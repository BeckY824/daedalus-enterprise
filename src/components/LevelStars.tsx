/**
 * 企业版客户级别徽标。10-31 会议（F-客户-01）：去掉星标，只显示字母 S / A / B / C（定宽小方块，一列里对得齐）。
 * 组件名、用法照旧（<LevelStars level=… 空=… />），调用的地方不用改。
 * 字母和说明从 lib/enterprise/customer-v2.ts 的 级别显示 来（老数据的 D 当 C），这里只管画。
 * 没分级回 空（调用方给的「—」之类）。悬停、读屏给档名「A 重点」
 */
import type { ReactNode } from "react";
import { 级别显示 } from "@/lib/enterprise/customer-v2";

export default function LevelStars({ level, 空 = null }: { level: unknown; 空?: ReactNode }) {
  const 显 = 级别显示(level);
  if (!显) return <>{空}</>;
  return (
    <span className={`cust-level cust-level-${显.级}`} title={显.读法} role="img" aria-label={`客户级别 ${显.读法}`}>
      {显.级}
    </span>
  );
}
