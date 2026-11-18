/**
 * 新建线索后「待分配」（2026-11-01 清单 A7 / A10）：项目建好留在新线索、没有负责人，等市场管理 / 销售管理 / 总管理员手动分。
 *
 * Project.ownerId 不能空，待分配时还是建的人占着那一格；awaitAssignAt 记下「从这一刻起待分配」，
 * 新线索列表按它摆成「待分配」，自动分配挑人时不把建的人当现负责人跳过。凡换负责人就清掉（P-转-21，lib/project/owner-write.ts 换负责人）。
 *
 * - 分配方式选自动分配、业务线是「暂不分配」：建好直接待分配，不发提醒（本来就是要等人分）。
 *   分配方式选「暂不分配」不来这里：建的人自己负责、落在潜客培育（P-转-03、X-90，after-create-assign.ts）
 * - 自动分配没分出去（这条业务线没人可分）：待分配，并提醒市场管理、销售管理、总管理员（A10）
 *
 * 只有企业版；开关关着什么都不写
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 企业版 } from "./switch";
import { 发待分配提醒, 满额提醒收件人 } from "./lead-full-notice";
import type { 组织 } from "./org-core";

export async function 标待分配(
  projectId: string,
  提醒: { org: 组织; 名: string; 谁建的: string; 为什么: string } | null,
  今 = new Date(),
): Promise<void> {
  if (!企业版()) return;
  await prisma.project.updateMany({ where: { id: projectId, phase: "线索", result: null, pooledAt: null }, data: { awaitAssignAt: 今 } });
  // 提醒没发出去不能连累已经建好的项目
  if (提醒) await 发待分配提醒(提醒.org, [提醒.名], 提醒.谁建的, 提醒.为什么, 今).catch((e) => console.error("[待分配提醒] 没发出去", e));
}

/**
 * 这家客户是不是被一条待分配的线索占着（X-87）：客户负责人就是那条待分配线索里占着负责人一格的建的人。
 * 是 = 这家客户其实还没有负责人，同号协同按没有负责人办（写进客户、通知能分配的人、不邀请不通知建的人）。回那条项目
 */
export async function 待分配占着(db: Prisma.TransactionClient | typeof prisma, customerId: string, salesOwnerId: string): Promise<{ id: string } | null> {
  return db.project.findFirst({
    where: { customerId, ownerId: salesOwnerId, awaitAssignAt: { not: null }, phase: "线索", result: null, pooledAt: null, deletedAt: null },
    orderBy: { awaitAssignAt: "desc" },
    select: { id: true },
  });
}

/**
 * 待分配期间占着负责人一格的人（建的人）只能看和改字段，不能初判、推进、删除（P-转-21、X-68，11-10 定）。
 * 是 = 拦。认的是占位的人（ownerId），不是 creatorId：离职交接后接手人占着的待分配同样拦。
 * 能分配的人、系统管理员不是占位的人，照各自原来的权限；进了公海（pooledAt）的不算待分配
 */
export function 待分配占位(me: { id: string }, p: { ownerId: string; awaitAssignAt?: Date | null; pooledAt?: Date | null }): boolean {
  return 企业版() && !!p.awaitAssignAt && !p.pooledAt && p.ownerId === me.id;
}
export const 待分配不能动 = "这条新线索在等分配，你只是先占着负责人一格：能看、能改字段，初判、推进、删除要等分给负责人以后";

/** 能分配待分配线索的人：市场管理、销售管理、总管理员（同待分配提醒的收件人，A7 / A10） */
export function 能分配的人们(org: 组织): string[] {
  return 满额提醒收件人(org, "待分配");
}
