/**
 * 企业版 AI 建档（首页对话的新线索卡）按全部联系方式查重（10-27 会议 agent 提示词）。
 *   联系方式先规整再全量查：卡上的电话，加上备注里认得出的邮箱 / 微信 / 阿里国际站ID（名片卡把它们拼成「邮箱：x」这样的行；10-29 前叫旺旺，旧说法也认）
 *   重复：不录入，回录入的人「〈原负责人〉已有该客户信息，请及时核对」，
 *         给原负责人建一条待办挂在原客户上「〈触发人〉疑似与您负责的〈客户名〉重复，请及时核对」（看不看得到原客户都建，待办只给原负责人）
 *   公海待捞、我名下已有：照查重原提示拦
 *   团队版服务端那边撞的：本机没有那位客户可挂待办，只回提示
 * 不加字段：邮箱、微信进联系人原有的两格，认出来的那几行从备注拿掉，认不出的原样留在备注
 */
import { prisma, defaultClient } from "@/lib/prisma";
import { 读的我 } from "@/lib/team-scope";
import { parseScheduleDate } from "@/lib/schedule-date";
import { recordAudit } from "@/lib/audit";
import { 验号码, 查重提示, type 号码类型 } from "./contact-format";
import { 全公司查号, 撞号结论, 首条撞的, 问同事撞没撞 } from "./contact-dedupe";

export type 认出的号 = { 类型: 号码类型; 值: string; 键: string };

/** 行头去掉空格、小写以后查。「阿里国际站ID」是 10-29 的新叫法，旧的「旺旺 / 旺旺ID」、简称「阿里ID / 国际站ID」都认 */
const 行名: Record<string, 号码类型> = {
  邮箱: "邮箱", 微信: "微信",
  阿里国际站id: "旺旺ID", 阿里国际站: "旺旺ID", 阿里id: "旺旺ID", 国际站id: "旺旺ID", 旺旺: "旺旺ID", 旺旺id: "旺旺ID",
};
const 号码行 = /^\s*(邮箱|微信|阿里国际站\s*(?:id)?|阿里\s*id|国际站\s*id|旺旺\s*(?:id)?)\s*[：:]\s*(.+?)\s*$/i;
const 裸邮箱 = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

/**
 * 备注里认号码：「邮箱：x」「微信：x」「阿里国际站ID：x」（旧的「旺旺：x / 旺旺ID：x」也认）这样的行，验得过才认、整行拿掉；每种只认第一个，再有的留在备注。
 * 没有邮箱行时，正文里夹着的一个邮箱也认（只认不删，句子不拆）
 */
export function 认出备注里的号码(备注: string): { 号们: 认出的号[]; 剩: string } {
  const 号们: 认出的号[] = [];
  const 有 = (t: 号码类型) => 号们.some((h) => h.类型 === t);
  const 剩行 = 备注.split(/\r?\n/).filter((行) => {
    const m = 号码行.exec(行);
    if (!m) return true;
    const 类型 = 行名[m[1].replace(/\s+/g, "").toLowerCase()];
    if (有(类型)) return true;
    const r = 验号码(类型, m[2]);
    if (!r.ok) return true;
    号们.push({ 类型, 值: r.值, 键: r.键 });
    return false;
  });
  const 剩 = 剩行.join("\n").trim();
  if (!有("邮箱")) {
    const m = 裸邮箱.exec(剩);
    const r = m && 验号码("邮箱", m[0]);
    if (r && r.ok) 号们.push({ 类型: "邮箱", 值: r.值, 键: r.键 });
  }
  return { 号们, 剩 };
}

/** 挨个查，撞了回给录入的人看的话（不建档）；都没撞回 null */
export async function AI建档查重(号们: 认出的号[], 我: { id: string; name: string }): Promise<string | null> {
  const 读 = await 读的我(defaultClient);
  for (const 号 of 号们) {
    const ids = await 全公司查号(prisma, 号.类型, 号.值, 号.键);
    if (!ids.length) {
      const 那边 = await 问同事撞没撞(号.类型, 号.值);
      if (那边?.撞) return 查重提示.AI建档重复(那边.撞.salesOwnerName);
      continue;
    }
    const 结论 = await 撞号结论(prisma, ids, 我.id, 读);
    if (结论.状态 !== "重复") return 结论.提示;
    const 原 = await 首条撞的(prisma, ids);
    if (原?.salesOwnerId) await 提醒原负责人(原.id, 原.name, 原.salesOwnerId, 我);
    return 查重提示.AI建档重复(结论.撞.salesOwnerName);
  }
  return null;
}

/** 同一位客户还挂着一条没做完的同样提醒就不再加（同一张卡点两次、两个号都撞同一位，只提醒一次） */
async function 提醒原负责人(客户id: string, 客户名: string, 原负责人: string, 我: { id: string; name: string }) {
  const title = 查重提示.提醒原负责人(我.name, 客户名);
  if (await prisma.task.findFirst({ where: { customerId: 客户id, ownerId: 原负责人, title, done: false }, select: { id: true } })) return;
  const 时间 = parseScheduleDate(new Date().toISOString())!;
  const t = await prisma.task.create({ data: { title, dueAt: 时间.at, dueOn: 时间.on, dueHasTime: 时间.hasTime, customerId: 客户id, ownerId: 原负责人 } });
  await recordAudit({ user: 我, action: "create", entity: "Task", entityId: t.id, summary: `AI 建档撞号，给原负责人加了待办「${title}」` });
}
