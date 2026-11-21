import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { cache } from "react";
import { 能看项目, 能看全部, 只看的人, 没设业务角色, 权限项目列, type 谁 } from "@/lib/enterprise/permissions";
import { 权限组织 } from "@/lib/enterprise/org";
import { 本套位置, 节点序号 } from "./nodes";
import { 企业版字典, 字典of } from "./stage-dict";
import { 阶段进程条件 } from "./list";
import { 客户id集合, 包含模式, type 另比一词 } from "@/lib/search-keyword";
import { 企业版 } from "@/lib/enterprise/switch";

/** 页签、列表「当前节点」上写的节点：有结局写结局，异常写「异常 · 节点」（同客户详情项目区页签） */
export const 节点字 = (p: { node: string; result: string | null }) => (p.result === "异常状态" ? `异常 · ${p.node}` : p.result ?? p.node);

/** 客户列表一行的项目概况（11-12 客户详情合并第 3 批）：只数我能看的、不在公海的项目 */
export type 客户项目概况 = { 项目数: number; 当前节点: string | null; 当前阶段: string | null };

/**
 * 我能看的、不在公海的项目：带限定的 prisma（看得到哪些由限定层管）∧ 能看项目 ∧ 不在公海。
 * 公海项目不算（11-12 用户：「只显示自己的，上级是可以看所有下属的」，公海项目不属于任何人）——只用于客户列表这两列和阶段 / 进程筛选，
 * 别处可见范围不动。不在公海也就不用再剔我回避的公海项目（C-01 只管公海里的）。
 * 一句取回（成员只带我自己那一条，能看项目只认「我加入了没有」），按最近有动静的排，同客户详情页签的顺序
 */
async function 我能看的项目们(me: 谁, where: Prisma.ProjectWhereInput) {
  const org = await 权限组织();
  const 行 = await prisma.project.findMany({
    where: { AND: [where, { pooledAt: null }] },
    orderBy: { updatedAt: "desc" },
    // 能看项目 要的列同一份（权限项目列，含待分配本线放开那几格，P-转-42）；组员只带我自己那一条
    select: {
      id: true, customerId: true, node: true, updatedAt: true, ...权限项目列,
      members: { where: { userId: me.id, inviteStatus: "JOINED" }, select: { userId: true } },
    },
  });
  return 行.filter((r) => 能看项目(me, { ...r, 已加入: r.members.map((m) => m.userId) }, org));
}

/**
 * 一位客户有几个我能看的项目时，「当前节点」写哪一个（11-12 用户定「按第 1 种做」）：最近有动静的那个——
 * 「最近有动静」沿用项目列表默认排序、客户详情页签顺序的口径（Project.updatedAt，list.ts 默认序）；
 * 一样新的取节点更靠后的那个（nodes.ts 节点序号：线索 → 商机 → 订单、阶段里按字典顺序）
 */
export function 最近有动静的<T extends { phase: string; node: string; result: string | null; updatedAt: Date }>(们: readonly T[]): T | null {
  let 选: T | null = null;
  for (const p of 们) {
    if (!选) { 选 = p; continue; }
    const 差 = p.updatedAt.getTime() - 选.updatedAt.getTime();
    if (差 > 0 || (差 === 0 && 节点序号(p, 企业版字典) > 节点序号(选, 企业版字典))) 选 = p;
  }
  return 选;
}

/**
 * 这一页客户的「项目数」「当前节点」：一页一句（不是每行各查），只算我能看的、不在公海的（能看项目：销售只算自己的，上级算自己和下属的，11-12 用户定）。
 * 当前节点 = 最近有动静的那个项目的节点（最近有动静的）；没有我能看的项目 = null
 */
export async function 客户项目概况们(me: 谁, customerIds: readonly string[]): Promise<Record<string, 客户项目概况>> {
  if (!customerIds.length) return {};
  const 们 = await 我能看的项目们(me, { customerId: { in: [...customerIds] } });
  const 按客户 = new Map<string, typeof 们>();
  for (const p of 们) {
    const 组 = 按客户.get(p.customerId);
    if (组) 组.push(p);
    else 按客户.set(p.customerId, [p]);
  }
  const 结果: Record<string, 客户项目概况> = {};
  for (const [cid, ps] of 按客户) {
    const d = 最近有动静的(ps);
    const 位 = d ? 本套位置({ phase: d.phase, node: d.node, result: d.result }, 企业版字典) : null;
    结果[cid] = { 项目数: ps.length, 当前节点: 位 ? 节点字(位) : null, 当前阶段: 位?.phase ?? null };
  }
  return 结果;
}

/**
 * 客户列表「全部阶段」「全部进程」筛选（第 3 批）：这位客户名下**有一个我能看的、不在公海的项目**在这个阶段 / 进程上就算。
 * 阶段、进程的认法和项目页筛选同一句（list.ts 阶段进程条件：有结局的按结局归的阶段）。都没给 / 认不出 = null（不筛）
 */
export async function 项目阶段客户条件(me: 谁, sp: { phase?: string; node?: string }): Promise<Prisma.CustomerWhereInput | null> {
  const r = await 阶段客户(me.id, me.role ?? "", sp.phase ?? "", sp.node ?? "");
  return r === 阶段命中太多 ? { id: { in: [] } } : r;
}

/**
 * 命中的客户点名时最多点这么多位：SQLite 一句的绑定参数上限 32766，留余量给同一句里别的条件。
 * 超了不报错、当一位都没中，页面据 阶段筛选太多 提示「结果太多，请再加筛选条件」。测试里可以调小（设阶段命中上限）
 */
let 点名上限 = 30000;
export function 设阶段命中上限(n: number) { 点名上限 = n; }
export const 阶段命中太多 = "阶段命中太多" as const;

/** 这一次请求里阶段 / 进程筛选是不是命中太多（页面提示用；和筛选同一份请求内缓存，不另查） */
export async function 阶段筛选太多(me: 谁, sp: { phase?: string; node?: string }): Promise<boolean> {
  if (!sp.phase && !sp.node) return false;
  return (await 阶段客户(me.id, me.role ?? "", sp.phase ?? "", sp.node ?? "")) === 阶段命中太多;
}

const 阶段客户 = cache(async (id: string, role: string, phase: string, node: string): Promise<Prisma.CustomerWhereInput | null | typeof 阶段命中太多> => {
  const me: 谁 = { id, role: role || null };
  const 阶进 = 阶段进程条件({ phase, node }, 字典of(true));
  if (!阶进.where.length) return null;
  // 看全部的（系统管理员、不按线的管理员只读；能看项目 里同一个顺序先排掉只看某人、没设角色）：不用逐个判可见，
  // 关联条件在库里一句筛完、不读进内存，也不点名（关联条件不过限定层，只靠它自己这几条：不在公海、没删、阶段 / 进程）
  const org = await 权限组织();
  if (org && !只看的人(org, id) && !没设业务角色(org, id) && 能看全部(me, org)) {
    return { projects: { some: { AND: [...阶进.where, { pooledAt: null, deletedAt: null }] } } };
  }
  const 们 = await 我能看的项目们(me, { AND: 阶进.where });
  const ids = [...new Set(们.map((p) => p.customerId))];
  if (ids.length > 点名上限) return 阶段命中太多;
  // 小 in 拼成一个 OR（search-keyword.ts 客户id集合）：命中上千位客户时 Prisma 不会把这句拆成几条查，翻页、导出的全局排序和总数照旧在一句里算
  return 客户id集合(ids);
});

/** 裸 SQL 回来的时刻格：按列声明一般已是 Date；没认出类型时是毫秒数，超出 32 位的 SQLite 整数回来是 bigint */
export type 裸时刻 = Date | number | bigint | string | null;
/**
 * 裸时刻转回 Date（能看项目 只问有没有，空还是空）。bigint 先转成数：new Date(bigint) 会直接抛 TypeError，
 * 整份行也不能直接 JSON.stringify（bigint 不认）——所以候选行只在这里转、不往外交
 */
export const 成时刻 = (v: 裸时刻): Date | null => (v == null ? null : v instanceof Date ? v : new Date(typeof v === "bigint" ? Number(v) : v));

/** 项目名另比：候选先取这么多行；超了（宽词）看全部的改用子查询、别的人再取全。测试里可以调小（设项目名候选先取） */
let 候选先取 = 2000;
export function 设项目名候选先取(n: number) { 候选先取 = n; }

/**
 * 客户列表搜索也比项目名（员工反馈第 2 批 2F，11-17）：给 客户关键词SQL 的「另比」，每个词一段 c.id IN (…)。
 * 只算**我能看的、不在公海的项目**（同「项目数」「当前节点」两列和阶段 / 进程筛选，我能看的项目们 = 限定层 ∧ 能看项目）：看不到的项目叫什么名字，搜不出来、也试不出来；
 * 客户本身照旧经列表的可见范围（快路径的范围 SQL、老路的限定层），看不到的客户不会因为项目名对上就出来。
 * 量（8.6 万客户 + 8.6 万项目的一次性库）：项目表没有名字索引（库侧不动，3H），每个词多一遍项目名 GLOB（约 15 ms）；Prisma 按 id 取几百行也要二三十 ms，所以：
 *   一句裸 SQL 取候选（名字对上、没删、不在公海，连带 能看项目 要的几列；一个都没中就不问我是谁）；
 *   看全部的直接用候选的客户（宽词改成子查询，不把上万行搬进内存）；
 *   别的人先在内存里按 能看项目 筛，剩下的再经限定层核一遍（同 我能看的项目们）——核的只是自己能看的那几个。
 * 只有企业版有项目；别的版本返回 undefined（不另比）。取我：给了 userId（AI 助手经 MCP）按那个人，不给 = 当前登录的人
 */
export function 项目名另比(取我: () => Promise<谁 | null>): 另比一词 | undefined {
  if (!企业版()) return undefined;
  let 我: Promise<谁 | null> | undefined;
  // 能看项目 要的列照 权限项目列 拼（含待分配本线放开那几格，P-转-42），不另写一份。
  // 这里把字段名直接当列名用：权限项目列 只能放 schema 里没有 @map 的字段（有 @map 的库里列名和字段名不同，裸 SQL 会报找不到列）；
  // 将来给其中哪个字段加 @map，这句要改成按库里列名写（tests/ent-await-assign-open-detail.test.ts 核着 schema）
  const 候选SQL = `SELECT p.id, p."customerId", ${Object.keys(权限项目列).map((k) => `p."${k}"`).join(", ")} FROM "Project" p WHERE p.name GLOB ? AND p."deletedAt" IS NULL AND p."pooledAt" IS NULL`;
  type 候选行 = {
    id: string; customerId: string; ownerId: string; creatorId: string | null; bizLine: string | null; phase: string | null; result: string | null;
    pooledAt: 裸时刻; awaitAssignAt: 裸时刻; scheduledAssignAt: 裸时刻; deletedAt: 裸时刻;
  };
  // 一个参数带整份名单（json_each），不受绑定参数个数上限管，也能进只读通道
  const 名单 = (ids: readonly string[]) => ({ sql: `c.id IN (SELECT value FROM json_each(?))`, values: [JSON.stringify([...new Set(ids)])] });
  return async (词) => {
    const 名 = 包含模式(词, true);
    let 候选 = await prisma.$queryRawUnsafe<候选行[]>(`${候选SQL} LIMIT ${候选先取 + 1}`, 名);
    if (!候选.length) return null;
    const me = await (我 ??= 取我());
    if (!me) return null;
    const org = await 权限组织();
    if (org && !只看的人(org, me.id) && !没设业务角色(org, me.id) && 能看全部(me, org)) {
      // 看全部的（同 阶段客户）：不用逐个判可见
      if (候选.length <= 候选先取) return 名单(候选.map((p) => p.customerId));
      return { sql: `c.id IN (SELECT p."customerId" FROM "Project" p WHERE p.name GLOB ? AND p."deletedAt" IS NULL AND p."pooledAt" IS NULL)`, values: [名] };
    }
    if (候选.length > 候选先取) 候选 = await prisma.$queryRawUnsafe<候选行[]>(候选SQL, 名);
    const 加入了 = new Set((await prisma.$queryRawUnsafe<{ projectId: string }[]>(
      `SELECT m."projectId" FROM "ProjectMember" m WHERE m."userId" = ? AND m."inviteStatus" = 'JOINED'`, me.id,
    )).map((m) => m.projectId));
    const 能看 = 候选.filter((p) => 能看项目(me, {
      ...p, pooledAt: null, awaitAssignAt: 成时刻(p.awaitAssignAt), scheduledAssignAt: 成时刻(p.scheduledAssignAt), deletedAt: 成时刻(p.deletedAt),
      已加入: 加入了.has(p.id) ? [me.id] : [],
    }, org));
    if (!能看.length) return null;
    // 再经限定层核一遍（同 我能看的项目们）：只核内存里筛剩下的那几个
    const 核过 = await prisma.project.findMany({ where: { id: { in: 能看.map((p) => p.id) }, pooledAt: null }, select: { customerId: true } });
    return 核过.length ? 名单(核过.map((p) => p.customerId)) : null;
  };
}
