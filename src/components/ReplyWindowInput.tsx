"use client";

/**
 * 「指定回复时间」两格（企业版，11-17）：开始、结束，各是日期 + 时刻（到分钟），填一个也行。
 * 建档向导、客户页新增项目（同一张向导）、首页 AI 新线索卡、项目资料卡就地改共用。
 * 值是北京墙钟「YYYY-MM-DD HH:mm」（lib/project/time-fields.ts；待客户方确认：问题 3 时区）。窄宽度两格自动折成两行，不横滚
 */
import type { CSSProperties } from "react";
import DatePicker from "@/components/BusinessDatePicker";
import { dayjs } from "@/lib/utils";
import { 录入时区叫法 } from "@/lib/project/time-fields";

export type 回复两格 = { 开始: string | null; 结束: string | null };
const 式 = "YYYY-MM-DD HH:mm";
/** 行内样式写在组件外（tests/inline-style-cap.test.ts 只减不增）：窄宽度两格折成两行 */
const 格样: CSSProperties = { flex: "1 1 150px", minWidth: 0, maxWidth: 200 };
const 两格样: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, minWidth: 0, maxWidth: "100%" };
const 至样: CSSProperties = { color: "var(--text-faint)" };

export default function ReplyWindowInput({ value, onChange, disabled, size, autoFocus }: {
  value: 回复两格;
  onChange: (v: 回复两格) => void;
  disabled?: boolean;
  size?: "small" | "middle";
  autoFocus?: boolean;
}) {
  const 格 = (键: keyof 回复两格, 叫: string, 先?: boolean) => (
    <DatePicker
      aria-label={`指定回复时间${叫}`}
      autoFocus={先 && autoFocus}
      showTime={{ format: "HH:mm", minuteStep: 5 }}
      format={式}
      size={size}
      disabled={disabled}
      placeholder={`${叫}（选填）`}
      style={格样}
      value={value[键] ? dayjs(value[键]!) : null}
      onChange={(d) => onChange({ ...value, [键]: d ? d.format(式) : null })}
    />
  );
  return (
    <div style={两格样} title={`按${录入时区叫法}填；只填开始 = 那个时间前后联系，只填结束 = 那之前联系`}>
      {格("开始", "开始", true)}
      <span style={至样} aria-hidden>至</span>
      {格("结束", "结束")}
    </div>
  );
}
