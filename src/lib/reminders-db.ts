import { prisma, defaultClient } from "@/lib/prisma";
import { 读的我 } from "@/lib/team-scope";
import { 今天界线, type 提醒项 } from "@/lib/reminders";
import { 企业版 } from "@/lib/enterprise/switch";
import { 在看已删 } from "@/lib/enterprise/soft-delete-core";

/**
 * 某人名下还没做的跟进计划和待办，摊成 算提醒() 要的样子。
 *
 * **Dock 上的数、左栏「跟进」上的数、手机顶栏铃铛上的数都从这里来**——同一个人、同一份查询、同一个 算提醒()。
 * 三处原来各算各的（铃铛数的是全部没做完的待办，Dock 数的是逾期 + 今天的计划和待办），
 * 人在 Dock 上看见 1、打开应用找不到那个 1 在哪儿（2026-09-29 用户报的）。
 */
export async function 取提醒项(ownerId: string): Promise<提醒项[]> {
  const [plans, tasks] = await Promise.all([
    prisma.followPlan.findMany({
      where: { done: false, ownerId },
      select: { id: true, subject: true, plannedAt: true, plannedOn: true, plannedHasTime: true, method: true, customer: { select: { id: true, name: true } } },
    }),
    prisma.task.findMany({
      where: { done: false, ownerId },
      select: { id: true, title: true, dueAt: true, dueOn: true, dueHasTime: true, customer: { select: { id: true, name: true } } },
    }),
  ]);
  return [
    ...plans.map((p) => ({ id: p.id, kind: "plan" as const, 标题: p.subject, 时间: p.plannedAt, 日历日: p.plannedOn, 明确钟点: p.plannedHasTime, customerId: p.customer.id, 客户: p.customer.name, 方式: p.method })),
    ...tasks.map((t) => ({ id: t.id, kind: "task" as const, 标题: t.title, 时间: t.dueAt, 日历日: t.dueOn, 明确钟点: t.dueHasTime, customerId: t.customer.id, 客户: t.customer.name })),
  ];
}

/**
 * 只要 逾期 / 今天 两个数时（左栏「跟进」上的红数字）：在库里数，不把这个人没做的计划和待办全拉回来。
 * layout 每个页面都走一遍，企业版业务员名下动辄几千条，整份拉回来光解析就几十毫秒。
 * 口径和 算提醒(取提醒项()) 一样（tests/reminder-count.test.ts 对拍）：有原日历日的按日历日比，没有的按时间比，没排时间的不算
 */
export async function 数提醒(ownerId: string, now = new Date()): Promise<{ 逾期: number; 今天: number }> {
  const { 逾期, 今天 } = await 数角标(ownerId, false, now);
  return { 逾期, 今天 };
}

/**
 * 左栏的角标一句数完（4 核提速 1c 第 4 条，11-16）：跟进的 逾期 / 今天（计划、待办各两个数）+ 铃铛上的未读通知数（带通知 = true 时）。
 * 原来是 4 句 count（每句都带限定层加的「客户没删」）+ 1 句未读通知，layout 每个页面都走一遍；现在名下这人在读的范围里时是 1 句裸 SQL。
 * 口径和原来逐项一样（tests/badge-count-one-query.test.ts 对拍老实现）：
 *   - 数的是自己名下的：钩子给计划 / 待办加的那句（负责人在范围里 OR 客户看得到）对它恒真，所以原来就包在 看全部 里数，
 *     剩下的只有软删那层（企业版、不在 看已删() 里）补的「客户没删」——裸 SQL 照抄这一层；
 *   - 名下这人不在读的范围里（没认出的人）才照旧走带限定的 4 句 count（范围条件太多，不手写）；
 *   - 未读通知：EntNotice 不挂客户、不在范围表里、也不跟软删走，原来那句就只有 userId + readAt IS NULL
 */
export async function 数角标(ownerId: string, 带通知: boolean, now = new Date()): Promise<{ 逾期: number; 今天: number; 通知未读: number | undefined }> {
  const 读 = await 读的我(defaultClient);
  const 恒真 = !读 || (typeof 读 === "string" ? 读 === ownerId : 读.includes(ownerId));
  if (恒真) return 一句数(ownerId, now, 带通知);
  const [数, 通知未读] = await Promise.all([照数(ownerId, now), 带通知 ? prisma.entNotice.count({ where: { userId: ownerId, readAt: null } }) : undefined]);
  return { ...数, 通知未读 };
}

async function 一句数(ownerId: string, now: Date, 带通知: boolean): Promise<{ 逾期: number; 今天: number; 通知未读: number | undefined }> {
  const { 今天开始, 明天开始, 今天串 } = 今天界线(now);
  // 软删那层（enterprise/soft-delete-core.ts 去掉已删）：计划、待办挂的客户没进回收站。不是企业版、或在 看已删() 里，原来也不加
  const 未删 = (表: string) => (企业版() && !在看已删() ? ` JOIN "Customer" c ON c.id = ${表}."customerId" AND c."deletedAt" IS NULL` : "");
  // Prisma 在 SQLite 里把 DateTime 存成毫秒数：参数也给毫秒数。空串的日历日当没有（同 算提醒()）
  const 开 = 今天开始.getTime(), 明 = 明天开始.getTime();
  const sql =
    `SELECT p.overdue AS a, t.overdue AS b, p.today AS c, t.today AS d${带通知 ? ", n.n AS n" : ""} FROM ` +
    `(SELECT COUNT(CASE WHEN (x."plannedOn" > '' AND x."plannedOn" < ?) OR ((x."plannedOn" IS NULL OR x."plannedOn" = '') AND x."plannedAt" < ?) THEN 1 END) AS overdue, ` +
    `COUNT(CASE WHEN x."plannedOn" = ? OR ((x."plannedOn" IS NULL OR x."plannedOn" = '') AND x."plannedAt" >= ? AND x."plannedAt" < ?) THEN 1 END) AS today ` +
    `FROM "FollowPlan" x${未删("x")} WHERE x."done" = 0 AND x."ownerId" = ?) p, ` +
    `(SELECT COUNT(CASE WHEN (x."dueOn" > '' AND x."dueOn" < ?) OR ((x."dueOn" IS NULL OR x."dueOn" = '') AND x."dueAt" < ?) THEN 1 END) AS overdue, ` +
    `COUNT(CASE WHEN x."dueOn" = ? OR ((x."dueOn" IS NULL OR x."dueOn" = '') AND x."dueAt" >= ? AND x."dueAt" < ?) THEN 1 END) AS today ` +
    `FROM "Task" x${未删("x")} WHERE x."done" = 0 AND x."ownerId" = ? AND x."dueAt" IS NOT NULL) t` +
    (带通知 ? `, (SELECT COUNT(*) AS n FROM "EntNotice" WHERE "userId" = ? AND "readAt" IS NULL) n` : "");
  const 值 = [今天串, 开, 今天串, 开, 明, ownerId, 今天串, 开, 今天串, 开, 明, ownerId, ...(带通知 ? [ownerId] : [])];
  const [r] = await prisma.$queryRawUnsafe<{ a: bigint | number; b: bigint | number; c: bigint | number; d: bigint | number; n?: bigint | number }[]>(sql, ...值);
  return { 逾期: Number(r.a) + Number(r.b), 今天: Number(r.c) + Number(r.d), 通知未读: 带通知 ? Number(r.n) : undefined };
}

/** 带限定的老数法：4 句 count。名下这人不在读的范围里时用；也是 一句数 的对拍基准 */
export async function 照数(ownerId: string, now: Date): Promise<{ 逾期: number; 今天: number }> {
  const { 今天开始, 明天开始, 今天串 } = 今天界线(now);
  // 算提醒() 里空串的日历日当没有：按时间算
  const [a, b, c, d] = await Promise.all([
    prisma.followPlan.count({ where: { done: false, ownerId, OR: [{ plannedOn: { gt: "", lt: 今天串 } }, { OR: [{ plannedOn: null }, { plannedOn: "" }], plannedAt: { lt: 今天开始 } }] } }),
    prisma.task.count({ where: { done: false, ownerId, dueAt: { not: null }, OR: [{ dueOn: { gt: "", lt: 今天串 } }, { OR: [{ dueOn: null }, { dueOn: "" }], dueAt: { lt: 今天开始 } }] } }),
    prisma.followPlan.count({ where: { done: false, ownerId, OR: [{ plannedOn: 今天串 }, { OR: [{ plannedOn: null }, { plannedOn: "" }], plannedAt: { gte: 今天开始, lt: 明天开始 } }] } }),
    prisma.task.count({ where: { done: false, ownerId, dueAt: { not: null }, OR: [{ dueOn: 今天串 }, { OR: [{ dueOn: null }, { dueOn: "" }], dueAt: { gte: 今天开始, lt: 明天开始 } }] } }),
  ]);
  return { 逾期: a + b, 今天: c + d };
}
