/**
 * 后售培育判定（11-25，客户 E-290 / E-292；总表 P-界面-63 / 64、M-节点-10；方案-售后回访与后售培育 第三节）。
 *
 * 规则：客户名下至少一个交付结清的项目时，这位客户停在 线索 · 潜客培育 的项目显示成「后售培育」；其他情况（不管几个项目）都是潜客培育。
 *   - 只算不存：不加列、不迁移，库里仍是潜客培育。随时按现状判——交付结清被撤回、软删、合并客户 / 项目换客户后名下没有了，立刻变回潜客培育
 *   - 交付结清 = result 交付结清（含旧名成功交付）、没软删；在公海里的、导入的也算。和客户状态的「交付数」同一把尺（cust-status-auto.ts 算客户状态）
 *   - 停在潜客培育 = phase 线索、node 潜客培育、还没结局（同项目列表「选节点 = 停在这个节点、还没结局的」，list.ts 阶段进程条件）。
 *     停在潜客培育的项目自己不可能是交付结清，所以不用排除自己。仅记录用的照样判（统计照旧按仅记录用排掉）
 *   - 看客户名下**全部**项目（看全部）：销售看不到同事负责的那个交付结清项目，也照样判后售（同客户状态）
 *   - 🔍 老项目算不算（交付结清之前就建好、一直停在潜客培育的）：没回之前按「算」（方案第十一节第 2 条）。
 *     只改 老项目算后售 这一处：false = 项目 createdAt 晚于这位客户最早一次交付结清（closedAt）的才算
 *
 * 用法：逐行显示用 后售项目们（一次查询、500 位一批，拿 Set 去对）或 交付结清客户们 + 判后售；
 * 列表筛选 / 统计 where 用 后售条件 / 潜客不含后售条件（两份加起来 = 停在潜客培育，不重不漏）。
 * 叫法、显示名在 stage-dict.ts（后售培育名、显示节点名、阶段与进程 的第三个参数）。
 *
 * ⚠️ 软删扩展只滤顶层 where，关系里的 some 不管：交付结清的项目 里的 deletedAt: null 必须手写（去掉它，软删了的交付结清还算数）。
 * ⚠️ Prisma 6.16 SQLite 嵌套关系带 orderBy 父记录过 999 条会崩：这里只用平铺 findMany，不 include、不嵌 orderBy。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 同名们 } from "./stage-dict";

export { 后售培育名, 显示节点名 } from "./stage-dict";

/** 🔍 老项目算不算后售（方案第十一节第 2 条，待客户确认）：true = 算（纯按现状）；false = 只算交付结清之后建的。改这一处 */
export const 老项目算后售: boolean = true;

/** 一批最多几位客户（SQLite IN 参数别太长，同 cust-status-auto-db.ts） */
const 一批 = 500;
/** 超过这么多位客户就不点名、改扫全部交付结清（公海全取一类整池的；一页的列表远到不了） */
const 点名最多 = 一批 * 4;

type 读库 = Pick<Prisma.TransactionClient, "project">;

/** 算数的交付结清项目：结局交付结清（含旧名）、没软删。放进 some 里用，deletedAt 必须手写 */
export const 交付结清的项目 = { result: { in: 同名们("交付结清") }, deletedAt: null } satisfies Prisma.ProjectWhereInput;

/** 名下有交付结清项目的客户（客户 where；项目 where 里写 customer: 有交付结清的客户） */
export const 有交付结清的客户 = { projects: { some: 交付结清的项目 } } satisfies Prisma.CustomerWhereInput;

/** 停在 线索 · 潜客培育、还没结局（新旧名都认） */
export const 停在潜客培育 = { phase: "线索", node: { in: 同名们("潜客培育") }, result: null } satisfies Prisma.ProjectWhereInput;

/** 判后售要的项目几列 */
export type 判后售的项目 = { phase: string; node: string; result: string | null; createdAt?: Date | null };

/** 同 停在潜客培育 的纯函数版 */
export function 是停在潜客培育(p: 判后售的项目): boolean {
  return p.phase === "线索" && 同名们("潜客培育").includes(p.node) && p.result == null;
}

/**
 * 判定式（唯一一处）。最早结清 = 这位客户最早一次交付结清的时间（交付结清客户们 的值）：undefined = 客户名下没有交付结清的；
 * null = 有、但老数据没记结清时间（closedAt 空，按算）
 */
export function 判后售(p: 判后售的项目, 最早结清: Date | null | undefined, 老项目算: boolean = 老项目算后售): boolean {
  if (最早结清 === undefined || !是停在潜客培育(p)) return false;
  if (老项目算 || 最早结清 === null || !p.createdAt) return true;
  return p.createdAt.getTime() > 最早结清.getTime();
}

/**
 * 这几位客户里名下有交付结清项目的 → 最早一次结清时间（closedAt；没记的 null）。没有的不在表里。
 * 看全部、500 位一批，每批一条平铺查询；在事务里传 tx
 */
export async function 交付结清客户们(customerIds: Iterable<string | null | undefined>, db: 读库 = prisma): Promise<Map<string, Date | null>> {
  const ids = [...new Set([...customerIds].filter((x): x is string => !!x))];
  const 表 = new Map<string, Date | null>();
  if (!ids.length) return 表;
  // 客户多（公海全取、导出这类整池的）：点名要好多批，不如把交付结清的平铺扫一遍（交付结清的项目远少于客户），再留这几位的
  if (ids.length > 点名最多) {
    const 要 = new Set(ids);
    for (const [c, t] of await 全部交付结清(db)) if (要.has(c)) 表.set(c, t);
    return 表;
  }
  await 看全部(async () => {
    for (let i = 0; i < ids.length; i += 一批) {
      const 行们 = await db.project.findMany({
        where: { customerId: { in: ids.slice(i, i + 一批) }, ...交付结清的项目 },
        select: { customerId: true, closedAt: true },
      });
      for (const r of 行们) 记最早(表, r.customerId, r.closedAt);
    }
  });
  return 表;
}

/** 逐行显示用：这几个项目里判成后售的 id。只查一遍交付结清（交付结清客户们），不逐行查 */
export async function 后售项目们<P extends 判后售的项目 & { id: string; customerId: string | null }>(项目们: readonly P[], db: 读库 = prisma): Promise<Set<string>> {
  const 候选 = 项目们.filter(是停在潜客培育);
  const 出 = new Set<string>();
  if (!候选.length) return 出;
  const 表 = await 交付结清客户们(候选.map((p) => p.customerId), db);
  for (const p of 候选) if (p.customerId && 判后售(p, 表.has(p.customerId) ? 表.get(p.customerId) : undefined)) 出.add(p.id);
  return 出;
}

/**
 * 「名下有交付结清、按判定式算后售」的项目 where 片段（不含 停在潜客培育）：后售条件 / 潜客不含后售条件 用它，
 * 统计自己配「这一格」时也直接拿它（project-stats.ts 后售那片，不拆 后售条件 的 AND）。
 * 老项目算：一句关系条件。不算：先平铺取全部交付结清（客户 → 最早结清），拼成「这位客户且建得比结清晚」的 OR（老项目算 只给测试换另一支用，调用方别传）
 */
export async function 后售客户片段(db: 读库 = prisma, 老项目算: boolean = 老项目算后售): Promise<Prisma.ProjectWhereInput> {
  if (老项目算) return { customer: 有交付结清的客户 };
  // ⚠️ 改成 false 前先分批：下面每位有交付结清的客户拼一段 OR（customerId + createdAt 两个参数）、没时间的拼进一个 in，客户一多就过 SQLite 999 / 32766 参数上限
  const 表 = await 全部交付结清(db);
  const 没时间 = [...表].filter(([, t]) => t === null).map(([c]) => c);
  const 有时间 = [...表].filter((e): e is [string, Date] => e[1] !== null);
  const OR: Prisma.ProjectWhereInput[] = [
    ...(没时间.length ? [{ customerId: { in: 没时间 } }] : []),
    ...有时间.map(([c, t]) => ({ customerId: c, createdAt: { gt: t } })),
  ];
  return OR.length ? { OR } : { id: { in: [] } };
}

/** 列表筛「后售培育」、统计拆「后售培育」那一行用：停在潜客培育、且判成后售（老项目算 只给测试换另一支用，调用方别传） */
export async function 后售条件(db: 读库 = prisma, 老项目算: boolean = 老项目算后售): Promise<Prisma.ProjectWhereInput> {
  return { AND: [停在潜客培育, await 后售客户片段(db, 老项目算)] };
}

/** 列表筛「潜客培育」、统计「潜客培育」那一行用：停在潜客培育、且不是后售。和 后售条件 加起来 = 停在潜客培育 */
export async function 潜客不含后售条件(db: 读库 = prisma, 老项目算: boolean = 老项目算后售): Promise<Prisma.ProjectWhereInput> {
  return { AND: [停在潜客培育, { NOT: await 后售客户片段(db, 老项目算) }] };
}

/** 全部交付结清：客户 → 最早结清（看全部，按 id 一页 一批 平铺翻，不 include、不嵌 orderBy） */
async function 全部交付结清(db: 读库): Promise<Map<string, Date | null>> {
  const 表 = new Map<string, Date | null>();
  let 游标: string | undefined;
  await 看全部(async () => {
    for (;;) {
      const 页 = await db.project.findMany({
        where: { ...交付结清的项目, ...(游标 ? { id: { gt: 游标 } } : {}) },
        select: { id: true, customerId: true, closedAt: true }, orderBy: { id: "asc" }, take: 一批,
      });
      for (const r of 页) 记最早(表, r.customerId, r.closedAt);
      if (页.length < 一批) break;
      游标 = 页[页.length - 1].id;
    }
  });
  return 表;
}

function 记最早(表: Map<string, Date | null>, customerId: string, t: Date | null) {
  if (!表.has(customerId)) return void 表.set(customerId, t);
  const 有 = 表.get(customerId);
  // 同一位客户有一条没记结清时间的就按 null（算），不然取最早的
  if (有 === null || t === null) return void 表.set(customerId, null);
  if (有 && t < 有) 表.set(customerId, t);
}
