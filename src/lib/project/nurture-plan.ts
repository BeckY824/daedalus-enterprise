/**
 * 潜客培育计划随节点撤（2026-11-27，客户 E-396「按建议一起撤」）：
 * 判 MQL 不合格时系统给项目负责人建一条「潜客培育：…」跟进计划（mql.ts，写 projectId + autoBy = "mql-nurture"）。
 * 项目之后离开「潜客培育」节点（改回去、往后推、按必填自动推都算）时，这条系统自动建、还没完成的计划一起撤掉：
 *   - 撤 = 硬删这一行（和计划页「删除计划」同一个口径，计划列表 / 红点 / 到期提醒读不到，不算完成）+ 记一条操作日志；
 *   - 只认 projectId = 本项目 且 autoBy = mql-nurture 且 done = false：人自己加的计划、已完成的、发版前建的（两列都是空）一概不动。
 * 在改节点的那笔事务里调。
 */
import type { Prisma } from "@/generated/prisma";
import { 同名们 } from "./stage-dict";

/** 撤培育计划要的几张表（事务里的完整 tx 也行；市场分配那头的 tx 是 Pick 出来的，放宽到这几张） */
export type 撤用库 = Pick<Prisma.TransactionClient, "followPlan" | "auditLog" | "user">;

export const 培育计划来源 = "mql-nurture";
export const 撤培育计划话 = "项目离开潜客培育，自动培育计划随之撤销";

/** 这个节点是不是「潜客培育」（新旧节点名都认） */
export function 在潜客培育(节点: string): boolean {
  return 同名们("潜客培育").includes(节点);
}

/** 从「潜客培育」走到别的节点才算离开（新旧节点名都认；原地不动、从别处进来都不算） */
export function 离开了潜客培育(从节点: string, 到节点: string): boolean {
  const 们 = 同名们("潜客培育");
  return 们.includes(从节点) && !们.includes(到节点);
}

/** 撤这个项目名下系统自动建、还没完成的培育计划；返回撤了几条 */
export async function 撤培育计划(tx: 撤用库, me: { id: string }, projectId: string): Promise<number> {
  const 们 = await tx.followPlan.findMany({
    where: { projectId, autoBy: 培育计划来源, done: false },
    select: { id: true, subject: true, plannedAt: true, customerId: true, ownerId: true },
  });
  if (!们.length) return 0;
  await tx.followPlan.deleteMany({ where: { id: { in: 们.map((x) => x.id) } } });
  const 人 = await tx.user.findUnique({ where: { id: me.id }, select: { name: true } });
  await tx.auditLog.create({
    data: {
      userId: me.id, userName: 人?.name ?? "", action: "delete", entity: "FollowPlan", entityId: 们[0].id,
      summary: `${撤培育计划话}：${们.map((x) => `「${x.subject}」`).join("、")}`,
      detail: JSON.stringify({ 项目: projectId, 计划: 们.map((x) => ({ id: x.id, 主题: x.subject, 时间: x.plannedAt.toISOString(), 负责人: x.ownerId })) }),
    },
  });
  return 们.length;
}
