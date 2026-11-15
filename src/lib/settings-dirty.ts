"use client";
/**
 * 设置里「改了还没存」的登记（原型 st.dirty）：各页签登记自己有几项没存，设置浮层关之前问一句。
 * 模块级的一张表就够：同一时刻只开一个设置浮层；页签卸了自动注销。
 */
import { useEffect } from "react";

const 表 = new Map<string, number>();

/** 现在一共有几项没存 */
export function 没存数(): number {
  let n = 0;
  for (const v of 表.values()) n += v;
  return n;
}

/** 全部作废（放弃改动关掉时） */
export function 清没存(): void {
  表.clear();
}

/** 页签里调：key 唯一，数 = 这一块改了几项没存（0 = 都存了） */
export function useDirtyMark(key: string, 数: number): void {
  useEffect(() => {
    if (数 > 0) 表.set(key, 数);
    else 表.delete(key);
    return () => void 表.delete(key);
  }, [key, 数]);
}
