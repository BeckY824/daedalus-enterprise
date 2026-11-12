/**
 * 客户页看板卡片上的三态小色点（C5，P-界面-19 ②）：客户三态开着时，沉睡 / 待回收 / 暂缓回收中的客户在卡片客户名后点一个色点。
 * 首屏（projects/board-page.tsx）和列底「再看」追加的那一批（customers/board-actions.ts）都走这一份：
 * 这一批卡片上看得到客户名、客户不在客户公海的，同一位客户几张卡只算一次，一次取钟（同客户表格「回收状态」一列）。
 * 不是企业版、三态关着 = undefined（不点、不查钟）；负责人是市场成员的在取钟那句里排掉（不点）
 */
import { 企业版 } from "@/lib/enterprise/switch";
import { 生效组织规则 } from "./org-rules-store";
import { 三态标们 } from "@/lib/enterprise/tri-state-list";
import type { 三态标 } from "@/lib/enterprise/tri-state-label";
import type { 项目行 } from "./board";

export async function 看板三态点(行: readonly Pick<项目行, "customerId" | "customerName" | "客户在公海">[]): Promise<Record<string, 三态标> | undefined> {
  if (!企业版()) return undefined;
  const 规则 = (await 生效组织规则()).三态;
  if (!规则.开) return undefined;
  const 看得到的 = [...new Set(行.filter((r) => r.customerName != null && !r.客户在公海).map((r) => r.customerId))];
  return 三态标们(看得到的.map((id) => ({ id, 在公海: false })), 规则);
}
