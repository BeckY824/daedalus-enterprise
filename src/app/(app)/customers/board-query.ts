import type { Prisma } from "@/generated/prisma";
import { 客户筛选条件, 只按页签, type 客户条件 } from "./query";
import { 仅项目安全条件, 仅项目筛选口径 } from "@/lib/enterprise/project-only-customers";

/** 客户页看板认的地址栏参数：客户页那一行筛选（客户条件）+ 看板自己的阶段 / 进程 / 页码 / 每页条数 / 排序 */
export type 客户页看板地址 = 客户条件 & { phase?: string; node?: string; page?: string; pageSize?: string; sort?: string; sortCurrency?: string; triState?: string };

/**
 * 客户页看板视图的条件（11-12 第 3 批 C18）：先按这一行筛选筛出客户，再出这些客户名下我看得到的项目。
 * 首屏（page.tsx 看板体）和列底「再看」（board-actions.ts）同一份，不会一边改了一边没改。
 * 「全部回收状态」只在列表视图有（构想页 C2 画在列表上），看板不按它筛；客户的排序在看板里不起作用。除了页签什么都没筛 = 不收窄（客户 = null）
 */
export async function 客户页看板条件(sp: 客户页看板地址): Promise<{ 项目: { phase?: string; node?: string; page?: string; pageSize?: string; sort?: string }; 客户: Prisma.CustomerWhereInput | null; 仅项目客户: Prisma.CustomerWhereInput | null }> {
  const { phase, node, page, pageSize, sort, sortCurrency: _币, triState: _三态, ...客户的 } = sp;
  const w = await 客户筛选条件(客户的);
  // 只负责项目的人（project-only-customers.ts）：筛了客户时，他看不到的那几位客户只按白名单条件参与（防拿号码、级别反推），
  // 作为 仅项目客户 显式带给 列表条件（page.tsx 看板体 → 项目页 → 读项目列表；board-actions.ts 同）；没筛（客户 = null）不收窄，他自己的项目卡照常在
  // 只拿客户条件登记过的键（new、paste 这类界面开关 客户筛选条件 本来就不认，不该让这类行消失）
  const 仅项目 = 仅项目安全条件(Object.fromEntries(Object.entries(客户的).filter(([k]) => k in 仅项目筛选口径)));
  return { 项目: { phase, node, page, pageSize, sort }, 客户: 只按页签(w) ? null : w, 仅项目客户: 仅项目 };
}
