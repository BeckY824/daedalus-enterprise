/**
 * 两类「不是这段时间里有人真做出来的」项目，统计时要分开对待。这里只有常量、不碰 prisma，界面、单测都能引。
 *
 * 一、补建（11-17）：补零项目客户的脚本建的「潜客培育」项目（M-公海-14 老数据补齐）：creatorId 记 补建创建人、createdAt 记客户的建档时间；
 *    存量改创建人时同时写 importBatch = 补建批次（11-18），之后认补建两样都看（补建的 / 不算补建 / 是补建）。
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
 * 公海页照常列出它们（归池见 enterprise/unified-pool-db.ts 的注释），项目详情显示「数据来源：历史分析」标签（现在没有项目导出，客户导出不带项目列）。
 *
 * 回填写库约定（脚本照这个写，统计按这个排）：
 *   1. source = 历史分析来源，importBatch = 这一批的批次号（同一次回填同一个值）；creatorId 用 补建创建人（不是哪位成员建的）
 *   2. **不写节点变更（ProjectNodeLog）**：节点、结局直接写在 Project 行上，不留「线索→商机」这类留痕。
 *      万一要留痕，userId 写 历史分析留痕人，统计（转商机 / 转订单）按它排掉；同时统计也按项目来源排，两道都挡
 *   3. 已结束的（有结局的）照 P-公海-02 / M-公海-02：算「客户整体进公海时连带进去的」，pooledAt 跟客户进公海一起写，不是单独放回
 */
import type { Prisma } from "@/generated/prisma";
import { 系统 } from "./timeout";

/** 补建项目的 creatorId（不是哪位成员；同超时回收留痕里的 系统操作人 一个值） */
export const 补建创建人 = "system";

/**
 * 11-17 补潜客培育那一批的批次号（Project.importBatch）。存量会把这批项目的创建人从 system 改成真人（审核 11-18 第五节），
 * 改完 creatorId 认不出来了，「补建」靠这个标记认：判补建一律「creatorId = 补建创建人 或 importBatch = 补建批次」，只看一样会把新建数撑大
 */
export const 补建批次 = "fill-nurture-20261117";

/**
 * 「是补建的」条件，放进 NOT 里也安全：importBatch 可空，写成 not null + equals，空的那几行算出 FALSE 而不是 NULL（同 历史分析的）
 */
export const 补建的 = {
  OR: [{ creatorId: 补建创建人 }, { importBatch: { not: null, equals: 补建批次 } }],
} satisfies Prisma.ProjectWhereInput;

/** 「创建人」那一格碰上补建创建人时的叫法（不是哪位成员，也不是删掉的账号；25E） */
export const 补建创建人名 = "系统补建";

/**
 * 人名 id → 显示名，界面和 AI 共用（项目详情的创建人、AI 查询结果的人名列）。
 * system 不是真账号：在「创建人」列上是补建的（系统补建）；别的列（超时回收、定时分配的操作人）是「系统」（timeout.ts 系统）。
 * 名单里查不到的用调用方给的说法（页面「已不在的成员」、AI「（已删除的账号）」）
 */
export function 人名显示(id: string, 名: ReadonlyMap<string, string>, o: { 创建人?: boolean; 不在: string }): string {
  if (id === 补建创建人) return o.创建人 ? 补建创建人名 : 系统.name;
  return 名.get(id) ?? o.不在;
}

/** Project.source：「历史沟通分析」回填的项目 */
export const 历史分析来源 = "history-analysis";
/** 回填万一写了节点变更，留痕的 userId 用这个（不是哪位成员），统计按它排掉（约定第 2 条） */
export const 历史分析留痕人 = "history-analysis";
/**
 * Project.source：「老客户重复咨询」——市场成员查号码撞上已有客户另建的线索（重复咨询第一步，客户 11-22 定稿）：
 * 出口 C（撞上同事名下的客户，在客户负责人名下新建）、查重领取新建线索项目（撞上公海客户，P-公海-12）两处建时写。
 * 它是系统里正常建的线索：统计照算（不算历史分析、不算补建都只排各自那一个值），只用来打标、详情现算「其他在推的项目」
 */
export const 重复咨询来源 = "repeat-inquiry";
/** 这条是老客户重复咨询吗 */
export function 是重复咨询(p: { source?: string | null }): boolean {
  return p.source === 重复咨询来源;
}
/**
 * 三、仅记录用（X-147，客户 11-17 提、11-18 第二轮选 A）：Project.source = 仅记录用来源——为了记一条沟通而新建的项目
 * （客户没有能记的在推项目，记沟通弹框 / 首页 AI 记沟通卡点「新建项目 / 去建项目」进来、勾着「仅记录用」建的），停在线索阶段「潜客培育」。
 * 客户原话「不算在推、不进任何转化率的分母」：只要还停在 线索 · 潜客培育，就和历史分析一样**所有**统计都不算（新建、现在、一段、漏斗、线索瀑布、
 * 首页卡、渠道看板、持有数、AI 统计），且没有「被领走还在推照算」那条例外（它本来就在人手上，照算就是「算在推」）；
 * 超时回收默认不收它（组织规则 超时回收.仅记录用也回收，默认关，timeout.ts 超时回收日）。
 * 推进出潜客培育（或转了商机）= 真成了在跟的线索，从那一刻起照常算，不用回写来源（任何一条推进路都不用改）；详情照旧标「仅记录用」。
 * 建它要组织规则 阶段.仅记录用 开着（默认关，关着时这两处建的照旧是普通项目，c2 行为不变）
 */
export const 仅记录用来源 = "record-only";
/** 仅记录用项目停的那一格（客户原话「一律停在潜客培育」）；推进出去就不再算仅记录用 */
export const 仅记录用阶段 = "线索";
export const 仅记录用节点 = "潜客培育";
/** 这个项目现在算仅记录用吗（来源 + 还停在 线索 · 潜客培育） */
export function 是仅记录用(p: { source?: string | null; phase?: string | null; node?: string | null }): boolean {
  return p.source === 仅记录用来源 && p.phase === 仅记录用阶段 && p.node === 仅记录用节点;
}
/** 「现在算仅记录用的」条件，放进 NOT 里也安全（source 写成 not null + equals，空的算出 FALSE 而不是 NULL，同 历史分析的） */
export const 仅记录用的 = {
  source: { not: null, equals: 仅记录用来源 }, phase: 仅记录用阶段, node: 仅记录用节点,
} satisfies Prisma.ProjectWhereInput;

/**
 * 962 条一次性咨询补建那批（scripts/ent-x147-record-only-backfill.ts）的批次号前缀：Project.importBatch = x147-<14 位时间>-<6 位>。
 * 补建项目的 createdAt 是几年前最早那条沟通的时间，不是「那年那月新建了一条线索」：以后有人把它推进出潜客培育，别的统计照仅记录用的规则走
 * （推进后照常算），只有「新建」类（数据页新建 / 一段漏斗、首页本月新增、渠道分档、AI 按创建时间数、报表新建）永远不算它——
 * 同 11-17 补建批次（补建的 / 不算补建 / 是补建）一个机制，不然推进那一刻几年前那个月的新建和漏斗会凭空多 1。
 * 规则说明（X-147 口径，不另写逻辑）：推进出去后又被改回潜客培育，照样算仅记录用（判定只看来源 + 现在停在哪）；
 * 市场成员勾着仅记录用、指定给销售建项目时，照现行规则走「市场转客户」（市场分配进线索验证 对它跳过，停在潜客培育）。
 */
export const 仅记录用补建批次前缀 = "x147-";
/** 这个项目是 962 条补建那批建的吗（取回来在内存里分时用，查的时候带上 importBatch） */
export function 是仅记录用补建(p: { importBatch?: string | null }): boolean {
  return !!p.importBatch && p.importBatch.startsWith(仅记录用补建批次前缀);
}

/** 界面上的来源标签（项目详情「数据来源」一行）；以后有项目导出时来源列也用它 */
export const 来源名: Record<string, string> = { [历史分析来源]: "历史分析", [重复咨询来源]: "老客户重复咨询", [仅记录用来源]: "仅记录用" };
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
 * 统计口径（X-147）：历史分析回填的、现在算仅记录用的都排掉。凡是「所有统计都不算」的地方用它（数据页现在 / 一段、渠道看板、AI 统计、
 * 数据页点进项目列表那几种筛法）。同 不算历史分析 收在一个 AND 里，展开进别的 where 不撞键
 */
export const 不进统计 = {
  AND: [...不算历史分析.AND, { NOT: 仅记录用的 }],
} satisfies Prisma.ProjectWhereInput;

/**
 * 「是历史分析的」条件，放进 NOT 里也安全：带上 source IS NOT NULL，source 空的那几行算出 FALSE 而不是 NULL
 * （NOT (source = 'x' AND …) 遇到 NULL 会整行丢掉）
 */
export const 历史分析的 = { source: { not: null, equals: 历史分析来源 } } satisfies Prisma.ProjectWhereInput;

/**
 * 节点变更（ProjectNodeLog）的统计用：留痕人不是 历史分析留痕人、项目也不是历史分析的。
 * 仅记录用的（X-147）现在还停在潜客培育就没有转商机 / 转订单的留痕；推出去了照常算，这里不另排
 */
export const 留痕不算历史分析 = {
  userId: { not: 历史分析留痕人 },
  project: 不算历史分析,
} satisfies Prisma.ProjectNodeLogWhereInput;

/**
 * 「新建」类计数用：排掉补建的项目（创建人 system，或带 11-17 补建批次标记——改了创建人的也认），历史分析的一并排掉（它也不是这段时间新建的）。
 * importBatch 可空：写成「空 或 不是补建批次」，SQL 里 importBatch <> 'x' 会把 NULL 也排掉。都收在一个 AND 里，展开进别的 where 不撞键
 */
export const 不算补建 = {
  creatorId: { not: 补建创建人 },
  // 仅记录用的（X-147）也不是「新建了一个在推项目」，一并排掉（不进统计 = 不算历史分析 + 不算仅记录用）
  // 962 条补建那批（importBatch 以 x147- 开头）推进出去以后也永远不算新建（仅记录用补建批次前缀）；NOT startsWith 对空值会算出 NULL，所以同样写成「空 或 不是」
  AND: [
    ...不进统计.AND,
    { OR: [{ importBatch: null }, { importBatch: { not: 补建批次 } }] },
    { OR: [{ importBatch: null }, { NOT: { importBatch: { startsWith: 仅记录用补建批次前缀 } } }] },
  ],
} satisfies Prisma.ProjectWhereInput;

/** 这个项目是补建的吗（含 962 条补建那批；取回来在内存里分时用，查的时候带上 creatorId、importBatch）。历史分析的在查库时就排掉了，不靠这里 */
export function 是补建(p: { creatorId?: string | null; importBatch?: string | null }): boolean {
  // 962 条补建那批（X-147）也认：渠道分档的「新建」同 不算补建 一样永远不算它
  return p.creatorId === 补建创建人 || p.importBatch === 补建批次 || 是仅记录用补建(p);
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
