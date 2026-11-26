/**
 * 客户详情「上一条 / 下一条」（E-332）：从客户列表 / 公海点进详情，按进来前那张列表的条件（筛选、排序、页签、范围）找这一位的前一位、后一位。
 *
 * 不另写查询：客户列表用 query.ts 的 客户筛选条件 + 客户排序（列表页同一份），公海用 读公海页（公海页同一份），可见范围照列表现有的限定层。
 * 只取 id：先取这一页（多取 1 条看有没有下一页），这一位在这一页头 / 尾时再取上一页 / 下一页，跨页也对。
 * 这一位不在那一页里（数据变了、从详情里点到了别的客户）就当不是从列表进来的，返回 null，详情页不摆箭头
 */
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { 客户页看法键 } from "@/lib/customers-view-pref";
import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 有管理范围 } from "@/lib/enterprise/permissions";
import { 生效客户范围 } from "@/lib/enterprise/customer-scope";
import { 规整币种 } from "@/lib/currency";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 读公海页筛, 按名单 as 按名单of, type 公海页地址 } from "../../pool/filters";
import { 客户筛选条件, 客户排序, 金额排序ids, 在看子集, type 客户条件 } from "../query";

export type 相邻一位 = { id: string; page: number };
export type 相邻 = { 上: 相邻一位 | null; 下: 相邻一位 | null };
/** 第 p 页的 id（按列表顺序）和后面还有没有 */
export type 一页 = { ids: string[]; 还有下页: boolean };

/** 按页找：这一位在第 page 页的第几位；头尾跨到上一页末位 / 下一页首位（只在需要时多取一页，两边要取就一起取） */
export async function 找相邻(id: string, page: number, 取页: (p: number) => Promise<一页>): Promise<相邻 | null> {
  const 这页 = await 取页(page);
  const i = 这页.ids.indexOf(id);
  if (i < 0) return null;
  const 要上页 = i === 0 && page > 1;
  const 要下页 = i === 这页.ids.length - 1 && 这页.还有下页;
  const [上页, 下页] = await Promise.all([要上页 ? 取页(page - 1) : null, 要下页 ? 取页(page + 1) : null]);
  const 上 = i > 0 ? { id: 这页.ids[i - 1], page } : 上页?.ids.length ? { id: 上页.ids[上页.ids.length - 1], page: page - 1 } : null;
  const 下 = i < 这页.ids.length - 1 ? { id: 这页.ids[i + 1], page } : 下页?.ids.length ? { id: 下页.ids[0], page: page + 1 } : null;
  return { 上, 下 };
}

/** 地址上的查询串 → 一层的键值（同名的取第一个，和 Next searchParams 给页面的一样只认字符串） */
export function 查询串of(href: string): Record<string, string> {
  const i = href.indexOf("?");
  const out: Record<string, string> = {};
  if (i < 0) return out;
  for (const [k, v] of new URLSearchParams(href.slice(i + 1))) if (!(k in out)) out[k] = v;
  return out;
}

/** 每页条数，和列表页同一个算法（10–100，默认 20） */
export function 每页条数(raw: string | undefined): number {
  const n = Number(raw);
  return Math.min(100, Math.max(10, Number.isSafeInteger(n) && n > 0 ? n : 20));
}

/** 客户页记的「列表 / 看板」（cookie）；不在请求里（单测直接调）读不到 = 没记 */
async function 记的看法(): Promise<string | undefined> {
  try {
    return (await cookies()).get(客户页看法键)?.value;
  } catch {
    return undefined;
  }
}

/** 客户列表（/customers）第 p 页的 id：条件、范围默认、排序都照 customers/page.tsx */
export async function 客户列表取页(raw: Record<string, string>): Promise<((p: number) => Promise<一页>) | null> {
  const b = await getBusiness();
  // 企业版项目模式 ?pool=1 列表页会转去 /pool，不是这张表
  if (企业版() && b.projectMode && raw.pool === "1") return null;
  // 「看板」视图（cookie，同 page.tsx 看板视图）摆的是项目卡、不是这张客户表：不算从列表进来的
  if (企业版() && b.projectMode && !在看子集(raw) && (await 记的看法()) === "board") return null;
  const 范围组织 = 企业版() && b.projectMode ? await 权限组织() : null;
  const 管理范围 = !!范围组织 && 有管理范围(await requireUser(), 范围组织);
  const sp: 客户条件 & { sort?: string; sortCurrency?: string } = { ...raw };
  sp.scope = 范围组织 && !在看子集(sp) ? 生效客户范围(sp.scope, 管理范围) : undefined;
  const pageSize = 每页条数(raw.pageSize);
  const where = await 客户筛选条件(sp);
  const 序 = 客户排序(sp.sort);
  if ("金额" in 序) {
    let 全部: Promise<string[]> | null = null;
    return async (p) => {
      全部 ??= 金额排序ids(where, 序.金额, 规整币种(sp.sortCurrency, b.currency));
      const ids = await 全部;
      return { ids: ids.slice((p - 1) * pageSize, p * pageSize), 还有下页: ids.length > p * pageSize };
    };
  }
  return async (p) => {
    const rows = await prisma.customer.findMany({ where, orderBy: 序, skip: (p - 1) * pageSize, take: pageSize + 1, select: { id: true } });
    return { ids: rows.slice(0, pageSize).map((r) => r.id), 还有下页: rows.length > pageSize };
  };
}

/** 公海（/pool）第 p 页里点得进客户详情的那几行（客户行、按客户并起来的行）；项目行进的是项目详情，跳过 */
export async function 公海取页(raw: Record<string, string>): Promise<((p: number) => Promise<一页>) | null> {
  if (!企业版() || (await getBusiness()).projectMode !== true) return null;
  const me = await requireUser();
  const sp = raw as 公海页地址;
  const pageSize = 每页条数(sp.pageSize);
  const 筛 = 读公海页筛(sp);
  const 按名单 = 按名单of(筛);
  const 规则 = await 生效组织规则();
  return async (p) => {
    const d = await 读公海页(
      me,
      { 属性: 筛.attr, 快捷: 筛.quick, 排序: 筛.sort, keyword: 筛.keyword, 来源: 筛.channelId, 号码不全: 规则.三态.开 ? 筛.phoneIncomplete : "" },
      p,
      pageSize,
      按名单 ? { channelId: 筛.projChannel, phase: 筛.phase, createdFrom: 筛.createdFrom, createdTo: 筛.createdTo, onlyNew: 筛.onlyNew, open: 筛.open, batch: 筛.batch } : undefined,
    );
    // 越界页公海页会钳回最后一页：那不是要的这一页
    if (d.当前页 !== p) return { ids: [], 还有下页: false };
    const ids = [...new Set(d.行.filter((r) => r.种 === "客户" || r.子).map((r) => r.customerId).filter((x): x is string => !!x))];
    return { ids, 还有下页: p * pageSize < d.总数 };
  };
}
