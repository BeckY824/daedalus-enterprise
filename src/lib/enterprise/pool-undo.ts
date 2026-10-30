/**
 * 撤销「从项目公海领走 / 分走」（2026-10-30，交互规则 B：转移归属一律能撤）：项目回到项目公海，负责人还给原来那位。
 * 客户公海那一半（客户本身）照旧走 customers/pool-actions.ts 撤销公海，这里只管项目。
 *
 * 只认自己刚才那一下：项目最近一条留痕得是 操作人 在撤销时限内把它领 / 分给 现 的 pool-claim，项目现在还归 现、不在公海，
 * 原负责人还在职（还给停用的人等于丢进黑洞，同撤销公海）。前端传回来的参数不可信，全靠这条留痕认。
 * 入池时间还原成领走前最近那次进公海的时间；领走那一行留痕删掉——只是撤回，不算又放回一次，入池原因、退回次数都照旧。
 * 谁撤的由调用方记操作日志。在调用方的事务里调，调用方包 看全部（撤完项目回公海，限定着查会查不到）
 */
import type { Prisma } from "@/generated/prisma";
import { 撤销时限毫秒 } from "@/lib/owner-log-db";

export async function 撤回项目公海(tx: Prisma.TransactionClient, projectId: string, 现: string, 操作人: string): Promise<boolean> {
  const p = await tx.project.findUnique({ where: { id: projectId }, select: { ownerId: true, pooledAt: true } });
  if (!p || p.pooledAt || p.ownerId !== 现) return false;
  const 痕 = await tx.projectNodeLog.findFirst({
    where: { projectId },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { id: true, kind: true, userId: true, fromOwnerId: true, toOwnerId: true, at: true },
  });
  if (!痕 || 痕.kind !== "pool-claim" || 痕.userId !== 操作人 || 痕.toOwnerId !== 现 || !痕.fromOwnerId) return false;
  if (痕.at.getTime() < Date.now() - 撤销时限毫秒) return false;
  if ((await tx.user.findUnique({ where: { id: 痕.fromOwnerId }, select: { active: true } }))?.active !== true) return false;
  const 放 = await tx.projectNodeLog.findFirst({
    where: { projectId, kind: "pool-release", at: { lte: 痕.at } },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { at: true },
  });
  await tx.project.update({ where: { id: projectId }, data: { ownerId: 痕.fromOwnerId, pooledAt: 放?.at ?? 痕.at } });
  await tx.projectNodeLog.delete({ where: { id: 痕.id } });
  return true;
}
