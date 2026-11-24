/**
 * 首页 AI 卡确认之后，落印（「已写入 HH:mm」）下面那几行回执（E-259）：
 *   - 推进：写进去时顺带按必填把项目推了一格，推到哪（apply 回的 推进，11-20）
 *   - 提示：这条沟通不算有效沟通（太短 / 只有链接 / 占位词，文案在 lib/enterprise/tri-state-quota.ts 的 超时短沟通话 / 短沟通话）
 * 两个都有就两行都出；落印那格已经写了「已写入」，提示开头的「已保存。」去掉，不说两遍；提示和推进说的是同一句就只出一行。
 *
 * 独立成文件、不引 prisma：在浏览器里跑（ProposalCard），也好写纯函数用例。
 */
export type 落印行 = { 种: "推进" | "提示"; 话: string; testid: "prop-done-push" | "prop-done-hint" };

export function 落印行们(回执: { 推进?: string | null; 提示?: string | null } | null | undefined): 落印行[] {
  if (!回执) return [];
  const 推进 = (回执.推进 ?? "").trim();
  const 提示 = (回执.提示 ?? "").trim().replace(/^已保存。/u, "").trim();
  const 行: 落印行[] = [];
  if (推进) 行.push({ 种: "推进", 话: 推进, testid: "prop-done-push" });
  if (提示 && !推进.includes(提示)) 行.push({ 种: "提示", 话: 提示, testid: "prop-done-hint" });
  return 行;
}
