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

/** 归到这批渠道的项目（两种来源都捞，见文件头）；渠道看板 channel-dash-db.ts 也用这一个 */
export const 渠道项目条件 = (渠道ids: string[]) => ({
  OR: [{ channelId: { in: 渠道ids } }, { channelId: null, customer: { channelId: { in: 渠道ids } } }],
});

async function 取项目(渠道ids: string[], 看的人?: { id: string }): Promise<统计用项目[]> {
  if (渠道ids.length === 0) return [];
  // 名单（11-11）：企业版带了是谁在看，再取一趟「这些里哪些在他的项目列表上」，界面上每个数点进去对得上、对不上说清差在哪
  const [行, 列表里, 公海里] = await Promise.all([prisma.project.findMany({
    where: 渠道项目条件(渠道ids),
    select: {
      id: true, pooledAt: true,
      channelId: true, phase: true, result: true, amount: true, currency: true,
      customer: { select: { channelId: true } },
      // 不在这里 orderBy：Prisma 6.16 父行过千时嵌套关系带 orderBy 会让查询引擎崩（record.rs「no entry found for key」），取回来再排
      logs: { where: { kind: "node" }, select: { fromPhase: true, toPhase: true, at: true } },
    },
  }), 看的人 && 企业版() ? 列表里的项目(看的人, 渠道项目条件(渠道ids)) : Promise.resolve(null),
  // 在公海的那几条：只数公海页「渠道名单」里看得到的（公海名单条件，和公海页同一句），点「另 M 条在公海」落地条数 = M
  看的人 && 企业版() ? 公海名单条件(看的人, 渠道项目条件(渠道ids)).then((where) => prisma.project.findMany({ where, select: { id: true } })).then((rs) => new Set(rs.map((r) => r.id))) : Promise.resolve(null)]);
  for (const p of 行) p.logs.sort((a, b) => a.at.getTime() - b.at.getTime());
  return 行.map((p) => ({
    channelId: 项目算哪个渠道(p.channelId, p.customer.channelId), phase: p.phase, result: p.result, amount: p.amount, currency: p.currency,
    // 没有建项目那条日志的（很老的数据）当从线索起
    起步阶段: p.logs.find((l) => l.fromPhase === null)?.toPhase ?? "线索",
    到过阶段们: p.logs.map((l) => l.toPhase),
    ...(列表里 ? { 在列表: 列表里.has(p.id), 在公海: !!公海里?.has(p.id) } : {}),
  }));
}

/** 看的人：给了（渠道页传当前登录的人）才算 渠道统计.名单；单测、别处不给就和原来一样 */
export async function 读渠道统计(渠道们: 统计用渠道[], 今天: Date = new Date(), 看的人?: { id: string }): Promise<Record<string, 渠道统计>> {
  const ids = 渠道们.map((c) => c.id);
  const [项目们, 投入们] = await Promise.all([
    取项目(ids, 看的人),
    ids.length ? prisma.entChannelInvest.findMany({ where: { channelId: { in: ids } }, select: { channelId: true, amount: true, currency: true } }) : [],
  ]);
  return 算渠道统计(渠道们, 项目们, 投入们, 今天, 字典of(企业版()));
}
