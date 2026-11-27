/**
 * 潜客培育计划随节点撤（2026-11-27，客户 E-396「按建议一起撤」）：
 * 判 MQL 不合格时系统给项目负责人建一条「潜客培育：…」跟进计划（mql.ts，写 projectId + autoBy = "mql-nurture"）。
 * 项目之后离开「潜客培育」节点（改回去、往后推、按必填自动推都算）时，这条系统自动建、还没完成的计划一起撤掉：
 *   - 撤 = 硬删这一行（和计划页「删除计划」同一个口径，计划列表 / 红点 / 到期提醒读不到，不算完成）+ 记一条操作日志；
 *   - 只认 projectId = 本项目 且 autoBy = mql-nurture 且 done = false：人自己加的计划、已完成的、发版前建的（两列都是空）一概不动。
 * 撤的几个口子（都在各自那笔事务里调）：改节点 / 按必填推进（db.ts）、市场分配进线索验证（market-assign-node.ts）、导入同步改节点（project-target.ts）、
 * 在潜客培育上终止进程（改节点结局）、删项目进回收站、项目进公海（放回、超时回收、客户整体进公海连带、离职放进公海，进公海撤培育计划）、
 * 项目合并（A 不在潜客培育时撤 B 的；A 也在则改指 A，project-merge.ts）。
 * 撤了不随撤销恢复：改节点撤销条 / 撤销分配 / 撤回导入 / 恢复回收站项目 / 撤销放回公海只还项目那几格，计划是硬删的不重建（E-396 客户口径）。
 * 撤的同时，这几条计划已经发出去、还没读的到期 / 逾期提醒（EntNotice，due-notice.ts 的 due:plan:<id>: / overdue:plan:<id>: 键）标已读，铃铛不留死链。
 */
import type { Prisma } from "@/generated/prisma";
import { 同名们 } from "./stage-dict";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";

/** 撤培育计划要的几张表（事务里的完整 tx 也行；市场分配那头的 tx 是 Pick 出来的，放宽到这几张） */
export type 撤用库 = Pick<Prisma.TransactionClient, "followPlan" | "auditLog" | "user" | "entNotice">;

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

/** 撤这个项目名下系统自动建、还没完成的培育计划；返回撤了几条（按实际删掉的行数） */
export async function 撤培育计划(tx: 撤用库, me: { id: string }, projectId: string): Promise<number> {
  // 看全部：计划挂在项目负责人名下，操作人（市场成员、同事、系统）的限定读写碰不到别人的行——按组织看客户开着时会一行没撤到（同 market-assign-node.ts）
  return 看全部(async () => {
    const 们 = await tx.followPlan.findMany({
      where: { projectId, autoBy: 培育计划来源, done: false },
      select: { id: true, subject: true, plannedAt: true, customerId: true, ownerId: true },
    });
    if (!们.length) return 0;
    const 删 = await tx.followPlan.deleteMany({ where: { id: { in: 们.map((x) => x.id) }, autoBy: 培育计划来源, done: false } });
    if (!删.count) return 0;
    // 已经发出去、还没读的到期 / 逾期提醒标已读（键前缀见 due-notice.ts）
    await tx.entNotice.updateMany({
      where: { readAt: null, OR: 们.flatMap((x) => [{ dedupeKey: { startsWith: `due:plan:${x.id}:` } }, { dedupeKey: { startsWith: `overdue:plan:${x.id}:` } }]) },
      data: { readAt: new Date() },
    });
    // me 是系统身份（超时回收等）、查不到人时记「系统」
    const 人 = await tx.user.findUnique({ where: { id: me.id }, select: { name: true } });
    await tx.auditLog.create({
      data: {
        userId: me.id, userName: 人?.name || "系统", action: "delete", entity: "FollowPlan", entityId: 们[0].id,
        summary: `${撤培育计划话}：${们.map((x) => `「${x.subject}」`).join("、")}`,
        detail: JSON.stringify({ 项目: projectId, 撤了: 删.count, 计划: 们.map((x) => ({ id: x.id, 主题: x.subject, 时间: x.plannedAt.toISOString(), 负责人: x.ownerId })) }),
      },
    });
    return 删.count;
  });
}

/** 一批项目进公海 / 进回收站：各自撤培育计划（企业版才撤）；返回撤了几条 */
export async function 项目们撤培育计划(tx: 撤用库, me: { id: string }, projectIds: readonly string[]): Promise<number> {
  if (!企业版()) return 0;
  let 共 = 0;
  for (const id of new Set(projectIds)) 共 += await 撤培育计划(tx, me, id);
  return 共;
}
