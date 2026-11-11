/**
 * 企业版统一公海的取数（2026-10-29，P7）：客户公海 + 项目公海一次取齐，拼成 公海行，筛排分页在 unified-pool.ts。
 * 规矩（一行是什么、属性、入池原因、快捷）见 unified-pool.ts 开头。
 *
 * 量：先两句取行，再两句取行上挂的项目和放回留痕，加一句可见客户（过 400 位才分批），不按行再查，30 人同时开也就这么多。
 * 公海是「没人要的」那一堆，不会很大；各取最近入池的 公海取上限 条，超了页面上说一声，更早的靠搜索
 *
 * 客户的项目、项目的留痕不用 select 关联带（11-02）：关联加载内部是 外键 IN (所有父行)，公海过 999 行就超 SQLite 的参数上限，
 * Prisma 要拆批；范围层给关联补的 看得到的项目 带 pooledAt: { not: null }，否定条件没法拆，受限身份一开就 P2029（总管理不限定所以不报）。
 * 单独查、用关联条件框范围，不拼大 IN；范围层给顶层查询加的条件和原来给关联加的是同一句，口径不变
 *
 * 客户行的公海属性按名下全部项目算，不过范围层（11-02）：属性是客户本身的事，谁看都一样。受限身份看不到项目时不能当成「没有项目」落到其他。
 * 项目名、当前进程还是按各人看得到的项目，这句不放开
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 看得到的客户, 露客户, 公海超时收回 } from "@/lib/project/db";
import { 字典of, 本套位置 } from "@/lib/project/nodes";
import { 阶段与进程 } from "@/lib/project/stage-dict";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 自动掉公海 } from "@/lib/pool-db";
import { 拦原负责人 } from "./pool-rules";
import { 原负责人回避, 回避豁免 } from "@/lib/project/pool-owner";
import type { Prisma } from "@/generated/prisma";
import { 公海名单条件, 渠道阶段候选 } from "@/lib/project/list";
import {
  客户定状态, 客户公海属性, 进程格, 客户入池类, 项目入池类, 入池原因文字, 归到快捷, 筛排,
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
 * 「当前进程」那一格 + 鼠标停上去的明细（U-公海-04）：按 客户定状态 取定状态的那个项目，写「阶段-节点」（11-01 用户：「应该是阶段+进程名。例如线索-潜客培育」），有结局再带结局；
 * 名下不止一个项目时明细列出每个项目
 */
function 进程们(projects: readonly 项目片[], 字典: 字典) {
  const 定 = 客户定状态(projects);
  const 进程 = 定.项目 ? 进程格(定.属性, 位置(定.项目, 字典)) : null;
  const 进程明细 = projects.length > 1
    ? projects.map((p) => { const x = 位置(p, 字典); return `${p.name}：${进程格(定.属性, x)}`; }).join("；")
    : null;
  return { 属性: 定.属性, 进程, 进程明细 };
}

/**
 * 取全量公海行（还没筛）。先跑一遍两种自动回收（同客户页 / 项目页：先收再列），收不动不挡列表。
 * 只要（渠道名单，11-11）：只取挂着这些公海项目的客户 / 这些公海项目（名单的条件，见 读公海页），不受「各取最近 公海取上限 条」的框外那些影响
 */
export async function 读公海行(me: { id: string; name: string; role?: string }, 只要?: Prisma.ProjectWhereInput): Promise<{ 行: 公海行[]; 截断: boolean; 字典: 字典 }> {
  await Promise.all([
    自动掉公海(me).catch((e) => console.error("[自动掉公海] 扫的时候出错，这次先不掉", e)),
    公海超时收回(me).catch((e) => console.error("[超时回收] 扫的时候出错，这次先不收", e)),
  ]);
  const [查到客户, 项目们, 规则] = await Promise.all([
    // 带限定的客户端：公海里的客户人人看得到（限定层说了算，这里不另写）
    prisma.customer.findMany({
      where: { pool: { isNot: null }, ...(只要 ? { projects: { some: 只要 } } : {}) },
      orderBy: { pool: { at: "desc" } },
      take: 公海取上限,
      select: {
        id: true, name: true, salesOwnerId: true, lastFollowAt: true, createdAt: true, poolInvalidAt: true, poolReturns: true, channelId: true,
        pool: { select: { userId: true, reason: true, at: true } },
      },
    }),
    // 项目公海里、客户不在客户公海的：客户在客户公海的那些已经算在客户行里（领客户即领项目）
    prisma.project.findMany({
      where: { pooledAt: { not: null }, customer: { pool: null }, ...(只要 ? { AND: [只要] } : {}) },
      orderBy: { pooledAt: "desc" },
      take: 公海取上限,
      select: {
        id: true, name: true, phase: true, node: true, result: true, pooledAt: true, ownerId: true, customerId: true, createdAt: true, channelId: true,
        customer: { select: { name: true, lastFollowAt: true, poolReturns: true, channelId: true } },
      },
    }),
    生效组织规则(),
  ]);
  // Prisma 分批查关联，中间这行被别人领走 pool 就是 null（11-03 测试 B2-8：整页 500），跳过这行
  const 客户们 = 查到客户.flatMap((c) => (c.pool ? [{ ...c, pool: c.pool }] : []));
  const 字典 = 字典of(true, 规则.阶段.出口叫法);
  // 取满了才按最早入池那一行框，没取满就是公海全部。框出来的可能比这些行多（同一刻入池的），下面按行取，多的不用
  const 最早客户 = 客户们.length >= 公海取上限 ? 客户们[客户们.length - 1].pool!.at : null;
  const 最早项目 = 项目们.length >= 公海取上限 ? 项目们[项目们.length - 1].pooledAt! : null;
  const 框客户 = { customer: { pool: 最早客户 ? { at: { gte: 最早客户 } } : { isNot: null } } };
  const [客户的项目们, 定属性的项目们, 留痕们, 可见] = await Promise.all([
    客户们.length
      ? prisma.project.findMany({
        where: 框客户,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { customerId: true, id: true, name: true, phase: true, node: true, result: true, createdAt: true },
      })
      : [],
    客户们.length
      ? 看全部(() => prisma.project.findMany({ where: 框客户, select: { customerId: true, phase: true, result: true } }))
      : [],
    项目们.length
      ? prisma.projectNodeLog.findMany({
        where: { kind: "pool-release", project: { pooledAt: 最早项目 ? { gte: 最早项目 } : { not: null }, customer: { pool: null } } },
        orderBy: [{ at: "desc" }, { id: "desc" }],
        select: { projectId: true, userId: true, reason: true, fromOwnerId: true },
      })
      : [],
    看得到的客户(项目们.map((p) => p.customerId)),
  ]);
  const 项目of客户 = new Map<string, (typeof 客户的项目们)[number][]>();
  for (const p of 客户的项目们) {
    const 们 = 项目of客户.get(p.customerId);
    if (们) 们.push(p);
    else 项目of客户.set(p.customerId, [p]);
  }
  const 全部项目of客户 = new Map<string, (typeof 定属性的项目们)[number][]>();
  for (const p of 定属性的项目们) {
    const 们 = 全部项目of客户.get(p.customerId);
    if (们) 们.push(p);
    else 全部项目of客户.set(p.customerId, [p]);
  }
  // 每个项目最近一条放回：入池类、入池原因认它；fromOwnerId 就是原负责人 = 最后一次进公海前的负责人
  // （11-01 C-01 起企业版进公海清负责人，只在留痕里，同 lib/project/pool-owner.ts 历史负责人们）
  const 最近放回 = new Map<string, (typeof 留痕们)[number]>();
  for (const l of 留痕们) if (!最近放回.has(l.projectId)) 最近放回.set(l.projectId, l);
  const 拦 = 拦原负责人();
  // 历史负责人看不到公海里的这个项目（总管理 / 管理员不算）
  const 回避 = 原负责人回避() && !(await 回避豁免(me));

  const 客户行: 公海行[] = 客户们.map((c) => {
    const 原类 = 客户入池类(c.pool!);
    const 类: 入池类 = c.poolInvalidAt ? "无效" : 原类;
    const 名下 = 项目of客户.get(c.id) ?? [];
    const 一个 = 名下.length === 1 ? 名下[0] : null;
    const 进 = 进程们(名下, 字典);
    return {
      id: `c:${c.id}`, 种: "客户", customerId: c.id, projectId: 一个?.id ?? null,
      客户名: c.name,
      项目名: 名下.length ? 名下.map((p) => p.name).join("、") : null,
      进程: 进.进程, 进程明细: 进.进程明细,
      属性: 客户公海属性(全部项目of客户.get(c.id) ?? []),
      最后跟进: c.lastFollowAt?.toISOString() ?? null,
      入池时间: c.pool!.at.toISOString(),
      创建时间: c.createdAt.toISOString(),
      类, 累计: c.poolReturns, 入池原因: 入池原因文字(原类, c.pool!.reason), 快捷: 归到快捷({ 类, 累计: c.poolReturns }),
      原负责人是我: 拦 && c.salesOwnerId === me.id,
      来源id: c.channelId,
    };
  });
  const 项目行: 公海行[] = 项目们.filter((p) => !(回避 && 最近放回.get(p.id)?.fromOwnerId === me.id)).map((p) => {
    const 留痕 = 最近放回.get(p.id) ?? null;
    const 类 = 项目入池类(留痕);
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
      类, 累计, 入池原因: 入池原因文字(类, 留痕?.reason), 快捷: 归到快捷({ 类, 累计 }),
      // 项目公海原负责人一律领不回（企业版看规则，别的版本本来就不能）
      原负责人是我: (留痕?.fromOwnerId || p.ownerId) === me.id,
      来源id: p.channelId ?? (露客户(me, p, 可见) ? p.customer.channelId : null),
    };
  });
  return { 行: [...客户行, ...项目行], 截断: 客户们.length >= 公海取上限 || 项目们.length >= 公海取上限, 字典 };
}

/** 页面用：取全量 → 筛排 → 切这一页 */
export async function 读公海页(me: { id: string; name: string; role?: string }, sp: 公海筛选, page: number, pageSize: number, 名单?: { channelId: string; phase: string }) {
  // 渠道名单（渠道页「另 M 条在公海」点进来，11-11）：按项目一条一行，和渠道页数的是同一句（list.ts 公海名单条件）
  const 名单条件 = 名单?.channelId ? await 公海名单条件(me, 渠道阶段候选(名单.channelId, 名单.phase)) : null;
  const 取到 = await 读公海行(me, 名单条件 ?? undefined);
  const 全部 = 名单条件 ? await 按名单展开(取到, 名单条件) : 取到.行;
  const 截断 = 取到.截断;
  const { 行, 快捷数, 属性数 } = 筛排(全部, sp);
  const 页数 = Math.max(1, Math.ceil(行.length / pageSize));
  const 当前页 = Math.min(Math.max(1, page), 页数);
  return { 行: 行.slice((当前页 - 1) * pageSize, 当前页 * pageSize), 总数: 行.length, 当前页, 快捷数, 属性数, 截断, 库里有: 取到.行.length > 0 };
}

/**
 * 渠道名单：名单里的公海项目一个一行（渠道页数的是项目，条数要对得上）。
 *   - 客户不在客户公海的：就是取到的那一行项目行
 *   - 客户在客户公海的：取到的是一行客户行（领客户即领项目），按名单里它名下的项目拆成几行，每行写那一个项目的名字和进程；
 *     领取 / 分配照旧按客户（customerId），id 带上项目以免撞（c:客户:项目）
 * 名单的项目走带限定的客户端取（可见范围、原负责人回避照旧）；取到的行里没有对应的（框外、刚被领走）不列
 */
async function 按名单展开(取到: { 行: 公海行[]; 字典: 字典 }, 名单条件: Prisma.ProjectWhereInput): Promise<公海行[]> {
  const 们 = await prisma.project.findMany({ where: 名单条件, orderBy: [{ pooledAt: "desc" }, { id: "asc" }], select: { id: true, customerId: true, name: true, phase: true, node: true, result: true } });
  const 项目行of = new Map(取到.行.flatMap((r) => (r.种 === "项目" && r.projectId ? [[r.projectId, r] as const] : [])));
  const 客户行of = new Map(取到.行.flatMap((r) => (r.种 === "客户" ? [[r.customerId, r] as const] : [])));
  return 们.flatMap((p): 公海行[] => {
    const 项 = 项目行of.get(p.id);
    if (项) return [项];
    const 客 = 客户行of.get(p.customerId);
    if (!客) return [];
    const x = 进程们([p], 取到.字典);
    return [{ ...客, id: `c:${p.customerId}:${p.id}`, projectId: p.id, 项目名: p.name, 进程: x.进程, 进程明细: null }];
  });
}
