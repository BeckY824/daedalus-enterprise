/**
 * 企业版客户页的「沟通记录」（2026-10-29 P14 第 6 条）：只读时间线，汇总这位客户在各项目里的跟进。
 *
 * 收哪些：
 *   - 客户本身挂的老跟进（不属于任何项目的）；
 *   - 这位客户是主客户的项目、或以关联客户挂进去的项目（ProjectCustomer，P17），这些项目下的跟进。
 * 看不到的项目一条都不出、也不报数：
 *   - 候选项目全走带限定的客户端（Project / ProjectCustomer / FollowUpProject 都按项目可见范围滤，team-scope.ts）；
 *   - 再照项目详情页的口子（lib/project/db.ts 露客户）：公海里同事客户的项目，沟通内容领了再看——这里也不出。
 * 最后那一查用 看全部：关联项目的跟进挂在那个项目的主客户名下，限定层按客户滤会把我看得到的项目的记录也滤掉；
 * 项目 id 已经是上面滤过的，跟项目详情页「沟通」卡给的是同一批。
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 看得到的客户, 露客户 } from "@/lib/project/db";
import { followHistoryInclude, followHistoryOrder, serializeFollowHistory } from "@/app/(app)/customers/[id]/follow-history-query";
import type { FollowUpRow } from "@/app/(app)/customers/[id]/types";

export type 沟通游标 = { occurredAt: string; id: string };
export const 汇总每页 = 50;
/** 一位客户最多汇总多少个项目（查询里 in 的上限；正常远到不了） */
const 项目上限 = 500;

type 项目行 = { id: string; name: string; customerId: string; ownerId: string; pooledAt: Date | null; result: string | null; nextStepAt: Date | null; updatedAt: Date };

/** 这位客户、当前这位看得到沟通内容的项目（主客户是它的 + 关联进来的；连挂过 = 再加历史上挂过这位跟进的） */
async function 看得到的项目们(me: { id: string }, customerId: string, 连挂过: boolean): Promise<{ 行: 项目行; 主: boolean }[]> {
  const [主, 关联, 挂过] = await Promise.all([
    prisma.project.findMany({ where: { customerId }, select: { id: true }, take: 项目上限 }),
    prisma.projectCustomer.findMany({ where: { customerId }, select: { projectId: true }, take: 项目上限 }),
    // 历史上记在这位客户名下、后来挂到项目上的（项目主客户改过的老数据）
    连挂过 ? prisma.followUpProject.findMany({ where: { followUp: { customerId } }, select: { projectId: true }, distinct: ["projectId"], take: 项目上限 }) : Promise.resolve([]),
  ]);
  const ids = [...new Set([...主.map((p) => p.id), ...关联.map((r) => r.projectId), ...挂过.map((r) => r.projectId)])];
  if (ids.length === 0) return [];
  const ps = await prisma.project.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, customerId: true, ownerId: true, pooledAt: true, result: true, nextStepAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  const 看得到 = await 看得到的客户(ps.map((p) => p.customerId));
  return ps.filter((p) => 露客户(me, p, 看得到)).map((p) => ({ 行: p, 主: p.customerId === customerId }));
}

/** 汇总时间线收哪些项目：id → 名称 */
export async function 汇总的项目(me: { id: string }, customerId: string): Promise<Map<string, string>> {
  return new Map((await 看得到的项目们(me, customerId, true)).map(({ 行 }) => [行.id, 行.name]));
}

/** 「跟进」菜单列的项目（第 3 条）：主客户的 + 关联进来的，进行中的在前、各自按最近改动排 */
export type 跟进去处 = {
  id: string;
  名: string;
  /** 这位是主客户（否则是关联进来的） */
  主: boolean;
  /** 有结局或在公海里：还能点进去看，排到后面、菜单上标一句 */
  结束: boolean;
  说明: "已结束" | "在公海" | null;
  /** 项目下一步时间（ISO）；待办里摆一行只读的（第 2 条） */
  下一步: string | null;
};
export async function 跟进去处们(me: { id: string }, customerId: string): Promise<跟进去处[]> {
  const 行们 = (await 看得到的项目们(me, customerId, false)).map(({ 行, 主 }) => ({
    id: 行.id,
    名: 行.name,
    主,
    结束: !!行.result || !!行.pooledAt,
    说明: 行.result ? ("已结束" as const) : 行.pooledAt ? ("在公海" as const) : null,
    下一步: 行.nextStepAt?.toISOString() ?? null,
  }));
  return [...行们.filter((x) => !x.结束), ...行们.filter((x) => x.结束)];
}

/**
 * 一页：新的在前，游标是不可变的排序边界（同 loadFollowHistory）。
 * 调用方先确认这位客户当前这位看得到（客户页本身就要看得到）。
 */
export async function 客户沟通汇总(me: { id: string }, customerId: string, before?: 沟通游标): Promise<{ rows: FollowUpRow[]; hasMore: boolean }> {
  const 项目们 = await 汇总的项目(me, customerId);
  const ids = [...项目们.keys()];
  const 范围 = { OR: [{ customerId, projectNode: null }, ...(ids.length ? [{ projectNode: { projectId: { in: ids } } }] : [])] };
  const rows = await 看全部(() => prisma.followUp.findMany({
    where: { AND: [范围, ...(before ? [{ OR: [
      { occurredAt: { lt: new Date(before.occurredAt) } },
      { occurredAt: new Date(before.occurredAt), id: { lt: before.id } },
    ] }] : [])] },
    orderBy: followHistoryOrder, take: 汇总每页 + 1,
    include: { ...followHistoryInclude, projectNode: { select: { projectId: true } } },
  }));
  return {
    rows: rows.slice(0, 汇总每页).map((f) => {
      const pid = f.projectNode?.projectId ?? null;
      const 行 = serializeFollowHistory(f);
      // 别的客户名下的记录（关联项目的）：商机是那家客户的，不在这里露
      return { ...行, opportunity: f.customerId === customerId ? 行.opportunity : null, 项目: pid ? { id: pid, 名: 项目们.get(pid) ?? "" } : null };
    }),
    hasMore: rows.length > 汇总每页,
  };
}
