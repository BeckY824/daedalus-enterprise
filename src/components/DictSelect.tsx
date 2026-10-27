"use client";

import { useEffect, useState } from "react";
import { Input, Select } from "antd";
import { 其他项, 其他补充上限, 合其他, 拆其他 } from "@/lib/enterprise/dict-kinds";

/**
 * 企业版选项字典的下拉（10-27 批注）：能搜；选了「其他」下面多一个必填的框，提交值是「其他：xxx」。
 * value / onChange 都是合好的值（见 dict-kinds.ts 合其他）；选了其他还没写时给出去的是「其他」，由调用方 / 服务端拦
 */
export default function DictSelect({
  options,
  value,
  onChange,
  placeholder,
  allowClear = true,
  style,
  "aria-label": ariaLabel,
}: {
  options: readonly string[];
  value?: string | null;
  onChange?: (v: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  style?: React.CSSProperties;
  "aria-label"?: string;
}) {
  const [s, setS] = useState(() => 拆其他(value));
  // 外面改了值（比如重新打开弹框时清空）就跟着；自己打字引起的变化不重设，免得光标跳
  useEffect(() => {
    if (value === undefined) return;
    setS((cur) => (合其他(cur.选, cur.写) === (value ?? null) ? cur : 拆其他(value)));
  }, [value]);
  const 改 = (选: string | null, 写: string) => {
    setS({ 选, 写 });
    onChange?.(合其他(选, 写));
  };
  return (
    <div style={style}>
      <Select
        style={{ width: "100%" }}
        showSearch
        optionFilterProp="label"
        allowClear={allowClear}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={s.选 ?? undefined}
        onChange={(v?: string) => 改(v ?? null, "")}
        options={options.map((x) => ({ value: x, label: x }))}
        notFoundContent="没有这一项"
      />
      {s.选 === 其他项 && (
        <Input
          style={{ marginTop: 8 }}
          autoFocus
          maxLength={其他补充上限}
          showCount
          status={s.写.trim() ? undefined : "warning"}
          placeholder="具体是什么（必填）"
          aria-label={`${ariaLabel ?? "选项"}：其他的具体内容`}
          value={s.写}
          onChange={(e) => 改(其他项, e.target.value)}
        />
      )}
    </div>
  );
}
