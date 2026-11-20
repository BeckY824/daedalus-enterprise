/**
 * 企业版判无效补位（2026-11-20，M-线索-02 补「优先」；用户 11-20：「如本轮次已分过客户的，只需要优先补1个客户即可，
 * 如正常1轮还没轮到，到优先补发客户之后，正常轮发客户还应不受影响」）。
 *
 * 线索验证最终判无效（市场复核 / 总管理终判判无效），负责人在这条线索上占过名额（有算数的分配记录，或这条本身是补发来的）时，
 * 给他记一个「待补」（EntLeadMakeup 一行），每次判无效只记 1 个。判无效那条原来占的轮转名额不退（分配记录照算本月已分、不加配额）。
 * 之后的自动分配：
 * - 先按现行条件筛合格候选（参与状态、方向、区域、义乌档口、超时转排除的人……一条不改；按配额分时分满了的有待补也照挑，补发不占配额）；
 * - 候选里有对得上方向的待补的人优先，多人按退名额时间最早的先（lead-assign 挑接手人）；
 * - 挑中就用掉他最早的一个待补，记用在哪条分配上；这次是补发：分配记录 counted = false，不进本月已分、不影响轮转顺序。
 *   所以本轮他已分过的只额外补这 1 条、本轮不再多给；本轮还没轮到他的，补完以后正常轮到他时照常给。
 * - 有待补但这次不合格（停用、暂停 / 禁止、方向对不上……）= 这次不在候选里，待补留着。
 * 不用待补的：市场直接指定（P-转-30）、销售管理 / 总管理的公海分配（不计本月已分的那几种）、营销企划不算数的。
 * 待补跨月留着，用掉为止。判无效的线索被恢复（结局清掉）：这条线索上没用掉的作废；已用掉的不回收。撤销自动分配：那次用掉的退回待用。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

/** 一个待用的补位：给谁、哪一刻退的名额、方向 */
export type 补位行 = { userId: string; at: Date; line: string | null };
type 库 = Pick<Prisma.TransactionClient, "entLeadMakeup">;

/** 补位的方向和这次分配对得上：补位没记方向、这次没定方向（区域没填两条线都算）都算对得上 */
export const 线对得上 = (补: string | null, 这次: string | null | undefined): boolean => !补 || !这次 || 补 === 这次;

/** 待用 = 没用掉、没作废 */
const 待用 = { usedAt: null, voidAt: null } as const;

/**
 * 判无效时记一个补位（lead-verify 判死，事务里调）。方向取这条线索上他最近一条分配记录的 line（补发来的 counted = false 也算）。
 * 同一条线索同一个人已有待用的补位就不再记（防重复判、重跑），回 false
 */
export async function 记补位(tx: Pick<Prisma.TransactionClient, "entLeadMakeup" | "entLeadAssign">, userId: string, projectId: string, at = new Date()): Promise<boolean> {
  if (await tx.entLeadMakeup.findFirst({ where: { userId, projectId, ...待用 }, select: { id: true } })) return false;
  const 分 = await tx.entLeadAssign.findFirst({ where: { projectId, toUserId: userId }, orderBy: { createdAt: "desc" }, select: { line: true } });
  await tx.entLeadMakeup.create({ data: { userId, projectId, line: 分?.line ?? null, createdAt: at } });
  return true;
}

/** 这几个人待用的补位，按退名额时间先后（再按 id，结果不随查询顺序变） */
export async function 待用补位行(ids: readonly string[], db: 库 = prisma): Promise<补位行[]> {
  if (!ids.length) return [];
  const 行 = await db.entLeadMakeup.findMany({
    where: { userId: { in: [...ids] }, ...待用 },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { userId: true, createdAt: true, line: true },
  });
  return 行.map((r) => ({ userId: r.userId, at: r.createdAt, line: r.line }));
}

/** 每人待补几条（「待补 N」显示用，不分方向）；没有的不在表里 */
export async function 待补数们(ids: readonly string[], db: 库 = prisma): Promise<Map<string, number>> {
  const 数 = new Map<string, number>();
  for (const r of await 待用补位行(ids, db)) 数.set(r.userId, (数.get(r.userId) ?? 0) + 1);
  return 数;
}

/**
 * 自动分配写分配记录的那个事务里先找：userId 最早一个方向对得上的待补（有 = 这次是补发，分配记录 counted = false、不查满额）。没有 = null。
 * 事务是 BEGIN IMMEDIATE、写的人排队，找到的到 用掉补位 之前不会被别人用掉
 */
export async function 找待用补位(tx: 库, userId: string, 线: string | null): Promise<string | null> {
  const 们 = await tx.entLeadMakeup.findMany({ where: { userId, ...待用 }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, line: true } });
  return 们.find((b) => 线对得上(b.line, 线))?.id ?? null;
}

/** 写完分配记录后标这个待补用掉了：用在哪条分配、哪个项目上。按「还是待用」条件写，回写没写上 */
export async function 用掉补位(tx: 库, id: string, assignId: string, projectId: string | null, now = new Date()): Promise<boolean> {
  return (await tx.entLeadMakeup.updateMany({ where: { id, ...待用 }, data: { usedAt: now, usedAssignId: assignId, usedProjectId: projectId } })).count === 1;
}

/** 这条线索是补发给 userId 的（用掉过他的待补、没撤销）：判无效时同样算占过名额（补来的又是坏线索，再补 1 条） */
export async function 是补发来的(db: 库, projectId: string, userId: string): Promise<boolean> {
  return !!(await db.entLeadMakeup.findFirst({ where: { usedProjectId: projectId, userId, usedAt: { not: null } }, select: { id: true } }));
}

/** 每人本月补发了几条（用掉的待补，按用掉时刻在 起 之后）：「本月已分 N（另补 M）」用；没有的不在表里 */
export async function 本月另补们(ids: readonly string[], 起: Date, db: 库 = prisma): Promise<Map<string, number>> {
  const 数 = new Map<string, number>();
  if (!ids.length) return 数;
  const 行 = await db.entLeadMakeup.findMany({ where: { userId: { in: [...ids] }, usedAt: { gte: 起 } }, select: { userId: true } });
  for (const r of 行) 数.set(r.userId, (数.get(r.userId) ?? 0) + 1);
  return 数;
}

/** 判无效的线索被恢复（结局清掉）：这条线索上没用掉的补位作废，回作废了几个。已用掉的不回收 */
export async function 作废补位(tx: 库, projectId: string, now = new Date()): Promise<number> {
  return (await tx.entLeadMakeup.updateMany({ where: { projectId, ...待用 }, data: { voidAt: now } })).count;
}

/** 撤销自动分配（删了那条分配记录）：那次用掉的补位退回待用 */
export async function 退回补位(tx: 库, assignIds: readonly string[]): Promise<number> {
  if (!assignIds.length) return 0;
  return (await tx.entLeadMakeup.updateMany({ where: { usedAssignId: { in: [...assignIds] }, voidAt: null }, data: { usedAt: null, usedAssignId: null, usedProjectId: null } })).count;
}

/** 这条线索判无效时记的补位还在待用（判无效结果通知里说「已记 1 条判无效待补」用） */
export async function 这条记了补位(projectId: string, userId: string, db: 库 = prisma): Promise<boolean> {
  return !!(await db.entLeadMakeup.findFirst({ where: { projectId, userId, ...待用 }, select: { id: true } }));
}
