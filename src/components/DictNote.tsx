"use client";

import type { ReactNode } from "react";

/**
 * 字典下拉里每项下面一行灰色小字（10-30，客户状态、客户类型）：释义从服务端 页面释义(kind) 来（名字 → 释义）。
 * 只改下拉里的样子：选中后框里还是只显示名字（label 不动）；没释义的项照常一行。
 * 下拉宽度给 释义下拉宽，长释义折行，窄框（列表筛选 140 宽）也不会把下拉撑出屏
 */
export const 释义下拉宽 = 300;

export function 带释义(释义?: Record<string, string>) {
  if (!释义 || !Object.keys(释义).length) return undefined;
  return function 渲染(o: { label?: ReactNode; value?: unknown }): ReactNode {
    const 释 = 释义[String(o.value)];
    if (!释) return o.label;
    return (
      <div data-testid="dict-note-option">
        <div>{o.label}</div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.4, whiteSpace: "normal" }}>{释}</div>
      </div>
    );
  };
}

/** 一起给 Select 的几样：optionRender + 下拉宽（有释义才加宽；没释义的返回空对象，下拉和原来一样） */
export function 释义下拉(释义?: Record<string, string>, 宽: number | boolean = 释义下拉宽) {
  const optionRender = 带释义(释义);
  return optionRender ? { optionRender, popupMatchSelectWidth: 宽 } : {};
}

/** 客户页、客户列表、客户表单拿到的两类释义（服务端 页面客户释义） */
export type 客户字典释义 = { 状态: Record<string, string>; 类型: Record<string, string> };
