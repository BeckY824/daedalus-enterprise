/**
 * 客户抬头（11-17 客户抬头 PR-5，P-抬头-06～12）：客户列表第一列、客户详情页头上显示的客户名称。
 * 不是全称也不是简称，是由区域、简称、全称、客户类型、当前进程节点现算出来的展示名，列表和详情共用这一个算法（U1：现算，不存列）。
 *
 *   全称、简称、类型、区域全空 → 客户编号|当前节点；没有项目只写客户编号（先判，答复 2.4 末行示例；U9 零项目）
 *   否则             → 区域段|主体段，哪段空就只写另一段
 *   区域段 = 地址里最小一级：区县（含县级市）→ 市 → 省 → 国家，只取一级、不叠加；照库里原值写，不去「市 / 区 / 县」后缀（Q4a）。
 *            国外客户只填国家和城市，有城市就是城市（按「最小一级」）
 *   主体段 = 简称 → 全称（name 那一格）→ 客户类型（字典原名）→ 当前节点（用户 11-17「简称优先」，同答复 2.3）
 *   分隔符半角「|」、两边不加空格；值里的换行和连续空白收成一个空格（抬头只占一行，放不下由界面一行省略、悬停看全文，P-抬头-11）。
 *   抬头可以重复，唯一性只靠客户编号（P-抬头-12）。没填按 lib/empty-value.ts 认（空白、横线、旧占位词都算没填）
 *
 * 当前节点（U9，P-抬头-10）：客户名下最近有动静、没删的那个项目，含公海项目、不按看的人的可见范围算（人人看到的抬头一样）；
 * 有结局写结局、异常写「异常 · 节点」（同客户列表「当前节点」那一列的写法）。只有简称、全称、类型都空的客户才用得上它，
 * 所以一页只为这些客户批量查一次（抬头节点们）；一位都没有就不查。
 *
 * 客户显名（原 project/relate-names.ts，关联客户那些地方用）并到这里：简称 → 全称 → 客户编号（回填前短号）；relate-names 照旧转导出。
 * 这份文件不 import 库：列表、详情这些客户端组件直接拿 客户抬头 算，批量查节点由服务端把 prisma 传进来
 */
import { 客户编号显示 } from "@/lib/customer-no";
import { 去空 } from "@/lib/empty-value";
import { 本套位置, 节点序号 } from "@/lib/project/nodes";
import { 企业版字典 } from "@/lib/project/stage-dict";

/** 段与段之间的分隔符：半角竖线、两边不加空格 */
export const 抬头分隔 = "|";

/** 算抬头要的列：客户行上本来就取的这些（列表 客户行字段、详情 findUnique 都带着） */
export type 抬头料 = {
  id: string;
  customerNo?: number | null;
  name?: string | null;
  shortName?: string | null;
  customerType?: string | null;
  addrCountry?: string | null;
  addrProvince?: string | null;
  addrCity?: string | null;
  addrDistrict?: string | null;
};

/** 没填给 ""；填了的去首尾空白、中间的换行和连续空白收成一个空格 */
function 值(v: string | null | undefined): string {
  return 去空(v)?.replace(/\s+/g, " ") ?? "";
}

/**
 * 存量名字的临时显示规则（用户 11-17 定「只改抬头现算规则、不动数据」）：旧导入按「姓名｜国家」「暂无名称｜…」补过名字
 * （M-导入-54，全角「｜」），直接当全称会在抬头里把国家写两遍。S-6 清理完数据后这段就用不上了，到时连同 补区域 一起删。
 * 只管抬头显示：不改库，查重、搜索、客户显名都不走这里。
 *   - 全称是「暂无名称」或以「暂无名称｜」开头 → 当没有全称（主体段往下取类型 → 节点）；「暂无名称｜X」的 X 留给区域段，
 *     客户没有城市时用它（X 往往比国家细，国家中国、X 香港 → 「香港|…」）
 *   - 全称末尾是「｜X」、X（去首尾空白）和这位客户的国家或城市一样 → 去掉这段「｜X」；不一样原样留。只认全角「｜」
 */
const 暂无名称 = "暂无名称";
export function 显示全称(c: Pick<抬头料, "name" | "addrCountry" | "addrCity">): { 全称: string; 补区域: string } {
  const 名 = 值(c.name);
  if (名 === 暂无名称) return { 全称: "", 补区域: "" };
  if (名.startsWith(`${暂无名称}｜`)) return { 全称: "", 补区域: 值(名.slice(暂无名称.length + 1)) };
  const 位 = 名.lastIndexOf("｜");
  if (位 >= 0) {
    const 尾 = 名.slice(位 + 1).trim();
    if (尾 && (尾 === 值(c.addrCountry) || 尾 === 值(c.addrCity))) return { 全称: 名.slice(0, 位).trim(), 补区域: "" };
  }
  return { 全称: 名, 补区域: "" };
}

/** 区域段：区县 → 市 →（「暂无名称｜X」的 X，见 显示全称）→ 省 → 国家，取最小那一级，原值不去后缀；都没填给 "" */
export function 区域段(c: Pick<抬头料, "addrCountry" | "addrProvince" | "addrCity" | "addrDistrict">, 补区域 = ""): string {
  return 值(c.addrDistrict) || 值(c.addrCity) || 补区域 || 值(c.addrProvince) || 值(c.addrCountry);
}

/** 简称、全称（按 显示全称 认）、类型都空：主体段要落到当前节点，只有这些客户要查节点 */
export function 要查节点(c: Pick<抬头料, "name" | "shortName" | "customerType" | "addrCountry" | "addrCity">): boolean {
  return !值(c.shortName) && !显示全称(c).全称 && !值(c.customerType);
}

/**
 * 抬头。节点 = 抬头节点们 给这位客户的那一格（没查、没项目都传 null / 不传）
 */
export function 客户抬头(c: 抬头料, 节点?: string | null): string {
  const { 全称, 补区域 } = 显示全称(c);
  const 区 = 区域段(c, 补区域);
  const 主 = 值(c.shortName) || 全称 || 值(c.customerType);
  const 节 = 值(节点);
  if (!区 && !主) return [客户编号显示(c), 节].filter(Boolean).join(抬头分隔);
  return [区, 主 || 节].filter(Boolean).join(抬头分隔);
}

/**
 * 客户显名（关联客户、引用联系人、通知、搜索结果、下拉、日志这些地方叫一位客户）：简称 → 全称 → 客户编号（没给编号 / 回填前是短号）。都去首尾空白。
 * 11-19 起企业版客户全称选填（新建弹窗、建档向导、AI 建档卡、资料卡就地改都能空着）：列表第一列、详情页头走 客户抬头，
 * 其余凡是要「叫出一位客户」的地方一律走这里，永远不给空串；不拿联系人姓名、号码兜（P-抬头-13）
 */
export function 客户显名(c: { id: string; name?: string | null; shortName?: string | null; customerNo?: number | null }): string {
  return (c.shortName ?? "").trim() || (c.name ?? "").trim() || 客户编号显示(c);
}

/** 叫一位客户要取的列（Prisma select 片段，和 客户显名 配套）：只取 name 的地方换成这个，名字空着时才兜得到简称 / 编号 */
export const 显名列 = { id: true, name: true, shortName: true, customerNo: true } as const;

/**
 * 项目默认名（潜客培育、建档时跟着客户起的名）：有全称照旧用全称（老规矩不变），全称空着才兜 客户显名（简称 → 客户编号），不落成空白
 */
export function 全称或显名(c: Parameters<typeof 客户显名>[0]): string {
  return (c.name ?? "").trim() || 客户显名(c);
}

/** 日志、提示里引一位客户：「显名」（显名不会空，不出现空引号「」） */
export function 客户引(c: Parameters<typeof 客户显名>[0]): string {
  return `「${客户显名(c)}」`;
}

/** 能跑裸 SQL 的客户端（服务端传 prisma；测试传数句子的假库） */
type 库 = { $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): PromiseLike<T> };

/**
 * 一句取回名单上客户的项目：没删的，含公海（pooledAt 不管）。走裸 SQL：不经限定层（U9 不按看的人算），
 * 名单用一个参数（json_each）带过去，不受绑定参数个数上限管；Project.customerId 有索引
 */
export const 抬头节点SQL = `SELECT p."customerId" AS "customerId", p.phase AS phase, p.node AS node, p.result AS result, p."updatedAt" AS "updatedAt"
FROM "Project" p WHERE p."deletedAt" IS NULL AND p."customerId" IN (SELECT value FROM json_each(?))`;

type 项目行 = { customerId: string; phase: string; node: string; result: string | null; updatedAt: unknown };

/** 裸 SQL 取回的 DateTime 可能是 Date、毫秒数（number / bigint）或字符串，统一成毫秒 */
function 毫秒(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return /^\d+$/.test(v) ? Number(v) : new Date(v).getTime();
  return 0;
}

/**
 * 这一页客户的抬头节点：{ 客户 id: 节点 }，只给要查节点、名下有没删项目的客户。
 * 一页一句（不是每行一句）；这一页没有要查节点的客户就一句都不发。
 * 选哪个项目同客户列表「当前节点」（customer-list-projects.ts 最近有动静的）：updatedAt 最新的，一样新取节点更靠后的；
 * 写法同那一列（节点字）：有结局写结局，异常写「异常 · 节点」，库里的旧节点名按企业版新名
 */
export async function 抬头节点们(db: 库, 客户们: readonly 抬头料[]): Promise<Record<string, string>> {
  const ids = [...new Set(客户们.filter(要查节点).map((c) => c.id))];
  if (!ids.length) return {};
  const 行们 = await db.$queryRawUnsafe<项目行[]>(抬头节点SQL, JSON.stringify(ids));
  const 选 = new Map<string, { 行: 项目行; 时: number; 序: number }>();
  for (const 行 of 行们) {
    const 时 = 毫秒(行.updatedAt);
    const 序 = 节点序号(行, 企业版字典);
    const 旧 = 选.get(行.customerId);
    if (!旧 || 时 > 旧.时 || (时 === 旧.时 && 序 > 旧.序)) 选.set(行.customerId, { 行, 时, 序 });
  }
  const 结果: Record<string, string> = {};
  for (const [cid, { 行 }] of 选) {
    const 位 = 本套位置({ phase: 行.phase, node: 行.node, result: 行.result }, 企业版字典);
    结果[cid] = 位.result === "异常状态" ? `异常 · ${位.node}` : 位.result ?? 位.node;
  }
  return 结果;
}
