/**
 * 客户列表「客户来源」筛选的取值（员工反馈 F-049，11-25）。纯算，服务端、客户端都能用。
 * 还是地址栏同一个参数 channelId（老链接、渠道页点进来的、列表回来还原都不变），多认两种值：
 *   - 「未填」：主渠道 channelId 和渠道触点 touchpoint 都空（P-渠道-08：两格至少填一个，都空就是没填）；
 *   - 「触点:公司资源」「触点:客户介绍」：按渠道触点筛（P-渠道-08 这两类主渠道留空、由触点承载）；
 *   - 别的照旧当渠道 id，比 Customer.channelId。
 * Prisma 老路（客户筛选条件）和关键词快路径（关键词分页的裸 SQL）都从这里拿，两边口径一份。
 * 只管客户：项目不带触点（P-渠道-08 我方定），项目列表的「渠道」筛选不用这个。
 */
import type { Prisma } from "@/generated/prisma";
import { 渠道触点们 } from "@/lib/enterprise/touchpoint";

export const 来源未填 = "未填";
export const 触点前缀 = "触点:";

export type 来源筛选 = { 类: "未填" } | { 类: "触点"; 触点: string } | { 类: "渠道"; id: string };

/** 地址栏那一格认成哪种；空的 / 「触点:」后面没字的 = null（当没筛） */
export function 认来源筛选(v: string | null | undefined): 来源筛选 | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s === 来源未填) return { 类: "未填" };
  if (s.startsWith(触点前缀)) {
    const 触点 = s.slice(触点前缀.length).trim();
    // 认不出的触点也照原样比（比出来 0 条），不偷偷当没筛
    return 触点 ? { 类: "触点", 触点 } : null;
  }
  return { 类: "渠道", id: s };
}

/**
 * 市场角色在客户列表切「我分出去的」（项目页那套）时地址栏要去掉的：scope 照旧（P-界面-51）；
 * 「客户来源」筛的是「未填」或某个触点时 channelId 一并去掉——项目不带触点，项目页的「渠道」筛选只认渠道 id
 */
export function 切我分出去的去掉(channelId: string | null | undefined): string[] {
  const f = 认来源筛选(channelId);
  return f && f.类 !== "渠道" ? ["scope", "channelId"] : ["scope"];
}

/** 触点一格空：null 或空串都算（导入、老数据可能写成空串） */
const 触点空: Prisma.CustomerWhereInput = { OR: [{ touchpoint: null }, { touchpoint: "" }] };

/** Prisma 老路的条件；没筛 = null */
export function 来源筛选条件(v: string | null | undefined): Prisma.CustomerWhereInput | null {
  const f = 认来源筛选(v);
  if (!f) return null;
  if (f.类 === "未填") return { AND: [{ channelId: null }, 触点空] };
  if (f.类 === "触点") return { touchpoint: f.触点 };
  return { channelId: f.id };
}

/** 关键词快路径的一段 SQL（别名 c = Customer），值按 ? 顺序绑定；没筛 = null */
export function 来源筛选SQL(v: string | null | undefined): { sql: string; values: unknown[] } | null {
  const f = 认来源筛选(v);
  if (!f) return null;
  if (f.类 === "未填") return { sql: `c."channelId" IS NULL AND (c."touchpoint" IS NULL OR c."touchpoint" = '')`, values: [] };
  if (f.类 === "触点") return { sql: 'c."touchpoint" = ?', values: [f.触点] };
  return { sql: 'c."channelId" = ?', values: [f.id] };
}

/** 触点在下拉、列表「客户来源」一列、导出里的写法：「公司资源（触点）」——和停用的同名主渠道「公司资源（已停用）」分得清 */
export const 触点显示名 = (t: string) => `${t}（触点）`;

export type 来源筛选项 = { value: string; label: string; title?: string };
export type 来源筛选组 = 来源筛选项 | { label: string; title?: string; options: 来源筛选项[] };

/**
 * 「客户来源」下拉：「未填」放最前，渠道触点单列一组，渠道一组（渠道筛选选项 原样，含停用 / 历史渠道的标注）。
 * 触点名带「（触点）」：停用的同名主渠道「公司资源（已停用）」还在渠道组里，选上以后框里分得清是哪个
 */
export function 客户来源筛选项(渠道项: { value: string; label: string }[]): 来源筛选组[] {
  return [
    { value: 来源未填, label: 来源未填, title: "主渠道和渠道触点都没填" },
    { label: "渠道触点", options: 渠道触点们.map((t) => ({ value: `${触点前缀}${t}`, label: 触点显示名(t) })) },
    ...(渠道项.length ? [{ label: "渠道", options: 渠道项 }] : []),
  ];
}
