/**
 * 企业版 AI 建档（首页对话的新线索卡）按全部联系方式查重（10-27 会议 agent 提示词）。
 *   联系方式先规整再全量查：卡上的电话，加上备注里认得出的邮箱 / 微信 / 阿里国际站ID（名片卡把它们拼成「邮箱：x」这样的行；10-29 前叫旺旺，旧说法也认）
 *   重复：不录入，回录入的人「〈原负责人〉已有该客户信息，请及时核对」，
 *         给原负责人建一条待办挂在原客户上「〈触发人〉疑似与您负责的〈客户名〉重复，请及时核对」（看不看得到原客户都建，待办只给原负责人）
 *   公海待捞、我名下已有：照查重原提示拦；市场成员撞上公海另带 公海（卡片给「领取并记沟通」，F-016）
 *   在用的没撞、回收站里撞了：照建档的提示拦，叫人找系统管理员恢复（客户 11-05（X-10））
 *   团队版服务端那边撞的：本机没有那位客户可挂待办，只回提示
 * 不加字段：邮箱、微信进联系人原有的两格，认出来的那几行从备注拿掉，认不出的原样留在备注
 */
import { prisma, defaultClient } from "@/lib/prisma";
import { 读的我, 看全部 } from "@/lib/team-scope";
import { parseScheduleDate, calendarDay } from "@/lib/schedule-date";
import { recordAudit } from "@/lib/audit";
import { 查重提示 } from "./contact-format";
import { 全公司查号, 撞号结论, 首条撞的, 问同事撞没撞, 回收站撞没撞 } from "./contact-dedupe";
import { notify } from "./notify";
import { 同号再次录入, type 录入信息 } from "./same-number-collab";
import { 查重可领 } from "./dedupe-claim";

// 认备注里的号码是纯函数，11-17 搬到 remark-numbers.ts（新线索卡的必填在浏览器里也要用）；这里照旧导出
export { 认出备注里的号码, type 认出的号 } from "./remark-numbers";
import type { 认出的号 } from "./remark-numbers";

/** 挨个查，撞了回给录入的人看的话（不建档）；都没撞回 null */
export async function AI建档查重(号们: 认出的号[], 我: { id: string; name: string }, 录入?: 录入信息): Promise<string | null> {
  return (await AI建档查重详(号们, 我, 录入))?.话 ?? null;
}

/** 同 AI建档查重，另带上只在回收站里撞上的那个号（卡片上给「从回收站捞回」，客户 11-05） */
export async function AI建档查重详(号们: 认出的号[], 我: { id: string; name: string }, 录入?: 录入信息): Promise<{ 话: string; 回收站?: 认出的号; 公海?: 认出的号 } | null> {
  const 读 = await 读的我(defaultClient);
  for (const 号 of 号们) {
    const ids = await 全公司查号(prisma, 号.类型, 号.值, 号.键);
    if (!ids.length) {
      const 回收站 = await 回收站撞没撞(prisma, 号);
      if (回收站) return { 话: 回收站.提示, 回收站: 号 };
      const 那边 = await 问同事撞没撞(号.类型, 号.值);
      if (那边?.撞) return { 话: 查重提示.AI建档重复(那边.撞.salesOwnerName) };
      continue;
    }
    const 结论 = await 撞号结论(prisma, ids, 我.id, 读);
    // 卡上录的内容也接同号协同（写进现有项目、发邀请、通知）；回 AI 卡的话照 10-27 定的原文，协同已经通知过就不再响铃
    const 协同 = 录入 ? await 同号再次录入(我, 号, 录入) : null;
    // 市场成员撞上公海（F-016）：卡片上给「领取并记沟通」（customers/pool-actions.ts 查重领取），话照旧
    if (结论.状态 === "公海待捞" && (await 查重可领(我.id, 号))) return { 话: 结论.提示, 公海: 号 };
    if (结论.状态 !== "重复") return { 话: 结论.提示 };
    const 原 = await 首条撞的(prisma, ids);
    if (原?.salesOwnerId) await 提醒原负责人(原.id, 原.name, 原.salesOwnerId, 我, !协同?.走);
    return { 话: 查重提示.AI建档重复(结论.撞.salesOwnerName) };
  }
  return null;
}

/**
 * 同一位客户还挂着一条没做完的同样提醒就不再加（同一张卡点两次、两个号都撞同一位，只提醒一次）。
 * 查有没有要在 看全部 里查：待办是原负责人的，触发人照自己的可见范围看不到，之前每点一次确认就多一条（11-04 线上 5 条重复）。
 * 只记今天、不带时刻：带上建的那一刻，一建出来就算已逾期
 */
async function 提醒原负责人(客户id: string, 客户名: string, 原负责人: string, 我: { id: string; name: string }, 响铃: boolean) {
  if (原负责人 === 我.id) return;
  const title = 查重提示.提醒原负责人(我.name, 客户名);
  const t = await 看全部(async () => {
    if (await prisma.task.findFirst({ where: { customerId: 客户id, ownerId: 原负责人, title, done: false }, select: { id: true } })) return null;
    const 时间 = parseScheduleDate(calendarDay(new Date()))!;
    return prisma.task.create({ data: { title, dueAt: 时间.at, dueOn: 时间.on, dueHasTime: 时间.hasTime, customerId: 客户id, ownerId: 原负责人 } });
  });
  if (!t) return;
  await recordAudit({ user: 我, action: "create", entity: "Task", entityId: t.id, summary: `AI 建档撞号，给原负责人加了待办「${title}」` });
  if (响铃) await notify([原负责人], { kind: "撞号", title, link: `/customers/${客户id}`, key: `ai-dup:${t.id}` });
}
