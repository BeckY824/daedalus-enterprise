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
import type { Prisma } from "@/generated/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 露客户, 看得到的客户 } from "@/lib/project/db";

/** 判客户看不看得到用哪个：服务端动作（翻页）现读 看得到的客户；客户页渲染传请求内缓存的 页面看得到的客户（lib/project/visible-customers.ts） */
export type 可见法 = (ids: string[]) => Promise<Set<string>>;
import { 我回避的公海项目, 回避豁免 } from "@/lib/project/pool-owner";
import { followHistoryInclude, followHistoryOrder, serializeFollowHistory } from "@/app/(app)/customers/[id]/follow-history-query";
import type { FollowUpRow } from "@/app/(app)/customers/[id]/types";

export type 沟通游标 = { occurredAt: string; id: string };
export const 汇总每页 = 50;
/** 一位客户最多汇总多少个项目（查询里 in 的上限；正常远到不了） */
const 项目上限 = 500;

type 项目行 = { id: string; name: string; customerId: string; ownerId: string; pooledAt: Date | null; result: string | null; nextStepAt: Date | null; nextStepText: string | null; updatedAt: Date };

/** 这位客户、当前这位看得到沟通内容的项目（主客户是它的 + 关联进来的；连挂过 = 再加历史上挂过这位跟进的） */
async function 看得到的项目们(me: { id: string; role?: string }, customerId: string, 连挂过: boolean, 可见: 可见法): Promise<{ 行: 项目行; 主: boolean }[]> {
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
    select: { id: true, name: true, customerId: true, ownerId: true, pooledAt: true, result: true, nextStepAt: true, nextStepText: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  // 公海里我是历史负责人的项目：沟通入口、时间线都不出（C-01，lib/project/pool-owner.ts；总管理 / 管理员照出）
  const [看得到, 回避] = await Promise.all([可见(ps.map((p) => p.customerId)), 回避豁免(me).then((免) => (免 ? ([] as string[]) : 我回避的公海项目(prisma, me.id)))]);
  return ps.filter((p) => 露客户(me, p, 看得到) && !回避.includes(p.id)).map((p) => ({ 行: p, 主: p.customerId === customerId }));
}

/** 汇总时间线收哪些项目：id → 名称 */
export async function 汇总的项目(me: { id: string; role?: string }, customerId: string, 可见: 可见法 = 看得到的客户): Promise<Map<string, string>> {
  return new Map((await 看得到的项目们(me, customerId, true, 可见)).map(({ 行 }) => [行.id, 行.name]));
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
  /** 项目下一步做什么（10-29 起记沟通时自己写的一句话）；老数据只有时间、这里是空 */
  下一步文字: string | null;
};
export async function 跟进去处们(me: { id: string; role?: string }, customerId: string, 可见: 可见法 = 看得到的客户): Promise<跟进去处[]> {
  const 行们 = (await 看得到的项目们(me, customerId, false, 可见)).map(({ 行, 主 }) => ({
    id: 行.id,
    名: 行.name,
    主,
    结束: !!行.result || !!行.pooledAt,
    说明: 行.result ? ("已结束" as const) : 行.pooledAt ? ("在公海" as const) : null,
    下一步: 行.nextStepAt?.toISOString() ?? null,
    下一步文字: 行.nextStepText,
  }));
  return [...行们.filter((x) => !x.结束), ...行们.filter((x) => x.结束)];
}

/** 挂在这些项目上的跟进记在哪几位客户名下（去重）。从 FollowUpProject 出发走 projectId 索引、再按主键连跟进，只碰这几个项目的那几条 */
async function 挂项目的客户们(ids: string[]): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ c: string }[]>(
    `SELECT DISTINCT f."customerId" AS c FROM "FollowUpProject" lk CROSS JOIN "FollowUp" f WHERE f.id = lk."followUpId" AND lk."projectId" IN (SELECT value FROM json_each(?))`,
    JSON.stringify(ids),
  );
  return rows.map((r) => r.c);
}

/** 和 followHistoryOrder 同一个顺序（occurredAt 倒序、同一刻按 id 倒序；id 按字节比，同 SQLite 的 BINARY） */
function 按时间线顺序(a: { occurredAt: Date; id: string }, b: { occurredAt: Date; id: string }): number {
  return +b.occurredAt - +a.occurredAt || Buffer.compare(Buffer.from(b.id), Buffer.from(a.id));
}

/**
 * 一页：新的在前，游标是不可变的排序边界（同 loadFollowHistory）。
 * 调用方先确认这位客户当前这位看得到（客户页本身就要看得到）。
 */
export async function 客户沟通汇总(me: { id: string; role?: string }, customerId: string, before?: 沟通游标, 可见: 可见法 = 看得到的客户): Promise<{ rows: FollowUpRow[]; hasMore: boolean }> {
  const 项目们 = await 汇总的项目(me, customerId, 可见);
  const ids = [...项目们.keys()];
  /*
    这位客户名下进了回收站的项目：挂在上面、记在这位客户名下的沟通照旧留在客户下（删项目时就是这么说的），
    和客户本身的老跟进一样摆，不标项目（11-03 C2-2：原来一起藏了，客户页「还没有沟通记录」，删客户预检却数得到）
  */
  const 删了的 = (await 看全部(() => 看已删(() => prisma.project.findMany({ where: { customerId, deletedAt: { not: null } }, select: { id: true }, take: 项目上限 })))).map((p) => p.id);
  /*
    收的是三段的并：这位客户不挂项目的、挂在 ids 上的（可能记在别的客户名下）、这位客户名下挂在 删了的 上的。
    按「记在哪位客户名下」拆成几句、各取一页再在这里合（8.5 万客户提速第三轮，11-14）：三段 OR 在一句里时，
    条件跨了 FollowUpProject 那张表，SQLite 用不上 customerId 的索引，改顺 (deletedAt, occurredAt) 把 25 万条跟进倒着扫、边扫边挑，
    这位客户没几条时要扫完整表（单句 95 ms，压测 p95 712 ms）。每句都带 customerId = ? 就走 (customerId, occurredAt)（0.1 ms）。
    每句各取 汇总每页 + 1 条，合起来再按同一个顺序截：全局前 n 条一定在各句的前 n 条里，所以页和 hasMore 跟原来一句时一样。
    别的客户：只能是挂在 ids 上的那几条的客户，先从 FollowUpProject 出发查出来（只多不少就行，每句自己还带着项目条件）
  */
  const 游标 = before ? [{ OR: [
    { occurredAt: { lt: new Date(before.occurredAt) } },
    { occurredAt: new Date(before.occurredAt), id: { lt: before.id } },
  ] }] : [];
  const 别的客户 = ids.length ? (await 挂项目的客户们(ids)).filter((c) => c !== customerId) : [];
  const 这位的项目 = [...ids, ...删了的];
  const 一位 = (c: string, 条件: Prisma.FollowUpWhereInput) => 看全部(() => prisma.followUp.findMany({
    where: { AND: [{ customerId: c }, 条件, ...游标] },
    orderBy: followHistoryOrder, take: 汇总每页 + 1,
    include: { ...followHistoryInclude, projectNode: { select: { projectId: true } } },
  }));
  const 各句 = await Promise.all([
    一位(customerId, 这位的项目.length ? { OR: [{ projectNode: null }, { projectNode: { projectId: { in: 这位的项目 } } }] } : { projectNode: null }),
    ...别的客户.map((c) => 一位(c, { projectNode: { projectId: { in: ids } } })),
  ]);
  const rows = 各句.length === 1 ? 各句[0] : 各句.flat().sort(按时间线顺序).slice(0, 汇总每页 + 1);
  return {
    rows: rows.slice(0, 汇总每页).map((f) => {
      // 删了的项目不标（上面的 删了的）
      const pid = f.projectNode && 项目们.has(f.projectNode.projectId) ? f.projectNode.projectId : null;
      const 行 = serializeFollowHistory(f);
      // 别的客户名下的记录（关联项目的）：商机是那家客户的，不在这里露
      return { ...行, opportunity: f.customerId === customerId ? 行.opportunity : null, 项目: pid ? { id: pid, 名: 项目们.get(pid) ?? "" } : null };
    }),
    hasMore: rows.length > 汇总每页,
  };
}
