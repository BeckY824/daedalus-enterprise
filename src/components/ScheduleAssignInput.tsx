"use client";

/**
 * 「指定分配时间」一格（企业版，11-17 PR3）：现在分配 / 指定时间，选指定时间再选日期 + 时刻。只在分配方式是指定分配、自动分配时出。
 * 值：null = 现在分配；字符串 = 指定时间（北京墙钟「YYYY-MM-DD HH:mm」，"" = 还没选时刻）。最远 30 天（time-fields.ts 指定分配最远天数）。
 * 建档向导、首页 AI 新线索卡、项目详情改定时共用。窄宽度自动折行，不横滚
 */
import { Segmented } from "antd";
import DatePicker from "@/components/BusinessDatePicker";
import { dayjs } from "@/lib/utils";
import { 录入时区叫法, 指定分配最远天数 } from "@/lib/project/time-fields";

const 式 = "YYYY-MM-DD HH:mm";

/** 日历上能选的日子：今天起、最远 30 天（时刻早于现在的服务端再挡一次） */
export const 定时能选日 = (d: ReturnType<typeof dayjs>) => d.isBefore(dayjs().startOf("day")) || d.isAfter(dayjs().add(指定分配最远天数, "day").endOf("day"));

export function 定时时刻格({ value, onChange, size, autoFocus, status }: {
  value: string; onChange: (v: string) => void; size?: "small" | "middle"; autoFocus?: boolean; status?: "error";
}) {
  return (
    <DatePicker
      aria-label="指定分配时间"
      autoFocus={autoFocus}
      status={status}
      showTime={{ format: "HH:mm", minuteStep: 5 }}
      format={式}
      size={size}
      placeholder="选日期和时刻"
      disabledDate={定时能选日}
      style={{ flex: "1 1 160px", minWidth: 0, maxWidth: 200 }}
      value={value ? dayjs(value) : null}
      onChange={(d) => onChange(d ? d.format(式) : "")}
    />
  );
}

export default function ScheduleAssignInput({ value, onChange, size, status }: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  size?: "small" | "middle";
  status?: "error";
}) {
  const 定时 = typeof value === "string";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, minWidth: 0, maxWidth: "100%" }} title={`按${录入时区叫法}；到点前留在新线索待分配，最远 ${指定分配最远天数} 天`}>
      <Segmented
        size={size === "small" ? "small" : undefined}
        aria-label="分配时间"
        value={定时 ? "定时" : "现在"}
        options={[{ value: "现在", label: "现在分配" }, { value: "定时", label: "指定时间" }]}
        onChange={(v) => onChange(v === "定时" ? "" : null)}
      />
      {定时 && <定时时刻格 value={value} onChange={onChange} size={size} autoFocus status={status} />}
    </div>
  );
}
