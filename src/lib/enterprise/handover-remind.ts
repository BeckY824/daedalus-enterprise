/**
 * 企业版申请移交挂起提醒（X-46 ⑥）：负责人本人发起的申请移交（转让、发起人 = 原负责人）等了 7 天还没人确认，
 * 站内通知提醒一次接手人和发起人。只提醒，不自动生效、不自动作废，之后接着等；发起人可以撤回或改接手人。
 *
 * 不加表、不加定时任务：挂在夜扫那个钟上（lib/project/nightly.ts），每分钟看一眼。
 * 只提醒一次靠 EntNotice 的 (userId, dedupeKey) 唯一键，key = handover:<id>:挂起7天；发之前先查已记的，别每遍去撞唯一键。
 * 改了接手人的，新接手人没收过也补一次（天数仍从发起那天算）。停用的人不收。切换视图里跳过；任何错只记日志，从不往外抛
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { notify } from "./notify";
import { 企业版 } from "./switch";
import { 视图中跳过 } from "./view-as";
import { 待确认, 读ids } from "./handover-db";

export const 挂起提醒天数 = 7;
const 一天毫秒 = 24 * 60 * 60_000;

export function 挂起提醒键(handoverId: string): string {
  return `handover:${handoverId}:挂起${挂起提醒天数}天`;
}

/** 扫一遍，返回新发了几条 */
export async function 挂起移交提醒(现在: Date = new Date()): Promise<number> {
  if (!企业版()) return 0;
  try {
    if (await 视图中跳过()) return 0;
    const 截止 = new Date(现在.getTime() - 挂起提醒天数 * 一天毫秒);
    const 行 = (
      await 看全部(() =>
        prisma.entHandover.findMany({
          where: { kind: "转让", status: 待确认, createdAt: { lte: 截止 } },
          select: { id: true, fromUserId: true, toUserId: true, byUserId: true, customerIds: true },
        }),
      )
    ).filter((h) => h.byUserId === h.fromUserId);
    if (!行.length) return 0;
    const 已发 = new Set(
      (await prisma.entNotice.findMany({ where: { dedupeKey: { in: 行.map((h) => 挂起提醒键(h.id)) } }, select: { userId: true, dedupeKey: true } })).map(
        (n) => `${n.userId}\n${n.dedupeKey}`,
      ),
    );
    const 人 = new Map(
      (
        await prisma.user.findMany({ where: { id: { in: [...new Set(行.flatMap((h) => [h.byUserId, h.toUserId]))] } }, select: { id: true, name: true, active: true } })
      ).map((u) => [u.id, u]),
    );
    let 发了 = 0;
    for (const h of 行) {
      const key = 挂起提醒键(h.id);
      const 发起人 = 人.get(h.byUserId);
      const 接手人 = 人.get(h.toUserId);
      const n = 读ids(h.customerIds).length;
      const 几位 = n ? ` ${n} 位客户` : "客户";
      const 要 = (u: typeof 发起人) => !!u?.active && !已发.has(`${u.id}\n${key}`);
      if (要(接手人)) {
        发了 += await notify([h.toUserId], {
          kind: "交接",
          title: `${发起人?.name ?? ""} 申请移交给你的${几位}已等你确认 ${挂起提醒天数} 天`,
          body: "不确认不会自动生效，也不会自动作废；请确认接手或拒绝。",
          link: "/customers",
          key,
        });
      }
      if (要(发起人)) {
        发了 += await notify([h.byUserId], {
          kind: "交接",
          title: `你申请移交给 ${接手人?.name ?? ""} 的${几位}已挂起 ${挂起提醒天数} 天，对方还没确认`,
          body: "申请会继续等对方确认；也可以撤回，或改接手人。",
          link: "/customers",
          key,
        });
      }
    }
    return 发了;
  } catch (e) {
    console.error("[移交提醒] 这一遍没扫成，下一遍再试", e);
    return 0;
  }
}
