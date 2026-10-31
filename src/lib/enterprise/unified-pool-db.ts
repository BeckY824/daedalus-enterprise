/**
 * 企业版统一公海的取数（2026-10-29，P7）：客户公海 + 项目公海一次取齐，拼成 公海行，筛排分页在 unified-pool.ts。
 * 规矩（一行是什么、属性、入池原因、快捷）见 unified-pool.ts 开头。
 *
 * 量：两句 findMany（各带一层 include）+ 一句可见客户，全部并行，不按行再查（30 人同时开也是固定 3 句）。
 * 公海是「没人要的」那一堆，不会很大；各取最近入池的 公海取上限 条，超了页面上说一声，更早的靠搜索
 */
import { prisma } from "@/lib/prisma";
import { 看得到的客户, 露客户, 公海超时收回 } from "@/lib/project/db";
import { 字典of, 本套位置 } from "@/lib/project/nodes";
import { 阶段与进程 } from "@/lib/project/stage-dict";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 自动掉公海 } from "@/lib/pool-db";
import { 拦原负责人 } from "./pool-rules";
import {
  客户定状态, 进程格, 进行中, 客户入池类, 项目入池类, 入池原因文字, 归到快捷, 筛排,
  type 公海行, type 公海筛选, type 入池类,
} from "./unified-pool";

/** 客户公海、项目公海各最多取这么多（按入池时间新的在前） */
export const 公海取上限 = 2000;

type 项目片 = { name: string; phase: string; node: string; result: string | null };
type 字典 = ReturnType<typeof 字典of>;

/** 一个项目的 阶段 / 节点 / 结局（老节点名、老结局名换成本套叫法；有结局的阶段按结局归） */
function 位置(p: 项目片, 字典: 字典) {
  const x = 阶段与进程(本套位置(p, 字典), 字典);
  return { 阶段: x.阶段, 节点: x.进程, 结局: x.结局 };
}

/**
 * 「当前进程」那一格 + 鼠标停上去的明细（U-公海-04）：按 客户定状态 取定状态的那个项目，写「节点 · 状态」，其他类前面带阶段；
 * 名下不止一个项目时明细列出每个项目
 */
function 进程们(projects: readonly 项目片[], 字典: 字典) {
  const 定 = 客户定状态(projects);
  const 进程 = 定.项目 ? 进程格(定.属性, 位置(定.项目, 字典)) : null;
  const 进程明细 = projects.length > 1
    ? projects.map((p) => { const x = 位置(p, 字典); return `${p.name}：${x.阶段} · ${x.节点} · ${x.结局 ?? 进行中}`; }).join("；")
    : null;
  return { 属性: 定.属性, 进程, 进程明细 };
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
        // orderBy 用到的字段必须一起 select：公海客户过 999 个时 Prisma（6.16，SQLite）把子查询的 IN 拆成几批再合，
        // 合的时候要按 orderBy 字段排，没 select 就 panic「no entry found for key」，整页打不开（10-30 8702 导入 4882 个客户后）
        projects: { select: { id: true, name: true, phase: true, node: true, result: true, createdAt: true }, orderBy: { createdAt: "asc" } },
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
        logs: { where: { kind: "pool-release" }, orderBy: { at: "desc" }, take: 1, select: { userId: true, reason: true, at: true } },
      },
    }),
    生效组织规则(),
  ]);
  const 字典 = 字典of(true, 规则.阶段.出口叫法);
  const 可见 = await 看得到的客户(项目们.map((p) => p.customerId));
  const 拦 = 拦原负责人();

  const 客户行: 公海行[] = 客户们.map((c) => {
    const 原类 = 客户入池类(c.pool!);
    const 类: 入池类 = c.poolInvalidAt ? "无效" : 原类;
    const 一个 = c.projects.length === 1 ? c.projects[0] : null;
    const 进 = 进程们(c.projects, 字典);
    return {
      id: `c:${c.id}`, 种: "客户", customerId: c.id, projectId: 一个?.id ?? null,
      客户名: c.name,
      项目名: c.projects.length ? c.projects.map((p) => p.name).join("、") : null,
      进程: 进.进程, 进程明细: 进.进程明细,
      属性: 进.属性,
      最后跟进: c.lastFollowAt?.toISOString() ?? null,
      入池时间: c.pool!.at.toISOString(),
      创建时间: c.createdAt.toISOString(),
      类, 累计: c.poolReturns, 入池原因: 入池原因文字(原类, c.pool!.reason), 快捷: 归到快捷({ 类, 累计: c.poolReturns }),
      原负责人是我: 拦 && c.salesOwnerId === me.id,
    };
  });
  const 项目行: 公海行[] = 项目们.map((p) => {
    const 类 = 项目入池类(p.logs[0] ?? null);
    const 累计 = p.customer.poolReturns;
    const 进 = 进程们([p], 字典);
    return {
      id: `p:${p.id}`, 种: "项目", customerId: p.customerId, projectId: p.id,
      客户名: 露客户(me, p, 可见) ? p.customer.name : null,
      项目名: p.name,
      进程: 进.进程, 进程明细: null,
      属性: 进.属性,
      最后跟进: p.customer.lastFollowAt?.toISOString() ?? null,
      入池时间: p.pooledAt!.toISOString(),
      创建时间: p.createdAt.toISOString(),
      类, 累计, 入池原因: 入池原因文字(类, p.logs[0]?.reason), 快捷: 归到快捷({ 类, 累计 }),
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
