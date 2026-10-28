import { 按币种合计, type 币种合计 } from "@/lib/currency";
import type { 订单行 } from "@/lib/order-db";

/**
 * 订单一览的顺序、表头那一行合计、企业版的服务端分页（2026-10-25 企业版压测）。不碰数据库，客户端和服务端都能引。
 *
 * 原来整张单子（企业版 10 倍数据 2000 单）全发到浏览器，在浏览器里排序、分页、算合计：整页 HTML 1.4 MB，30 人同时开 p95 1.9 秒。
 * 库只要 40 毫秒，慢在发。现在企业版超过 分页起 单时，服务端照原来的算法排好、算好合计，只发当前这一页；
 * 不到 分页起 单、不是企业版：照原来全发、浏览器里排，一样都不变。
 *
 * 两边用的是同一份函数（顺序、比较、合计），所以分页以后：
 *   - 列头合计、条数：算的还是全部筛选结果，和原来一样
 *   - 翻到底：每一单出现一次、先后和原来浏览器里看到的一样（排序列也一样，antd 的稳定排序、降序取反）
 */

/** 企业版超过这么多单才分页（个人版、团队版、企业版少量数据都不变） */
export const 分页起 = 200;

/** 能点的排序只有「订单确认时间」（节点版的「超期」2026-10-28 随订单节点一起删了）。比较函数就是原来写在列上的那个 */
export const 订单比较 = {
  confirmed: (a: 订单行, b: 订单行) => a.confirmedAt.localeCompare(b.confirmedAt),
};
export type 订单排序 = "" | `${keyof typeof 订单比较}-${"asc" | "desc"}`;

/** 网址里的 sort：只认一览上有的那一列，别的当没排 */
export function 读订单排序(raw: string | undefined): 订单排序 {
  return raw === "confirmed-asc" || raw === "confirmed-desc" ? raw : "";
}

/** 没点排序时的先后：新确认的在前 */
export function 一览顺序(rows: 订单行[]): 订单行[] {
  return [...rows].sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
}

/** 点了排序：和 antd 表格在浏览器里排的一样——在上面那个顺序上稳定排序，降序把比较结果取反（同值的保持原先后） */
export function 按列排(rows: 订单行[], sort: 订单排序): 订单行[] {
  if (!sort) return rows;
  const [键, 向] = sort.split("-") as [keyof typeof 订单比较, "asc" | "desc"];
  const 比 = 订单比较[键];
  return [...rows].sort((a, b) => {
    const r = 比(a, b);
    return r === 0 ? 0 : 向 === "asc" ? r : -r;
  });
}

export type 订单汇总 = {
  单: number;
  金额: 币种合计[];
};

export function 算汇总(rows: 订单行[]): 订单汇总 {
  return {
    单: rows.length,
    金额: 按币种合计(rows, (r) => r.amount, (r) => r.currency),
  };
}

export type 订单分页 = { 页: number; 每页: number; 总数: number; sort: 订单排序; 汇总: 订单汇总 };

/** 服务端：全部筛选结果 → 当前这一页 + 全部的合计。页码超了就落在最后一页 */
export function 切订单页(
  rows: 订单行[],
  o: { sort?: string; page?: string; pageSize?: string },
): { rows: 订单行[]; 分页: 订单分页 } {
  const 正整数 = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : fallback;
  };
  const 每页 = Math.min(100, Math.max(10, 正整数(o.pageSize, 20)));
  const 页 = Math.min(正整数(o.page, 1), Math.max(1, Math.ceil(rows.length / 每页)));
  const sort = 读订单排序(o.sort);
  const 排好 = 按列排(一览顺序(rows), sort);
  return {
    rows: 排好.slice((页 - 1) * 每页, 页 * 每页),
    分页: { 页, 每页, 总数: rows.length, sort, 汇总: 算汇总(rows) },
  };
}
