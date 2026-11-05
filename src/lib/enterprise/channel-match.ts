/**
 * 企业版 AI 建档卡从「来源」认渠道（11-05）：卡上只有来源一格，AI 常常只写平台名（「TikTok」「视频号」），
 * 而渠道名多带平台前缀（「平台｜账号」）。按下面顺序认，每一步只有对上**唯一一个**才算，对上多个不猜、交给人在卡上选：
 *   1. 来源就是某个渠道名（去首尾空格）
 *   2. 来源（去空格、忽略大小写）就是某个渠道名
 *   3. 来源里包含渠道名（原样比较，只含一个才认；含多个直接认不出）
 *   4. 竖线（全角｜、半角 |）前的平台前缀——没竖线的整个名字当前缀：来源（去空格、忽略大小写）等于前缀优先，
 *      否则看来源里包含哪些前缀
 * 停用渠道（active === false）不参与。卡片预选（components/ProposalCard.tsx）和确认落库（dashboard/apply.ts）共用。
 * 纯函数，客户端组件也 import。
 */
export type 认渠道结果<T> = { 渠道: T; 候选: T[] } | { 渠道: null; 候选: T[] };

const 规整 = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const 前缀 = (name: string) => 规整(name.split(/[｜|]/)[0] ?? "");

export function 认渠道<T extends { name: string; active?: boolean }>(来源: string, 渠道们: readonly T[]): 认渠道结果<T> {
  const 源 = 来源.trim();
  const 启用 = 渠道们.filter((c) => c.active !== false && c.name.trim());
  if (!源) return { 渠道: null, 候选: [] };
  const 唯一 = (xs: T[]): 认渠道结果<T> | null => (xs.length === 1 ? { 渠道: xs[0], 候选: xs } : xs.length > 1 ? { 渠道: null, 候选: xs } : null);

  const 整名 = 启用.find((c) => c.name.trim() === 源);
  if (整名) return { 渠道: 整名, 候选: [整名] };
  const 规源 = 规整(源);
  const 不分大小写 = 唯一(启用.filter((c) => 规整(c.name) === 规源));
  if (不分大小写) return 不分大小写;
  const 含 = 唯一(启用.filter((c) => 源.includes(c.name.trim())));
  if (含) return 含;

  const 带前缀 = 启用.map((c) => ({ c, k: 前缀(c.name) })).filter((x) => x.k);
  const 等 = 唯一(带前缀.filter((x) => x.k === 规源).map((x) => x.c));
  if (等) return 等;
  return 唯一(带前缀.filter((x) => 规源.includes(x.k)).map((x) => x.c)) ?? { 渠道: null, 候选: [] };
}

/** 认不出时报错里列候选：最多 3 个，用「、」连，多了带「等 N 个」 */
export function 候选说明(候选: readonly { name: string }[]): string {
  const 前三 = 候选.slice(0, 3).map((c) => c.name).join("、");
  return 候选.length > 3 ? `${前三}等 ${候选.length} 个` : 前三;
}
