import type { Prisma } from "@/generated/prisma";
import { 客户筛选条件, 只按页签, type 客户条件 } from "./query";

/** 客户页看板认的地址栏参数：客户页那一行筛选（客户条件）+ 看板自己的阶段 / 进程 / 页码 / 每页条数 / 排序 */
export type 客户页看板地址 = 客户条件 & { phase?: string; node?: string; page?: string; pageSize?: string; sort?: string; sortCurrency?: string; triState?: string };

/**
 * 客户页看板视图的条件（11-12 第 3 批 C18）：先按这一行筛选筛出客户，再出这些客户名下我看得到的项目。
 * 首屏（page.tsx 看板体）和列底「再看」（board-actions.ts）同一份，不会一边改了一边没改。
 * 「全部回收状态」只在列表视图有（构想页 C2 画在列表上），看板不按它筛；客户的排序在看板里不起作用。除了页签什么都没筛 = 不收窄（客户 = null）
 */
export async function 客户页看板条件(sp: 客户页看板地址): Promise<{ 项目: { phase?: string; node?: string; page?: string; pageSize?: string; sort?: string }; 客户: Prisma.CustomerWhereInput | null }> {
  const { phase, node, page, pageSize, sort, sortCurrency: _币, triState: _三态, ...客户的 } = sp;
  const w = await 客户筛选条件(客户的);
  return { 项目: { phase, node, page, pageSize, sort }, 客户: 只按页签(w) ? null : w };
}
