/**
 * 渠道看板的读库部分（11-03）：取项目（带创建时间、线索判定、节点日志）和投入（带日期），交给 channel-dash.ts 的 算看板底数。
 * 项目范围和渠道列表的统计是同一个条件（channel-stats-db.ts 的 渠道项目条件），也同样走带企业版范围扩展的 prisma，
 * 所以看板和列表数的是同一批项目。
 */
import { prisma } from "@/lib/prisma";
import { 项目算哪个渠道 } from "./channel-stats";
import { 渠道项目条件 } from "./channel-stats-db";
import { 算看板底数, type 看板底数 } from "./channel-dash";

export async function 读看板底数(渠道ids: string[], 今: Date = new Date()): Promise<看板底数> {
  if (渠道ids.length === 0) return 算看板底数([], [], [], 今);
  const [项目们, 投入们] = await Promise.all([
    prisma.project.findMany({
      where: 渠道项目条件(渠道ids),
      select: {
        channelId: true, phase: true, result: true, amount: true, currency: true, createdAt: true,
        customer: { select: { channelId: true } },
        entLeadVerify: { select: { verdict: true } },
        // 不 orderBy（父行过千会让 Prisma 6.16 崩，见 channel-stats-db.ts）；算的时候取最早一条，不靠顺序
        logs: { where: { kind: "node" }, select: { toPhase: true, at: true } },
      },
    }),
    prisma.entChannelInvest.findMany({ where: { channelId: { in: 渠道ids } }, select: { channelId: true, amount: true, currency: true, date: true } }),
  ]);
  return 算看板底数(
    渠道ids,
    项目们.map((p) => ({
      channelId: 项目算哪个渠道(p.channelId, p.customer.channelId),
      phase: p.phase, result: p.result, amount: p.amount, currency: p.currency, createdAt: p.createdAt,
      判定: p.entLeadVerify?.verdict ?? null,
      节点们: p.logs,
    })),
    投入们,
    今,
  );
}
