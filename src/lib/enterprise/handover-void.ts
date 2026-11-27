/**
 * 12-22 终审 5：上级 / 条线总管理 / 系统管理员直接转客户时，负责人本人还在等接手人确认的那份转让申请（申请移交）作废，
 * 并通知两边（负责人本人、原接手人）。答 E-335:20「两套转让记录」。
 * 申请里的客户都在这次转的里面 = 整份作废（状态「已作废」，同 7 天超时作废）；只覆盖了一部分 = 把这几位从申请里去掉，申请余下的照旧等确认。
 * 带着「还待确认」条件改：刚被接手人确认 / 拒收 / 本人撤回的命中 0 行，不通知、不留痕。任何错只记日志，不往外抛（转让已经成了）。
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { recordAudit } from "@/lib/audit";
import { notify } from "./notify";
import { 待确认, 已作废, 读ids } from "./handover-db";

export type 等确认的申请 = { id: string; fromUserId: string; toUserId: string; byUserId: string; customerIds: string; counts: string };

/**
 * 这几位客户上还在等确认的转让申请。其他 = 里面有不是负责人本人发起的（老数据），那种不作废，照旧由 移交中挡 拦
 */
export async function 等确认的申请移交(ids: readonly string[]): Promise<{ 行: 等确认的申请[]; 其他: boolean }> {
  const 要 = new Set(ids);
  const 行 = (await 看全部(() => prisma.entHandover.findMany({ where: { kind: "转让", status: 待确认 }, select: { id: true, fromUserId: true, toUserId: true, byUserId: true, customerIds: true, counts: true } })))
    .filter((r) => 读ids(r.customerIds).some((c) => 要.has(c)));
  return { 行, 其他: 行.some((r) => r.byUserId !== r.fromUserId) };
}

export async function 作废申请移交(
  me: { id: string; name: string },
  行: readonly 等确认的申请[],
  转成了: readonly string[],
  新负责人: string,
): Promise<void> {
  try {
    const 转 = new Set(转成了);
    const 接 = (await prisma.user.findUnique({ where: { id: 新负责人 }, select: { name: true } }))?.name ?? "";
    for (const h of 行) {
      const 全 = 读ids(h.customerIds);
      const 余 = 全.filter((c) => !转.has(c));
      if (余.length === 全.length) continue;
      const 现在 = new Date();
      const r = await 看全部(() =>
        余.length
          ? prisma.entHandover.updateMany({ where: { id: h.id, status: 待确认 }, data: { customerIds: JSON.stringify(余), counts: JSON.stringify({ 客户: 余.length }) } })
          : prisma.entHandover.updateMany({ where: { id: h.id, status: 待确认 }, data: { status: 已作废, doneAt: 现在, doneById: me.id } }),
      );
      if (r.count !== 1) continue;
      const 人 = new Map((await prisma.user.findMany({ where: { id: { in: [h.byUserId, h.toUserId] } }, select: { id: true, name: true, active: true } })).map((u) => [u.id, u]));
      const 本人 = 人.get(h.byUserId);
      const 原接手 = 人.get(h.toUserId);
      const 几位 = `${全.length - 余.length} 位客户`;
      await recordAudit({
        user: me, action: "assign", entity: "Customer", entityId: null,
        summary: `${me.name} 直接把${几位}转给「${接}」，「${本人?.name ?? h.byUserId}」发给「${原接手?.name ?? h.toUserId}」的转让申请${余.length ? "里这几位" : ""}作废`,
        detail: { 交接: h.id, kind: "转让", 状态: 余.length ? "部分作废" : 已作废, fromUserId: h.fromUserId, toUserId: h.toUserId, 客户: 全.filter((c) => 转.has(c)) },
      });
      await prisma.entNotice.updateMany({ where: { userId: h.toUserId, dedupeKey: `handover:${h.id}:发起`, readAt: null }, data: { readAt: 现在 } });
      const 话 = `${me.name} 已直接把${几位}转给 ${接}`;
      if (本人?.active && h.byUserId !== me.id) {
        await notify([h.byUserId], { kind: "交接", title: `你发给 ${原接手?.name ?? ""} 的转让申请已作废：${话}`, body: "客户已按新的转让生效，不用再等确认。", link: "/customers", key: `handover:${h.id}:作废:本人` });
      }
      if (原接手?.active && h.toUserId !== me.id && h.toUserId !== 新负责人) {
        await notify([h.toUserId], { kind: "交接", title: `${本人?.name ?? ""} 发给你的转让申请已作废：${话}`, body: "不用再确认。", link: "/customers", key: `handover:${h.id}:作废:接手` });
      }
    }
  } catch (e) {
    console.error("作废申请移交失败（转让已成功）", e);
  }
}
