/**
 * 公海表格里哪几行底下要摆「行下确认条 / 没领到的原因」（现状主题，设计语言 G-A · K4）：表格展开行的 key。
 * - 正在问的那一行（问着）排第一，其后是有没领到原因的行；客户池并成一行的（不在 顶行 里）不算，它们展开的是子列表
 * - 已经领走 / 分出去的（走的）不摆：确认条对它们画出来是空的，批量领成功后会闪一条空灰行（G-A 审查）
 */
export function 确认条行们({ 新样, 问着, 行错, 走的, 顶行 }: {
  新样: boolean;
  问着: string | null;
  行错: Record<string, string>;
  走的: Record<string, string>;
  顶行: Set<string>;
}): string[] {
  if (!新样) return [];
  return [...(问着 && 顶行.has(问着) ? [问着] : []), ...Object.keys(行错).filter((id) => 顶行.has(id) && id !== 问着)]
    .filter((id) => !走的[id]);
}
