/**
 * 企业版统一公海的取数（2026-10-29，P7）：客户公海 + 项目公海一次取齐，拼成 公海行，筛排分页在 unified-pool.ts。
 * 规矩（一行是什么、属性、入池原因、快捷）见 unified-pool.ts 开头。
 *
 * 量：先三句取行（客户、进公海那一行、公海项目），再取定属性的项目和放回留痕；项目名 / 当前进程、原负责人、客户可见只为这一页的行查（搜关键词、按来源筛时才为全部行查，见 全取），
 * 不按行再查，30 人同时开也就这么多。
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
import { 公海客户原负责人是 } from "@/lib/owner-log-db";
import { 看得到的客户, 露客户, 公海超时收回 } from "@/lib/project/db";
import { 字典of, 本套位置 } from "@/lib/project/nodes";
import { 阶段与进程 } from "@/lib/project/stage-dict";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 自动掉公海 } from "@/lib/pool-db";
import { 拦原负责人 } from "./pool-rules";
import { 原负责人回避, 回避豁免, 一批id数 } from "@/lib/project/pool-owner";
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

type 客户的项目 = { customerId: string; id: string; name: string; phase: string; node: string; result: string | null };

/** 客户名下、各人看得到的项目（走带限定的客户端），按创建先后：项目名、当前进程、定状态的那个都认这个顺序 */
function 查客户的项目(where: Prisma.ProjectWhereInput): Promise<客户的项目[]> {
  return prisma.project.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { customerId: true, id: true, name: true, phase: true, node: true, result: true, createdAt: true },
  });
}

function 按客户分<P extends { customerId: string }>(们: readonly P[]): Map<string, P[]> {
  const 出 = new Map<string, P[]>();
  for (const p of 们) {
    const 有 = 出.get(p.customerId);
    if (有) 有.push(p);
    else 出.set(p.customerId, [p]);
  }
  return 出;
}

const 池要的 = { customerId: true, userId: true, reason: true, at: true } satisfies Prisma.CustomerPoolSelect;

/** 客户行里要「各人看得到的项目」才拼得出的四格 */
function 客户项目格(名下: readonly 客户的项目[], 字典: 字典) {
  const 进 = 进程们(名下, 字典);
  return {
    projectId: 名下.length === 1 ? 名下[0].id : null,
    项目名: 名下.length ? 名下.map((p) => p.name).join("、") : null,
    进程: 进.进程, 进程明细: 进.进程明细,
  };
}

/** 项目行里要「我看不看得到这位客户」才定得下的两格：客户不露就不写名字，来源也只认项目自己选的 */
function 项目客户格(露: boolean, p: { channelId: string | null; customer: { name: string; channelId: string | null } }) {
  return { 客户名: 露 ? p.customer.name : null, 来源id: p.channelId ?? (露 ? p.customer.channelId : null) };
}

/**
 * 筛、数、排要用到的先不取全：只有这一页才用得上的（11-10，代码体检 P1）留给 补这一页。
 *   - 客户的项目：项目名只有按关键词搜才参加筛，当前进程、点进去的项目不参加 → 没搜关键词就只取这一页客户的
 *   - 客户可见：项目行的客户名（关键词）、来源（按来源筛）才看 → 两样都没筛就只查这一页的
 *   - 原负责人是我（客户行）：不参加筛排，永远只查这一页的
 * 属性、入池方式、三种排序、来源（客户行）每一行都要，照旧全取；这些是算出来的（看名下全部项目的阶段和结局、入池说明的写法），
 * 库里筛不出一样的结果，仍在内存里筛、数、排
 */
type 全取 = { 客户的项目: boolean; 客户可见: boolean;
  /** 渠道名单（11-11）：只取挂着这些公海项目的客户 / 这些公海项目（名单的条件，见 读公海页），不受「各取最近 公海取上限 条」的框外那些影响 */
  只要?: Prisma.ProjectWhereInput };

/**
 * 取全量公海行（还没筛）。先跑一遍两种自动回收（同客户页 / 项目页：先收再列），收不动不挡列表。
 * 全取 里没要的那几格先空着（客户行的 项目名 / 进程 / 进程明细 / projectId、项目行的 客户名 / 来源id、客户行的 原负责人是我 只算了「负责人还是我」那一半），
 * 筛排之后由 补这一页 填；没补过的行不能往外给
 */
async function 读公海骨架(me: { id: string; name: string; role?: string }, 全取: 全取) {
  await Promise.all([
    自动掉公海(me).catch((e) => console.error("[自动掉公海] 扫的时候出错，这次先不掉", e)),
    公海超时收回(me).catch((e) => console.error("[超时回收] 扫的时候出错，这次先不收", e)),
  ]);
  const [查到客户, 池们, 项目们, 规则] = await Promise.all([
    // 带限定的客户端：公海里的客户人人看得到（限定层说了算，这里不另写）
    prisma.customer.findMany({
      where: { pool: { isNot: null }, ...(全取.只要 ? { projects: { some: 全取.只要 } } : {}) },
      orderBy: { pool: { at: "desc" } },
      take: 公海取上限,
      select: { id: true, name: true, salesOwnerId: true, lastFollowAt: true, createdAt: true, poolInvalidAt: true, poolReturns: true, channelId: true },
    }),
    // 进公海那一行单独取、不用 select 关联带（11-10）：关联加载是 客户 id IN (上面所有行)，一千多位时比取行本身还慢。
    // 同一个带限定的客户端、同样按入池时间新的在前取 公海取上限 条，就是上面那些客户的；对不上的（同一刻入池卡在上限那条线上的）下面按 id 补
    prisma.customerPool.findMany({ ...(全取.只要 ? { where: { customer: { projects: { some: 全取.只要 } } } } : {}), orderBy: { at: "desc" }, take: 公海取上限, select: 池要的 }),
    // 项目公海里、客户不在客户公海的：客户在客户公海的那些已经算在客户行里（领客户即领项目）
    prisma.project.findMany({
      where: { pooledAt: { not: null }, customer: { pool: null }, ...(全取.只要 ? { AND: [全取.只要] } : {}) },
      orderBy: { pooledAt: "desc" },
      take: 公海取上限,
      select: {
        id: true, name: true, phase: true, node: true, result: true, pooledAt: true, ownerId: true, customerId: true, createdAt: true, channelId: true,
        customer: { select: { name: true, lastFollowAt: true, poolReturns: true, channelId: true } },
      },
    }),
    生效组织规则(),
  ]);
  const 池of = new Map(池们.map((p) => [p.customerId, p]));
  const 没对上 = 查到客户.filter((c) => !池of.has(c.id)).map((c) => c.id);
  for (let i = 0; i < 没对上.length; i += 一批id数) {
    for (const p of await prisma.customerPool.findMany({ where: { customerId: { in: 没对上.slice(i, i + 一批id数) } }, select: 池要的 })) 池of.set(p.customerId, p);
  }
  // 两句之间这行被别人领走就没有进公海那一行了（11-03 测试 B2-8：整页 500），跳过这行
  const 客户们 = 查到客户.flatMap((c) => { const pool = 池of.get(c.id); return pool ? [{ ...c, pool }] : []; });
  const 字典 = 字典of(true, 规则.阶段.出口叫法);
  // 取满了才按最早入池那一行框，没取满就是公海全部。框出来的可能比这些行多（同一刻入池的），下面按行取，多的不用
  const 最早客户 = 客户们.length >= 公海取上限 ? 客户们[客户们.length - 1].pool!.at : null;
  const 最早项目 = 项目们.length >= 公海取上限 ? 项目们[项目们.length - 1].pooledAt! : null;
  const 框客户 = { customer: { pool: 最早客户 ? { at: { gte: 最早客户 } } : { isNot: null } } } satisfies Prisma.ProjectWhereInput;
  const [客户的项目们, 定属性的项目们, 留痕们, 可见] = await Promise.all([
    全取.客户的项目 && 客户们.length ? 查客户的项目(框客户) : null,
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
    全取.客户可见 ? 看得到的客户(项目们.map((p) => p.customerId)) : null,
  ]);
  const 项目of客户 = 客户的项目们 ? 按客户分(客户的项目们) : null;
  const 全部项目of客户 = 按客户分(定属性的项目们);
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
    return {
      id: `c:${c.id}`, 种: "客户", customerId: c.id,
      客户名: c.name,
      // 没全取的先按「一个项目都看不到」摆，补这一页 再填
      ...客户项目格(项目of客户?.get(c.id) ?? [], 字典),
      属性: 客户公海属性(全部项目of客户.get(c.id) ?? []),
      最后跟进: c.lastFollowAt?.toISOString() ?? null,
      入池时间: c.pool!.at.toISOString(),
      创建时间: c.createdAt.toISOString(),
      类, 累计: c.poolReturns, 入池原因: 入池原因文字(原类, c.pool!.reason), 快捷: 归到快捷({ 类, 累计: c.poolReturns }),
      // 负责人还是我的这一半；进公海清了负责人、原负责人在历史记录里的那一半 补这一页 再认
      原负责人是我: 拦 && c.salesOwnerId === me.id,
      来源id: c.channelId,
    };
  });
  const 留下的项目 = 项目们.filter((p) => !(回避 && 最近放回.get(p.id)?.fromOwnerId === me.id));
  const 项目行: 公海行[] = 留下的项目.map((p) => {
    const 留痕 = 最近放回.get(p.id) ?? null;
    const 类 = 项目入池类(留痕);
    const 累计 = p.customer.poolReturns;
    const 进 = 进程们([p], 字典);
    return {
      id: `p:${p.id}`, 种: "项目", customerId: p.customerId, projectId: p.id,
      // 没全取可见的先按「客户不露」摆，补这一页 再填
      ...项目客户格(!!可见 && 露客户(me, p, 可见), p),
      项目名: p.name,
      进程: 进.进程, 进程明细: null,
      属性: 进.属性,
      最后跟进: p.customer.lastFollowAt?.toISOString() ?? null,
      入池时间: p.pooledAt!.toISOString(),
      创建时间: p.createdAt.toISOString(),
      类, 累计, 入池原因: 入池原因文字(类, 留痕?.reason), 快捷: 归到快捷({ 类, 累计 }),
      // 项目公海原负责人一律领不回（企业版看规则，别的版本本来就不能）
      原负责人是我: (留痕?.fromOwnerId || p.ownerId) === me.id,
    };
  });
  return {
    行: [...客户行, ...项目行],
    截断: 客户们.length >= 公海取上限 || 项目们.length >= 公海取上限,
    // 补这一页 要的
    字典, 框客户, 拦,
    有客户的项目: !!项目of客户 || !客户们.length,
    有客户可见: !!可见,
    公海项目: new Map(留下的项目.map((p) => [p.id, p])),
  };
}

/**
 * 把筛排之后切出来的这一页补全（骨架里没全取的那几格）：只为这一页的客户 / 项目查，不为公海全部查。
 * 查的条件和全取时是同一句、只是范围换成这一页的行：项目照样走带限定的客户端、按创建先后；原负责人照样包 看全部
 */
async function 补这一页(me: { id: string }, 骨: Awaited<ReturnType<typeof 读公海骨架>>, 页: 公海行[]): Promise<公海行[]> {
  const 客户ids = 页.filter((r) => r.种 === "客户").map((r) => r.customerId);
  const 页里的项目 = 页.flatMap((r) => (r.种 === "项目" && r.projectId ? [骨.公海项目.get(r.projectId)!] : []));
  const [名下们, 我放走的, 可见] = await Promise.all([
    骨.有客户的项目 || !客户ids.length
      ? null
      // 一页的客户按 id 点名；一页大过 一批id数（只有测试、导出这类一次要全部的）照旧按公海全部框，不拼过长的名单
      : 查客户的项目(客户ids.length <= 一批id数 ? { customerId: { in: 客户ids } } : 骨.框客户).then(按客户分),
    // 客户进公海清负责人后（M-公海-03）原负责人在历史记录里；管理员不回避、看得到这一行，按钮照样要灰
    骨.拦 && 客户ids.length ? 看全部(() => 公海客户原负责人是(prisma, [me.id], 客户ids)) : new Map<string, string>(),
    骨.有客户可见 || !页里的项目.length ? null : 看得到的客户(页里的项目.map((p) => p.customerId)),
  ]);
  return 页.map((r) => {
    if (r.种 === "客户") {
      return {
        ...r,
        ...(名下们 ? 客户项目格(名下们.get(r.customerId) ?? [], 骨.字典) : {}),
        原负责人是我: r.原负责人是我 || 我放走的.has(r.customerId),
      };
    }
    const p = 可见 && r.projectId ? 骨.公海项目.get(r.projectId) : undefined;
    return p ? { ...r, ...项目客户格(露客户(me, p, 可见!), p) } : r;
  });
}

/**
 * 页面用：取骨架 → 筛排 → 切这一页 → 补这一页。
 * 每翻一页不再把公海全部的项目名、当前进程、原负责人、客户可见都取一遍；筛、数、排的口径和原来逐条一致
 * （tests/ent-unified-pool-paging.test.ts 拿改前的写法逐个筛选组合、逐页对）
 */
export async function 读公海页(me: { id: string; name: string; role?: string }, sp: 公海筛选, page: number, pageSize: number, 名单?: { channelId: string; phase: string }) {
  // 和 筛排 认关键词、来源用的是同一个判断
  const 有词 = !!(sp.keyword ?? "").trim().toLowerCase();
  // 渠道名单（渠道页「另 M 条在公海」点进来，11-11）：按项目一条一行，和渠道页数的是同一句（list.ts 公海名单条件）
  const 名单条件 = 名单?.channelId ? await 公海名单条件(me, 渠道阶段候选(名单.channelId, 名单.phase)) : null;
  const 骨 = await 读公海骨架(me, { 客户的项目: 有词 || !!名单条件, 客户可见: 有词 || !!sp.来源 || !!名单条件, ...(名单条件 ? { 只要: 名单条件 } : {}) });
  const 全部行 = 名单条件 ? await 按名单展开(骨, 名单条件) : 骨.行;
  const { 行, 快捷数, 属性数 } = 筛排(全部行, sp);
  const 页数 = Math.max(1, Math.ceil(行.length / pageSize));
  const 当前页 = Math.min(Math.max(1, page), 页数);
  const 这页 = await 补这一页(me, 骨, 行.slice((当前页 - 1) * pageSize, 当前页 * pageSize));
  return { 行: 这页, 总数: 行.length, 当前页, 快捷数, 属性数, 截断: 骨.截断, 库里有: 骨.行.length > 0 };
}

/**
 * 渠道名单：名单里的公海项目一个一行（渠道页数的是项目，条数要对得上）。
 *   - 客户不在客户公海的：就是骨架里那一行项目行
 *   - 客户在客户公海的：骨架里是一行客户行（领客户即领项目），按名单里它名下的项目拆成几行，每行写那一个项目的名字和进程；
 *     领取 / 分配照旧按客户（customerId），id 带上项目以免撞（c:客户:项目）
 * 名单的项目走带限定的客户端取（可见范围、原负责人回避照旧）；骨架里没有对应行的（框外、刚被领走）不列
 */
async function 按名单展开(骨: Awaited<ReturnType<typeof 读公海骨架>>, 名单条件: Prisma.ProjectWhereInput): Promise<公海行[]> {
  const 们 = await prisma.project.findMany({ where: 名单条件, orderBy: [{ pooledAt: "desc" }, { id: "asc" }], select: { id: true, customerId: true, name: true, phase: true, node: true, result: true } });
  const 项目行of = new Map(骨.行.flatMap((r) => (r.种 === "项目" && r.projectId ? [[r.projectId, r] as const] : [])));
  const 客户行of = new Map(骨.行.flatMap((r) => (r.种 === "客户" ? [[r.customerId, r] as const] : [])));
  return 们.flatMap((p): 公海行[] => {
    const 项 = 项目行of.get(p.id);
    if (项) return [项];
    const 客 = 客户行of.get(p.customerId);
    if (!客) return [];
    const x = 进程们([p], 骨.字典);
    return [{ ...客, id: `c:${p.customerId}:${p.id}`, projectId: p.id, 项目名: p.name, 进程: x.进程, 进程明细: null }];
  });
}
