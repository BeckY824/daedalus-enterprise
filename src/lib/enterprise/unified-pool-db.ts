/**
 * 企业版统一公海的取数（2026-10-29，P7）：客户公海 + 项目公海一次取齐，拼成 公海行，筛排分页在 unified-pool.ts。
 * 规矩（一行是什么、属性、入池原因、快捷）见 unified-pool.ts 开头。
 *
 * 量：两句 findMany（各带一层 include）+ 一句可见客户，全部并行，不按行再查（30 人同时开也是固定 3 句）。
 * 公海是「没人要的」那一堆，不会很大；各取最近入池的 公海取上限 条，超了页面上说一声，更早的靠搜索
 */
import { prisma } from "@/lib/prisma";
import { 看得到的客户, 露客户, 公海超时收回 } from "@/lib/project/db";
import { 字典of, 结局叫法, 本套位置 } from "@/lib/project/nodes";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 自动掉公海 } from "@/lib/pool-db";
import { 拦原负责人 } from "./pool-rules";
import {
  客户公海属性, 项目公海属性, 客户入池类, 项目入池类, 入池原因文字, 归到快捷, 筛排,
  type 公海行, type 公海筛选, type 入池类,
} from "./unified-pool";

/** 客户公海、项目公海各最多取这么多（按入池时间新的在前） */
export const 公海取上限 = 2000;

type 项目片 = { phase: string; node: string; result: string | null };

/** 「当前进程」那一格：没结局的写 阶段 · 节点（老节点名换成本套叫法），有结局的写结局叫法 */
function 进程(p: 项目片, 字典: ReturnType<typeof 字典of>): string {
  if (p.result) return 结局叫法(p.result, 字典);
  return `${p.phase} · ${本套位置(p, 字典).node}`;
}

/**
 * 取全量公海行（还没筛）。先跑一遍两种自动回收（同客户页 / 项目页：先收再列），收不动不挡列表
 */
export async function 读公海行(me: { id: string; name: string }): Promise<{ 行: 公海行[]; 截断: boolean }> {
  await Promise.all([
    自动掉公海(me).catch((e) => console.error("[自动掉公海] 扫的时候出错，这次先不掉", e)),
    公海超时收回(me).catch((e) => console.error("[超时回收] 扫的时候出错，这次先不收", e)),
  ]);
  const [客户们, 项目们, 规则] = await Promise.all([
    // 带限定的客户端：公海里的客户人人看得到（限定层说了算，这里不另写）
    prisma.customer.findMany({
      where: { pool: { isNot: null } },
      orderBy: { pool: { at: "desc" } },
      take: 公海取上限,
      select: {
        id: true, name: true, salesOwnerId: true, lastFollowAt: true, createdAt: true, poolInvalidAt: true, poolReturns: true,
        pool: { select: { userId: true, reason: true, at: true } },
        projects: { select: { id: true, name: true, phase: true, node: true, result: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    // 项目公海里、客户不在客户公海的：客户在客户公海的那些已经算在客户行里（领客户即领项目）
    prisma.project.findMany({
      where: { pooledAt: { not: null }, customer: { pool: null } },
      orderBy: { pooledAt: "desc" },
      take: 公海取上限,
      select: {
        id: true, name: true, phase: true, node: true, result: true, pooledAt: true, ownerId: true, customerId: true, createdAt: true,
        customer: { select: { name: true, lastFollowAt: true, poolReturns: true } },
        logs: { where: { kind: "pool-release" }, orderBy: { at: "desc" }, take: 1, select: { userId: true, reason: true } },
      },
    }),
    生效组织规则(),
  ]);
  const 字典 = 字典of(true, 规则.阶段.出口叫法);
  const 可见 = await 看得到的客户(项目们.map((p) => p.customerId));
  const 拦 = 拦原负责人();

  const 客户行: 公海行[] = 客户们.map((c) => {
    const 类: 入池类 = c.poolInvalidAt ? "无效" : 客户入池类(c.pool!);
    const 一个 = c.projects.length === 1 ? c.projects[0] : null;
    return {
      id: `c:${c.id}`, 种: "客户", customerId: c.id, projectId: 一个?.id ?? null,
      客户名: c.name,
      项目名: c.projects.length ? c.projects.map((p) => p.name).join("、") : null,
      进程: c.projects.length ? c.projects.map((p) => 进程(p, 字典)).join("；") : null,
      属性: 客户公海属性(c.projects),
      最后跟进: c.lastFollowAt?.toISOString() ?? null,
      入池时间: c.pool!.at.toISOString(),
      创建时间: c.createdAt.toISOString(),
      类, 累计: c.poolReturns, 入池原因: 入池原因文字(类, c.poolReturns), 快捷: 归到快捷({ 类, 累计: c.poolReturns }),
      原负责人是我: 拦 && c.salesOwnerId === me.id,
    };
  });
  const 项目行: 公海行[] = 项目们.map((p) => {
    const 类 = 项目入池类(p.logs[0] ?? null);
    const 累计 = p.customer.poolReturns;
    return {
      id: `p:${p.id}`, 种: "项目", customerId: p.customerId, projectId: p.id,
      客户名: 露客户(me, p, 可见) ? p.customer.name : null,
      项目名: p.name,
      进程: 进程(p, 字典),
      属性: 项目公海属性(p),
      最后跟进: p.customer.lastFollowAt?.toISOString() ?? null,
      入池时间: p.pooledAt!.toISOString(),
      创建时间: p.createdAt.toISOString(),
      类, 累计, 入池原因: 入池原因文字(类, 累计), 快捷: 归到快捷({ 类, 累计 }),
      // 项目公海原负责人一律领不回（企业版看规则，别的版本本来就不能）
      原负责人是我: p.ownerId === me.id,
    };
  });
  return { 行: [...客户行, ...项目行], 截断: 客户们.length >= 公海取上限 || 项目们.length >= 公海取上限 };
}

/** 页面用：取全量 → 筛排 → 切这一页 */
export async function 读公海页(me: { id: string; name: string }, sp: 公海筛选, page: number, pageSize: number) {
  const { 行: 全部, 截断 } = await 读公海行(me);
  const { 行, 快捷数, 属性数 } = 筛排(全部, sp);
  const 页数 = Math.max(1, Math.ceil(行.length / pageSize));
  const 当前页 = Math.min(Math.max(1, page), 页数);
  return { 行: 行.slice((当前页 - 1) * pageSize, 当前页 * pageSize), 总数: 行.length, 当前页, 快捷数, 属性数, 截断, 库里有: 全部.length > 0 };
}
