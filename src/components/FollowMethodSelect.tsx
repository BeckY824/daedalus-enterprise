"use client";

import { useEffect, useState } from "react";
import { Select } from "antd";
import { 沟通方式选项 } from "@/app/(app)/follow-method-actions";
import { 方式对类型, 类型对方式, 对得上的方式 } from "@/lib/follow-method";

// 一页只取一次：几张表单共用，管理员改了字典刷新页面就是新的；取失败下次再取
let 取着: Promise<string[] | null> | null = null;

/** 企业版沟通方式的启用项；没取到 / 不是企业版是 null（表单照旧用类型下拉，服务端按类型补方式） */
export function useFollowMethods(): string[] | null {
  const [们, set们] = useState<string[] | null>(null);
  useEffect(() => {
    let 作废 = false;
    取着 ??= 沟通方式选项().catch(() => { 取着 = null; return null; });
    取着.then((r) => { if (!作废) set们(r); });
    return () => { 作废 = true; };
  }, []);
  return 们;
}

export type 方式和类型 = { type: string; method: string | null };

/**
 * 记沟通的「沟通方式」下拉（10-31）：企业版列字典里的 19 种（存 method，类型跟着推出来，提醒 / 统计照旧按类型），
 * 类型们里带了待办 / 提醒的照样能选；别的版本就是原来的类型下拉。
 * 老数据的方式已经停用、或只有类型没有方式的，下拉里补上它自己，不改就原样存回
 */
export default function FollowMethodSelect({ type, method, 类型们, onChange, style, "aria-label": ariaLabel }: {
  type: string;
  method?: string | null;
  类型们: readonly { value: string; label: string }[];
  onChange: (v: 方式和类型) => void;
  style?: React.CSSProperties;
  "aria-label"?: string;
}) {
  const 们 = useFollowMethods();
  if (!们) {
    return <Select aria-label={ariaLabel} style={style} value={type} options={类型们.map((t) => ({ value: t.value, label: t.label }))} onChange={(t: string) => onChange({ type: t, method: null })} />;
  }
  const 待办类 = 类型们.filter((t) => t.value === "TASK" || t.value === "REMIND");
  // 方式和类型对不上（AI 解析、默认 WhatsApp 只改了类型）就按类型摆
  const 现方式 = 待办类.some((t) => t.value === type) ? null : 对得上的方式(type, method) ?? 类型对方式(type);
  const 方式们 = 现方式 && !们.includes(现方式) ? [...们, 现方式] : 们;
  const 值 = 现方式 ? `m:${现方式}` : `t:${type}`;
  return (
    <Select
      aria-label={ariaLabel}
      style={style}
      showSearch
      optionFilterProp="label"
      value={值}
      options={[...方式们.map((m) => ({ value: `m:${m}`, label: m })), ...待办类.map((t) => ({ value: `t:${t.value}`, label: t.label }))]}
      onChange={(v: string) => onChange(v.startsWith("m:") ? { type: 方式对类型(v.slice(2)), method: v.slice(2) } : { type: v.slice(2), method: null })}
    />
  );
}
