"use server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 客户沟通汇总 } from "@/lib/enterprise/customer-follow-feed";
import { followHistoryInclude, followHistoryOrder, serializeFollowHistory } from "./follow-history-query";

export type FollowHistoryCursor = { occurredAt: string; id: string };
const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 256;
const unavailable = { ok: false as const, error: "这位客户不存在或当前账号无权查看，请刷新确认" };
const 游标坏了 = { ok: false as const, error: "历史记录页码已失效，请刷新记录" };
const 游标对 = (before: FollowHistoryCursor | undefined) => before === undefined || (!!before && validId(before.id) && typeof before.occurredAt === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(before.occurredAt)
  && Number.isFinite(new Date(before.occurredAt).getTime()) && new Date(before.occurredAt).toISOString() === before.occurredAt);

/** 使用不可变的排序边界，不依赖游标那条记录仍存在。所有查询继续经过租户/业务员限定。 */
export async function loadFollowHistory(customerId: string, before?: FollowHistoryCursor) {
  await requireUser();
  if (!validId(customerId)) return unavailable;
  if (!游标对(before)) return 游标坏了;
  if (!await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } })) return unavailable;
  const rows = await prisma.followUp.findMany({
    where: { customerId, ...(before ? { OR: [
      { occurredAt: { lt: new Date(before.occurredAt) } },
      { occurredAt: new Date(before.occurredAt), id: { lt: before.id } },
    ] } : {}) },
    orderBy: followHistoryOrder, take: 51, include: followHistoryInclude,
  });
  return { ok: true as const, rows: rows.slice(0, 50).map(serializeFollowHistory), hasMore: rows.length > 50 };
}

/**
 * 企业版客户页「沟通记录」翻页（只读汇总：客户本身的老跟进 + 我看得到的各项目的跟进，lib/enterprise/customer-follow-feed.ts）。
 * 客户先过一遍限定（看不到客户 = 什么都不给），项目再按项目可见范围滤。
 */
export async function loadCustomerFeed(customerId: string, before?: FollowHistoryCursor) {
  const me = await requireUser();
  if (!企业版()) return unavailable;
  if (!validId(customerId)) return unavailable;
  if (!游标对(before)) return 游标坏了;
  if (!await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } })) return unavailable;
  const r = await 客户沟通汇总(me, customerId, before);
  return { ok: true as const, ...r };
}

/** 编辑/撤销旧页记录后只重读该条，不把整段历史下载回浏览器。 */
export async function readFollowHistoryRow(customerId: string, id: string) {
  await requireUser();
  if (!validId(customerId) || !validId(id)) return unavailable;
  if (!await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } })) return unavailable;
  const row = await prisma.followUp.findFirst({ where: { id, customerId }, include: followHistoryInclude });
  return { ok: true as const, row: row ? serializeFollowHistory(row) : null };
}
