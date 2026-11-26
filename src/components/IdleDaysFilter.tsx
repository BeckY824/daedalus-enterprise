"use client";

import { useState, type CSSProperties } from "react";
import { InputNumber } from "antd";
import FilterSelect from "@/components/FilterSelect";

/** 选了它就换成填天数的框（不是真的天数，不会写进地址栏） */
const 自定义 = "__custom";

/**
 * 客户列表「超过 N 天没跟进」筛选（员工反馈 1I，11-16，原话「可统一设定时间」）：常用天数直接选；
 * 选「自定义天数…」换成一个填天数的框（1–3650 的整数），回车或点开别处就筛，Esc 或空着点开别处回到下拉。
 * 常收在「更多筛选」弹层里，和手机号筛选一样不边打边筛（components/PhoneFilter.tsx）。地址栏 idleDays= 由调用方写，口径见 customers/query.ts
 */
export default function IdleDaysFilter({ value, 天数们, 改, style }: { value: string; 天数们: string[]; 改: (v: string) => void; style?: CSSProperties }) {
  const [填, set填] = useState(false);
  const [草稿, set草稿] = useState<number | null>(null);
  const 交 = () => {
    set填(false);
    if (草稿 != null && Number.isInteger(草稿) && 草稿 >= 1 && 草稿 <= 3650 && String(草稿) !== value) 改(String(草稿));
  };
  if (填) {
    return (
      <InputNumber
        style={style}
        aria-label="久未跟进天数"
        placeholder="天数，回车筛"
        prefix={<span className="muted">超过</span>}
        suffix={<span className="muted">天</span>}
        min={1}
        max={3650}
        precision={0}
        autoFocus
        value={草稿}
        onChange={(v) => set草稿(typeof v === "number" ? v : null)}
        onPressEnter={交}
        onBlur={交}
        onKeyDown={(e) => { if (e.key === "Escape") { set草稿(null); set填(false); } }}
      />
    );
  }
  return (
    <FilterSelect
      style={style}
      placeholder="不限跟进时间"
      allowClear
      aria-label="久未跟进"
      popupMatchSelectWidth={false}
      value={value || undefined}
      onChange={(v?: string) => {
        if (v === 自定义) { set草稿(value ? Number(value) : null); set填(true); return; }
        改(v ?? "");
      }}
      options={[
        ...[...new Set([...天数们, ...(value ? [value] : [])])].sort((a, b) => Number(a) - Number(b)).map((d) => ({ value: d, label: `超过 ${d} 天没跟进` })),
        { value: 自定义, label: "自定义天数…" },
      ]}
    />
  );
}
