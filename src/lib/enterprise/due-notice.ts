/**
 * 企业版到期提醒（2026-11-02）：跟进计划、项目下一步今天到期，进站内通知（铃铛），飞书推送开着时 notify 顺带推。
 *
 * 只从夜扫那个钟上触发（lib/project/nightly.ts），不挂任何页面、动作：切换视图（只读预览）碰不到它，这里再防一道。
 *
 * 提醒什么（「今天」一律按北京日历，lib/business-clock.ts）：
 *   - 跟进计划 FollowPlan：没完成、客户不在公海、计划日是今天。给 ownerId
 *   - 项目下一步 Project.nextStepAt（计划页标「来自项目」的那些）：项目进行中、不在公海、客户不在公海。给 ownerId
 *     EntFollowUpMeta.nextAt 不用：那是每条沟通留的历史副本，被新沟通取代后还在，也没有完成状态
 *   卡点到期日这版不提醒：界面上看不到这个日期，也和「不设解决时限」的定稿冲突
 *   已删的经 加上限定 自动滤掉；停用的人不收。企业版项目模式是锁死开着的（企业版锁定），这里不用再看
 *
 * 什么时候：每天北京 09:00 起，钟每 5 分钟扫一遍今天到期的。起得晚当天照样补；白天才改成今天到期的，下一遍提醒。
 * 只认「到期日 == 今天」：历史逾期的永远不补发，上线、停机后开机都不会轰炸；服务停了一整天，那天到期的也不再补。
 *
 * 只提醒一次靠 EntNotice 的 (userId, dedupeKey) 唯一键，存在库里，重启不重发；key 带记录 id 和到期日，改了到期日再到期可以再提醒。
 * 发之前先查一遍已记的，别让每一遍扫都去撞唯一键。任何一步出错只记日志，从不往外抛。
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { dayjs } from "@/lib/utils";
import { calendarDay } from "@/lib/schedule-date";
import { notify } from "./notify";
import { 企业版 } from "./switch";
import { 视图中跳过 } from "./view-as";

export const 提醒时刻 = { 时: 9, 分: 0 } as const;
const 钟上间隔毫秒 = 5 * 60_000;

/** 今天过了提醒时刻没（北京时间） */
export function 过了提醒时刻(现在: Date): boolean {
  return !dayjs(现在).isBefore(dayjs(现在).startOf("day").hour(提醒时刻.时).minute(提醒时刻.分));
}

/** 一条要发的提醒 */
type 条 = { 人们: readonly string[]; kind: string; title: string; body: string; link: string; key: string };
type 今天范围 = { 今天: string; 零点: Date; 明天: Date };

async function 跟进计划们({ 今天, 零点, 明天 }: 今天范围): Promise<条[]> {
  const 行们 = await prisma.followPlan.findMany({
    // 日历日的写法同 lib/overdue.ts 逾期条件：有 plannedOn 认它，老数据才看 plannedAt
    where: { done: false, customer: { pool: null }, OR: [{ plannedOn: 今天 }, { plannedOn: null, plannedAt: { gte: 零点, lt: 明天 } }] },
    select: { id: true, subject: true, method: true, ownerId: true, customerId: true, customer: { select: { name: true } } },
  });
  if (!行们.length) return [];
  // 计划不挂项目：这位负责人在这个客户下有进行中的项目就点去项目页（取最近动过的），不然去客户页。别人的项目他不一定打得开
  const 项目们 = await prisma.project.findMany({
    where: { customerId: { in: [...new Set(行们.map((p) => p.customerId))] }, result: null, pooledAt: null },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, customerId: true, ownerId: true },
  });
  const 他的项目 = new Map<string, string>();
  for (const p of 项目们) {
    const 键 = `${p.customerId}\n${p.ownerId}`;
    if (!他的项目.has(键)) 他的项目.set(键, p.id);
  }
  return 行们.map((p) => {
    const 项目 = 他的项目.get(`${p.customerId}\n${p.ownerId}`);
    return {
      人们: [p.ownerId],
      kind: "跟进到期",
      title: `跟进计划今天到期：${p.subject}`,
      body: `客户「${p.customer.name}」· ${p.method} · 到期日 ${今天}`,
      link: 项目 ? `/projects/${encodeURIComponent(项目)}` : `/customers/${encodeURIComponent(p.customerId)}`,
      key: `due:plan:${p.id}:${今天}`,
    };
  });
}

async function 项目下一步们({ 今天, 零点, 明天 }: 今天范围): Promise<条[]> {
  const 行们 = await prisma.project.findMany({
    where: { result: null, pooledAt: null, customer: { pool: null }, nextStepAt: { gte: 零点, lt: 明天 } },
    select: { id: true, name: true, ownerId: true, nextStepText: true },
  });
  return 行们.map((p) => ({
    人们: [p.ownerId],
    kind: "跟进到期",
    title: `项目下一步今天到期：${p.name}`,
    body: `${p.nextStepText ? `${p.nextStepText} · ` : ""}到期日 ${今天}`,
    link: `/projects/${encodeURIComponent(p.id)}`,
    key: `due:next:${p.id}:${今天}`,
  }));
}

/** 一处来源出错不拦别的来源 */
async function 稳(名: string, 查: () => Promise<条[]>): Promise<条[]> {
  try {
    return await 查();
  } catch (e) {
    console.error(`[到期提醒] ${名}没扫成，下一遍再试`, e);
    return [];
  }
}

async function 扫(现在: Date): Promise<number> {
  const 今 = dayjs(现在).startOf("day");
  const 范围: 今天范围 = { 今天: calendarDay(现在), 零点: 今.toDate(), 明天: 今.add(1, "day").toDate() };
  // 钟上没有请求，看全部 只是写明白：这一遍不按任何人的范围收窄
  const 条们 = await 看全部(async () => [
    ...(await 稳("跟进计划", () => 跟进计划们(范围))),
    ...(await 稳("项目下一步", () => 项目下一步们(范围))),
  ]);
  if (!条们.length) return 0;

  const 涉及 = [...new Set(条们.flatMap((t) => t.人们))];
  const [在职们, 记过们] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: 涉及 }, active: true }, select: { id: true } }),
    prisma.entNotice.findMany({ where: { dedupeKey: { in: 条们.map((t) => t.key) } }, select: { userId: true, dedupeKey: true } }),
  ]);
  const 在职 = new Set(在职们.map((u) => u.id));
  const 记过 = new Set(记过们.map((r) => `${r.userId}\n${r.dedupeKey}`));

  let 数 = 0;
  for (const t of 条们) {
    const 没记过 = t.人们.filter((u) => 在职.has(u) && !记过.has(`${u}\n${t.key}`));
    if (没记过.length) 数 += await notify(没记过, { kind: t.kind, title: t.title, body: t.body, link: t.link, key: t.key });
  }
  return 数;
}

/** 扫一遍今天到期的，返回新记了几条通知。从不抛 */
export async function 到期提醒扫一遍(现在: Date = new Date()): Promise<number> {
  if (!企业版() || !过了提醒时刻(现在)) return 0;
  try {
    if (await 视图中跳过()) return 0;
    return await 扫(现在);
  } catch (e) {
    console.error("[到期提醒] 这一遍没扫成，下一遍再试", e);
    return 0;
  }
}

const g = globalThis as unknown as { __entDueScanAt?: number };

/** 钟每分钟来一次，这里隔 5 分钟才真扫：计划表没有按日期的索引，别每分钟全表看一遍 */
export async function 钟上到期提醒(现在: Date = new Date()): Promise<number> {
  if (!过了提醒时刻(现在)) return 0;
  const 隔了 = g.__entDueScanAt === undefined ? null : 现在.getTime() - g.__entDueScanAt;
  if (隔了 !== null && 隔了 >= 0 && 隔了 < 钟上间隔毫秒) return 0;
  g.__entDueScanAt = 现在.getTime();
  return 到期提醒扫一遍(现在);
}

/** 测试用：忘掉上一次扫的时间，等于进程刚起来 */
export function 忘掉到期提醒节流(): void {
  g.__entDueScanAt = undefined;
}
