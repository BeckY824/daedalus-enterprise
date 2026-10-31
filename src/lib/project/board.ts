/**
 * 项目列表 / 看板的读（2026-10-23，D-31）。看板按 nodes.ts 的 看板列们 分列，
 * 每列列头写项目数和金额合计，金额按币种分开不换汇（总控 10-23 定：项目不进首页统计、数据页、业绩，只在自己的看板里合计）。
 */
import { 按币种合计, type 币种合计 } from "../currency";
import { 看板列, 看板列们, type 看板列 as 列名 } from "./nodes";

export type 项目行 = {
  id: string;
  name: string;
  customerId: string;
  /** 公海里同事客户的项目不给客户名（lib/project/db.ts 露客户），领了再看 */
  customerName: string | null;
  ownerId: string;
  ownerName: string;
  phase: string;
  node: string;
  result: string | null;
  /** 异常状态时选的类别名（类别停用了也照显示）和备注 */
  exceptionCategory: string | null;
  exceptionReason: string | null;
  /** 在项目公海里（ownerId 还是放回去的人，界面写「公海」） */
  pooled: boolean;
  /** 企业版超时回收：明天（或今天）就要回到项目公海的回收日，看板 / 列表标「即将回收」；不会收 = 不带（10-27） */
  即将回收?: string | null;
  /** 企业版：这个项目的回收日 YYYY-MM-DD（列表「回公海日」列；不会收 = null）、项目上填的下一步时间 YYYY-MM-DD（没填 = null）；别的版本不给 */
  回收日?: string | null;
  下一步时间?: string | null;
  /** 企业版：被收回公海几次（放回、超时回收都算，recycle-count.ts）；别的版本不给 */
  收回次数?: number;
  /** 企业版（10-29 P6）：预计成交日期 YYYY-MM-DD（没填 = null）、已立项天数、项目来源名（项目没选跟客户来源走，都没有 = null）；别的版本不给 */
  expectedDealAt?: string | null;
  已立项天数?: number;
  项目来源?: string | null;
  /** 企业版（P11 定稿 -2 版，迁移 093）：项目级别 S / A / B / C，null = 没分级；别的版本不给 */
  level?: string | null;
  amount: number;
  currency: string;
  updatedAt: string;
};

export type 看板一列 = { 列: 列名; 数: number; 合计: 币种合计[]; 行: 项目行[] };

/** 五列都在（空的也摆出来，列头写 0），列里按最近改过的排前 */
export function 看板分列(行: 项目行[]): 看板一列[] {
  return 看板列们.map((列) => {
    const 这列 = 行.filter((r) => 看板列(r) === 列).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { 列, 数: 这列.length, 合计: 按币种合计(这列, (r) => r.amount, (r) => r.currency), 行: 这列 };
  });
}

/**
 * 企业版项目首页看板摆哪几列（U-项目-08，10-31 晚会议「看板空块默认隐藏」）：
 *   - 有项目的列在、空列默认藏起来，宽度全给有项目的列；点「显示空列」再摆回来
 *   - 五列全空（新库、筛得一个不剩）不藏：留着各列的空态说明，人知道有哪几列
 * 返回要摆的列（顺序不变）和藏了几列。
 */
export function 看板显示列(列们: 看板一列[], 显示空列: boolean): { 列: 看板一列[]; 藏了: number } {
  if (显示空列 || 列们.every((c) => c.数 === 0)) return { 列: 列们, 藏了: 0 };
  const 有 = 列们.filter((c) => c.数 > 0);
  return { 列: 有, 藏了: 列们.length - 有.length };
}
