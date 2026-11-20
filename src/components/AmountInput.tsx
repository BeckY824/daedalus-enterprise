"use client";

import { InputNumber, Tooltip, type InputNumberProps } from "antd";
import { useEffect, useRef, useState } from "react";
import { 千分位, 读金额原文, 金额格式 } from "@/lib/money-input";

/** 表单校验、保存挡住时说的那句（框上悬停 / 聚焦时另有带原文的那句） */
export const 金额框认不出提示 = "金额认不出：只填不小于 0 的数字，可带千分位、¥、万 / 千 / k / w";

/** 金额框交上来的 NaN = 敲了认不出的字：保存要挡住 */
export const 金额认不出 = (v: unknown): boolean => typeof v === "number" && Number.isNaN(v);

type 透传 = Omit<InputNumberProps<number>, "value" | "defaultValue" | "onChange" | "formatter" | "parser" | "stringMode" | "suffix">;

/**
 * 页面上的金额框（11-20）：项目卡就地改、编辑项目、补必填、提成、回款、渠道投入共用。
 *
 * 原来直接用 antd InputNumber：它默认的 parser 把非 \w 的字删掉，「5万」「12.5万」悄悄存成 5、12.5；
 * 「3w」认不出就停在敲到一半的 3，失焦后框里也变回 3；「-500」失焦被压成 0 —— 都没有一句提示（no-silent-input-rewrite 第 1 类）。
 * 现在用 认金额（和导入、AI 卡同一个）认：
 * - 认得出：带「万 / 千 / k / w / 亿」的，敲的时候框上方浮一句「「12.5万」= 125,000」，失焦后框里就是换算后的数（千分位）；
 * - 认不出（负数、「约5万」「5万5」、超上限）：框标红，聚焦 / 悬停时框上方说为什么；失焦后框里空着、占位写「认不出「…」」；
 *   交上去的是 NaN，各处保存按 金额认不出 挡住（表单走校验），绝不把敲到一半的数或上一个数当成人要的。清空 = null（没填）。
 * 提示浮在框上方、不放进框里：项目卡就地改的金额框连币种只有一百来宽，放框里会把敲的字挤没（11-20 生产构建实量）。
 * 拼音输入（敲 wan 选「万」）中途不判，选完再认。
 * currency = 旁边选的币种（审查 11-20）：敲的字里带了币种记号（「5000元」「USD 5000」「¥5万」）又和选的对不上，算认不出、说清楚，
 *   不悄悄按选的币种存；改了币种对上了就照常认。没写记号的照常按选的币种。
 */
export default function AmountInput({
  value, onChange, onInput, onFocus, onBlur, onCompositionStart, onCompositionEnd, onMouseEnter, onMouseLeave, max, status, currency, ...rest
}: 透传 & { value?: number | null; onChange?: (v: number | null) => void; currency?: string | null }) {
  const [原文, set原文] = useState<string | null>(null);
  const [聚焦, set聚焦] = useState(false);
  const [悬停, set悬停] = useState(false);
  const 拼 = useRef(false);
  const 上限 = typeof max === "number" ? max : undefined;
  const 错 = 金额认不出(value);
  const 读 = 原文 === null ? null : 读金额原文(原文, 上限, currency);
  const 话 = 错 ? (读?.类 === "错" ? 读.话 : 金额框认不出提示) : null;
  const 换算 = !错 && 读?.类 === "换算" && 读.值 === value ? 读.值 : null;
  // 认不出的说为什么（聚焦、悬停都出）；换算只在敲的时候出
  const 浮 = 话 ?? (换算 !== null && 原文 ? `「${原文.trim()}」= ${千分位(换算)}` : null);
  const 浮着 = 话 ? 聚焦 || 悬停 : 聚焦 && !!浮;

  /** 敲的每一下（拼音选完那一下也算）：认不出就交 NaN；认不出之后清空交 null。认得出的由 InputNumber 自己交数 */
  const 收 = (s: string) => {
    if (拼.current) return;
    set原文(s);
    const r = 读金额原文(s, 上限, currency);
    if (r.类 === "错") {
      if (!错) onChange?.(Number.NaN);
    } else if (r.类 === "空" && 错) onChange?.(null);
  };

  /*
    敲完再改币种：框里还留着认不出的原文就按新币种重认一遍——「5000元」配美元认不出，币种改成人民币就交 5000。
    认得出的失焦后原文已清、框里是数，之后改币种是人明着改的，照新币种存
  */
  const 上回币 = useRef(currency);
  useEffect(() => {
    if (上回币.current === currency) return;
    上回币.current = currency;
    if (原文 === null || 拼.current) return;
    const r = 读金额原文(原文, 上限, currency);
    if (r.类 === "错") {
      if (!错) onChange?.(Number.NaN);
    } else if (r.类 !== "空" && 错) onChange?.(r.值);
  }, [currency, 原文, 上限, 错, onChange]);

  return (
    <Tooltip open={浮着} title={浮}>
      <InputNumber<number>
        {...rest}
        max={max}
        // 认不出时 InputNumber 那边当空：失焦不会拿 min / max 把它压成 0 或上限
        value={错 ? null : value}
        formatter={金额格式}
        parser={(s) => {
          const r = 读金额原文(s ?? "", 上限, currency);
          return (r.类 === "空" ? "" : r.类 === "错" ? "NaN" : String(r.值)) as unknown as number;
        }}
        status={错 ? "error" : status}
        // 失焦后框里空着：占位直接写认不出的原文，不悬停也看得到
        placeholder={错 && 原文?.trim() ? `认不出「${原文.trim()}」` : rest.placeholder}
        onChange={(v) => onChange?.(v ?? null)}
        onInput={(s) => {
          onInput?.(s);
          收(s);
        }}
        onCompositionStart={(e) => {
          拼.current = true;
          onCompositionStart?.(e);
        }}
        onCompositionEnd={(e) => {
          拼.current = false;
          onCompositionEnd?.(e);
        }}
        onFocus={(e) => {
          set聚焦(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          set聚焦(false);
          // 认得出的失焦后框里已经是换算后的数，不再挂「= …」；认不出的留着原文好说为什么
          if (!错) set原文(null);
          onBlur?.(e);
        }}
        onMouseEnter={(e) => {
          set悬停(true);
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          set悬停(false);
          onMouseLeave?.(e);
        }}
      />
    </Tooltip>
  );
}
