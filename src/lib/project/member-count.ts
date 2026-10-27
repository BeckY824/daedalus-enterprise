/**
 * 设置 → 团队成员的「项目数」列（10-27 用户「改成项目数」）：企业版只用项目一条线，不再数老商机。
 * 数的是在跟的项目（没结局、不在公海），按三阶段分开说；一个都没有就是 0
 */
export const 三阶段 = ["线索", "商机", "订单"] as const;

export function 按阶段说(数: Record<string, number>): string | 0 {
  const 总 = 三阶段.reduce((a, ph) => a + (数[ph] ?? 0), 0);
  return 总 ? 三阶段.map((ph) => `${ph} ${数[ph] ?? 0}`).join(" · ") : 0;
}
