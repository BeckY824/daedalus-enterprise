import { prisma } from "@/lib/prisma";
import { 成员选项 } from "@/lib/utils";
import { 阶段们, 字典of, 本套位置, 结局们of, 是交付, type 阶段, type 阶段字典 } from "@/lib/project/nodes";
import { 企业版 } from "@/lib/enterprise/switch";
import { 是我放回的公海项目条件 } from "@/lib/project/pool-owner";
import type { Prisma } from "@/generated/prisma";
import { bucketOf, 刻度们, type 粒度 } from "./data";
import { 项目漏斗of, type 漏斗格 } from "./funnel";
import { 不算补建, 不进统计, 仅记录用的, 历史分析来源, 留痕不算历史分析, 并条件 } from "@/lib/project/system-created";
import { 批次条件, 读批次, 批次参数, 批次下拉项, type 批次筛 } from "@/lib/project/import-batch";
import { 后售客户片段 } from "@/lib/project/after-sale";
import { 后售培育名, 同名们 } from "@/lib/project/stage-dict";

/**
 * 企业版只用项目时「数据」页的数（10-26 用户：「「数据」页改成按项目统计」，线索 / 商机 / 订单是项目的三大阶段）。
 *
 * 看得到哪些项目不在这里管：prisma 外面那层（lib/team-scope）已经按人限定了 project 的查询。
 * 金额只算本位币，不换汇（和签约复盘同一个理由：折出来的数说不清按哪天的汇率）；外币的另外数一下告诉人。
 * 库里存着旧节点名 / 旧结局的（10-31 企业版改名）先过 本套位置 对到这套的新名再数。
 */

export type 节点格 = { phase: 阶段; node: string; count: number; amount: number };
export type 人行现在 = { id: string; name: string; 线索: number; 商机: number; 订单: number; 商机金额: number; 订单金额: number };

export type 项目现在 = {
  阶段: { phase: 阶段; count: number; amount: number }[];
  /** 各节点在跟的；线索阶段潜客培育后面多一行后售培育（统计节点们，P-界面-65） */
  节点: 节点格[];
  /** 已经有结局的，各几个（不限时间） */
  结局: { result: string; count: number }[];
  公海: number;
  按人: 人行现在[];
  /** 进行中但不是本位币的，金额没算进来 */
  外币: number;
  /** 全周期漏斗：看得到的全部项目（含已结束的）走到了哪一步（funnel.ts） */
  漏斗: 漏斗格[];
  /** 线索瀑布（P15）：线索阶段各节点停着几个、流出去几个（线索节点of；后售培育单独一行） */
  线索节点: 线索节点格[];
  /** 已经进了商机 / 订单的 */
  线索转商机: number;
};

/**
 * 线索瀑布（P15 / 10-29 定稿：每个节点要看得出流出去多少）：线索阶段各节点，按 节点们.线索 的先后铺开（没有的也摆 0）。
 *   count     还停在这个节点、进行中、不在公海
 *   流失      在这个节点点了线索流失（不含判无效的）
 *   判无效    在这个节点被判成无效线索（线索验证的市场复核 / 总管理终判判无效，结局也记线索流失，单独拆出来）
 *   退回公海  停在这个节点、人已经放回公海了（还没结局）
 * 另外 线索转商机of：已经进了商机或订单的（线索阶段的好出口），摆在最后一条。都只用现成的列，不加表。
 */
export type 线索节点格 = { node: string; count: number; 流失: number; 判无效: number; 退回公海: number };
/**
 * n = 这一行代表几个项目（库里分组数出来的一组）；不给 = 1 个（逐个项目的行）。
 * 后售 = 这一行停（或结束）在潜客培育、客户名下有交付结清的（后售那片），数进「后售培育」那一行、不进潜客培育
 */
type 线索行 = { phase: string; node: string; result: string | null; pooledAt?: Date | null; 判无效?: boolean; n?: number; 后售?: boolean };
const 个数 = (rows: readonly { n?: number }[]) => rows.reduce((s, p) => s + (p.n ?? 1), 0);

/**
 * 后售培育单独一行（11-25，客户 E-292 选 A，总表 P-界面-65；方案-售后回访与后售培育 第六节阶段 2）：
 * 数据页「各进程的项目」和线索瀑布里，潜客培育后面多一行后售培育（没有也摆 0），潜客培育那行只数不是后售的，两行加起来 = 原来的潜客培育。
 * 只拆这两处：阶段、按人、结局、公海、四段漏斗（线索→商机→订单→交付，按阶段数、没有潜客培育这一行）、线索转商机都不变（方案第十节第 1、5 条）；
 * 首页卡、渠道看板、按人表不走这里，也不拆。仅记录用、历史分析回填的照旧在 范围 里排掉，两行都不算。
 * 判后售照 after-sale.ts（唯一判定式，老项目算不算也跟着那边）；统计里按「这一格」拆：
 * 停在潜客培育的（进行中、在公海里的）按 后售条件，结束在潜客培育的（线索流失 / 判无效）也按同一位客户那一片落到后售那行——瀑布里看得出复购那条流出去多少
 */
export const 后售行名 = 后售培育名;
/** 这一阶段各节点在统计里怎么排：线索阶段潜客培育后面插一行后售培育 */
export function 统计节点们(phase: 阶段, 字典: 阶段字典): string[] {
  const 们 = [...字典.节点们[phase]];
  const i = phase === "线索" ? 们.indexOf("潜客培育") : -1;
  if (i >= 0) 们.splice(i + 1, 0, 后售行名);
  return 们;
}
/** 拆过的行：后售的节点名换成后售培育（先 本套位置 再换，旧名照旧对到新名） */
const 拆后的节点 = <T extends { phase: string; node: string; 后售?: boolean }>(p: T): T => (p.后售 && p.phase === "线索" ? { ...p, node: 后售行名 } : p);

/**
 * 「这一格是后售」的项目 where 片段（项目现在 按它多取一句、分好组从原组里减掉；项目一段 按它取 id；都不按行查）：线索 · 潜客培育（新旧名都认、有没有结局都算），
 * 且客户那一片和 after-sale.ts 后售条件 同一句（后售客户片段；老项目算不算跟着那边）
 */
async function 后售那片(): Promise<Prisma.ProjectWhereInput> {
  // 「这一格」自己配（不限还没结局），客户那一片直接用 后售客户片段
  return { AND: [{ phase: "线索", node: { in: 同名们("潜客培育") } }, await 后售客户片段()] };
}

export function 线索节点of(rows: readonly 线索行[], 字典: 阶段字典 = 字典of(false)): 线索节点格[] {
  const 在线索 = rows.filter((p) => p.phase === "线索").map((p) => 拆后的节点(本套位置(p, 字典)));
  return 统计节点们("线索", 字典).map((node) => {
    const 这里 = 在线索.filter((p) => p.node === node);
    const 死了 = 这里.filter((p) => p.result === "线索流失");
    return {
      node,
      count: 个数(这里.filter((p) => !p.result && !p.pooledAt)),
      流失: 个数(死了.filter((p) => !p.判无效)),
      判无效: 个数(死了.filter((p) => p.判无效)),
      退回公海: 个数(这里.filter((p) => !p.result && p.pooledAt)),
    };
  });
}
/** 走出线索阶段、进了商机或订单的（有结局的按结局认阶段：线索流失归线索，不算） */
export function 线索转商机of(rows: readonly 线索行[]): number {
  return 个数(rows.filter((p) => p.phase !== "线索" && p.result !== "线索流失"));
}
/** 只看（P15）：一个人 = 只这个人；一串 = 这些人里的（复盘「全部」= 上级能看的这一圈，服务端兜底） */
export type 只看谁 = string | readonly string[];
const 负责人是 = (只看: 只看谁) => (typeof 只看 === "string" ? 只看 : { in: [...只看] });
/**
 * 按人看时这些人的项目：自己负责的 + 公海里最后是他们放的（企业版 11-01 起进公海清负责人，原负责人只在留痕里，lib/project/pool-owner.ts）。
 * 公海里的只给线索瀑布数「退回公海」，别的口径照旧不算在谁头上
 */
async function 这些人的(只看: 只看谁): Promise<Prisma.ProjectWhereInput> {
  // F-057：不把名单整串塞 id in（上千个过 SQLite 参数上限，P2029），用有界条件
  const 放的 = await 是我放回的公海项目条件(prisma, typeof 只看 === "string" ? [只看] : 只看);
  return 放的 ? { OR: [{ ownerId: 负责人是(只看) }, 放的] } : { ownerId: 负责人是(只看) };
}
const 无效线索 = "无效线索";
const 判无效了 = (v: { finalResult: string | null } | null) => v?.finalResult === 无效线索;

/** 项目现在 分组数的一组：同 phase / node / result / currency / ownerId / 在不在公海 / 是不是后售 的几个项目，n 个、金额合计 amount */
type 现在组 = { phase: string; node: string; result: string | null; currency: string; ownerId: string; pooledAt: Date | null; amount: number; n: number; 后售: boolean };

/** 库里分组数的一组（键是 groupBy 的 by，键缺的当 undefined） */
type 分组 = { phase: string; node: string; result: string | null; currency?: string; ownerId?: string; _count: { _all: number }; _sum?: { amount: number | null } };
/**
 * 后售拆行：全 = 原来那句分组数，后 = 落在 后售那片 的、按同一句的口径和键分好的组（后售分组）。后的每一组从全里同键那组减掉（个数、金额），自己带上 后售 另成一组。
 * 合起来个数、金额和原来一样（不重不漏）；减成 0 的组不留
 */
function 拆后售<G extends 分组>(全: readonly G[], 后: readonly G[]): (G & { 后售: boolean })[] {
  const 键of = (g: 分组) => JSON.stringify([g.phase, g.node, g.result, g.currency ?? null, g.ownerId ?? null]);
  const 后的 = new Map(后.map((g) => [键of(g), g]));
  const 出: (G & { 后售: boolean })[] = [];
  for (const g of 全) {
    const h = 后的.get(键of(g));
    if (!h) { 出.push({ ...g, 后售: false }); continue; }
    const n = g._count._all - h._count._all;
    if (n > 0) 出.push({ ...g, 后售: false, _count: { _all: n }, ...(g._sum ? { _sum: { amount: (g._sum.amount ?? 0) - (h._sum?.amount ?? 0) } } : {}) });
  }
  for (const h of 后) 出.push({ ...h, 后售: true });
  return 出;
}

type 后售行 = { phase: string; node: string; result: string | null; currency: string; ownerId: string; amount: number; pooledAt: Date | null; source: string | null; entLeadVerify: { finalResult: string | null } | null };
/**
 * 后售那片的项目（范围 ∪ 领走的历史 里的）按 项目现在 那五句分组数的口径分好组：
 *   历史分析来源的 = 领走的历史（范围 排掉了历史分析，能进来的只有领走在推的那条路）；
 *   别的按在不在公海分两组，有结局的另按判无效 / 没判无效分（同那两句：和公海两组是交叠的，不是互斥）
 */
function 后售分组(行们: readonly 后售行[], 无效: string) {
  type 组 = 分组 & { _sum: { amount: number } };
  const 桶 = () => new Map<string, 组>();
  const 们 = { 不在公海: 桶(), 在公海: 桶(), 判无效: 桶(), 没判无效: 桶(), 领走的历史: 桶() };
  const 记 = (m: Map<string, 组>, r: 后售行, 全键: boolean) => {
    const g: 组 = 全键
      ? { phase: r.phase, node: r.node, result: r.result, currency: r.currency, ownerId: r.ownerId, _count: { _all: 0 }, _sum: { amount: 0 } }
      : { phase: r.phase, node: r.node, result: r.result, _count: { _all: 0 }, _sum: { amount: 0 } };
    const k = JSON.stringify([g.phase, g.node, g.result, g.currency ?? null, g.ownerId ?? null]);
    const 有 = m.get(k) ?? g;
    有._count._all++;
    有._sum.amount += r.amount;
    m.set(k, 有);
  };
  for (const r of 行们) {
    if (r.source === 历史分析来源) { 记(们.领走的历史, r, true); continue; }
    记(r.pooledAt ? 们.在公海 : 们.不在公海, r, true);
    if (r.result) 记(r.entLeadVerify?.finalResult === 无效 ? 们.判无效 : 们.没判无效, r, false);
  }
  // 键全的那三组（同 数组 那句）要 currency / ownerId；结了的两组（同 数结了）只有 phase / node / result
  const 全 = (m: Map<string, 组>) => [...m.values()] as (分组 & { currency: string; ownerId: string; _sum: { amount: number | null } })[];
  const 结 = (m: Map<string, 组>) => [...m.values()].map(({ phase, node, result, _count }) => ({ phase, node, result, _count }));
  return { 不在公海: 全(们.不在公海), 在公海: 全(们.在公海), 领走的历史: 全(们.领走的历史), 判无效: 结(们.判无效), 没判无效: 结(们.没判无效) };
}

/**
 * 进行中 = 还没有结局。
 * 只看（P15 复盘页按成员看）：只数这个人负责的；公海里的不算在谁头上，按人看时一并不数（同下面「按人」的口径）
 * 历史分析回填的项目（system-created.ts）一个都不算：它们是旧沟通还原出来的往事，算进来公海数、结局、漏斗都失真。
 * 仅记录用的（X-147，还停在潜客培育的）同样一个都不算，也没有「领走在推照算」的例外：客户原话「不算在推、不进任何转化率的分母」
 * 库里分组数（11-18）：不再把看得到的全部项目逐个读进内存（回填后公海里多出约 6 万个），按 阶段 / 节点 / 结局 / 币种 / 负责人 × 在不在公海 分组，
 * 判无效另数一组；本套位置（旧名对新名）对分组的键做，口径和逐个数一样
 */
export async function 项目现在(本位币: string, 只看?: 只看谁, 批次?: 批次筛 | null): Promise<项目现在> {
  const 字典 = 字典of(企业版());
  const 谁的 = 只看 === undefined ? undefined : await 这些人的(只看);
  // 导入批次（11-19，import-batch.ts）：只看 / 排掉某一批，所有项目的数都套上；不给 = 全部，和原来一样
  const 批 = 批次条件(批次);
  const 范围 = 并条件(谁的, 不进统计, 批);
  // 历史分析的项目被人领走、还在推的（领客户时一起带走的进行中项目）：是这个人手上真在跟的，只进阶段 / 节点 / 按人 / 外币（同 持有数、复盘「在跟」），
  // 结局、公海、漏斗、线索瀑布、线索转商机照样不算
  const 在跟条件 = 并条件(谁的, 批, { result: null, pooledAt: null, NOT: 仅记录用的 });
  const 键 = ["phase", "node", "result", "currency", "ownerId"] as const;
  const 数组 = (where: Prisma.ProjectWhereInput) => prisma.project.groupBy({ by: [...键], where, _count: { _all: true }, _sum: { amount: true } });
  const 数结了 = (where: Prisma.ProjectWhereInput) => prisma.project.groupBy({ by: ["phase", "node", "result"], where, _count: { _all: true } });
  const 不在公海条件 = 并条件(范围, { pooledAt: null });
  const 在公海条件 = 并条件(范围, { pooledAt: { not: null } });
  // 线索瀑布拆「判无效」：有结局的、线索验证终判无效线索的（同 判无效了）
  const 判无效条件 = 并条件(范围, { result: { not: null }, entLeadVerify: { is: { finalResult: 无效线索 } } });
  const 没判无效条件 = 并条件(范围, { result: { not: null }, NOT: { entLeadVerify: { is: { finalResult: 无效线索 } } } });
  const 领走的历史条件 = 并条件(在跟条件, { source: 历史分析来源 });
  // 后售培育拆行（后售行名）：五组要拆的（不在公海、在公海、判无效、没判无效、领走的历史）只多一句——范围 ∪ 领走的历史 里落在 后售那片 的项目，
  // 取回来按同样的五组、同样的键在内存里分组（后售分组），拆后售 从原组里减掉。后售那片只在线索 · 潜客培育这一格、客户名下有交付结清的，条数小；
  // 不按行查库，也不把五句分组数各套一遍（8.5 万客户量级上五句要多 40 ms，一句约 10 ms，tests/perf-85k-data-page.test.ts）
  const 后售那些 = 后售那片().then((后) => prisma.project.findMany({
    where: 并条件({ OR: [范围, 领走的历史条件] }, 后),
    select: { phase: true, node: true, result: true, currency: true, ownerId: true, amount: true, pooledAt: true, source: true, entLeadVerify: { select: { finalResult: true } } },
  }));
  const [不在公海全, 在公海全, 判无效全, 没判无效全, 外币, 领走的历史全, 后售行们] = await Promise.all([
    数组(不在公海条件),
    数组(在公海条件),
    数结了(判无效条件),
    数结了(没判无效条件),
    // 外币：在跟的、不是本位币、金额大于 0 的个数（分组的金额是合计，看不出哪几个是 0，单数）
    prisma.project.count({ where: 并条件(在跟条件, { currency: { not: 本位币 }, amount: { gt: 0 } }) }),
    数组(领走的历史条件),
    后售那些,
  ]);
  const 后 = 后售分组(后售行们, 无效线索);
  const [不在公海, 在公海, 判无效组, 没判无效组, 领走的历史] = [
    拆后售(不在公海全, 后.不在公海), 拆后售(在公海全, 后.在公海), 拆后售(判无效全, 后.判无效), 拆后售(没判无效全, 后.没判无效), 拆后售(领走的历史全, 后.领走的历史),
  ];
  const 组们 = (gs: typeof 不在公海, 公海: boolean): 现在组[] =>
    gs.map((g) => 拆后的节点(本套位置({ phase: g.phase, node: g.node, result: g.result, currency: g.currency, ownerId: g.ownerId, pooledAt: 公海 ? new Date(0) : null, amount: g._sum.amount ?? 0, n: g._count._all, 后售: g.后售 }, 字典)));
  const 全部行 = [...组们(不在公海, false), ...组们(在公海, true)];
  // 按人看时公海里的不算在谁头上；只有线索瀑布要它们（数「退回公海」流出去几个）
  const rows = 只看 === undefined ? 全部行 : 全部行.filter((p) => !p.pooledAt);
  const 进行中 = rows.filter((p) => !p.result);
  // 阶段、节点只数有人跟的：公海里的单独数在「公海」（11-02 验收：客户数和项目数要趋同，公海的两边都不算）
  const 在跟 = [...进行中.filter((p) => !p.pooledAt), ...组们(领走的历史, false)];
  const 钱 = (p: { amount: number; currency: string }) => (p.currency === 本位币 ? p.amount : 0);

  // 线索阶段潜客培育后面多一行后售培育（统计节点们）；阶段、按人照旧按 phase 数，拆不拆一样
  const 节点 = 阶段们.flatMap((phase) =>
    统计节点们(phase, 字典).map((node) => {
      const 这些 = 在跟.filter((p) => p.phase === phase && p.node === node);
      return { phase, node, count: 个数(这些), amount: 这些.reduce((s, p) => s + 钱(p), 0) };
    }),
  );
  const 阶段 = 阶段们.map((phase) => {
    const 这些 = 在跟.filter((p) => p.phase === phase);
    return { phase, count: 个数(这些), amount: 这些.reduce((s, p) => s + 钱(p), 0) };
  });

  // 公海里的不算在谁头上（负责人还是原来那个人，可人已经不管它了）
  const 人 = new Map<string, 人行现在>();
  for (const p of 在跟) {
    const r = 人.get(p.ownerId) ?? { id: p.ownerId, name: "", 线索: 0, 商机: 0, 订单: 0, 商机金额: 0, 订单金额: 0 };
    if (p.phase === "线索") r.线索 += p.n;
    else if (p.phase === "商机") { r.商机 += p.n; r.商机金额 += 钱(p); }
    else if (p.phase === "订单") { r.订单 += p.n; r.订单金额 += 钱(p); }
    人.set(p.ownerId, r);
  }
  // 线索瀑布：没结局的照 全部行（含公海里的，数退回公海）；有结局的按判无效拆两组
  const 结了 = (gs: typeof 判无效组, 判无效: boolean) => gs.map((g) => ({ phase: g.phase, node: g.node, result: g.result, 判无效, n: g._count._all, 后售: g.后售 }));

  return {
    阶段,
    节点,
    结局: 结局们of(字典).map((result) => ({ result, count: 个数(rows.filter((p) => p.result === result)) })),
    公海: 个数(进行中.filter((p) => p.pooledAt)),
    按人: (await 起名(人)).sort((a, b) => b.商机金额 + b.订单金额 - (a.商机金额 + a.订单金额) || b.线索 + b.商机 + b.订单 - (a.线索 + a.商机 + a.订单)),
    外币,
    漏斗: 项目漏斗of(rows),
    线索节点: 线索节点of([...全部行.filter((p) => !p.result), ...结了(判无效组, true), ...结了(没判无效组, false)], 字典),
    线索转商机: 线索转商机of(rows),
  };
}

export type 段桶 = { label: string; 新建: number; 转商机: number; 转订单: number; 成功交付: number };
export type 人行一段 = { id: string; name: string; 新建: number; 转商机: number; 转订单: number; 成功交付: number; 交付金额: number; 没成: number };

export type 项目一段 = {
  合计: { 新建: number; 转商机: number; 转订单: number; 成功交付: number; 交付金额: number; 线索流失: number; 丢单: number; 异常状态: number };
  trend: 段桶[];
  按人: 人行一段[];
  /** 这一段成功交付的外币项目，金额没算进来 */
  外币: number;
  /**
   * 成交：这一段里转了订单、或成功交付结束的项目，一个项目只数一次（两样都有也只算一个）。
   * 企业版首页「本月成交」用它（10-28 去遗留 A4），不按客户签约数
   */
  成交: number;
  /** 漏斗：这一段新建的项目（同「新建」的 createdAt）现在走到了哪一步（funnel.ts） */
  漏斗: 漏斗格[];
  /** 线索瀑布（P15）：这一段新建的，现在在线索阶段各节点停着几个、流出去几个 */
  线索节点: 线索节点格[];
  /** 这一段新建、现在已经进了商机 / 订单的 */
  线索转商机: number;
};

/**
 * 一段时间里发生了什么。
 *   新建：项目建在这一段（createdAt）；补建的（老客户补的潜客培育，system-created.ts）不算，漏斗、线索瀑布、线索转商机这批也不带它
 *   历史分析回填的（system-created.ts）新建、转商机 / 转订单、结局都不算；仅记录用的（还停在潜客培育）新建、结局也不算（X-147）
 *   转商机 / 转订单：这一段里有一次从线索进商机 / 从商机进订单的节点变更（一个项目只数一次，来回改不重复算）
 *   成功交付 / 线索流失 / 丢单 / 异常状态：现在是这个结局、结束在这一段（closedAt）——后来又恢复了的不算
 *     「成功交付」这一格 = 订单走成的（企业版叫 交付结清，库里旧名也认，见 是交付），键名不改
 * 按人拆按项目现在的负责人，不是当时的。只看（P15）也按现在的负责人筛。
 * 批次（11-19，import-batch.ts）：只看 / 排掉某一批，新建、转商机 / 转订单、结局都只数这些项目；补建的照旧不进新建（选只看补建批次 = 0）
 * 后售培育（11-25，P-界面-65）：只有线索瀑布拆一行（后售那片，同 项目现在）；新建、走势、按人、漏斗不拆
 */
export async function 项目一段(from: Date, to: Date, 粒: 粒度, 本位币: string, 只看?: 只看谁, 批次?: 批次筛 | null): Promise<项目一段> {
  const 字典 = 字典of(企业版());
  const 批 = 批次条件(批次);
  const 段 = { gte: from, lte: to };
  // 同 项目现在：按人看时公海里的不算在谁头上（线索瀑布除外，它要数退回公海的）
  const 负责 = 只看 === undefined ? {} : await 这些人的(只看);
  const 谁 = 只看 === undefined ? {} : { ownerId: 负责人是(只看), pooledAt: null };
  const 新条件 = 并条件({ createdAt: 段, ...负责, ...不算补建 }, 批);
  const [新全, 变, 结, 后售的] = await Promise.all([
    prisma.project.findMany({
      where: 新条件,
      select: { id: true, ownerId: true, createdAt: true, phase: true, node: true, result: true, pooledAt: true, entLeadVerify: { select: { finalResult: true } } },
    }),
    // 历史分析回填约定不写节点变更；万一写了（留痕人 = 历史分析留痕人）、或项目是历史分析的，都不算转商机 / 转订单（system-created.ts）
    prisma.projectNodeLog.findMany({
      where: {
        kind: "node", at: 段, OR: [{ fromPhase: "线索", toPhase: "商机" }, { fromPhase: "商机", toPhase: "订单" }],
        userId: 留痕不算历史分析.userId,
        project: 并条件(留痕不算历史分析.project, 只看 === undefined ? undefined : 谁, 批),
      },
      select: { projectId: true, fromPhase: true, at: true, project: { select: { ownerId: true } } },
      orderBy: { at: "asc" },
    }),
    // 结局按 closedAt 落段：历史分析回填的 closedAt 是当年的时间，不算（不然 2022–25 年各月凭空多出流失、丢单）
    prisma.project.findMany({ where: 并条件({ result: { not: null }, closedAt: 段, ...谁, ...不进统计 }, 批), select: { id: true, ownerId: true, result: true, closedAt: true, amount: true, currency: true } }),
    // 线索瀑布的后售培育那行（后售行名）：这一段新建的里落在 后售那片 的（线索 · 潜客培育这一格、有没有结局都算，同 项目现在），条件版一句取 id、不按行查
    后售那片().then((后) => prisma.project.findMany({ where: 并条件(新条件, 后), select: { id: true } })).then((rs) => new Set(rs.map((r) => r.id))),
  ]);
  const 新 = 只看 === undefined ? 新全 : 新全.filter((p) => !p.pooledAt);

  const 桶 = new Map<string, 段桶>(刻度们(from, to, 粒).map((label) => [label, { label, 新建: 0, 转商机: 0, 转订单: 0, 成功交付: 0 }]));
  // 今天以后的刻度不铺；万一有日期写在以后的，也给它一个刻度，别让数凭空少掉
  const 进桶 = (d: Date, k: "新建" | "转商机" | "转订单" | "成功交付") => {
    const label = bucketOf(d, 粒);
    const b = 桶.get(label) ?? { label, 新建: 0, 转商机: 0, 转订单: 0, 成功交付: 0 };
    b[k]++;
    桶.set(label, b);
  };
  const 人 = new Map<string, 人行一段>();
  const 行 = (id: string) => {
    const r = 人.get(id) ?? { id, name: "", 新建: 0, 转商机: 0, 转订单: 0, 成功交付: 0, 交付金额: 0, 没成: 0 };
    // 公海里没负责人的（企业版进公海清空了）不算在谁头上，只进合计
    if (id) 人.set(id, r);
    return r;
  };

  for (const p of 新) {
    进桶(p.createdAt, "新建");
    行(p.ownerId).新建++;
  }
  const 数过 = new Set<string>();
  for (const l of 变) {
    const k = l.fromPhase === "线索" ? "转商机" : "转订单";
    if (数过.has(`${k}:${l.projectId}`)) continue;
    数过.add(`${k}:${l.projectId}`);
    进桶(l.at, k);
    行(l.project.ownerId)[k]++;
  }
  const 合计 = { 新建: 新.length, 转商机: 0, 转订单: 0, 成功交付: 0, 交付金额: 0, 线索流失: 0, 丢单: 0, 异常状态: 0 };
  for (const k of 数过) 合计[k.startsWith("转商机") ? "转商机" : "转订单"]++;
  let 外币 = 0;
  for (const p of 结) {
    const r = (是交付(p.result) ? "成功交付" : p.result) as "成功交付" | "线索流失" | "丢单" | "异常状态";
    if (!(r in 合计)) continue;
    合计[r]++;
    if (r === "成功交付") {
      进桶(p.closedAt!, "成功交付");
      const 算 = p.currency === 本位币 ? p.amount : 0;
      if (p.currency !== 本位币 && p.amount > 0) 外币++;
      合计.交付金额 += 算;
      const x = 行(p.ownerId);
      x.成功交付++;
      x.交付金额 += 算;
    } else if (r === "线索流失" || r === "丢单") 行(p.ownerId).没成++;
  }

  const 成交了 = new Set<string>([
    ...[...数过].filter((k) => k.startsWith("转订单:")).map((k) => k.slice("转订单:".length)),
    ...结.filter((p) => 是交付(p.result)).map((p) => p.id),
  ]);

  return {
    合计,
    成交: 成交了.size,
    trend: [...桶.values()].sort((a, b) => a.label.localeCompare(b.label)),
    按人: (await 起名(人)).sort((a, b) => b.交付金额 - a.交付金额 || b.成功交付 - a.成功交付 || b.转订单 - a.转订单 || b.转商机 - a.转商机 || b.新建 - a.新建),
    外币,
    漏斗: 项目漏斗of(新),
    线索节点: 线索节点of(新全.map((p) => ({ ...p, 判无效: 判无效了(p.entLeadVerify), 后售: 后售的.has(p.id) })), 字典),
    线索转商机: 线索转商机of(新),
  };
}

/**
 * 数据页「导入批次」下拉的候选（11-19）：库里有项目的那些批次号，新的在前（批次号带日期，按字串倒排）。
 * 历史分析回填的、还算仅记录用的（X-147）不列：它们哪个数都不算（system-created.ts 不进统计），选了全是 0。
 * 962 条补建那批（x147-）推进出去的项目照列（推进后照常算，只是不算新建）
 */
export async function 导入批次们(): Promise<string[]> {
  const gs = await prisma.project.groupBy({ by: ["importBatch"], where: 并条件({ importBatch: { not: null } }, 不进统计) });
  return gs.map((g) => g.importBatch).filter((b): b is string => !!b).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/**
 * 数据页这一次按哪一批数、摆不摆「导入批次」下拉（11-19）。
 * 只有看得到全部的人（看板的人 的 全看：总管理、管理员）才认地址栏 batch=、才摆下拉；主管、业务员带了 batch= 也当「全部」，数和不带一样。
 * 地址栏的批次库里没有（写错、那批删了）也当「全部」；库里一批都没有就不摆下拉
 */
export async function 数据页批次(全看: boolean | undefined, 要的: unknown): Promise<{ 批: 批次筛 | null; 下拉?: { 选项: { value: string; label: string }[]; 当前: string } }> {
  if (!全看) return { 批: null };
  const 们 = await 导入批次们();
  const 要 = 读批次(要的);
  const 批 = 要 && 们.includes(要.批) ? 要 : null;
  return { 批, 下拉: 们.length ? { 选项: 批次下拉项(们), 当前: 批次参数(批) } : undefined };
}

/** 填上名字；同名的带上邮箱分开，人已经删了的写「已不在的成员」 */
async function 起名<T extends { id: string; name: string }>(人: Map<string, T>): Promise<T[]> {
  const users = await prisma.user.findMany({ where: { id: { in: [...人.keys()] } }, select: { id: true, name: true, email: true } });
  const 标签 = new Map(成员选项(users).map((o) => [o.value, o.label]));
  return [...人.values()].map((r) => ({ ...r, name: 标签.get(r.id) ?? "已不在的成员" }));
}
