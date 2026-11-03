/**
 * 企业版录回款的「少于应收」提示（11-03 A5-4）：只提示、不拦保存。
 * 应收 = 项目的合同金额减已经回的同币种回款（照现有字段；商机金额是预估，不算应收）；不换汇，录的币种和合同币种不一样就不提示。
 * 纯函数，界面在 projects/[id]/ProjectExtras.tsx 回款卡。
 */
import { 金额, 规整币种 } from "../currency";

export type 应收依据 = { 数: number | null | undefined; 币: string | null | undefined };

/** 这一笔之前还应收多少（同币种）；没依据、已经收齐了给 null */
export function 还应收(依据: 应收依据 | null | undefined, 已回: readonly { amount: number; currency: string }[]): { 数: number; 币: string } | null {
  if (!依据 || typeof 依据.数 !== "number" || !Number.isFinite(依据.数) || 依据.数 <= 0 || !依据.币) return null;
  const 币 = 规整币种(依据.币);
  const 回了 = 已回.filter((x) => 规整币种(x.currency) === 币).reduce((s, x) => s + x.amount, 0);
  // 按分算，免得 0.1+0.2 这种尾巴
  const 剩 = Math.round((依据.数 - 回了) * 100) / 100;
  return 剩 > 0 ? { 数: 剩, 币 } : null;
}

/** 录的这一笔少于还应收的就给一句「回款少于应收 ¥N」，否则 null */
export function 回款少于应收(本笔: number | null | undefined, 本笔币: string, 应收: { 数: number; 币: string } | null): string | null {
  if (!应收 || typeof 本笔 !== "number" || !(本笔 > 0)) return null;
  if (规整币种(本笔币) !== 应收.币) return null;
  return 本笔 < 应收.数 ? `回款少于应收 ${金额(应收.数, 应收.币)}` : null;
}
