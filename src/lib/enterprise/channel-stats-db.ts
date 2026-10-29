/**
 * 渠道统计的读库部分（2026-10-29）：取项目和投入，交给 channel-stats.ts 的 算渠道统计。
 *
 * 「项目归哪个渠道」现在走客户的 channelId；下一批 Project 有了自己的 channelId 后，
 * 只改下面 取项目 这一处（select 里加 channelId，优先用项目自己的），口径函数不动。
 */
import { prisma } from "@/lib/prisma";
import { 算渠道统计, type 统计用渠道, type 统计用项目, type 渠道统计 } from "./channel-stats";

async function 取项目(渠道ids: string[]): Promise<统计用项目[]> {
  if (渠道ids.length === 0) return [];
  const 行 = await prisma.project.findMany({
    where: { customer: { channelId: { in: 渠道ids } } },
    select: { phase: true, result: true, amount: true, currency: true, customer: { select: { channelId: true } } },
  });
  return 行.map((p) => ({ channelId: p.customer.channelId, phase: p.phase, result: p.result, amount: p.amount, currency: p.currency }));
}

export async function 读渠道统计(渠道们: 统计用渠道[], 今天: Date = new Date()): Promise<Record<string, 渠道统计>> {
  const ids = 渠道们.map((c) => c.id);
  const [项目们, 投入们] = await Promise.all([
    取项目(ids),
    ids.length ? prisma.entChannelInvest.findMany({ where: { channelId: { in: ids } }, select: { channelId: true, amount: true, currency: true } }) : [],
  ]);
  return 算渠道统计(渠道们, 项目们, 投入们, 今天);
}
