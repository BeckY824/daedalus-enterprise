/**
 * 渠道统计的读库部分（2026-10-29）：取项目和投入，交给 channel-stats.ts 的 算渠道统计。
 *
 * 「项目归哪个渠道」按 channel-stats.ts 的 项目算哪个渠道()：项目来源优先，老项目没填的退回客户来源。
 * 取数时两种都要捞：项目来源在这批渠道里的；项目来源空着、客户来源在这批渠道里的。
 * 项目来源填了别的渠道的，不再因为客户来源算到这里（客户来源只记第一次）。
 *
 * 统计范围（10-30 B2）：这里用的 prisma 带着企业版范围扩展（team-scope.ts → visibility.ts 的 企业版范围），
 * project 查询自动按「按组织看客户」限定——和客户列表是同一个函数，不另写一套：老板、总管理员看全部，
 * 别人只数自己和下属看得见的项目。开关没开时谁都数全部。投入不分人，照旧全数。
 *
 * 转化率要的「起步阶段」「到过阶段」从节点日志（kind = node）取：建项目那条（fromPhase 空）的 toPhase 是起步阶段，
 * 每条的 toPhase 都算到过；口径见 channel-stats.ts 的 算转化()。
 */
import { prisma } from "@/lib/prisma";
import { 算渠道统计, 项目算哪个渠道, type 统计用渠道, type 统计用项目, type 渠道统计 } from "./channel-stats";
import { 企业版 } from "./switch";
import { 字典of } from "@/lib/project/stage-dict";
import { 列表里的项目, 公海名单条件 } from "@/lib/project/list";
import { 算分期统计, type 分期统计, type 看板区间 } from "./channel-dash";
import { 是补建, 不算历史分析 } from "@/lib/project/system-created";

/**
 * 归到这批渠道的项目（两种来源都捞，见文件头）；渠道看板 channel-dash-db.ts 也用这一个。
 * 历史分析回填的项目不算（system-created.ts）：挂在有来源的老客户名下时会按客户来源落进渠道，把「全部」和各档撑大
 */
export const 渠道项目条件 = (渠道ids: string[]) => ({
  OR: [{ channelId: { in: 渠道ids } }, { channelId: null, customer: { channelId: { in: 渠道ids } } }],
  ...不算历史分析,
});

/**
 * 这批渠道的项目里，看的人点进去在哪看得到（11-11）：项目列表上的（列表里的项目）、公海页渠道名单里的（公海名单条件，和公海页同一句）。
 * 渠道列表的名单和渠道看板 TOP5 都用这一个；不是企业版 / 没带看的人 = null
 */
export async function 名单落点(渠道ids: string[], 看的人?: { id: string }): Promise<{ 列表里: Set<string>; 公海里: Set<string> } | null> {
  if (!看的人 || !企业版() || 渠道ids.length === 0) return null;
  const [列表里, 公海里] = await Promise.all([
    列表里的项目(看的人, 渠道项目条件(渠道ids)),
    公海名单条件(看的人, 渠道项目条件(渠道ids)).then((where) => prisma.project.findMany({ where, select: { id: true } })).then((rs) => new Set(rs.map((r) => r.id))),
  ]);
  return { 列表里, 公海里 };
}

/**
 * 渠道页一趟取数（11-18 提速）：项目（带客户来源、线索判定、节点日志）、投入、名单落点各取一趟，
 * 列表统计（读渠道分期统计）和总览看板（channel-dash-db.ts 读看板底数）共用这一份。
 * 原来两边各取一遍：同一批项目、同一句 名单落点（列表里的项目 + 公海名单条件）、同一批投入都读两回，渠道页比别的页慢一截。
 * 节点日志在这里按时间排好（两边都要「头一回」）；返回的对象两边只读，别改
 */
export type 渠道底 = Awaited<ReturnType<typeof 取渠道底>>;
export async function 取渠道底(渠道ids: string[], 看的人?: { id: string }) {
  if (渠道ids.length === 0) return { 行: [], 落点: null, 投入们: [] };
  // 名单（11-11）：企业版带了是谁在看，再取一趟「这些里哪些在他的项目列表上」，界面上每个数点进去对得上、对不上说清差在哪
  const [行, 落点, 投入们] = await Promise.all([
    prisma.project.findMany({
      where: 渠道项目条件(渠道ids),
      select: {
        id: true, createdAt: true, creatorId: true, importBatch: true,
        channelId: true, phase: true, result: true, amount: true, currency: true,
        customer: { select: { channelId: true } },
        entLeadVerify: { select: { verdict: true } },
        // 不在这里 orderBy：Prisma 6.16 父行过千时嵌套关系带 orderBy 会让查询引擎崩（record.rs「no entry found for key」），取回来再排
        logs: { where: { kind: "node" }, select: { fromPhase: true, toPhase: true, at: true } },
      },
    }),
    // 在公海的那几条：只数公海页「渠道名单」里看得到的，点「另 M 条在公海」落地条数 = M
    名单落点(渠道ids, 看的人),
    prisma.entChannelInvest.findMany({ where: { channelId: { in: 渠道ids } }, select: { channelId: true, amount: true, currency: true, date: true } }),
  ]);
  for (const p of 行) p.logs.sort((a, b) => a.at.getTime() - b.at.getTime());
  return { 行, 落点, 投入们 };
}

function 统计项目们({ 行, 落点 }: 渠道底): 统计用项目[] {
  return 行.map((p) => ({
    channelId: 项目算哪个渠道(p.channelId, p.customer.channelId), phase: p.phase, result: p.result, amount: p.amount, currency: p.currency, createdAt: p.createdAt,
    ...(是补建(p) ? { 补建: true } : {}),
    // 线索验证的判定：有效线索 只认「有效线索」（同看板，channel-stats.ts 是有效线索）
    判定: p.entLeadVerify?.verdict ?? null,
    // 没有建项目那条日志的（很老的数据）当从线索起
    起步阶段: p.logs.find((l) => l.fromPhase === null)?.toPhase ?? "线索",
    到过阶段们: p.logs.map((l) => l.toPhase),
    节点们: p.logs.map((l) => ({ toPhase: l.toPhase, at: l.at })),
    ...(落点 ? { 在列表: 落点.列表里.has(p.id), 在公海: 落点.公海里.has(p.id) } : {}),
  }));
}

/** 项目、投入各一趟（不按渠道一条条查）；投入带日期，按时间段算时用。底：渠道页已取好的那一份（取渠道底），给了就不再读库 */
async function 取底(渠道们: 统计用渠道[], 看的人?: { id: string }, 底?: Promise<渠道底>) {
  const d = await (底 ?? 取渠道底(渠道们.map((c) => c.id), 看的人));
  return [统计项目们(d), d.投入们] as const;
}

/** 看的人：给了（渠道页传当前登录的人）才算 渠道统计.名单；单测、别处不给就和原来一样 */
export async function 读渠道统计(渠道们: 统计用渠道[], 今天: Date = new Date(), 看的人?: { id: string }): Promise<Record<string, 渠道统计>> {
  const [项目们, 投入们] = await 取底(渠道们, 看的人);
  return 算渠道统计(渠道们, 项目们, 投入们, 今天, 字典of(企业版()));
}

/**
 * 渠道列表统计跟看板时间段（2D）：同一趟取数，按 本月 / 本季 / 全部（带了区间再加 自定义）各算一份，口径见 channel-dash.ts 算分期统计。
 * 全部 = 读渠道统计 的结果；区间 = 地址栏「自定义」那一段（日期段界() 算好的），同看板
 */
export async function 读渠道分期统计(渠道们: 统计用渠道[], 今天: Date = new Date(), 区间?: 看板区间 | null, 看的人?: { id: string }, 底?: Promise<渠道底>): Promise<分期统计> {
  const [项目们, 投入们] = await 取底(渠道们, 看的人, 底);
  return 算分期统计(渠道们, 项目们, 投入们, 今天, 字典of(企业版()), 区间);
}
