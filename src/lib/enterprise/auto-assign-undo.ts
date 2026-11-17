/**
 * 撤销「行末自动分配」（原型 pr.autoone，6 秒内可撤销；P-撤销-01 按原样回滚、不半撤）。
 *
 * 自动分配一下动了这些，撤销整批还回去：
 *   - 项目负责人还给原来那位，原来是「待分配」的按原时刻把待分配标记还上（还负责人 不碰待分配，这里自己还）
 *   - 那条「再不跟进就回公海」的提醒、卡点认领跟着换回原负责人
 *   - 被撤的转让痕、这次的分配记录（占本月额度的那一行）删掉，不另记一条（操作日志由调用方记）
 *   - 市场第一次分给销售（X-18）连客户一起转的：客户负责人还原、一起带过去的计划 / 待办 / 项目 / 待分配状态按 带过来 还
 *
 * 只认自己刚才那一下：项目最近一条留痕得是 操作人 在撤销时限内把它从 原 转给现负责人的 transfer，项目还在线索阶段、没结局、没进公海；
 * 原负责人得还在职。前端带回来的 还原单 不可信：形状在这里规整，值全靠留痕和库里的现状核对。
 * 任何一处对不上（被人推进了、又改过、带过去的活被动过）整批不动，回原因让人手工改。
 * 从公海里分出来的（原来 pooledAt 有值）不在这里撤：那一下连客户可能一起出了客户公海，回原因让人到公海里放回。
 */
import type { Prisma } from "@/generated/prisma";
import { 撤销时限毫秒, 删被撤的换负责人记录 } from "@/lib/owner-log-db";
import { 还负责人 } from "@/lib/project/owner-write";
import { 将回收提醒跟着换人 } from "@/lib/project/db";
import { 卡点随项目换人, 转让接手理由 } from "@/lib/project/blocker";
import { 带过来对不上, 还项目, type 带走的 } from "@/lib/carry-over-db";
import { 还待分配状态 } from "@/lib/enterprise/market-transfer";

/** 自动分配成了之后回给界面的「还原单」：撤销时原样交回来 */
export type 自动分配还原 = {
  /** 分之前的负责人（在公海里的是历史负责人） */
  原: string | null;
  /** 分之前是待分配的：那一刻（ISO）；不是 = null */
  待分配: string | null;
  /** 分之前在公海里：入池时刻（ISO）；不在 = null */
  公海: string | null;
  /** 市场转销售连客户一起转了：客户、原客户负责人、一起带过去的 */
  客户?: { customerId: string; 原: string; 带过来: 带走的 };
};

const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string").slice(0, 500) : []);
const 串或空 = (x: unknown): string | null => (typeof x === "string" && x ? x : null);

/** 前端带回来的还原单不可信：只留形状对的 */
export function 规整还原单(x: unknown): 自动分配还原 | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const 单: 自动分配还原 = { 原: 串或空(o.原), 待分配: 串或空(o.待分配), 公海: 串或空(o.公海) };
  const c = o.客户 as Record<string, unknown> | undefined;
  if (c && typeof c === "object" && typeof c.customerId === "string" && typeof c.原 === "string") {
    const 带 = (c.带过来 ?? {}) as Record<string, unknown>;
    const 清 = Array.isArray(带.清待分配)
      ? 带.清待分配.filter((r): r is { id: string; at: string } => !!r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string" && typeof (r as { at?: unknown }).at === "string").map((r) => ({ id: r.id, at: r.at })).slice(0, 500)
      : [];
    单.客户 = {
      customerId: c.customerId, 原: c.原,
      带过来: { 计划: ids(带.计划), 待办: ids(带.待办), 商机: ids(带.商机), 项目: ids(带.项目), 公海项目: ids(带.公海项目), 清待分配: 清, 补方式: ids(带.补方式), 补分配: ids(带.补分配) },
    };
  }
  return 单;
}

/** 撤到一半发现对不上：抛它让事务整个回滚 */
class 对不上 extends Error {}

/**
 * 在调用方的事务里调（调用方包 看全部：撤完项目归原负责人，按「我」限定着查会查不到）。
 * 成了回 { ok: true, 名, 原 }；对不上回 { ok: false, error }（事务里已经写的由抛错回滚）
 */
export async function 撤回自动分配(
  tx: Prisma.TransactionClient, projectId: string, 单: 自动分配还原, 操作人: string,
  /** 这次补进带过去项目「分配方式」格的叫法（字典「分配方式」第 2 项，调用方事务外读好）：补方式 按它核对、还成空 */
  方式: string, now = Date.now(),
): Promise<{ ok: true; 名: string; 原: string; 现: string } | { ok: false; error: string }> {
  const 撤不了 = (为什么: string) => ({ ok: false as const, error: `${为什么}，要改回请手工改` });
  if (单.公海) return 撤不了("从公海分出去的撤不了整批（客户可能一起出了客户公海），到公海里放回");
  if (!单.原) return 撤不了("分之前没有负责人");
  const p = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, node: true, phase: true, result: true, ownerId: true, pooledAt: true, awaitAssignAt: true, customerId: true } });
  if (!p) return 撤不了("这条新线索已经不在了");
  if (p.phase !== "线索" || p.result || p.pooledAt || p.awaitAssignAt) return 撤不了("这条新线索分完之后又被推进、放回公海或改过");
  const 现 = p.ownerId;
  const 痕 = await tx.projectNodeLog.findFirst({
    where: { projectId },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { id: true, kind: true, userId: true, fromOwnerId: true, toOwnerId: true, at: true },
  });
  if (!痕 || 痕.kind !== "transfer" || 痕.userId !== 操作人 || 痕.toOwnerId !== 现 || (痕.fromOwnerId || null) !== 单.原) return 撤不了("分完之后负责人又改过");
  if (痕.at.getTime() < now - 撤销时限毫秒) return 撤不了("过了撤销时限");
  const 原 = 单.原;
  if ((await tx.user.findUnique({ where: { id: 原 }, select: { active: true } }))?.active !== true) return 撤不了("原负责人已停用");

  // 客户层（市场转销售 X-18）：先还客户和带过去的活，再还这个项目——还项目 只还带过去的那几条，这一条不在里面
  const 客 = 单.客户;
  if (客) {
    if (客.customerId !== p.customerId) throw new 对不上("还原单和这条新线索的客户对不上");
    const c = await tx.customer.findUnique({ where: { id: 客.customerId }, select: { salesOwnerId: true } });
    if (c?.salesOwnerId !== 现) throw new 对不上("客户负责人分完之后又改过");
    // 补方式：市场转一位 补的是这次的分配方式（自动分配），不是客户层的「指定分配」——自己核、自己还，不交给 带过来对不上 / 还待分配状态
    const 补 = [...new Set(客.带过来.补方式 ?? [])];
    const 带过来 = { ...客.带过来, 补方式: [] };
    const 补对上 = 补.length ? await tx.project.count({ where: { id: { in: 补 }, customerId: 客.customerId, ownerId: 现, assignMode: 方式 } }) : 0;
    const 差 = (await 带过来对不上(tx, 带过来, [客.customerId], 现)) + 补.length - 补对上;
    if (差) throw new 对不上(`一起转过去的计划、待办、项目里有 ${差} 条已经被改过（换了人、做完了或删了）`);
    await tx.customer.update({ where: { id: 客.customerId }, data: { salesOwnerId: 客.原 } });
    await 删被撤的换负责人记录(tx, 客.customerId, 客.原, 现, 操作人);
    const 这位 = { in: [客.customerId] };
    await tx.followPlan.updateMany({ where: { id: { in: 客.带过来.计划 }, customerId: 这位, ownerId: 现, done: false }, data: { ownerId: 客.原 } });
    await tx.task.updateMany({ where: { id: { in: 客.带过来.待办 }, customerId: 这位, ownerId: 现, done: false }, data: { ownerId: 客.原 } });
    await 还待分配状态(tx, 带过来, 客.customerId, 现);
    if (补.length) await tx.project.updateMany({ where: { id: { in: 补 }, customerId: 客.customerId, ownerId: 现, assignMode: 方式 }, data: { assignMode: null } });
    await 还项目(tx, (客.带过来.项目 ?? []).filter((id) => id !== projectId), 客.customerId, 现, 客.原, 操作人);
  }
  // 项目本身：提醒、卡点认领先换回去，再还负责人和待分配时刻（条件带上现负责人：中间被人改了就一行都不动）
  await 将回收提醒跟着换人(tx, p, 现, 原);
  await 卡点随项目换人(tx, p.id, 现, 原, 操作人, 转让接手理由);
  const 待分配时刻 = 单.待分配 ? new Date(单.待分配) : null;
  const 改 = await tx.project.updateMany({
    where: { id: p.id, ownerId: 现, phase: "线索", result: null, pooledAt: null },
    data: { ...还负责人(原), awaitAssignAt: 待分配时刻 && !Number.isNaN(待分配时刻.getTime()) ? 待分配时刻 : null },
  });
  if (改.count !== 1) throw new 对不上("这条新线索刚又被改过");
  await tx.projectNodeLog.delete({ where: { id: 痕.id } });
  // 这次的分配记录（占本月额度）删掉：撤了 = 没分过
  const 记 = await tx.entLeadAssign.findFirst({ where: { projectId, toUserId: 现, byUserId: 操作人, fromUserId: 原 }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
  if (记) await tx.entLeadAssign.delete({ where: { id: 记.id } });
  return { ok: true, 名: p.name, 原, 现 };
}

export { 对不上 as 自动分配撤销对不上 };
