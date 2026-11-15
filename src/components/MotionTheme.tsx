"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { 现状动效, 从样式读动效, 默认过渡, type 动效 } from "@/lib/motion";

/**
 * JS 驱动的动效跟着主题走（设置 → 外观 → 主题）。
 *
 * 主题只在样式表里换 --ease-* / --t-* 的值；motion 认不了 CSS 变量，于是这里从 <html> 上把当前值读出来，
 * 挂到 MotionConfig 的默认过渡上（默认主题是 ui 那档不回弹弹簧，换了曲线的主题照它的曲线 + --t，见 lib/motion 的 默认过渡），也经 useMotionTheme() 发给写了自己 transition 的那些组件（时间线、设置浮层、建议卡……）。
 * <html> 的 data-skin 一变（设置里点了别的主题）就重读一次，不用刷新。
 *
 * 服务端没有样式可读，用现状的值；浏览器里第一次渲染就直接读（<head> 里的预设脚本早已把 data-skin 挂好）——
 * 否则记录页时间线这类「一进来就排队出现」的动画会先按现状跑完一遍。两边不一样也不会水合出错：
 * 这些值只进 transition，不进 HTML。
 */
const 上下文 = createContext<动效>(现状动效);

export function useMotionTheme(): 动效 {
  return useContext(上下文);
}

function 读当前(): 动效 {
  const cs = getComputedStyle(document.documentElement);
  return 从样式读动效((n) => cs.getPropertyValue(n));
}

export default function MotionTheme({ children }: { children: React.ReactNode }) {
  const [值, 设值] = useState<动效>(() => (typeof document === "undefined" ? 现状动效 : 读当前()));
  useEffect(() => {
    const 看 = new MutationObserver(() => 设值(读当前()));
    看.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin", "data-paper"] });
    return () => 看.disconnect();
  }, []);
  return (
    <上下文.Provider value={值}>
      {/*
        reducedMotion="user" —— 系统开了「减弱动态效果」，**所有 motion 组件不再位移、缩放**。
          globals.css 末尾那条 @media 只管 CSS 的 transition/animation，管不到 JS 驱动的值。
          主题换不掉这一条：它挂在这里，和主题读出来的值无关。
          motion 的 "user" 只把位移、缩放、旋转、布局动画直接跳到位，透明度、颜色照常过渡——正是 P-界面-38 的「减弱动态只留透明度」
          （tests/motion-reduced.ui.test.ts 用真浏览器钉着）。
        transition —— 没写 transition 的 motion 组件：默认主题走弹簧（不回弹），别的主题走它那条曲线和 --t。
      */}
      <MotionConfig reducedMotion="user" transition={默认过渡(值)}>
        {children}
      </MotionConfig>
    </上下文.Provider>
  );
}
