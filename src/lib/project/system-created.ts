/**
 * 两类「不是这段时间里有人真做出来的」项目，统计时要分开对待。这里只有常量、不碰 prisma，界面、单测都能引。
 *
 * 一、补建（11-17）：补零项目客户的脚本建的「潜客培育」项目（M-公海-14 老数据补齐）：creatorId 记 补建创建人、createdAt 记客户的建档时间。
 * 它们不是谁这段时间新建的，所以「新建」类的数一律不算（不然补一次就把历史月份撑大）：
 *   - 数据页 新建（按年 / 按月走势、按人、本月 / 本年漏斗与线索瀑布那批）：overview/project-stats.ts
 *   - 首页卡「本月新增」（卡上的数和点进去的列表同一个条件）：home-cards.ts
 *   - 渠道看板、渠道列表分档（本月 / 本季 / 自定义）的「总线索 / 关联项目」：channel-dash.ts（「全部」照旧算，它是关联项目总数、不是新建）
 * 别的（阶段、节点、结局、转商机 / 转订单、持有数……）照常算。
 *
 * 二、历史分析（11-18）：「历史沟通分析」一次性回填的项目（Project.source = 历史分析来源，迁移 151），挂在公海客户名下，
 * 节点按分析定，部分带结局（线索流失 / 丢单），closedAt、createdAt 是当年的时间。它们是旧沟通里还原出来的往事，不是系统里发生的业务，
 * 所以数据页、首页、渠道看板的**所有**统计都不算（比补建排得更多）：
 *   - 新建类：并进 不算补建（凡是排补建的地方一并排掉它）
 *   - 现在类（project-stats 项目现在）：阶段、节点、结局、公海、漏斗、线索瀑布、线索转商机
 *   - 一段类（project-stats 项目一段）：结局按 closedAt 落段、转商机 / 转订单（节点变更）
 *   - 渠道看板 / 渠道列表（channel-stats-db.ts 渠道项目条件）、公海页渠道名单（list.ts 公海名单候选），两边条数对得上
 *   - 首页卡：本月新增走 不算补建；重点 / 暂未跟进 / 3 天内回公海只数在推的（公海里的本来不算）；暂未跟进对它同补建的例外（客户身上有过沟通就不算）
 * 例外：被人领走、还在推的（领客户时随客户带出公海的进行中项目，carry-over-db.ts 带走公海项目）是这个人手上真在跟的，
 *   持有数（project/db.ts 算持有）、复盘「在跟」、数据页的阶段 / 节点 / 按人照算；结局、漏斗、线索瀑布、转商机仍不算
 * 公海页照常列出它们（客户池 / 线索池 / 商机池归池见 enterprise/unified-pool-db.ts 的注释），项目详情显示来源标签「历史分析」，导出带来源列。
 *
 * 回填写库约定（脚本照这个写，统计按这个排）：
 *   1. source = 历史分析来源，importBatch = 这一批的批次号（同一次回填同一个值）；creatorId 用 补建创建人（不是哪位成员建的）
 *   2. **不写节点变更（ProjectNodeLog）**：节点、结局直接写在 Project 行上，不留「线索→商机」这类留痕。
 *      万一要留痕，userId 写 历史分析留痕人，统计（转商机 / 转订单）按它排掉；同时统计也按项目来源排，两道都挡
 *   3. 已结束的（有结局的）照 P-公海-02 / M-公海-02：算「客户整体进公海时连带进去的」，pooledAt 跟客户进公海一起写，不是单独放回
 */
import type { Prisma } from "@/generated/prisma";

/** 补建项目的 creatorId（不是哪位成员；同超时回收留痕里的 系统操作人 一个值） */
export const 补建创建人 = "system";

/** Project.source：「历史沟通分析」回填的项目 */
export const 历史分析来源 = "history-analysis";
/** 回填万一写了节点变更，留痕的 userId 用这个（不是哪位成员），统计按它排掉（约定第 2 条） */
export const 历史分析留痕人 = "history-analysis";
/** 界面上的来源标签（项目详情、导出的来源列） */
export const 来源名: Record<string, string> = { [历史分析来源]: "历史分析" };
/** 来源写成人话：空 = 系统里建的，显示「—」；不认识的值照原样 */
export function 来源字(source: string | null | undefined): string {
  return source ? 来源名[source] ?? source : "—";
}

/**
 * 排掉历史分析回填的项目。source 可空，SQL 里 source <> 'x' 会把 NULL 也排掉，所以写成 OR。
 * 外面包一层 AND：展开进别的 where（...不算历史分析）时不和那边的 OR 撞键；那边要是也有 AND，用 并条件 合
 */
export const 不算历史分析 = {
  AND: [{ OR: [{ source: null }, { source: { not: 历史分析来源 } }] }],
} satisfies Prisma.ProjectWhereInput;

/**
 * 「是历史分析的」条件，放进 NOT 里也安全：带上 source IS NOT NULL，source 空的那几行算出 FALSE 而不是 NULL
 * （NOT (source = 'x' AND …) 遇到 NULL 会整行丢掉）
 */
export const 历史分析的 = { source: { not: null, equals: 历史分析来源 } } satisfies Prisma.ProjectWhereInput;

/** 节点变更（ProjectNodeLog）的统计用：留痕人不是 历史分析留痕人、项目也不是历史分析的 */
export const 留痕不算历史分析 = {
  userId: { not: 历史分析留痕人 },
  project: 不算历史分析,
} satisfies Prisma.ProjectNodeLogWhereInput;

/** 「新建」类计数用：排掉补建的项目，历史分析的一并排掉（它也不是这段时间新建的） */
export const 不算补建 = { creatorId: { not: 补建创建人 }, ...不算历史分析 } satisfies Prisma.ProjectWhereInput;

/** 这个项目是补建的吗（取回来在内存里分时用）。历史分析的在查库时就排掉了，不靠这里 */
export function 是补建(p: { creatorId?: string | null }): boolean {
  return p.creatorId === 补建创建人;
}

/** 这个项目是历史分析回填的吗 */
export function 是历史分析(p: { source?: string | null }): boolean {
  return p.source === 历史分析来源;
}

/** 两个 where 合成一个（都可能带 AND / OR，展开会撞键时用） */
export function 并条件(...ws: (Prisma.ProjectWhereInput | undefined)[]): Prisma.ProjectWhereInput {
  const 有 = ws.filter((w): w is Prisma.ProjectWhereInput => !!w && Object.keys(w).length > 0);
  return 有.length === 0 ? {} : 有.length === 1 ? 有[0] : { AND: 有 };
}
