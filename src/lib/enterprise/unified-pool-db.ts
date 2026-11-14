/**
 * 企业版统一公海的取数（2026-10-29，P7）：客户公海 + 项目公海一次取齐，拼成 公海行，筛排分页在 unified-pool.ts。
 * 规矩（一行是什么、属性、入池原因、快捷）见 unified-pool.ts 开头。
 *
 * 量：先三句取行（客户、进公海那一行、公海项目），再取定属性的项目和放回留痕；项目名 / 当前进程、原负责人、客户可见只为这一页的行查（搜关键词、按来源筛时才为全部行查，见 全取），
 * 不按行再查，30 人同时开也就这么多。
 * 客户行（公海全量导入后 6.6 万位）在库里筛、数、分页（11-14，unified-pool-sql.ts，读公海页_库里分页）；项目行、渠道名单的行量小，照旧全取在内存里筛排。
 * 11-14 以前各取最近入池的 2000 条（公海取上限），更早入池的搜不到、也不进各池的数
 *
 * 客户的项目、项目的留痕不用 select 关联带（11-02）：关联加载内部是 外键 IN (所有父行)，公海过 999 行就超 SQLite 的参数上限，
 * Prisma 要拆批；范围层给关联补的 看得到的项目 带 pooledAt: { not: null }，否定条件没法拆，受限身份一开就 P2029（总管理不限定所以不报）。
 * 单独查、用关联条件框范围，不拼大 IN；范围层给顶层查询加的条件和原来给关联加的是同一句，口径不变
 *
 * 客户行的公海属性按名下全部项目算，不过范围层（11-02）：属性是客户本身的事，谁看都一样。受限身份看不到项目时不能当成「没有项目」落到线索池（11-11 前是「其他」）。
 * 项目名、当前进程还是按各人看得到的项目，这句不放开；「没有项目」显示 线索-潜客培育 也按全部项目认（真没有才写，看不到的写「—」）
 * 项目行一律客户池；同一位客户的几行在 筛排 里并成一行（并客户池），补这一页 按里面每个项目补完再并
 */
import { prisma, defaultClient } from "@/lib/prisma";
import { 看全部, 现在的公海回避 } from "@/lib/team-scope";
import { 包含模式 } from "@/lib/search-keyword";
import { 分组数SQL, 取一段SQL, 键毫秒, type 客户行筛 } from "./unified-pool-sql";
import { 缓存分组数 } from "./pool-count-cache";
import { 公海客户原负责人是 } from "@/lib/owner-log-db";
import { 看得到的客户, 露客户, 公海超时收回 } from "@/lib/project/db";
import { 字典of, 本套位置 } from "@/lib/project/nodes";
import { 阶段与进程 } from "@/lib/project/stage-dict";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 自动掉公海 } from "@/lib/pool-db";
import { 拦原负责人 } from "./pool-rules";
import { 原负责人回避, 回避豁免, 一批id数 } from "@/lib/project/pool-owner";
import type { Prisma } from "@/generated/prisma";
import { 公海名单条件, 公海名单候选, type 公海名单筛 } from "@/lib/project/list";
import {
  客户定状态, 客户公海属性, 进程显示项目, 进程格, 客户入池类, 项目入池类, 入池原因文字, 归到快捷, 筛排, 并客户池, 没项目进程, 项目行属性,
  规整公海属性, 是快捷, 规整排序,
  type 公海行, type 公海筛选, type 入池类, type 公海属性, type 快捷,
} from "./unified-pool";

/**
 * 改前（11-14 以前）客户公海、项目公海各最多取这么多（按入池时间新的在前），更早入池的搜不到、也不进各池的数。
 * 现在不再截：客户行在库里筛、数、分页（unified-pool-sql.ts），项目行、渠道名单的行量小，全取。只留给 tests/helpers 里改前的写法对拍用
 */
export const 公海取上限 = 2000;

type 项目片 = { id: string; createdAt: Date; name: string; phase: string; node: string; result: string | null };
type 字典 = ReturnType<typeof 字典of>;

/** 一个项目的 阶段 / 节点 / 结局（老节点名、老结局名换成本套叫法；有结局的阶段按结局归） */
function 位置(p: 项目片, 字典: 字典) {
  const x = 阶段与进程(本套位置(p, 字典), 字典);
  return { 阶段: x.阶段, 节点: x.进程, 结局: x.结局 };
}

/**
 * 「当前进程」那一格 + 鼠标停上去的明细（U-公海-04）：写名下最新创建的那个项目（进程显示项目，11-11 跟进；和归池用的项目故意不同），
 * 「阶段-节点」（11-01 用户：「应该是阶段+进程名。例如线索-潜客培育」），有结局再带结局；名下不止一个项目时明细列出每个项目。
 * 范围照旧（11-02）：传进来的是各人看得到的项目，进程格按看得到的里最新的那个；属性另按全部项目算（归池）
 */
function 进程们(projects: readonly 项目片[], 字典: 字典) {
  const 定 = 客户定状态(projects);
  const 显示 = 进程显示项目(projects);
  const 进程 = 显示 ? 进程格(定.属性, 位置(显示, 字典)) : null;
  const 进程明细 = projects.length > 1
    ? projects.map((p) => { const x = 位置(p, 字典); return `${p.name}：${进程格(定.属性, x)}`; }).join("；")
    : null;
  return { 属性: 定.属性, 进程, 进程明细 };
}

type 客户的项目 = { customerId: string; id: string; name: string; phase: string; node: string; result: string | null; createdAt: Date };

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

const 池要的 = { customerId: true, userId: true, reason: true, at: true, phoneIncomplete: true } satisfies Prisma.CustomerPoolSelect;

/** 客户行里要「各人看得到的项目」才拼得出的四格。没项目 = 名下一个项目都没有（按全部项目认，不按看得到的）：进程写 线索-潜客培育（11-11） */
function 客户项目格(名下: readonly 客户的项目[], 字典: 字典, 没项目: boolean) {
  const 进 = 进程们(名下, 字典);
  return {
    projectId: 名下.length === 1 ? 名下[0].id : null,
    项目名: 名下.length ? 名下.map((p) => p.name).join("、") : null,
    进程: 没项目 ? 没项目进程 : 进.进程, 进程明细: 进.进程明细,
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
  /** 客户行在不在骨架里取：读公海页 没名单时客户行改在库里分页（读客户行一页），骨架只取项目行；渠道名单照旧全取 */
  不取客户?: boolean;
  /** 渠道名单（11-11）：只取挂着这些公海项目的客户 / 这些公海项目（名单的条件，见 读公海页），名单之外的公海行一行不取 */
  只要?: Prisma.ProjectWhereInput };

const 客户要的 = { id: true, name: true, salesOwnerId: true, lastFollowAt: true, createdAt: true, poolInvalidAt: true, poolReturns: true, channelId: true } satisfies Prisma.CustomerSelect;
type 客户片 = Prisma.CustomerGetPayload<{ select: typeof 客户要的 }>;
type 池片 = Prisma.CustomerPoolGetPayload<{ select: typeof 池要的 }>;

/** 定属性用的项目：名下全部项目，不过范围层（属性是客户本身的事，谁看都一样；11-02） */
function 定属性的项目(where: Prisma.ProjectWhereInput) {
  return 看全部(() => prisma.project.findMany({ where, select: { customerId: true, phase: true, result: true } }));
}

/** 一行客户行（骨架、库里分页两条路同一个拼法）。没全取的项目格先按「一个项目都看不到」摆，补这一页 再填 */
function 拼客户行(me: { id: string }, c: 客户片, pool: 池片, 看得到的项目: readonly 客户的项目[], 字典: 字典, 没项目: boolean, 全部项目: readonly { phase: string; result: string | null }[], 拦: boolean): 公海行 {
  const 原类 = 客户入池类(pool);
  const 类: 入池类 = c.poolInvalidAt ? "无效" : 原类;
  return {
    id: `c:${c.id}`, 种: "客户", customerId: c.id,
    客户名: c.name,
    ...客户项目格(看得到的项目, 字典, 没项目),
    属性: 客户公海属性(全部项目),
    最后跟进: c.lastFollowAt?.toISOString() ?? null,
    入池时间: pool.at.toISOString(),
    创建时间: c.createdAt.toISOString(),
    类, 累计: c.poolReturns, 入池原因: 入池原因文字(原类, pool.reason), 快捷: 归到快捷({ 类, 累计: c.poolReturns }),
    // 负责人还是我的这一半；进公海清了负责人、原负责人在历史记录里的那一半 补这一页 再认
    原负责人是我: 拦 && c.salesOwnerId === me.id,
    来源id: c.channelId,
    ...(pool.phoneIncomplete ? { 号码不全: true } : {}),
  };
}

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
    全取.不取客户 ? [] : prisma.customer.findMany({
      where: { pool: { isNot: null }, ...(全取.只要 ? { projects: { some: 全取.只要 } } : {}) },
      orderBy: { pool: { at: "desc" } },
      select: 客户要的,
    }),
    // 进公海那一行单独取、不用 select 关联带（11-10）：关联加载是 客户 id IN (上面所有行)，一千多位时比取行本身还慢。
    // 同一个带限定的客户端、同样按入池时间新的在前取，就是上面那些客户的；对不上的（两句之间刚进公海的）下面按 id 补
    全取.不取客户 ? [] : prisma.customerPool.findMany({ ...(全取.只要 ? { where: { customer: { projects: { some: 全取.只要 } } } } : {}), orderBy: { at: "desc" }, select: 池要的 }),
    // 项目公海里、客户不在客户公海的：客户在客户公海的那些已经算在客户行里（领客户即领项目）
    prisma.project.findMany({
      where: { pooledAt: { not: null }, customer: { pool: null }, ...(全取.只要 ? { AND: [全取.只要] } : {}) },
      orderBy: { pooledAt: "desc" },
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
  // 不再截（11-14）：框 = 公海全部
  const 框客户 = { customer: { pool: { isNot: null } } } satisfies Prisma.ProjectWhereInput;
  const [客户的项目们, 定属性的项目们, 留痕们, 可见] = await Promise.all([
    全取.客户的项目 && 客户们.length ? 查客户的项目(框客户) : null,
    客户们.length ? 定属性的项目(框客户) : [],
    项目们.length
      ? prisma.projectNodeLog.findMany({
        where: { kind: "pool-release", project: { pooledAt: { not: null }, customer: { pool: null } } },
        orderBy: [{ at: "desc" }, { id: "desc" }],
        select: { projectId: true, userId: true, reason: true, fromOwnerId: true },
      })
      : [],
    全取.客户可见 ? 看得到的客户(项目们.map((p) => p.customerId)) : null,
  ]);
  const 项目of客户 = 客户的项目们 ? 按客户分(客户的项目们) : null;
  const 全部项目of客户 = 按客户分(定属性的项目们);
  // 名下一个项目都没有的（按全部项目认，不按各人看得到的）：归线索池、进程写 线索-潜客培育
  const 没项目客户 = new Set(客户们.filter((c) => !全部项目of客户.has(c.id)).map((c) => c.id));
  // 每个项目最近一条放回：入池类、入池原因认它；fromOwnerId 就是原负责人 = 最后一次进公海前的负责人
  // （11-01 C-01 起企业版进公海清负责人，只在留痕里，同 lib/project/pool-owner.ts 历史负责人们）
  const 最近放回 = new Map<string, (typeof 留痕们)[number]>();
  for (const l of 留痕们) if (!最近放回.has(l.projectId)) 最近放回.set(l.projectId, l);
  const 拦 = 拦原负责人();
  // 历史负责人看不到公海里的这个项目（总管理 / 管理员不算）
  const 回避 = 原负责人回避() && !(await 回避豁免(me));

  const 客户行: 公海行[] = 客户们.map((c) => 拼客户行(me, c, c.pool, 项目of客户?.get(c.id) ?? [], 字典, 没项目客户.has(c.id), 全部项目of客户.get(c.id) ?? [], 拦));
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
      属性: 项目行属性,
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
    截断: false,
    // 补这一页 要的
    字典, 框客户, 拦, 没项目客户,
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
  // 客户池并出来的那行：按里面每个项目补
  const 页里的项目 = 页.flatMap((r) => (r.种 === "项目" ? r.子 ?? [r] : [])).flatMap((r) => (r.projectId ? [骨.公海项目.get(r.projectId)!] : []));
  const [名下们, 我放走的, 可见] = await Promise.all([
    骨.有客户的项目 || !客户ids.length
      ? null
      // 一页的客户按 id 点名；一页大过 一批id数（只有测试、导出这类一次要全部的）照旧按公海全部框，不拼过长的名单
      : 查客户的项目(客户ids.length <= 一批id数 ? { customerId: { in: 客户ids } } : 骨.框客户).then(按客户分),
    // 客户进公海清负责人后（M-公海-03）原负责人在历史记录里；管理员不回避、看得到这一行，按钮照样要灰
    骨.拦 && 客户ids.length ? 看全部(() => 公海客户原负责人是(prisma, [me.id], 客户ids)) : new Map<string, string>(),
    骨.有客户可见 || !页里的项目.length ? null : 看得到的客户(页里的项目.map((p) => p.customerId)),
  ]);
  const 补项目 = (r: 公海行): 公海行 => {
    const p = 可见 && r.projectId ? 骨.公海项目.get(r.projectId) : undefined;
    return p ? { ...r, ...项目客户格(露客户(me, p, 可见!), p) } : r;
  };
  return 页.map((r) => {
    if (r.种 === "客户") {
      return {
        ...r,
        ...(名下们 ? 客户项目格(名下们.get(r.customerId) ?? [], 骨.字典, 骨.没项目客户.has(r.customerId)) : {}),
        原负责人是我: r.原负责人是我 || 我放走的.has(r.customerId),
      };
    }
    return r.子 ? 并客户池(r.子.map(补项目)) : 补项目(r);
  });
}

/**
 * 页面用：取骨架 → 筛排 → 切这一页 → 补这一页。
 * 每翻一页不再把公海全部的项目名、当前进程、原负责人、客户可见都取一遍；筛、数、排的口径和原来逐条一致
 * （tests/ent-unified-pool-paging.test.ts 拿改前的写法逐个筛选组合、逐页对）
 */
/**
 * 选.数号码不全（客户三态开着才给，三态界面 B 组 C14）：顺带数「号码不全 N」按钮上的 N =
 * 在现在这些筛选上再点「号码不全」会列出几行（同一份全量行在内存里再筛一遍，不多查库；客户池并行、取上限的框、渠道名单拆行都同列表）
 */
export async function 读公海页(me: { id: string; name: string; role?: string }, sp: 公海筛选, page: number, pageSize: number, 名单?: 公海名单筛, 选: { 数号码不全?: boolean } = {}) {
  // 渠道名单（渠道页「另 M 条在公海」点进来，11-11）：按项目一条一行，和渠道页数的是同一句（list.ts 公海名单条件）
  // 按创建时间筛（11-11，渠道看板 TOP5 点进来带时间段）也走名单：时间是项目的创建时间，客户行按项目拆开才数得对
  const 候选 = 名单 ? 公海名单候选(名单) : null;
  const 名单条件 = 候选 ? await 公海名单条件(me, 候选) : null;
  // 没名单（公海页平常的样子）：客户行在库里筛、数、分页（11-14），见 读公海页_库里分页
  if (!名单条件) return 读公海页_库里分页(me, sp, page, pageSize, 选);
  const 骨 = await 读公海骨架(me, { 客户的项目: true, 客户可见: true, 只要: 名单条件 });
  const 全部行 = await 按名单展开(骨, 名单条件);
  // 名单按项目一条一行（和渠道页对数），客户池不并
  const { 行, 快捷数, 属性数 } = 筛排(全部行, sp, { 按项目: true });
  const 页数 = Math.max(1, Math.ceil(行.length / pageSize));
  const 当前页 = Math.min(Math.max(1, page), 页数);
  const 这页 = await 补这一页(me, 骨, 行.slice((当前页 - 1) * pageSize, 当前页 * pageSize));
  // 不数时不带这一格（和改前的返回逐字段一样）
  const 号码不全数 = !选.数号码不全 ? undefined : sp.号码不全 === "1" ? 行.length : 筛排(全部行, { ...sp, 号码不全: "1" }, { 按项目: true }).行.length;
  return { 行: 这页, 总数: 行.length, 当前页, 快捷数, 属性数, 截断: 骨.截断, 库里有: 骨.行.length > 0, ...(号码不全数 === undefined ? {} : { 号码不全数 }) };
}

/**
 * 原负责人回避掉的公海客户（这个人看不到的那几位）。公海客户人人看得到（team-scope 可见客户 第三条），限定层只可能因为回避把公海客户挡掉：
 * 先不过范围层把「可能被回避的」圈出来（负责人是他、回避名单上的、名单过上限时按留痕认的），再用带限定的客户端问一遍哪几位看得到，剩下的就是回避掉的。
 * 不另写一遍回避的规矩，限定层怎么挡这里就怎么排
 */
async function 回避掉的公海客户(): Promise<string[]> {
  const 避 = await 现在的公海回避(defaultClient);
  if (!避) return [];
  const 留痕 = { kind: "pool-release", fromOwnerId: 避.本人 };
  const 圈 = await 看全部(() => prisma.customer.findMany({
    where: {
      pool: { isNot: null },
      OR: [
        { salesOwnerId: 避.本人 },
        ...(避.客户?.length ? [{ id: { in: 避.客户 } }] : []),
        ...(避.客户 === null ? [{ ownerLogs: { some: 留痕 } }, { projects: { some: { pooledAt: { not: null }, logs: { some: 留痕 } } } }] : []),
      ],
    },
    select: { id: true },
  }));
  const ids = 圈.map((c) => c.id);
  const 看得到 = new Set<string>();
  for (let i = 0; i < ids.length; i += 一批id数) {
    for (const c of await prisma.customer.findMany({ where: { id: { in: ids.slice(i, i + 一批id数) } }, select: { id: true } })) 看得到.add(c.id);
  }
  return ids.filter((id) => !看得到.has(id));
}

type 分组行 = { 属性: string; 快捷: string | null; 不全: number | bigint | null; n: number | bigint };

/**
 * 公海页（没渠道名单）：客户行在库里、项目行在内存里，口径和 筛排 一样（tests/ent-unified-pool-paging.test.ts 拿改前的内存写法对拍）。
 *   - 客户行：按 (属性, 快捷, 号码不全) 分组数一次，页签数 / 快捷数 / 总数 / 号码不全数都从这张表加；这一页按排序取一段，再按 id 取这一页的资料
 *   - 项目行：照旧取全（量小），筛排 筛、并、排、数
 *   - 两边不相交（客户行的客户在客户公海，项目行的客户不在），数直接相加；行按同一个排序键（时间倒序、同刻比行 id）合起来切这一页：
 *     第 i 位客户行在合起来的第 i + 排在它前面的项目行数 位，所以要切 [起, 起+页大小) 只用取客户行第 起−项目行数 位到 起+页大小 位
 */
async function 读公海页_库里分页(me: { id: string; name: string; role?: string }, sp: 公海筛选, page: number, pageSize: number, 选: { 数号码不全?: boolean }) {
  const 词 = (sp.keyword ?? "").trim().toLowerCase();
  // 项目行（和骨架同一套取法，只是不取客户行；自动回收也在这里先跑）
  const 骨 = await 读公海骨架(me, { 客户的项目: false, 客户可见: !!词 || !!sp.来源, 不取客户: true });
  const 项目筛 = 筛排(骨.行, sp);
  const 项目不全数 = 0; // 号码不全只打在客户行上，项目行（客户不在客户公海）一行都不会中
  // 客户行的属性：名下全部项目（不过范围层），只有有项目的那几位可能不是线索池
  const 框客户 = { customer: { pool: { isNot: null } } } satisfies Prisma.ProjectWhereInput;
  const [定属性, 排掉, 项目名对上] = await Promise.all([
    定属性的项目(框客户).then(按客户分),
    回避掉的公海客户(),
    // 关键词还比项目名：各人看得到的项目、按创建先后用「、」连起来（同 客户项目格 的 项目名）
    词 ? 查客户的项目(框客户).then((们) => [...按客户分(们)].filter(([, ps]) => ps.map((p) => p.name).join("、").toLowerCase().includes(词)).map(([id]) => id)) : [],
  ]);
  const 商机: string[] = [], 订单: string[] = [];
  for (const [id, ps] of 定属性) {
    const 属 = 客户公海属性(ps);
    if (属 === "商机池") 商机.push(id);
    else if (属 === "订单池") 订单.push(id);
  }
  const 筛: 客户行筛 = { 商机, 订单, 排掉, ...(词 ? { 词: { 名: 包含模式(词), 项目对上: 项目名对上 } } : {}), ...(sp.来源 ? { 来源: sp.来源 } : {}), ...(sp.号码不全 === "1" ? { 号码不全: true } : {}) };
  const 组 = await (async () => {
    const q = 分组数SQL(筛);
    // 没关键词时人人差不多是同一句（只差回避的那几位），短时缓存几秒（pool-count-cache.ts：键是整句 + 参数，写过库就作废）；带关键词的照常现数
    const 数 = () => prisma.$queryRawUnsafe<分组行[]>(q.sql, ...q.值);
    return (await (词 ? 数() : 缓存分组数(q.sql, q.值, 数))).map((r) => ({ 属性: r.属性 as 公海属性, 快捷: (r.快捷 as 快捷 | null) ?? null, 不全: Number(r.不全 ?? 0) === 1, n: Number(r.n) }));
  })();
  const 属性 = 规整公海属性(sp.属性);
  const 快捷 = 是快捷(sp.快捷) ? sp.快捷 : null;
  // 数：属性数在关键词 / 来源 / 号码不全之后；快捷数再在属性之后；总数再在快捷之后（同 筛排）
  const 属性数 = { ...项目筛.属性数 };
  for (const g of 组) {
    属性数.全部 += g.n;
    属性数[g.属性] += g.n;
  }
  const 按属性 = 组.filter((g) => !属性 || g.属性 === 属性);
  const 快捷数 = { ...项目筛.快捷数 };
  for (const g of 按属性) if (g.快捷) 快捷数[g.快捷] += g.n;
  const 客户总数 = 按属性.filter((g) => !快捷 || g.快捷 === 快捷).reduce((a, g) => a + g.n, 0);
  const 总数 = 客户总数 + 项目筛.行.length;
  const 页数 = Math.max(1, Math.ceil(总数 / pageSize));
  const 当前页 = Math.min(Math.max(1, page), 页数);
  const 起 = (当前页 - 1) * pageSize;
  const 止 = 起 + pageSize;
  // 客户行这一段：合起来的第 起 位之前最多有 项目行数 个项目行，所以客户行从第 起−项目行数 位取到第 止 位就够
  const 跳过 = Math.max(0, 起 - 项目筛.行.length);
  const 排序 = 规整排序(sp.排序);
  const 段 = 客户总数 > 跳过
    ? await (async () => {
      const q = 取一段SQL(筛, { 属性, 快捷, 排序, 跳过, 取几: 止 - 跳过 });
      return prisma.$queryRawUnsafe<{ id: string; k: unknown }[]>(q.sql, ...q.值);
    })()
    : [];
  // 合起来：比 筛排 的排序（键倒序、同键比行 id），项目行的键照 筛排 的 取
  const 项目键 = (r: 公海行) => { const v = 排序 === "follow" ? r.最后跟进 : 排序 === "created" ? r.创建时间 : r.入池时间; return v ? new Date(v).getTime() : Number.NEGATIVE_INFINITY; };
  const 前于 = (k1: number, id1: string, k2: number, id2: string) => k1 > k2 || (!(k1 < k2) && id1 < id2);
  const 客户段 = 段.map((x) => ({ k: 键毫秒(x.k), id: `c:${x.id}`, customerId: x.id }));
  const 项目段 = 项目筛.行.map((r) => ({ k: 项目键(r), id: r.id, r }));
  const 落位: { 位: number; 客户?: string; 项目?: 公海行 }[] = [];
  客户段.forEach((c, i) => {
    const 位 = 跳过 + i + 项目段.filter((p) => 前于(p.k, p.id, c.k, c.id)).length;
    if (位 >= 起 && 位 < 止) 落位.push({ 位, 客户: c.customerId });
  });
  项目段.forEach((p, j) => {
    const 位 = j + 跳过 + 客户段.filter((c) => 前于(c.k, c.id, p.k, p.id)).length;
    if (位 >= 起 && 位 < 止) 落位.push({ 位, 项目: p.r });
  });
  落位.sort((a, b) => a.位 - b.位);
  // 这一页的客户行资料：同一个带限定的客户端；两句之间被领走的（没有进公海那一行了）跳过，同骨架。
  // 一页大过 一批id数（测试、一次要全部的）按批取：范围层给回避的人带着否定条件，Prisma 拆不了过 999 个参数的 IN
  const 页客户ids = 落位.flatMap((x) => (x.客户 ? [x.客户] : []));
  const 客户of = new Map<string, Prisma.CustomerGetPayload<{ select: typeof 客户要的 }>>();
  const 池of = new Map<string, Prisma.CustomerPoolGetPayload<{ select: typeof 池要的 }>>();
  for (let i = 0; i < 页客户ids.length; i += 一批id数) {
    const 批 = 页客户ids.slice(i, i + 一批id数);
    const [客户们, 池们] = await Promise.all([
      prisma.customer.findMany({ where: { id: { in: 批 }, pool: { isNot: null } }, select: 客户要的 }),
      prisma.customerPool.findMany({ where: { customerId: { in: 批 } }, select: 池要的 }),
    ]);
    for (const c of 客户们) 客户of.set(c.id, c);
    for (const p of 池们) 池of.set(p.customerId, p);
  }
  const 拦 = 拦原负责人();
  const 骨这页 = { ...骨, 有客户的项目: false, 没项目客户: new Set(页客户ids.filter((id) => !定属性.has(id))) };
  const 页行 = 落位.flatMap((x): 公海行[] => {
    if (x.项目) return [x.项目];
    const c = 客户of.get(x.客户!);
    const pool = 池of.get(x.客户!);
    return c && pool ? [拼客户行(me, c, pool, [], 骨.字典, 骨这页.没项目客户.has(c.id), 定属性.get(c.id) ?? [], 拦)] : [];
  });
  const 这页 = await 补这一页(me, 骨这页, 页行);
  const 号码不全数 = !选.数号码不全 ? undefined : sp.号码不全 === "1" ? 总数
    : 按属性.filter((g) => g.不全 && (!快捷 || g.快捷 === 快捷)).reduce((a, g) => a + g.n, 0) + 项目不全数;
  // 库里有：不看筛选，公海里有没有这个人看得到的行
  const 库里有 = 骨.行.length > 0 || (!词 && !sp.来源 && sp.号码不全 !== "1" ? 组.length > 0 : await 有公海客户(排掉));
  return { 行: 这页, 总数, 当前页, 快捷数, 属性数, 截断: false, 库里有, ...(号码不全数 === undefined ? {} : { 号码不全数 }) };
}

/** 公海里有没有这个人看得到的客户（不看筛选） */
async function 有公海客户(排掉: readonly string[]): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ x: number }[]>(
    `SELECT 1 AS x FROM "CustomerPool" p JOIN "Customer" c ON c.id = p."customerId" WHERE c."deletedAt" IS NULL${排掉.length ? ` AND c.id NOT IN (SELECT value FROM json_each(?))` : ""} LIMIT 1`,
    ...(排掉.length ? [JSON.stringify(排掉)] : []),
  );
  return rows.length > 0;
}

/**
 * 渠道名单：名单里的公海项目一个一行（渠道页数的是项目，条数要对得上）。
 *   - 客户不在客户公海的：就是骨架里那一行项目行
 *   - 客户在客户公海的：骨架里是一行客户行（领客户即领项目），按名单里它名下的项目拆成几行，每行写那一个项目的名字和进程；
 *     领取 / 分配照旧按客户（customerId），id 带上项目以免撞（c:客户:项目）
 * 名单的项目走带限定的客户端取（可见范围、原负责人回避照旧）；骨架里没有对应行的（框外、刚被领走）不列
 */
async function 按名单展开(骨: Awaited<ReturnType<typeof 读公海骨架>>, 名单条件: Prisma.ProjectWhereInput): Promise<公海行[]> {
  const 们 = await prisma.project.findMany({ where: 名单条件, orderBy: [{ pooledAt: "desc" }, { id: "asc" }], select: { id: true, customerId: true, name: true, phase: true, node: true, result: true, createdAt: true } });
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
