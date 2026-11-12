/**
 * 企业版申请移交超时作废（11-10 新口径，覆盖 X-46 ⑥ 原来的「7 天提醒后一直挂着」）：
 * 负责人本人发起的申请移交（转让、发起人 = 原负责人）挂满 7 天没人处理（接手人没确认 / 拒绝，发起人没撤回）→ 自动作废，
 * 站内通知申请人一次（因超过 7 天没处理已作废，需要可重新申请）。作废前一天（挂满 6 天）先给申请人、接手人各发一条预告，
 * 预告发出满 24 小时才作废（存量里已挂满 7 天的也先预告、第二天才作废）。作废 = 什么都不转，客户、项目归属不变；客户不再算「申请中」，可以重新申请。
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

import { 移交作废天数 } from "./handover-expire-days";

export { 移交作废天数, 移交作废说法 } from "./handover-expire-days";
const 一天毫秒 = 24 * 60 * 60_000;

export function 移交作废键(handoverId: string): string {
  return `handover:${handoverId}:作废`;
}

/** 作废前一天的预告：同一人同一笔只收一次（EntNotice 唯一键）；「预告发没发过、什么时候发的」也就查这条，不另加列 */
export function 移交预告键(handoverId: string): string {
  return `handover:${handoverId}:作废预告`;
}

/**
 * 扫一遍，返回这一遍作废了几笔。两步：
 *   1. 挂满 6 天还待确认 → 给申请人、接手人各发一条预告（明天自动作废，请尽快处理），每人只发一次（改过接手人的，新接手人没收过也补）；
 *   2. 挂满 7 天、且预告已发出满 24 小时 → 作废。上线时存量里已经挂满 7 天的，第一遍只收到预告，24 小时后才作废。
 *      两个人都停用了（没人可预告）的不等预告，满 7 天直接作废。
 */
export async function 挂起移交作废(现在: Date = new Date()): Promise<number> {
  if (!企业版()) return 0;
  try {
    if (await 视图中跳过()) return 0;
    const 预告线 = new Date(现在.getTime() - (移交作废天数 - 1) * 一天毫秒);
    const 截止 = new Date(现在.getTime() - 移交作废天数 * 一天毫秒);
    const 预告满一天 = 现在.getTime() - 一天毫秒;
    const 行 = (
      await 看全部(() =>
        prisma.entHandover.findMany({
          where: { kind: "转让", status: 待确认, createdAt: { lte: 预告线 } },
          select: { id: true, fromUserId: true, toUserId: true, byUserId: true, customerIds: true, createdAt: true },
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
    // 已发的预告：谁收过、这一笔最早哪一刻发的
    const 收过 = new Set<string>();
    const 最早预告 = new Map<string, number>();
    for (const n of await prisma.entNotice.findMany({ where: { dedupeKey: { in: 行.map((h) => 移交预告键(h.id)) } }, select: { userId: true, dedupeKey: true, createdAt: true } })) {
      收过.add(`${n.userId}\n${n.dedupeKey}`);
      最早预告.set(n.dedupeKey, Math.min(最早预告.get(n.dedupeKey) ?? Infinity, n.createdAt.getTime()));
    }
    let 作废了 = 0;
    for (const h of 行) {
      const 发起人 = 人.get(h.byUserId);
      const 接手人 = 人.get(h.toUserId);
      const ids = 读ids(h.customerIds);
      const 几位 = ids.length ? ` ${ids.length} 位客户` : "客户";
      const 预告键 = 移交预告键(h.id);
      const 在职的 = [发起人, 接手人].filter((u): u is NonNullable<typeof u> => !!u?.active);
      const 要预告 = 在职的.filter((u) => !收过.has(`${u.id}\n${预告键}`));
      if (要预告.length) {
        const 已超 = h.createdAt.getTime() <= 截止.getTime();
        const 何时 = 已超 ? `已超过 ${移交作废天数} 天没人处理，24 小时后自动作废` : `明天（满 ${移交作废天数} 天）自动作废`;
        for (const u of 要预告) {
          const 给接手人 = u.id === h.toUserId;
          await notify([u.id], {
            kind: "交接",
            title: 给接手人 ? `${发起人?.name ?? ""} 申请移交给你的${几位}${何时}，请尽快处理` : `你申请移交给 ${接手人?.name ?? ""} 的${几位}${何时}，请尽快处理`,
            body: 给接手人 ? "请确认接手或拒绝；到时还没处理，申请自动作废，客户留在原负责人名下。" : "对方还没确认。到时还没处理，申请自动作废，客户仍在你名下；也可以现在撤回，或改接手人。",
            link: "/customers",
            key: 预告键,
          });
        }
        // 预告的时刻按这一遍的「现在」记（库里默认值是真实时钟）：作废要等它满 24 小时
        await prisma.entNotice.updateMany({ where: { dedupeKey: 预告键, userId: { in: 要预告.map((u) => u.id) } }, data: { createdAt: 现在 } });
      }
      // 满 7 天、预告发出满 24 小时才作废；没人可预告（两位都停用）的不等预告
      if (h.createdAt.getTime() > 截止.getTime()) continue;
      const 预告于 = 最早预告.get(预告键);
      if (预告于 === undefined ? 在职的.length > 0 : 预告于 > 预告满一天) continue;
      const r = await 看全部(() =>
        prisma.entHandover.updateMany({ where: { id: h.id, status: 待确认 }, data: { status: 已作废, doneAt: 现在, doneById: 系统.id } }),
      );
      // 刚被人确认 / 拒绝 / 撤回了：不动
      if (r.count !== 1) continue;
      作废了++;
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
