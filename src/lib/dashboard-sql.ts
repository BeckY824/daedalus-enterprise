/**
 * 裸 SQL 里按日期数数用的两个小件（盯盘清单 lib/sentinel-data.ts 在用）。
 *
 * 原来这里还有老数据看板（dashboard/Board.tsx）「数客户」「全部商机」的库里算法，
 * 看板 2026-10-28 删了（企业版只用项目，首页、数据页都不走它），只留下面两个。
 */

/**
 * 日期列取成毫秒：Prisma 写进 SQLite 的 DateTime 是整数毫秒；
 * 同步或老数据里可能是文本（ISO 串），一并换算，免得漏数或报错
 */
export const 毫秒 = (列: string) =>
  `CASE WHEN typeof(${列}) IN ('integer','real') THEN ${列} ELSE CAST(round((julianday(${列}) - 2440587.5) * 86400000) AS INTEGER) END`;

/**
 * 「t 落在第几天」：零点[j] ≤ t < 零点[j+1] 是第 j 天；早于第一个零点是 -1，晚于最后一个是最后一个的下标。
 * 二分写成嵌套 CASE，每行约 7 次整数比较
 */
export function 第几天(t: string, 零点: number[], lo = 0, hi = 零点.length): string {
  // 在 [lo, hi) 里找最后一个 ≤ t 的下标；lo 处已知 ≤ t（lo = 0 时另判 -1）
  if (hi - lo <= 1) return String(lo);
  const mid = (lo + hi) >> 1;
  return `CASE WHEN ${t} < ${零点[mid]} THEN ${第几天(t, 零点, lo, mid)} ELSE ${第几天(t, 零点, mid, hi)} END`;
}
