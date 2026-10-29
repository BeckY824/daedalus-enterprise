/**
 * 企业版客户级别显示成星（2026-10-29，P13 第 5 条）：S 4 星 … C 1 星，满格 4 颗、没亮的淡色画，
 * 这样一列里每格一样宽，不跟着级别伸缩。星数和说明都从 lib/enterprise/customer-v2.ts 的 级别显示 来，这里只管画。
 * 没分级回 空（调用方给的「—」之类）。读屏念「3 星（A 重点）」，不念四个「星」字
 */
import type { ReactNode } from "react";
import { 级别显示 } from "@/lib/enterprise/customer-v2";

export default function LevelStars({ level, 空 = null }: { level: unknown; 空?: ReactNode }) {
  const 显 = 级别显示(level);
  if (!显) return <>{空}</>;
  return (
    <span className="cust-stars" title={显.读法} role="img" aria-label={显.读法}>
      {显.亮}
      {显.暗 && <span className="cust-stars-off">{显.暗}</span>}
    </span>
  );
}
