"use client";

import { Input } from "antd";
import { useState, type ReactNode } from "react";
import { 千分位, 读金额原文, 金额认不出话 } from "@/lib/money-input";

/** 认不出时框下那句（测试也用；页面上的金额框 AmountInput 同一句） */
export { 金额认不出话 };

/**
 * AI 建议卡上的金额框（签约 / 回款，11-17 复盘第 4 类「输入被悄悄改写」）。
 * 原来 onChange 里直接删掉非数字字符：「1万」存成 1、「-500」存成 500，卡上看到的和敲的不一样，也没有一句提示。
 * 现在框里留着人敲的原文，用 认金额 认（千分位、¥、「万 / 千 / k / w」都认，和导入同一个；带单位的框下写换算后的数）；认不出（负数、「约5万」、「面议」）
 * 就在框下说为什么，交上去的金额是 NaN —— 卡的缺项（签约 !amount、回款 !(amount > 0)）照旧把确认按钮按灰。清空 = 0（没填）
 * 卡上的币种（currency）：敲的字里带的记号对不上（美元卡上敲「5000元」）也算认不出、框下说清楚（审查 11-20）
 */
export default function AmountTextInput({ value, prefix, currency, onChange, "aria-label": ariaLabel }: {
  value: number;
  prefix?: ReactNode;
  currency?: string | null;
  onChange: (n: number) => void;
  "aria-label"?: string;
}) {
  const [原文, set原文] = useState<string | null>(null);
  const 显示 = 原文 ?? (value ? String(value) : "");
  const 读 = 原文 === null ? null : 读金额原文(原文, undefined, currency);
  const 错 = 读?.类 === "错";
  // 带「万 / 千 / k / w」的：框下写换算成了多少（11-20），人一眼看得出「5万」记成了 50,000
  const 换算 = 读?.类 === "换算" ? 读.值 : null;
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
          const r = 读金额原文(t, undefined, currency);
          onChange(r.类 === "空" ? 0 : r.类 === "错" ? Number.NaN : r.值);
        }}
      />
      {读?.类 === "错" && <span className="prop-err prop-err-inline" role="alert">{读.话}</span>}
      {换算 !== null && <span className="amount-text-conv" role="status">= {千分位(换算)}</span>}
    </span>
  );
}
