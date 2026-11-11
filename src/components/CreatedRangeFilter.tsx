"use client";

import type { CSSProperties } from "react";
import BusinessDatePicker from "@/components/BusinessDatePicker";
import { dayjs } from "@/lib/utils";
import { 是日期 } from "@/lib/custom-date-range";

/**
 * 列表「创建时间」筛选（11-11 客户、项目列表，P-界面-12 自选筛选里的一项）：挑开始日、结束日，两头都算，可以只填一头、可以清空。
 * 面板的「今天」和键盘输入走业务钟（企业版北京日），回出去的是 YYYY-MM-DD，地址栏 createdFrom / createdTo 由调用方写；
 * 服务端按 lib/custom-date-range.ts 创建时间段 换成北京日的 00:00 到 23:59:59.999
 */
export default function CreatedRangeFilter({ from, to, 改, style }: {
  from: string;
  to: string;
  改: (段: { createdFrom: string; createdTo: string }) => void;
  style?: CSSProperties;
}) {
  return (
    <BusinessDatePicker.RangePicker
      style={style}
      aria-label="创建时间"
      placeholder={["创建时间起", "创建时间止"]}
      format="YYYY-MM-DD"
      allowEmpty={[true, true]}
      value={[是日期(from) ? dayjs(from) : null, 是日期(to) ? dayjs(to) : null]}
      // 地址栏只认 2000–2099 年（lib/custom-date-range.ts 是日期），面板上也别让人点到外面去
      disabledDate={(d) => !是日期(d.format("YYYY-MM-DD"))}
      onChange={(v) => {
        const [a, b] = v ?? [];
        改({ createdFrom: a ? a.format("YYYY-MM-DD") : "", createdTo: b ? b.format("YYYY-MM-DD") : "" });
      }}
    />
  );
}
