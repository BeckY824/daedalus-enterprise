/**
 * 企业版客户级别只显示字母（F-客户-01，10-31 会议）：S / A / B / C 一枚字母章，不画星。
 * 项目级别、渠道星级不归这里（lib/enterprise/level-stars.ts 照旧画星）。悬停看档名，读屏念「客户级别 A 重点」
 */
import type { ReactNode } from "react";
import { 企业级别, 企业级别说明 } from "@/lib/enterprise/customer-v2";

export default function LevelLetter({ level, 空 = null }: { level: unknown; 空?: ReactNode }) {
  const 级 = 企业级别(level);
  if (!级) return <>{空}</>;
  const 读法 = `客户级别 ${企业级别说明[级]}`;
  return (
    <span className={`cust-level cust-level-${级}`} title={读法} aria-label={读法}>
      {级}
    </span>
  );
}
