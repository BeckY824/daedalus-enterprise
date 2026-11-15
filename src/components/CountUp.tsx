"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { useMotionTheme } from "@/components/MotionTheme";
import { 默认过渡 } from "@/lib/motion";

/**
 * 从 0 滚到这个数。**只滚第一次**。
 *
 * 为什么值得有：首页那一行信号是「这一刻真查出来的」，滚一下说的就是这件事——
 * 数字是刚数出来的，不是一张贴在那儿的图。
 * 为什么只滚一次：翻回首页、切个页签就重滚一遍，第二次之后它就只是噪音了。
 * 记号相同的那一个数，这次会话里只滚一次（刷新页面重新开始，这正好——那是新的一次打开）。
 *
 * 服务端渲染出来的是**最终值**，不是 0：万一 JS 没跑起来，页面上留下的得是真的数，
 * 而不是一个永远停在 0 的谎。滚动在挂载后的同一帧里接管（useLayoutEffect），所以看不见跳。
 *
 * 2026-11 PR2 外壳（原型 g.numbers「数字滚到位、等宽，不跳宽度」）：挂着的时候数变了（筛选、刷新），
 * 从**旧值**滚到新值（ui 那档不回弹弹簧，换了曲线的主题照它的曲线 + --t），不再硬换；
 * `只滚变化` 的那种第一次不从 0 滚，直接是数——复盘、待办卡这类每次进来都看的数，从 0 滚是噪音，变了才值得动一下。
 * 等宽靠调用处的样式（font-variant-numeric: tabular-nums），滚的时候宽度不跳。
 */
const 滚过的 = new Set<string>();

/** useLayoutEffect 在服务端会告警；SSR 时退回 useEffect（那一趟本来也不跑动画） */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function CountUp({
  值,
  记号,
  格式 = (n) => String(Math.round(n)),
  时长 = 0.6,
  只滚变化 = false,
}: {
  值: number;
  /** 这个数在页面上的身份，用来记「滚过了」。比如 "signal:逾期" */
  记号: string;
  格式?: (n: number) => string;
  时长?: number;
  /** 第一次直接显示、不从 0 滚；之后数变了才从旧值滚到新值 */
  只滚变化?: boolean;
}) {
  const 动效值 = useMotionTheme();
  const { 曲线 } = 动效值;
  const 少动 = useReducedMotion();
  const [显示, set显示] = useState(值);
  /** 上一次落定的数：数变了从它滚起。null = 还没落定过（第一次挂上） */
  const 上次 = useRef<number | null>(null);
  /** 正在滚的那一段停在哪：半路又变了，从这里接着滚，不回头 */
  const 当前 = useRef(值);
  const 变化过渡 = 默认过渡(动效值);

  useIsoLayoutEffect(() => {
    const 旧 = 上次.current;
    上次.current = 值;
    if (少动) {
      set显示(值);
      当前.current = 值;
      return;
    }
    // 挂着的时候数变了：从眼前那个数滚到新数
    if (旧 !== null) {
      // 数没变、是别的依赖变了（或者开发模式下副作用重跑、把上一段滚动停在了半路）：落到终点
      if (旧 === 值) {
        set显示(值);
        当前.current = 值;
        return;
      }
      const 起 = 当前.current;
      const 控制 = animate(起, 值, {
        ...变化过渡,
        onUpdate: (n) => { 当前.current = n; set显示(n); },
        onComplete: () => { 当前.current = 值; set显示(值); },
      });
      return () => 控制.stop();
    }
    // 第一次挂上：0 没什么可滚的；滚过了、或者只滚变化的，就直接是数
    if (只滚变化 || 值 === 0 || 滚过的.has(记号)) {
      set显示(值);
      当前.current = 值;
      return;
    }
    滚过的.add(记号);
    set显示(0);
    const 控制 = animate(0, 值, {
      duration: 时长,
      ease: 曲线.ease,
      onUpdate: (n) => { 当前.current = n; set显示(n); },
      onComplete: () => { 当前.current = 值; set显示(值); },
    });
    return () => 控制.stop();
    // 变化过渡 每次渲染是新对象，跟着主题的 是弹簧 / 曲线 走就够
  }, [值, 记号, 少动, 时长, 曲线.ease, 只滚变化, 动效值.是弹簧]);

  return <>{格式(显示)}</>;
}
