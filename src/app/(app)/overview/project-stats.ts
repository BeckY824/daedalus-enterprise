import { prisma } from "@/lib/prisma";
import { 成员选项 } from "@/lib/utils";
import { 阶段们, 字典of, 本套位置, 结局们of, 是交付, type 阶段, type 阶段字典 } from "@/lib/project/nodes";
import { 企业版 } from "@/lib/enterprise/switch";
import { 公海里历史负责人是 } from "@/lib/project/pool-owner";
import type { Prisma } from "@/generated/prisma";
import { bucketOf, 刻度们, type 粒度 } from "./data";
import { 项目漏斗of, type 漏斗格 } from "./funnel";
import { 不算补建, 不算历史分析, 留痕不算历史分析, 并条件 } from "@/lib/project/system-created";

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
  节点: 节点格[];
  /** 已经有结局的，各几个（不限时间） */
  结局: { result: string; count: number }[];
  公海: number;
  按人: 人行现在[];
  /** 进行中但不是本位币的，金额没算进来 */
  外币: number;
  /** 全周期漏斗：看得到的全部项目（含已结束的）走到了哪一步（funnel.ts） */
  漏斗: 漏斗格[];
  /** 线索瀑布（P15）：线索阶段各节点停着几个、流出去几个（线索节点of） */
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
/** n = 这一行代表几个项目（库里分组数出来的一组）；不给 = 1 个（逐个项目的行） */
type 线索行 = { phase: string; node: string; result: string | null; pooledAt?: Date | null; 判无效?: boolean; n?: number };
const 个数 = (rows: readonly { n?: number }[]) => rows.reduce((s, p) => s + (p.n ?? 1), 0);
export function 线索节点of(rows: readonly 线索行[], 字典: 阶段字典 = 字典of(false)): 线索节点格[] {
  const 在线索 = rows.filter((p) => p.phase === "线索").map((p) => 本套位置(p, 字典));
  return 字典.节点们.线索.map((node) => {
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
  const 放的 = await 公海里历史负责人是(prisma, typeof 只看 === "string" ? [只看] : 只看);
  return 放的.length ? { OR: [{ ownerId: 负责人是(只看) }, { id: { in: 放的 } }] } : { ownerId: 负责人是(只看) };
}
const 无效线索 = "无效线索";
const 判无效了 = (v: { finalResult: string | null } | null) => v?.finalResult === 无效线索;

/** 项目现在 分组数的一组：同 phase / node / result / currency / ownerId / 在不在公海 的几个项目，n 个、金额合计 amount */
type 现在组 = { phase: string; node: string; result: string | null; currency: string; ownerId: string; pooledAt: Date | null; amount: number; n: number };

/**
 * 进行中 = 还没有结局。
 * 只看（P15 复盘页按成员看）：只数这个人负责的；公海里的不算在谁头上，按人看时一并不数（同下面「按人」的口径）
 * 历史分析回填的项目（system-created.ts）一个都不算：它们是旧沟通还原出来的往事，算进来公海数、结局、漏斗都失真。
 * 库里分组数（11-18）：不再把看得到的全部项目逐个读进内存（回填后公海里多出约 6 万个），按 阶段 / 节点 / 结局 / 币种 / 负责人 × 在不在公海 分组，
 * 判无效另数一组；本套位置（旧名对新名）对分组的键做，口径和逐个数一样
 */
export async function 项目现在(本位币: string, 只看?: 只看谁): Promise<项目现在> {
  const 字典 = 字典of(企业版());
  const 范围 = 并条件(只看 === undefined ? undefined : await 这些人的(只看), 不算历史分析);
  const 键 = ["phase", "node", "result", "currency", "ownerId"] as const;
  const [不在公海, 在公海, 判无效组, 没判无效组, 外币] = await Promise.all([
    prisma.project.groupBy({ by: [...键], where: 并条件(范围, { pooledAt: null }), _count: { _all: true }, _sum: { amount: true } }),
    prisma.project.groupBy({ by: [...键], where: 并条件(范围, { pooledAt: { not: null } }), _count: { _all: true }, _sum: { amount: true } }),
    // 线索瀑布拆「判无效」：有结局的、线索验证终判无效线索的（同 判无效了）
    prisma.project.groupBy({ by: ["phase", "node", "result"], where: 并条件(范围, { result: { not: null }, entLeadVerify: { is: { finalResult: 无效线索 } } }), _count: { _all: true } }),
    prisma.project.groupBy({ by: ["phase", "node", "result"], where: 并条件(范围, { result: { not: null }, NOT: { entLeadVerify: { is: { finalResult: 无效线索 } } } }), _count: { _all: true } }),
    // 外币：在跟的、不是本位币、金额大于 0 的个数（分组的金额是合计，看不出哪几个是 0，单数）
    prisma.project.count({ where: 并条件(范围, { result: null, pooledAt: null, currency: { not: 本位币 }, amount: { gt: 0 } }) }),
  ]);
  const 组们 = (gs: typeof 不在公海, 公海: boolean): 现在组[] =>
    gs.map((g) => 本套位置({ phase: g.phase, node: g.node, result: g.result, currency: g.currency, ownerId: g.ownerId, pooledAt: 公海 ? new Date(0) : null, amount: g._sum.amount ?? 0, n: g._count._all }, 字典));
  const 全部行 = [...组们(不在公海, false), ...组们(在公海, true)];
  // 按人看时公海里的不算在谁头上；只有线索瀑布要它们（数「退回公海」流出去几个）
  const rows = 只看 === undefined ? 全部行 : 全部行.filter((p) => !p.pooledAt);
  const 进行中 = rows.filter((p) => !p.result);
  // 阶段、节点只数有人跟的：公海里的单独数在「公海」（11-02 验收：客户数和项目数要趋同，公海的两边都不算）
  const 在跟 = 进行中.filter((p) => !p.pooledAt);
  const 钱 = (p: { amount: number; currency: string }) => (p.currency === 本位币 ? p.amount : 0);

  const 节点 = 阶段们.flatMap((phase) =>
    字典.节点们[phase].map((node) => {
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
  const 结了 = (gs: typeof 判无效组, 判无效: boolean) => gs.map((g) => ({ phase: g.phase, node: g.node, result: g.result, 判无效, n: g._count._all }));

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
 *   历史分析回填的（system-created.ts）新建、转商机 / 转订单、结局都不算
 *   转商机 / 转订单：这一段里有一次从线索进商机 / 从商机进订单的节点变更（一个项目只数一次，来回改不重复算）
 *   成功交付 / 线索流失 / 丢单 / 异常状态：现在是这个结局、结束在这一段（closedAt）——后来又恢复了的不算
 *     「成功交付」这一格 = 订单走成的（企业版叫 交付结清，库里旧名也认，见 是交付），键名不改
 * 按人拆按项目现在的负责人，不是当时的。只看（P15）也按现在的负责人筛。
 */
export async function 项目一段(from: Date, to: Date, 粒: 粒度, 本位币: string, 只看?: 只看谁): Promise<项目一段> {
  const 字典 = 字典of(企业版());
  const 段 = { gte: from, lte: to };
  // 同 项目现在：按人看时公海里的不算在谁头上（线索瀑布除外，它要数退回公海的）
  const 负责 = 只看 === undefined ? {} : await 这些人的(只看);
  const 谁 = 只看 === undefined ? {} : { ownerId: 负责人是(只看), pooledAt: null };
  const [新全, 变, 结] = await Promise.all([
    prisma.project.findMany({
      where: { createdAt: 段, ...负责, ...不算补建 },
      select: { id: true, ownerId: true, createdAt: true, phase: true, node: true, result: true, pooledAt: true, entLeadVerify: { select: { finalResult: true } } },
    }),
    // 历史分析回填约定不写节点变更；万一写了（留痕人 = 历史分析留痕人）、或项目是历史分析的，都不算转商机 / 转订单（system-created.ts）
    prisma.projectNodeLog.findMany({
      where: {
        kind: "node", at: 段, OR: [{ fromPhase: "线索", toPhase: "商机" }, { fromPhase: "商机", toPhase: "订单" }],
        userId: 留痕不算历史分析.userId,
        project: 并条件(留痕不算历史分析.project, 只看 === undefined ? undefined : 谁),
      },
      select: { projectId: true, fromPhase: true, at: true, project: { select: { ownerId: true } } },
      orderBy: { at: "asc" },
    }),
    // 结局按 closedAt 落段：历史分析回填的 closedAt 是当年的时间，不算（不然 2022–25 年各月凭空多出流失、丢单）
    prisma.project.findMany({ where: { result: { not: null }, closedAt: 段, ...谁, ...不算历史分析 }, select: { id: true, ownerId: true, result: true, closedAt: true, amount: true, currency: true } }),
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
    线索节点: 线索节点of(新全.map((p) => ({ ...p, 判无效: 判无效了(p.entLeadVerify) })), 字典),
    线索转商机: 线索转商机of(新),
  };
}

/** 填上名字；同名的带上邮箱分开，人已经删了的写「已不在的成员」 */
async function 起名<T extends { id: string; name: string }>(人: Map<string, T>): Promise<T[]> {
  const users = await prisma.user.findMany({ where: { id: { in: [...人.keys()] } }, select: { id: true, name: true, email: true } });
  const 标签 = new Map(成员选项(users).map((o) => [o.value, o.label]));
  return [...人.values()].map((r) => ({ ...r, name: 标签.get(r.id) ?? "已不在的成员" }));
}
