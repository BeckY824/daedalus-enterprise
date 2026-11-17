"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Select } from "antd";
import { 沟通方式选项, 发起主体选项, 我常用的沟通方式 } from "@/app/(app)/follow-method-actions";
import type { 一条方式 } from "@/lib/follow-habit";
import { 方式对类型, 补的方式, 对得上的方式 } from "@/lib/follow-method";

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

/**
 * 这个人的习惯方式（11-17，lib/follow-habit.ts）：记沟通的框每次打开问一次（刚记完一条，下次就算上了）。
 * undefined = 还在问；null = 没有记录 / 没问到（照原来的默认）
 */
export function useFollowHabit(要: boolean = true): 一条方式 | null | undefined {
  const [习惯, set习惯] = useState<一条方式 | null | undefined>(要 ? undefined : null);
  useEffect(() => {
    if (!要) return;
    let 作废 = false;
    我常用的沟通方式().then((r) => { if (!作废) set习惯(r); }, () => { if (!作废) set习惯(null); });
    return () => { 作废 = true; };
  }, [要]);
  return 习惯;
}

/**
 * 新记一条沟通的默认方式按个人习惯（11-18 再接 5 处：首页待办「记一条沟通」、建档向导首条沟通、线索转项目、完成计划、AI 卡在服务端另接）。
 * 要 = 这次该问（新记的；带回了草稿、计划自己写了方式的不问）。习惯问到了、人还没在下拉里改过，才 填 一次；
 * 返回 人改了：下拉 onChange 里调，之后晚到的习惯不再盖人选的。没有记录（null）不填，照各处原来的默认
 */
export function useHabitDefault(要: boolean, 填: (x: 一条方式) => void): () => void {
  const 习惯 = useFollowHabit(要);
  const 改过 = useRef(false);
  const 填过 = useRef(false);
  const 填的 = useRef(填);
  useEffect(() => { 填的.current = 填; });
  useEffect(() => {
    if (!要 || !习惯 || 改过.current || 填过.current) return;
    填过.current = true;
    填的.current(习惯);
  }, [要, 习惯]);
  return useCallback(() => { 改过.current = true; }, []);
}

// 发起主体同上，一页取一次
let 取主体: Promise<string[] | null> | null = null;

/** 企业版发起主体的启用项（11-01）；不是企业版 / 没取到是 null（表单不摆这一格，服务端也不写） */
export function useFollowInitiators(): string[] | null {
  const [们, set们] = useState<string[] | null>(null);
  useEffect(() => {
    let 作废 = false;
    取主体 ??= 发起主体选项().catch(() => { 取主体 = null; return null; });
    取主体.then((r) => { if (!作废) set们(r); });
    return () => { 作废 = true; };
  }, []);
  return 们;
}

/** 新记沟通的默认（11-01 客户答复 #2）：沟通方式「微信沟通」、发起主体「我方发起」——字典里停用了就不默认 */
export const 默认沟通方式 = "微信沟通";
export const 默认发起主体 = "我方发起";

/** 发起主体下拉：老记录的值已经停用的，补上它自己，不改就原样存回 */
export function InitiatorSelect({ value, onChange, 们, style, "aria-label": ariaLabel = "发起主体" }: {
  value?: string | null;
  onChange?: (v: string) => void;
  们: string[];
  style?: React.CSSProperties;
  "aria-label"?: string;
}) {
  const 项 = value && !们.includes(value) ? [...们, value] : 们;
  return <Select aria-label={ariaLabel} style={style} placeholder="选发起主体" value={value ?? undefined} options={项.map((x) => ({ value: x, label: x }))} onChange={onChange} />;
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
  // 方式和类型对不上（AI 解析、默认 WhatsApp 只改了类型）就按类型摆；没填方式的「其他」类留空（11-17：不自动填成「其他方式」，留空就是空）
  const 待办 = 待办类.some((t) => t.value === type);
  const 现方式 = 待办 ? null : 对得上的方式(type, method) ?? 补的方式(type);
  const 方式们 = 现方式 && !们.includes(现方式) ? [...们, 现方式] : 们;
  const 值 = 现方式 ? `m:${现方式}` : 待办 ? `t:${type}` : undefined;
  return (
    <Select
      aria-label={ariaLabel}
      style={style}
      showSearch
      optionFilterProp="label"
      placeholder="—"
      value={值}
      options={[...方式们.map((m) => ({ value: `m:${m}`, label: m })), ...待办类.map((t) => ({ value: `t:${t.value}`, label: t.label }))]}
      onChange={(v: string) => onChange(v.startsWith("m:") ? { type: 方式对类型(v.slice(2)), method: v.slice(2) } : { type: v.slice(2), method: null })}
    />
  );
}
