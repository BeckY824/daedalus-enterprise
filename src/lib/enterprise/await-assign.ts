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
import { prisma } from "@/lib/prisma";
import { 企业版 } from "./switch";
import { 发待分配提醒 } from "./lead-full-notice";
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
