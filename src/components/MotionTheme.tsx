"use client";

import { MotionConfig } from "motion/react";
import { 现状动效, 默认过渡, type 动效 } from "@/lib/motion";

/**
 * JS 驱动的动效：曲线、时长、排队间隔都是 lib/motion 的常量（和 globals.css 的 --ease-* / --t-* 一一对应，
 * tests/motion-tokens.test.ts 对着）。写了自己 transition 的组件（时间线、设置浮层、建议卡……）经 useMotionTheme() 取。
 */
export function useMotionTheme(): 动效 {
  return 现状动效;
}

export default function MotionTheme({ children }: { children: React.ReactNode }) {
  return (
    /*
      reducedMotion="user" —— 系统开了「减弱动态效果」，**所有 motion 组件不再位移、缩放**。
        globals.css 末尾那条 @media 只管 CSS 的 transition/animation，管不到 JS 驱动的值。
        motion 的 "user" 只把位移、缩放、旋转、布局动画直接跳到位，透明度、颜色照常过渡——正是 P-界面-38 的「减弱动态只留透明度」
        （tests/motion-reduced.ui.test.ts 用真浏览器钉着）。
      transition —— 没写 transition 的 motion 组件走 ui 那档弹簧（不回弹）。
    */
    <MotionConfig reducedMotion="user" transition={默认过渡}>
      {children}
    </MotionConfig>
  );
}
