/**
 * 企业版到期提醒（2026-11-02）：跟进计划、项目下一步今天到期或昨天逾期，进站内通知（铃铛），飞书推送开着时 notify 顺带推。
 *
 * 只从夜扫那个钟上触发（lib/project/nightly.ts），不挂任何页面、动作：切换视图（只读预览）碰不到它，这里再防一道。
 *
 * 提醒什么（「今天」「昨天」一律按北京日历，lib/business-clock.ts）：
 *   - 跟进计划 FollowPlan：没完成、客户不在公海、计划日是今天。给 ownerId
 *   - 项目下一步 Project.nextStepAt（计划页标「来自项目」的那些）：项目进行中、不在公海、客户不在公海。给 ownerId
 *     EntFollowUpMeta.nextAt 不用：那是每条沟通留的历史副本，被新沟通取代后还在，也没有完成状态
 *   - 逾期（11-02）：上面两样，口径相同，到期日是昨天的（到今天还没动）。给 ownerId + 他的直属上级，上级看得出是谁的
 *   卡点到期日不提醒：界面上看不到这个日期，也和「不设解决时限」的定稿冲突
 *   已删的经 加上限定 自动滤掉；停用的人不收。企业版项目模式是锁死开着的（企业版锁定），这里不用再看
 *
 * 什么时候：每天北京 09:00 起，钟每 5 分钟扫一遍。起得晚当天照样补；白天才改成今天到期的，下一遍提醒。
 * 平时只认「到期日 == 今天」和「到期日 == 昨天」：更早的历史逾期不补发，头一次上线不会轰炸。
 *
 * 服务停过怎么补（10c，2026-11-10）：Setting 里记一个水位（到期提醒水位键）= 上一次扫成的是哪一天。
 * 这一遍发现水位比昨天还早 = 中间有整天没扫，逾期那一档从水位那天一直查到昨天（最多往回 最多补几天 天，停很久也不刷屏）：
 *   - 水位那天到期的：当天发过「今天到期」，第二天该发的逾期漏了 → 补逾期
 *   - 停机那几天到期的：到期、逾期都漏了，现在已经过期 → 只补一条「已逾期」，不说「今天到期」；到期日写它自己的那天
 * 口径照旧（没完成、没结束、不在公海、没删、在职），停机期间已经做完的不补。没有水位（头一次扫）= 只看昨天。
 * 有来源没扫成、切换视图里跳过的那一遍不挪水位，下一遍接着补。
 *
 * 只提醒一次靠 EntNotice 的 (userId, dedupeKey) 唯一键，存在库里，重启不重发；key 带记录 id 和到期日，改了到期日再到期、再逾期可以再提醒。
 * 发之前先查一遍已记的，别让每一遍扫都去撞唯一键。任何一步出错只记日志，从不往外抛。
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { dayjs } from "@/lib/utils";
import { calendarDay } from "@/lib/schedule-date";
import { getSetting, setSetting } from "@/lib/settings";
import { notify } from "./notify";
import { 读组织, 负责人和上级, type 组织 } from "./org";
import { 企业版 } from "./switch";
import { 视图中跳过 } from "./view-as";

export const 提醒时刻 = { 时: 9, 分: 0 } as const;
const 钟上间隔毫秒 = 5 * 60_000;
/** Setting 里的水位：上一次扫成的那天（YYYY-MM-DD） */
export const 到期提醒水位键 = "entDueNoticeScannedDay";
/** 停机后逾期最多往回补几天 */
export const 最多补几天 = 7;

/** 今天过了提醒时刻没（北京时间） */
export function 过了提醒时刻(现在: Date): boolean {
  return !dayjs(现在).isBefore(dayjs(现在).startOf("day").hour(提醒时刻.时).minute(提醒时刻.分));
}

/** 一条要发的提醒。日 = 它自己的到期日（补停机那几天的逾期时用来分「昨天的」和「补的」） */
type 条 = { 人们: readonly string[]; kind: string; title: string; body: string; link: string; key: string; 日: string };
/** 哪几天：今天（到期）一天；逾期平时是昨天一天，停过机是从水位那天到昨天。首日、末日都含 */
type 日范围 = { 首日: string; 末日: string; 零点: Date; 次日: Date };
/** 逾期条：还要补上级和负责人名字，先记着负责人 */
type 逾期条 = 条 & { 负责人: string };

/** 从 首 那天零点到 末 那天过完 */
const 几天 = (首: ReturnType<typeof dayjs>, 末: ReturnType<typeof dayjs> = 首): 日范围 => ({
  首日: calendarDay(首.toDate()), 末日: calendarDay(末.toDate()), 零点: 首.toDate(), 次日: 末.add(1, "day").toDate(),
});

async function 跟进计划行({ 首日, 末日, 零点, 次日 }: 日范围) {
  const 查到 = await prisma.followPlan.findMany({
    // 日历日的写法同 lib/overdue.ts 逾期条件：有 plannedOn 认它，老数据才看 plannedAt
    where: { done: false, customer: { pool: null }, OR: [{ plannedOn: { gte: 首日, lte: 末日 } }, { plannedOn: null, plannedAt: { gte: 零点, lt: 次日 } }] },
    select: { id: true, subject: true, method: true, ownerId: true, customerId: true, plannedOn: true, plannedAt: true, customer: { select: { name: true, salesOwnerId: true } } },
  });
  const 行们 = 查到.map((p) => ({ ...p, 日: p.plannedOn ?? calendarDay(p.plannedAt) }));
  if (!行们.length) return [];
  // 计划不挂项目：这位负责人在这个客户下有进行中的项目就点去项目页（取最近动过的），不然他是客户负责人就去客户页。
  // 别人的项目他不一定打得开；客户也不是他的（市场分出去后活还归他 P-转-10、项目已结束）客户页多半 404，去计划页，那里能勾完成
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
    const link = 项目 ? `/projects/${encodeURIComponent(项目)}` : p.customer.salesOwnerId === p.ownerId ? `/customers/${encodeURIComponent(p.customerId)}` : "/follow-ups/plans";
    return { ...p, link };
  });
}

async function 跟进计划们(范围: 日范围): Promise<条[]> {
  return (await 跟进计划行(范围)).map((p) => ({
    人们: [p.ownerId],
    kind: "跟进到期",
    title: `跟进计划今天到期：${p.subject}`,
    body: `客户「${p.customer.name}」· ${p.method} · 到期日 ${p.日}`,
    link: p.link,
    key: `due:plan:${p.id}:${p.日}`,
    日: p.日,
  }));
}

async function 逾期跟进计划们(范围: 日范围): Promise<逾期条[]> {
  return (await 跟进计划行(范围)).map((p) => ({
    负责人: p.ownerId,
    人们: [p.ownerId],
    kind: "跟进逾期",
    title: `跟进计划已逾期：${p.subject}`,
    body: `客户「${p.customer.name}」· ${p.method} · 到期日 ${p.日}`,
    link: p.link,
    key: `overdue:plan:${p.id}:${p.日}`,
    日: p.日,
  }));
}

async function 项目下一步行({ 零点, 次日 }: 日范围) {
  const 行们 = await prisma.project.findMany({
    where: { result: null, pooledAt: null, customer: { pool: null }, nextStepAt: { gte: 零点, lt: 次日 } },
    select: { id: true, name: true, ownerId: true, nextStepText: true, nextStepAt: true },
  });
  return 行们.map((p) => ({ ...p, 日: calendarDay(p.nextStepAt!) }));
}

async function 项目下一步们(范围: 日范围): Promise<条[]> {
  return (await 项目下一步行(范围)).map((p) => ({
    人们: [p.ownerId],
    kind: "跟进到期",
    title: `项目下一步今天到期：${p.name}`,
    body: `${p.nextStepText ? `${p.nextStepText} · ` : ""}到期日 ${p.日}`,
    link: `/projects/${encodeURIComponent(p.id)}`,
    key: `due:next:${p.id}:${p.日}`,
    日: p.日,
  }));
}

async function 逾期项目下一步们(范围: 日范围): Promise<逾期条[]> {
  return (await 项目下一步行(范围)).map((p) => ({
    负责人: p.ownerId,
    人们: [p.ownerId],
    kind: "跟进逾期",
    title: `项目下一步已逾期：${p.name}`,
    body: `${p.nextStepText ? `${p.nextStepText} · ` : ""}到期日 ${p.日}`,
    link: `/projects/${encodeURIComponent(p.id)}`,
    key: `overdue:next:${p.id}:${p.日}`,
    日: p.日,
  }));
}

/**
 * 逾期的补上直属上级和负责人名字。只有真有逾期才读组织。
 * 读出错这一遍只发负责人：防重按人算，下一遍读得到了上级照样补上
 */
async function 补上级(们: 逾期条[], 没读成?: () => void): Promise<条[]> {
  if (!们.length) return [];
  let 底: { org: 组织; 名: Map<string, string> } | null = null;
  try {
    const [org, 人们] = await Promise.all([
      读组织(),
      prisma.user.findMany({ where: { id: { in: [...new Set(们.map((t) => t.负责人))] } }, select: { id: true, name: true } }),
    ]);
    底 = { org, 名: new Map(人们.map((u) => [u.id, u.name])) };
  } catch (e) {
    没读成?.();
    console.error("[到期提醒] 读组织失败，逾期这一遍只发负责人", e);
  }
  return 们.map(({ 负责人, ...t }) => {
    const 名 = 底?.名.get(负责人);
    return { ...t, 人们: 底 ? 负责人和上级(底.org, 负责人) : t.人们, body: 名 ? `${t.body} · 负责人：${名}` : t.body };
  });
}

/** 这一遍新发了几条：到期（今天到期的）、逾期（昨天到期的）、补逾期（停机漏掉、更早到期的）；补自 = 这一遍从哪天补起（没补 = null） */
export type 到期提醒明细 = { 到期: number; 逾期: number; 补逾期: number; 补自: string | null };
const 空明细 = (): 到期提醒明细 => ({ 到期: 0, 逾期: 0, 补逾期: 0, 补自: null });

/**
 * 逾期从哪天查起：平时 = 昨天。水位（上次扫成的那天）比昨天早 = 中间有整天没扫，从水位那天起，最多往回 最多补几天 天。
 * 没有水位 / 存坏了 / 比今天还晚（钟调过）= 昨天
 */
function 逾期首日(今: ReturnType<typeof dayjs>, 水位: string | null): ReturnType<typeof dayjs> {
  const 昨 = 今.subtract(1, "day");
  if (!水位 || !/^\d{4}-\d{2}-\d{2}$/.test(水位)) return 昨;
  const 上次 = dayjs(水位).startOf("day");
  if (!上次.isValid() || !上次.isBefore(昨)) return 昨;
  const 最早 = 今.subtract(最多补几天, "day");
  return 上次.isBefore(最早) ? 最早 : 上次;
}

async function 扫(现在: Date): Promise<到期提醒明细> {
  const 今 = dayjs(现在).startOf("day");
  const 今天 = 几天(今);
  const 水位 = await getSetting<string>(到期提醒水位键);
  const 首 = 逾期首日(今, 水位);
  const 逾期段 = 几天(首, 今.subtract(1, "day"));
  const 昨日 = 逾期段.末日;
  const 明细 = { ...空明细(), 补自: 逾期段.首日 < 昨日 ? 逾期段.首日 : null };
  /** 一处来源出错不拦别的来源；但这一遍不算扫成，水位不挪 */
  let 有没扫成的 = false;
  const 稳 = async <T,>(名: string, 查: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await 查();
    } catch (e) {
      有没扫成的 = true;
      console.error(`[到期提醒] ${名}没扫成，下一遍再试`, e);
      return [];
    }
  };
  // 钟上没有请求，看全部 只是写明白：这一遍不按任何人的范围收窄
  const 条们 = await 看全部(async () => [
    ...(await 稳("跟进计划", () => 跟进计划们(今天))),
    ...(await 稳("项目下一步", () => 项目下一步们(今天))),
    ...(await 补上级([
      ...(await 稳("逾期跟进计划", () => 逾期跟进计划们(逾期段))),
      ...(await 稳("逾期项目下一步", () => 逾期项目下一步们(逾期段))),
    ], () => { 有没扫成的 = true; })),
  ]);

  if (条们.length) {
    const 涉及 = [...new Set(条们.flatMap((t) => t.人们))];
    const 键们 = [...new Set(条们.map((t) => t.key))];
    const [在职们, 记过们] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: 涉及 }, active: true }, select: { id: true } }),
      prisma.entNotice.findMany({ where: { dedupeKey: { in: 键们 } }, select: { userId: true, dedupeKey: true } }),
    ]);
    const 在职 = new Set(在职们.map((u) => u.id));
    const 记过 = new Set(记过们.map((r) => `${r.userId}\n${r.dedupeKey}`));

    for (const t of 条们) {
      const 没记过 = t.人们.filter((u) => 在职.has(u) && !记过.has(`${u}\n${t.key}`));
      if (!没记过.length) continue;
      const 数 = await notify(没记过, { kind: t.kind, title: t.title, body: t.body, link: t.link, key: t.key });
      明细[t.kind === "跟进到期" ? "到期" : t.日 < 昨日 ? "补逾期" : "逾期"] += 数;
    }
  }
  // 扫成了才挪水位：一天只写一次
  if (!有没扫成的 && 水位 !== 今天.首日) await setSetting(到期提醒水位键, 今天.首日);
  return 明细;
}

/** 扫一遍今天到期和逾期的（平时只有昨天的，停过机从水位补起），返回各发了几条。从不抛 */
export async function 到期提醒扫一遍明细(现在: Date = new Date()): Promise<到期提醒明细> {
  if (!企业版() || !过了提醒时刻(现在)) return 空明细();
  try {
    if (await 视图中跳过()) return 空明细();
    return await 扫(现在);
  } catch (e) {
    console.error("[到期提醒] 这一遍没扫成，下一遍再试", e);
    return 空明细();
  }
}

/** 同上，只回新记了几条通知 */
export async function 到期提醒扫一遍(现在: Date = new Date()): Promise<number> {
  const r = await 到期提醒扫一遍明细(现在);
  return r.到期 + r.逾期 + r.补逾期;
}

const g = globalThis as unknown as { __entDueScanAt?: number };

/** 钟每分钟来一次，这里隔 5 分钟才真扫：计划表没有按日期的索引，别每分钟全表看一遍 */
export async function 钟上到期提醒明细(现在: Date = new Date()): Promise<到期提醒明细> {
  if (!过了提醒时刻(现在)) return 空明细();
  const 隔了 = g.__entDueScanAt === undefined ? null : 现在.getTime() - g.__entDueScanAt;
  if (隔了 !== null && 隔了 >= 0 && 隔了 < 钟上间隔毫秒) return 空明细();
  g.__entDueScanAt = 现在.getTime();
  return 到期提醒扫一遍明细(现在);
}

/** 同上，只回新记了几条通知 */
export async function 钟上到期提醒(现在: Date = new Date()): Promise<number> {
  const r = await 钟上到期提醒明细(现在);
  return r.到期 + r.逾期 + r.补逾期;
}

/** 测试用：忘掉上一次扫的时间，等于进程刚起来 */
export function 忘掉到期提醒节流(): void {
  g.__entDueScanAt = undefined;
}
