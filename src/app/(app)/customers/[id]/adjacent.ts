/**
 * 客户详情「上一条 / 下一条」（E-332）：从客户列表点进详情，按进来前那张列表的条件（筛选、排序、页签、范围）找这一位的前一位、后一位。
 * 这一期只做客户列表（客户口径）；公海、项目等别的列表点进来不摆箭头。
 *
 * 不另写查询：和列表页走同一条路——默认排序时先试 query.ts 的 关键词分页（带关键词那条一句 SQL 的快路），接不住再用 客户筛选条件 + 客户排序；
 * 可见范围照列表现有的限定层（lib/prisma.ts 的限定，同列表页）。
 * 只取 id：先取这一页（多取 1 条看有没有下一页），这一位在这一页头 / 尾时再取上一页 / 下一页，跨页也对。
 * 页码照列表页钳到末页（地址上 page=99、删空了最后一页，列表摆的是末页，相邻也按末页找；给出去的 page 也是钳过的）。
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
import { 生效客户范围, 是客户范围 } from "@/lib/enterprise/customer-scope";
import { 读市场身份, 是部门市场无市场角色 } from "@/lib/enterprise/market-view-db";
import { 规整币种 } from "@/lib/currency";
import { 客户筛选条件, 客户排序, 金额排序ids, 在看子集, 关键词分页, type 客户条件 } from "../query";

export type 相邻一位 = { id: string; page: number };
export type 相邻 = { 上: 相邻一位 | null; 下: 相邻一位 | null };
/** 第 p 页的 id（按列表顺序）和后面还有没有；page = 钳过的页码（越界钳到末页，同列表页），不给就是问的那页 */
export type 一页 = { ids: string[]; 还有下页: boolean; page?: number };

/** 按页找：这一位在第 page 页的第几位；头尾跨到上一页末位 / 下一页首位（只在需要时多取一页，两边要取就一起取） */
export async function 找相邻(id: string, page: number, 取页: (p: number) => Promise<一页>): Promise<相邻 | null> {
  const 这页 = await 取页(page);
  // 跨页从钳过的那页往前后推（地址上 page=99、其实是第 3 页时，上一页是 2 不是 98）
  page = 这页.page ?? page;
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
  const me = await requireUser();
  if (企业版() && b.projectMode && !在看子集(raw)) {
    const 记 = await 记的看法();
    // 市场角色 / 被挡转来的（同 page.tsx）：/customers 摆的是「我分出去的」那套项目页，不是这张客户表
    const 市场角色 = !!(await 读市场身份(me.id));
    const 被挡转来 = !市场角色 && !!raw.hl && (await 是部门市场无市场角色(me.id));
    if ((市场角色 || 被挡转来) && !raw.new && !raw.import && (raw.hl || (!是客户范围(raw.scope) && (记 === "board" || 记 === undefined)))) return null;
    // 「看板」视图（cookie，同 page.tsx 看板视图）摆的是项目卡、不是这张客户表：不算从列表进来的
    if (!市场角色 && 记 === "board") return null;
  }
  const 范围组织 = 企业版() && b.projectMode ? await 权限组织() : null;
  const 管理范围 = !!范围组织 && 有管理范围(me, 范围组织);
  const sp: 客户条件 & { sort?: string; sortCurrency?: string } = { ...raw };
  sp.scope = 范围组织 && !在看子集(sp) ? 生效客户范围(sp.scope, 管理范围) : undefined;
  const pageSize = 每页条数(raw.pageSize);
  /** 地址上的页码钳到末页（同 page.tsx 的 Math.min(page, ceil(total / pageSize))，0 条回第 1 页） */
  const 钳 = (p: number, total: number) => Math.min(p, Math.max(1, Math.ceil(total / pageSize)));
  const 序 = 客户排序(sp.sort);
  // 条件只在用到时拼：关键词快路接住了就不跑 客户筛选条件（它里头的 客户关键词条件 先对全表跑一遍不限范围的 GLOB，10 万客户搜一次 1.6–1.9 s）
  let whereP: ReturnType<typeof 客户筛选条件> | null = null;
  const 条件 = () => (whereP ??= 客户筛选条件(sp));
  if ("金额" in 序) {
    let 全部: Promise<string[]> | null = null;
    return async (p) => {
      全部 ??= 条件().then((where) => 金额排序ids(where, 序.金额, 规整币种(sp.sortCurrency, b.currency)));
      const ids = await 全部;
      const page = 钳(p, ids.length);
      return { ids: ids.slice((page - 1) * pageSize, page * pageSize), 还有下页: ids.length > page * pageSize, page };
    };
  }
  const 慢取 = async (p: number): Promise<一页> => {
    const where = await 条件();
    const 取 = (q: number) => prisma.customer.findMany({ where, orderBy: 序, skip: (q - 1) * pageSize, take: pageSize + 1, select: { id: true } });
    let page = p;
    let rows = await 取(page);
    // 取空了又不在第 1 页：数一次，钳到末页再取
    if (!rows.length && page > 1) {
      page = 钳(page, await prisma.customer.count({ where }));
      if (page < p) rows = await 取(page);
    }
    return { ids: rows.slice(0, pageSize).map((r) => r.id), 还有下页: rows.length > pageSize, page };
  };
  // 同 page.tsx 慢路：按金额 / 等级 / 建档 / 跟进排了的不走关键词快路；其余（含没排、乱写的 sort）先试 关键词分页，和列表同一条 SQL
  let 能快 = !(sp.sort && 列表认的排序.has(sp.sort));
  return async (p) => {
    if (能快) {
      const 快 = await 关键词分页(sp, p, pageSize);
      if (快) return { ids: 快.ids, 还有下页: 快.page * pageSize < 快.total, page: 快.page };
      // 接不住只看条件（和页码无关），以后各页都走老路
      能快 = false;
    }
    return 慢取(p);
  };
}

/** 列表页（page.tsx）认的几种排序：带了这些 = 慢路，不走关键词快路 */
const 列表认的排序 = new Set(["amount-asc", "amount-desc", "level-asc", "level-desc", "created-asc", "created-desc", "follow-asc", "follow-desc"]);
