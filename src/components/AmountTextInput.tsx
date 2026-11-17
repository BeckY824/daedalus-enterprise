"use client";

import { Input } from "antd";
import { useState, type ReactNode } from "react";
import { 认金额 } from "@/lib/money-input";

/** 认不出时框下那句（测试也用） */
export const 金额认不出话 = (原文: string) => `认不出「${原文}」：只填不小于 0 的数字，可带千分位、¥、「万」「千」`;

/**
 * AI 建议卡上的金额框（签约 / 回款，11-17 复盘第 4 类「输入被悄悄改写」）。
 * 原来 onChange 里直接删掉非数字字符：「1万」存成 1、「-500」存成 500，卡上看到的和敲的不一样，也没有一句提示。
 * 现在框里留着人敲的原文，用 认金额 认（千分位、¥、「万 / 千 / k」都认，和导入同一个）；认不出（负数、「约5万」、「面议」）
 * 就在框下说为什么，交上去的金额是 NaN —— 卡的缺项（签约 !amount、回款 !(amount > 0)）照旧把确认按钮按灰。清空 = 0（没填）
 */
export default function AmountTextInput({ value, prefix, onChange, "aria-label": ariaLabel }: {
  value: number;
  prefix?: ReactNode;
  onChange: (n: number) => void;
  "aria-label"?: string;
}) {
  const [原文, set原文] = useState<string | null>(null);
  const 显示 = 原文 ?? (value ? String(value) : "");
  const 错 = 原文 !== null && 原文.trim() !== "" && 认金额(原文) === null;
  return (
    <span className="amount-text">
      <Input
        size="small"
        className="amount-text-box"
        aria-label={ariaLabel}
        prefix={prefix}
        value={显示}
        status={错 ? "error" : undefined}
        onChange={(e) => {
          const t = e.target.value;
          set原文(t);
          const n = t.trim() ? 认金额(t) : 0;
          onChange(n === null ? Number.NaN : n);
        }}
      />
      {错 && <span className="prop-err prop-err-inline" role="alert">{金额认不出话(原文.trim())}</span>}
    </span>
  );
}
