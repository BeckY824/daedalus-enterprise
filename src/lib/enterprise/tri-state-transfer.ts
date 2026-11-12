/**
 * 客户三态 · 换负责人归不归零（M-公海-20 / M-公海-37）。纯函数 + 写换负责人日志时当下算一次（owner-log-db.ts 记换负责人 调）。
 *
 * 转让 / 离职交接 12 个月内满 2 次后不再归零；次数和窗口后台可改，改了只对之后的转让生效、不回改历史。所以：
 *   - 写日志那一刻（转让、申请移交被确认、离职交接……都走 记换负责人）按当时的三态规则算出归不归零，存进 CustomerOwnerLog.clockReset；
 *   - 三态关着时不算、留空；之后开了三态遇到空值，夜扫 / 按钮「第一次算到时」按那时的规则补存（tri-state-db.ts 存归零）
 * 撤销转让会把那一行删掉（owner-log-db.ts 删被撤的换负责人记录）：那次不算次数、它造成的归零也跟着没了（推断）
 */
import type { Prisma } from "@/generated/prisma";
import type { 三态规则 } from "@/lib/project/org-rules";
import { beijingDay } from "@/lib/business-clock";
import { 换负责人归零, type 换负责人记录, type 换负责人方式 } from "./tri-state";
import { 企业版 } from "./switch";

export const 换人方式: Readonly<Record<string, 换负责人方式>> = { assign: "转让", deactivate: "离职交接", claim: "公海捞取", "pool-assign": "公海指派", "market-assign": "市场首次分配" };

/**
 * 换负责人记录（按时间正序）→ 算三态要的记录。转让 / 离职交接：存过归不归零（clockReset）的照存的；没存过的按先后、拿现在的规则算一次，
 * 放进 待存（调用方存下，之后不再重算：M-公海-37 改规则只对之后的转让生效）
 */
export function 换负责人们of(
  行们: readonly { id?: string; at: Date; kind: string; clockReset?: boolean | null }[],
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


/**
 * 写换负责人日志之前（同一笔事务里）算这几位这次归不归零：只管转让（assign）/ 离职交接（deactivate），企业版、三态开着才算，别的回空 Map（留空）。
 * 读的是这几位以前的日志（存过的照存的，没存过的按现在的规则先补算），规则是此刻生效的那份
 */
export async function 当下归零(
  tx: Pick<Prisma.TransactionClient, "customerOwnerLog">,
  customerIds: readonly string[],
  kind: string,
  现在: Date = new Date(),
): Promise<Map<string, boolean>> {
  const 出 = new Map<string, boolean>();
  const 方式 = 换人方式[kind];
  if (!企业版() || (方式 !== "转让" && 方式 !== "离职交接") || !customerIds.length) return 出;
  // 动态引：org-rules-store 走 settings，别把整条引用链拉进 owner-log-db
  const 规则 = await (await import("@/lib/project/org-rules-store")).生效组织规则();
  if (!规则.三态.开) return 出;
  const 以前 = await tx.customerOwnerLog.findMany({
    where: { customerId: { in: [...customerIds] } },
    select: { id: true, customerId: true, at: true, kind: true, clockReset: true },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  const 按客户 = new Map<string, typeof 以前>();
  for (const r of 以前) 按客户.set(r.customerId, [...(按客户.get(r.customerId) ?? []), r]);
  for (const id of customerIds) {
    const 记录们 = 换负责人们of(按客户.get(id) ?? [], 规则.三态);
    出.set(id, 换负责人归零(记录们, { 日: beijingDay(现在), 方式 }, 规则.三态));
    for (const x of 记录们.待存) await tx.customerOwnerLog.updateMany({ where: { id: x.id, clockReset: null }, data: { clockReset: x.归零 } });
  }
  return 出;
}
