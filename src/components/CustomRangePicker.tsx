"use client";

import BusinessDatePicker from "@/components/BusinessDatePicker";
import { dayjs } from "@/lib/utils";
import { 是日期, type 日期段 } from "@/lib/custom-date-range";

/**
 * 时间预设选了「自定义」时跟在分段后面的那个日期段（V3.5.1 P-界面-10）：挑开始日、结束日，两头都算。
 * 面板的「今天」和键盘输入走业务钟（BusinessDatePicker），回出去的是 YYYY-MM-DD 两个日历日，地址栏由调用方写。
 * 不给清空：「自定义」总得有一段，不想要了点回别的预设。
 */
export default function CustomRangePicker({ 段, 改, size, className }: {
  段: 日期段;
  改: (段: 日期段) => void;
  size?: "small" | "middle";
  className?: string;
}) {
  return (
    <BusinessDatePicker.RangePicker
      className={`custom-range${className ? ` ${className}` : ""}`}
      aria-label="自定义时间段"
      size={size}
      format="YYYY-MM-DD"
      allowClear={false}
      value={[dayjs(段.from), dayjs(段.to)]}
      // 地址栏只认 2000–2099 年（lib/custom-date-range.ts），面板上也别让人点到外面去
      disabledDate={(d) => !是日期(d.format("YYYY-MM-DD"))}
      onChange={(v) => {
        const [a, b] = v ?? [];
        if (!a || !b) return;
        const 新 = { from: a.format("YYYY-MM-DD"), to: b.format("YYYY-MM-DD") };
        if (新.from !== 段.from || 新.to !== 段.to) 改(新);
      }}
    />
  );
}
