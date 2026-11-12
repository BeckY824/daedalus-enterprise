import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { cache } from "react";
import { 能看项目, 能看全部, 只看的人, 没设业务角色, type 谁 } from "@/lib/enterprise/permissions";
import { 权限组织 } from "@/lib/enterprise/org";
import { 本套位置, 节点序号 } from "./nodes";
import { 企业版字典, 字典of } from "./stage-dict";
import { 阶段进程条件 } from "./list";
import { 客户id集合 } from "@/lib/search-keyword";

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
    select: {
      id: true, customerId: true, phase: true, node: true, result: true, pooledAt: true, ownerId: true, creatorId: true, bizLine: true, updatedAt: true,
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
