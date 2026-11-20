"use client";

/**
 * 列表页放在本页 state 里的筛选，记在这个标签页里（和 lib/local-pref.ts 同一套读写）。
 * 单放一个文件：要 usePathname，不让只用 useLocalPref 的组件也连带依赖路由（#381 复审）
 */
import { useState } from "react";
import { usePathname } from "next/navigation";
import { 带人, 进来可还原 } from "./list-return";
import { usePref, 删 } from "./local-pref";

/**
 * 列表页放在本页 state 里的筛选（联系人的关系 / 负责人、渠道的属性 / 状态、跟进的范围……）：
 * 进客户详情再回来、浏览器后退、刷新都还在（29R 推广，11-20 用户「之前筛选栏的保持，对其他页面也一样」）；
 * 从左栏、首页点进来回默认，和客户列表一样（#381 审查，判定见 lib/list-return.ts 进来可还原）。
 * 记在 sessionStorage，键按人分（带人）；key 要以 list-keep: 开头（退出时按前缀清）。
 * fallback 要是稳定的值（字面量），读到坏数据也回它
 */
export function useListKeep<T>(key: string, fallback: T): [T, (v: T) => void] {
  // 路径用 usePathname：渲染这一下 window.location 可能还是上一页（Next 提交阶段才改地址栏，#381 复审）
  const pathname = usePathname() ?? "";
  const 键 = 带人(key);
  /*
    挂上那一下、以及同一次挂载里 key 换了（跟进计划 ?scope 切到全员，键换成 scope-all）都判一次：
    不是「回来」就把这个键记的扔掉、回默认。在渲染里判（先于下面读），第一帧就是默认、不闪；判过的键记在 state 里，不重复删
  */
  const [判过, set判过] = useState<string | null>(null);
  if (判过 !== 键) {
    if (typeof window !== "undefined" && !进来可还原(pathname)) 删("session", 键);
    set判过(键);
  }
  return usePref("session", 键, fallback);
}
