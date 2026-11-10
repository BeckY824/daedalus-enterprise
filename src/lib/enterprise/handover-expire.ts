/**
 * 企业版申请移交超时作废（11-10 新口径，覆盖 X-46 ⑥ 原来的「7 天提醒后一直挂着」）：
 * 负责人本人发起的申请移交（转让、发起人 = 原负责人）挂满 7 天没人处理（接手人没确认 / 拒绝，发起人没撤回）→ 自动作废，
 * 站内通知申请人一次（因超过 7 天没处理已作废，需要可重新申请）。作废 = 什么都不转，客户、项目归属不变；客户不再算「申请中」，可以重新申请。
 * 管理发起的要确认的交接、离职交接不在这条里（不是「申请移交」）。
 *
 * 不加表、不加定时任务：挂在夜扫那个钟上（lib/project/nightly.ts），每分钟看一眼。天数从发起那天算（改过接手人也不重算）。
 * 并发：带着「还待确认」条件改，和接手人确认 / 拒绝、发起人撤回同时发生只成一个；命中 0 行就跳过，不通知、不留痕。
 * 留痕：操作日志记在「系统」名下（同超时回收）；交接行 doneById = system。
 * 通知只发一次靠 EntNotice 的 (userId, dedupeKey) 唯一键，key = handover:<id>:作废；发起人已停用不发。
 * 接手人那条「等你确认」标已读（申请没了，不用他再管）。切换视图里跳过；任何错只记日志，从不往外抛
 */
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { 看全部 } from "@/lib/team-scope";
import { 系统 } from "@/lib/project/timeout";
import { notify } from "./notify";
import { 企业版 } from "./switch";
import { 视图中跳过 } from "./view-as";
import { 待确认, 已作废, 读ids } from "./handover-db";

export const 移交作废天数 = 7;
const 一天毫秒 = 24 * 60 * 60_000;
/** 界面上作废的申请怎么写（客户页顶上那条，HandoverPending） */
export const 移交作废说法 = `已作废（超 ${移交作废天数} 天未处理）`;

export function 移交作废键(handoverId: string): string {
  return `handover:${handoverId}:作废`;
}

/** 扫一遍，返回这一遍作废了几笔 */
export async function 挂起移交作废(现在: Date = new Date()): Promise<number> {
  if (!企业版()) return 0;
  try {
    if (await 视图中跳过()) return 0;
    const 截止 = new Date(现在.getTime() - 移交作废天数 * 一天毫秒);
    const 行 = (
      await 看全部(() =>
        prisma.entHandover.findMany({
          where: { kind: "转让", status: 待确认, createdAt: { lte: 截止 } },
          select: { id: true, fromUserId: true, toUserId: true, byUserId: true, customerIds: true },
          orderBy: { createdAt: "asc" },
          take: 200,
        }),
      )
    ).filter((h) => h.byUserId === h.fromUserId);
    if (!行.length) return 0;
    const 人 = new Map(
      (
        await prisma.user.findMany({ where: { id: { in: [...new Set(行.flatMap((h) => [h.byUserId, h.toUserId]))] } }, select: { id: true, name: true, active: true } })
      ).map((u) => [u.id, u]),
    );
    let 作废了 = 0;
    for (const h of 行) {
      const r = await 看全部(() =>
        prisma.entHandover.updateMany({ where: { id: h.id, status: 待确认 }, data: { status: 已作废, doneAt: 现在, doneById: 系统.id } }),
      );
      // 刚被人确认 / 拒绝 / 撤回了：不动
      if (r.count !== 1) continue;
      作废了++;
      const 发起人 = 人.get(h.byUserId);
      const 接手人 = 人.get(h.toUserId);
      const ids = 读ids(h.customerIds);
      const 几位 = ids.length ? ` ${ids.length} 位客户` : "客户";
      await recordAudit({
        user: 系统, action: "assign", entity: "Customer", entityId: null,
        summary: `「${发起人?.name ?? h.byUserId}」申请移交给「${接手人?.name ?? h.toUserId}」的${几位}超过 ${移交作废天数} 天没人处理，申请自动作废，数据留在原负责人名下`,
        detail: { 交接: h.id, kind: "转让", 状态: 已作废, fromUserId: h.fromUserId, toUserId: h.toUserId, 客户: ids },
      });
      await prisma.entNotice.updateMany({ where: { userId: h.toUserId, dedupeKey: `handover:${h.id}:发起`, readAt: null }, data: { readAt: 现在 } });
      if (发起人?.active) {
        await notify([h.byUserId], {
          kind: "交接",
          title: `你申请移交给 ${接手人?.name ?? ""} 的${几位}已作废`,
          body: `因超过 ${移交作废天数} 天没处理，这笔移交申请已自动作废，客户仍在你名下；需要的话可以重新申请。`,
          link: "/customers",
          key: 移交作废键(h.id),
        });
      }
    }
    return 作废了;
  } catch (e) {
    console.error("[移交作废] 这一遍没扫成，下一遍再试", e);
    return 0;
  }
}
