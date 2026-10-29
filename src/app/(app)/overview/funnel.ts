/**
 * 复盘页的全周期项目漏斗（定稿 #15、待 4：线索 → 商机 → 订单 → 交付）。
 *
 * 口径（同一批项目往下数，不是四个事件各数各的）：
 *   线索 = 这批项目全部（项目都从线索阶段起建）
 *   商机 = 走到了商机或更后面（phase 是商机 / 订单）
 *   订单 = 走到了订单（phase 是订单）
 *   交付 = 结局是成功交付
 * 「这批」由调用方给：现在 = 看得到的全部项目；本月 / 本年 = 这一段新建的项目（和「新建项目」卡同一个 createdAt）。
 * 丢单留在商机阶段、线索流失留在线索阶段、异常状态留在订单阶段，所以它们照样算走到了自己那一段。
 * 转化率 = 本段 / 上一段；上一段是 0 时没有转化率（null），第一段也是 null。
 * 看得到哪些项目不在这里管：查库那层（lib/team-scope）已经按人限定了。
 */

export const 漏斗段们 = ["线索", "商机", "订单", "交付"] as const;
export type 漏斗段 = (typeof 漏斗段们)[number];
export type 漏斗格 = { 段: 漏斗段; count: number; 转化率: number | null };

export function 项目漏斗of(rows: readonly { phase: string; result: string | null }[]): 漏斗格[] {
  const 数 = [
    rows.length,
    rows.filter((p) => p.phase === "商机" || p.phase === "订单").length,
    rows.filter((p) => p.phase === "订单").length,
    rows.filter((p) => p.result === "成功交付").length,
  ];
  return 漏斗段们.map((段, i) => ({ 段, count: 数[i], 转化率: i === 0 || 数[i - 1] === 0 ? null : 数[i] / 数[i - 1] }));
}

/** 转化率写成人话：null 写「—」；整数百分比，不到 1% 但不是 0 的写「<1%」 */
export function 转化率字(r: number | null): string {
  if (r == null) return "—";
  if (r > 0 && r < 0.01) return "<1%";
  return `${Math.round(r * 100)}%`;
}
