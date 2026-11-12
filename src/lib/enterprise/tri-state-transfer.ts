/**
 * 客户三态 · 换负责人归不归零（M-公海-20 / M-公海-37）。纯函数 + 写换负责人日志时当下算一次（owner-log-db.ts 记换负责人 调）。
 *
 * 转让 / 离职交接 12 个月内满 2 次后不再归零；次数和窗口后台可改，改了只对之后的转让生效、不回改历史。所以：
 *   - 写日志那一刻（转让、申请移交被确认、离职交接……都走 记换负责人）按当时的三态规则算出归不归零，存进 CustomerOwnerLog.clockReset；
 *   - 三态关着时不算、留空；之后开了三态遇到空值，夜扫 / 按钮「第一次算到时」按那时的规则补存（tri-state-db.ts 存归零）
 * 撤销转让会把那一行删掉（owner-log-db.ts 删被撤的换负责人记录）：撤销即未发生，次数和钟都还原（T7）。
 * T7 护栏：同一对负责人（从谁 → 到谁）7 天内「转—撤—转」第二次起，撤销不还原次数（钟照样还原）——
 * 撤销时在状态留痕记一行（记撤销转让），第二次起那行方式记「撤销转让·计次」，算次数时当成一次不归零的转让（撤销计次们）
 */
import type { Prisma } from "@/generated/prisma";
import { 规整组织规则, type 三态规则, type 组织规则 } from "@/lib/project/org-rules";
import { 字典of } from "@/lib/project/stage-dict";
import { BUSINESS_KEY, mergeBusiness, 企业版锁定, 企业版默认业务 } from "@/lib/business-config";
import { beijingDay } from "@/lib/business-clock";
import { 换负责人归零, type 换负责人记录, type 换负责人方式 } from "./tri-state";
import { 企业版 } from "./switch";

export const 换人方式: Readonly<Record<string, 换负责人方式>> = { assign: "转让", deactivate: "离职交接", claim: "公海捞取", "pool-assign": "公海指派", "market-assign": "市场首次分配" };

/**
 * 换负责人记录（按时间正序）→ 算三态要的记录。转让 / 离职交接：存过归不归零（clockReset）的照存的；没存过的按先后、拿现在的规则算一次，
 * 放进 待存（调用方存下，之后不再重算：M-公海-37 改规则只对之后的转让生效）
 */
export function 换负责人们of(
  行们: readonly 换人行[],
  规则: Pick<三态规则, "转让归零">,
): 换负责人记录[] & { 待存: { id: string; 归零: boolean }[] } {
  const 出 = [] as unknown as 换负责人记录[] & { 待存: { id: string; 归零: boolean }[] };
  出.待存 = [];
  for (const r of 行们) {
    const 方式 = 换人方式[r.kind];
    if (!方式) continue;
    const 日 = beijingDay(r.at);
    if (方式 === "转让" || 方式 === "离职交接") {
      const 存的 = r.clockReset ?? null;
      const 归零 = 存的 ?? 换负责人归零(出, { 日, 方式 }, 规则);
      if (存的 === null && r.id) 出.待存.push({ id: r.id, 归零 });
      出.push({ 日, 方式, 归零 });
    } else 出.push({ 日, 方式 });
  }
  return 出;
}


/** Setting 一行 → 值（同 settings.ts getSetting：存的是 JSON，解不开当没存） */
const 解 = (行: { value: string } | null): unknown => {
  if (!行) return null;
  try {
    return JSON.parse(行.value);
  } catch {
    return null;
  }
};

/**
 * 在事务里读「三态在不在跑、用哪份规则」：口径同 tri-state-db.ts 三态开着（企业版、项目模式开着、组织规则里三态开着），
 * 但走传进来的 tx 读 Setting，不走设置缓存 / 全局连接——SQLite 写事务独占，库只有一个连接时用外面的连接读会等到超时（第二轮审查）。
 * 没在跑回 null
 */
export async function 事务里三态规则(tx: Pick<Prisma.TransactionClient, "setting">): Promise<组织规则 | null> {
  if (!企业版()) return null;
  const 业务 = 企业版锁定(企业版默认业务(mergeBusiness(解(await tx.setting.findUnique({ where: { key: BUSINESS_KEY }, select: { value: true } })) as never)));
  if (业务.projectMode !== true) return null;
  const 规则 = 规整组织规则(解(await tx.setting.findUnique({ where: { key: "orgRules" }, select: { value: true } })), 字典of(true));
  return 规则.三态.开 ? 规则 : null;
}

/**
 * 写换负责人日志之前（同一笔事务里）算这几位这次归不归零：只管转让（assign）/ 离职交接（deactivate），三态在跑才算（事务里三态规则），别的回空 Map（留空）。
 * 读的是这几位以前的日志（存过的照存的，没存过的按现在的规则先补算），规则是此刻生效的那份；
 * 规则、日志都用 tx 读（转让事务里不能用外面的连接）；撤销了但照算次数的转让（T7）也算进以前的次数
 */
export async function 当下归零(
  tx: Pick<Prisma.TransactionClient, "customerOwnerLog" | "setting" | "entCustomerStateLog">,
  customerIds: readonly string[],
  kind: string,
  现在: Date = new Date(),
): Promise<Map<string, boolean>> {
  const 出 = new Map<string, boolean>();
  const 方式 = 换人方式[kind];
  if (!企业版() || (方式 !== "转让" && 方式 !== "离职交接") || !customerIds.length) return 出;
  const 规则 = await 事务里三态规则(tx);
  if (!规则) return 出;
  const 以前 = await tx.customerOwnerLog.findMany({
    where: { customerId: { in: [...customerIds] } },
    select: { id: true, customerId: true, at: true, kind: true, clockReset: true },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  const 按客户 = new Map<string, typeof 以前>();
  for (const r of 以前) 按客户.set(r.customerId, [...(按客户.get(r.customerId) ?? []), r]);
  const 计次 = await 撤销计次们(tx, customerIds);
  for (const id of customerIds) {
    const 记录们 = 换负责人们of(并上撤销计次(按客户.get(id) ?? [], 计次.get(id)), 规则.三态);
    出.set(id, 换负责人归零(记录们, { 日: beijingDay(现在), 方式 }, 规则.三态));
    for (const x of 记录们.待存) await tx.customerOwnerLog.updateMany({ where: { id: x.id, clockReset: null }, data: { clockReset: x.归零 } });
  }
  return 出;
}

/** T7：撤销转让留痕的方式（EntCustomerStateLog.via）；计次 = 这次撤销不还原转让次数 */
export const 撤销转让方式 = "撤销转让";
export const 撤销计次方式 = "撤销转让·计次";
/** 同一对负责人几天内再撤销就不还原次数（T7） */
export const 撤销计次天数 = 7;
const 一天毫秒 = 86_400_000;

/**
 * 企业版撤销转让（删掉被撤的那行之前，同一笔事务里调）：三态在跑时每位留一行痕（每次撤销都留，T7「每次撤销留操作日志」；操作日志另有 recordAudit）。
 * 这一对负责人在这位客户上 7 天内已经撤销过一次 → 这次记「撤销转让·计次」：次数不还原。三态关着不记（零影响）
 */
export async function 记撤销转让(
  tx: Pick<Prisma.TransactionClient, "setting" | "entCustomerStateLog" | "entCustomerClock">,
  行们: readonly { customerId: string; userId: string; at: Date }[],
  from: string,
  to: string,
  现在: Date = new Date(),
): Promise<void> {
  if (!行们.length || !(await 事务里三态规则(tx))) return;
  const ids = [...new Set(行们.map((r) => r.customerId))];
  const 撤过 = new Set((await tx.entCustomerStateLog.findMany({
    where: { customerId: { in: ids }, via: { in: [撤销转让方式, 撤销计次方式] }, fromOwnerId: from, toOwnerId: to, at: { gte: new Date(现在.getTime() - 撤销计次天数 * 一天毫秒) } },
    select: { customerId: true },
  })).map((x) => x.customerId));
  const 钟 = new Map((await tx.entCustomerClock.findMany({ where: { customerId: { in: ids } }, select: { customerId: true, state: true } })).map((x) => [x.customerId, x.state]));
  for (const r of 行们) {
    const 计次 = 撤过.has(r.customerId);
    const 态 = 钟.get(r.customerId) ?? "活跃";
    await tx.entCustomerStateLog.create({
      data: {
        customerId: r.customerId, fromState: 态, toState: 态, userId: r.userId, via: 计次 ? 撤销计次方式 : 撤销转让方式, fromOwnerId: from, toOwnerId: to, at: 现在,
        reason: 计次 ? `撤销转让：${撤销计次天数} 天内同一对负责人第 2 次起撤销，这次转让照算次数，钟还原` : "撤销转让：次数和钟都还原",
      },
    });
  }
}

/** T7：这些客户「撤销了但照算次数」的转让（撤销转让·计次那几行）→ 换负责人行（当成一次不归零的转让，日子取撤销那天） */
export async function 撤销计次们(db: Pick<Prisma.TransactionClient, "entCustomerStateLog">, customerIds: readonly string[]): Promise<Map<string, 换人行[]>> {
  const 出 = new Map<string, 换人行[]>();
  if (!customerIds.length) return 出;
  for (const r of await db.entCustomerStateLog.findMany({ where: { customerId: { in: [...customerIds] }, via: 撤销计次方式 }, select: { customerId: true, at: true }, orderBy: { at: "asc" } })) {
    出.set(r.customerId, [...(出.get(r.customerId) ?? []), { at: r.at, kind: "assign", clockReset: false }]);
  }
  return 出;
}

export type 换人行 = { id?: string; at: Date; kind: string; clockReset?: boolean | null };
/** 换负责人日志 + 撤销计次，按时间先后并起来 */
export const 并上撤销计次 = (日志: readonly 换人行[], 计次: readonly 换人行[] | undefined): 换人行[] =>
  计次?.length ? [...日志, ...计次].sort((a, b) => a.at.getTime() - b.at.getTime()) : [...日志];
