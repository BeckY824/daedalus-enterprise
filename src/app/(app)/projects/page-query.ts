import type { 项目筛选 } from "@/lib/project/list";

/**
 * 项目页（/projects、市场角色客户页「我分出去的」）认地址栏的那一步：首屏（board-page.tsx 项目页）和看板列底「再看」（board-actions.ts）同一份。
 * q / hl：进不了详情转过来的（projects/[id]/page.tsx 市场挡，客户 11-05）——q 当搜索词预填，hl 是要指出的那一行，不进条件。
 * 搜索框照旧认 keyword，q 只在没带 keyword 时顶上。
 * 客户：读项目列表 的内部键（客户页看板视图服务端自己给的客户条件），地址栏手写的 ?客户=… 一律剔掉，不顶掉也不进 Prisma
 */
export function 项目页筛选<T extends Record<string, unknown>>(原: T): { sp: Omit<T, "q" | "hl" | "客户"> & { keyword?: string } & 项目筛选; hl: unknown } {
  const { q, hl, 客户: _地址栏的客户, ...其余 } = 原 as T & { q?: unknown; hl?: unknown; 客户?: unknown; keyword?: string };
  const keyword = (其余 as { keyword?: string }).keyword ?? (typeof q === "string" ? q : undefined);
  return { sp: { ...(其余 as Omit<T, "q" | "hl" | "客户">), keyword } as Omit<T, "q" | "hl" | "客户"> & { keyword?: string } & 项目筛选, hl };
}
