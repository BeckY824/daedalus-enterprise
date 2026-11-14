/**
 * 统一公海的客户行在库里筛、数、分页（2026-11-14，8.5 万客户提速 + 修「公海只在最近入池的 2000 条里找」）。
 *
 * 原来客户公海、项目公海各取最近入池的 2000 条，在内存里筛、数、排（unified-pool.ts 筛排）：全量导入后公海 6.6 万位，
 * 更早入池的搜不到，各池数量、快捷数也只数这 2000 条；取这 2000 条两句各 150–400 ms（30 人时）。
 * 现在客户行（一位公海客户一行，永远不并）在库里按同一套口径筛、按 (属性, 快捷, 号码不全) 分组数、按页取；
 * 项目行（项目公海里客户不在客户公海的，量小）照旧在内存里走 筛排，两边相加、按同一个排序键合起来切页（unified-pool-db.ts 读公海页）。
 *
 * 口径逐条对着 unified-pool.ts，那边改了这边要跟（tests/ent-unified-pool-paging.test.ts 拿改前的内存写法逐个身份、逐个筛选组合、逐页对拍）：
 *   - 属性：按名下全部项目算（归池），只有名下有项目的客户才可能不是线索池——这几位在内存里用 客户公海属性 算好，名单进 SQL
 *   - 快捷：客户入池类 + 标无效 + 第几次 → 归到快捷，写成一句 CASE（自动理由、离职理由、多次退回起 都从 unified-pool.ts 取，不另写）
 *   - 关键词：客户名在库里比（GLOB，单个字符的大小写等价，同客户列表搜索）；项目名（各人看得到的项目，「、」连起来）在内存里比，对上的客户 id 进 SQL
 *   - 排序：入池时间 / 最后跟进 / 创建时间倒序，空的排最后，同一刻按行 id（c:客户 id）正序——和 筛排 的 取 + 比id 一样
 *   - 可见范围：公海客户人人看得到（team-scope 可见客户 第三条），只差原负责人回避（P-公海-04）；回避掉的那几位由带限定的客户端认出来，按 id 排掉
 */
import { 自动理由 } from "@/lib/pool";
import { 离职理由们, 多次退回起, 快捷们, type 快捷, type 公海属性 } from "./unified-pool";

/** SQL 字符串字面（只给代码里的常量用；用户输入一律走参数） */
const 字面 = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** 「N 天没跟进，自动放进公海」里 N 后面那一截（同 客户入池类 认的 /^\d+ 天没跟进，自动放进公海$/） */
const 自动尾 = 自动理由(0).replace(/^0/, "");
const 尾长 = [...自动尾].length;
const 是自动理由SQL = `(length(p."reason") > ${尾长} AND substr(p."reason", -${尾长}) = ${字面(自动尾)} AND ltrim(substr(p."reason", 1, length(p."reason") - ${尾长}), '0123456789') = '')`;
const 第几次SQL = `max(1, coalesce(c."poolReturns", 0))`;
const 次档 = ["首次退回", "二次退回", "三次退回"] as const;

/**
 * 客户行的快捷（= 归到快捷({ 类: 标了无效 ? 无效 : 客户入池类(pool), 累计: poolReturns })）。离职交接的不落任何快捷（NULL）。
 * 客户入池类：离职理由 → 离职交接；没有操作人（空也算）或自动理由 → 超时回收；其余主动退回，按第几次分档
 */
export const 快捷SQL = `CASE
  WHEN c."poolInvalidAt" IS NOT NULL THEN ${字面("无效客户")}
  WHEN p."reason" IN (${离职理由们.map(字面).join(", ")}) THEN NULL
  WHEN p."userId" IS NULL OR p."userId" = '' OR ${是自动理由SQL} THEN ${字面("超时回收")}
  WHEN ${第几次SQL} >= ${多次退回起} THEN ${字面("多次退回")}
  ${次档.map((k, i) => `WHEN ${第几次SQL} = ${i + 1} THEN ${字面(k)}`).join("\n  ")}
  ELSE ${字面("多次退回")}
END`;

/** 客户行的属性：名下有项目、算出来不是线索池的几位按名单认，其余线索池（含一个项目都没有的） */
export const 属性SQL = `CASE
  WHEN c.id IN (SELECT value FROM json_each(?)) THEN ${字面("商机池")}
  WHEN c.id IN (SELECT value FROM json_each(?)) THEN ${字面("订单池")}
  ELSE ${字面("线索池")}
END`;

export type 客户行筛 = {
  /** 属性名单：商机池、订单池的客户 id（其余线索池） */
  商机: readonly string[];
  订单: readonly string[];
  /** 回避掉、这个人看不到的公海客户 */
  排掉: readonly string[];
  /** 关键词：客户名比的 GLOB 式子（search-keyword 包含模式）+ 项目名对上的客户 id；没关键词不带 */
  词?: { 名: string; 项目对上: readonly string[] };
  来源?: string;
  号码不全?: boolean;
};

/** FROM + WHERE（别名 p = CustomerPool、c = Customer），属性 / 快捷两个表达式另给 */
function 底(筛: 客户行筛): { sql: string; 值: unknown[] } {
  const 段: string[] = [`c.id = p."customerId"`, `c."deletedAt" IS NULL`];
  const 值: unknown[] = [];
  if (筛.排掉.length) {
    段.push(`c.id NOT IN (SELECT value FROM json_each(?))`);
    值.push(JSON.stringify(筛.排掉));
  }
  if (筛.词) {
    段.push(`(c."name" GLOB ? OR c.id IN (SELECT value FROM json_each(?)))`);
    值.push(筛.词.名, JSON.stringify(筛.词.项目对上));
  }
  if (筛.来源) {
    段.push(`c."channelId" = ?`);
    值.push(筛.来源);
  }
  if (筛.号码不全) 段.push(`p."phoneIncomplete" = 1`);
  // CROSS JOIN 定死从公海表出发：没有统计信息时 SQLite 以为 deletedAt IS NULL 很能筛，会从客户表的 deletedAt 索引出发、8.5 万位逐个回公海表找，
  // 按入池时间取一页也得整表排（32 ms）；从公海表的 (at DESC, customerId) 索引顺着取，一页 0.1 ms
  return { sql: `FROM "CustomerPool" p CROSS JOIN "Customer" c WHERE ${段.join(" AND ")}`, 值 };
}

const 属性值 = (筛: 客户行筛) => [JSON.stringify(筛.商机), JSON.stringify(筛.订单)];

/** 按 (属性, 快捷, 号码不全) 分组数：页签上的各池数、快捷按钮上的数、总数、号码不全数都从这一张表加出来 */
export function 分组数SQL(筛: 客户行筛): { sql: string; 值: unknown[] } {
  const d = 底(筛);
  return {
    sql: `SELECT ${属性SQL} AS "属性", ${快捷SQL} AS "快捷", (p."phoneIncomplete" = 1) AS "不全", COUNT(*) AS n ${d.sql} GROUP BY 1, 2, 3`,
    值: [...属性值(筛), ...d.值],
  };
}

export type 排序键 = "pooled" | "follow" | "created";
const 键列: Record<排序键, string> = { pooled: `p."at"`, follow: `c."lastFollowAt"`, created: `c."createdAt"` };

/**
 * 按排序取第 跳过 位起的 取几 位客户行（只要 id 和排序键）。属性 / 快捷筛了才带那一句。
 * 排序同 筛排：键倒序（SQLite 里 NULL 最小，倒序排在最后，同 时(null) = 负无穷）、同键按客户 id 正序
 * （行 id 都是「c:」开头，比行 id 就是比客户 id）。按入池时间排时走 CustomerPool_at_customerId_idx（迁移 137）
 */
export function 取一段SQL(筛: 客户行筛, 选: { 属性?: 公海属性 | ""; 快捷?: 快捷 | null; 排序: 排序键; 跳过: number; 取几: number }): { sql: string; 值: unknown[] } {
  const d = 底(筛);
  const 加: string[] = [];
  const 值 = [...d.值];
  if (选.属性) {
    加.push(` AND ${属性SQL} = ?`);
    值.push(...属性值(筛), 选.属性);
  }
  if (选.快捷 && (快捷们 as readonly string[]).includes(选.快捷)) {
    加.push(` AND ${快捷SQL} = ?`);
    值.push(选.快捷);
  }
  const 键 = 键列[选.排序];
  const 序 = 选.排序 === "pooled" ? `p."at" DESC, p."customerId" ASC` : `${键} DESC, c.id ASC`;
  值.push(选.取几, 选.跳过);
  return { sql: `SELECT c.id AS id, ${键} AS k ${d.sql}${加.join("")} ORDER BY ${序} LIMIT ? OFFSET ?`, 值 };
}

/** 库里回的时间（整数毫秒；万一是文本也认）→ 毫秒，空 = 负无穷（同 筛排 的 时） */
export function 键毫秒(v: unknown): number {
  if (v === null || v === undefined) return Number.NEGATIVE_INFINITY;
  if (typeof v === "number" || typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  return Number.isFinite(n) ? n : new Date(String(v)).getTime();
}
