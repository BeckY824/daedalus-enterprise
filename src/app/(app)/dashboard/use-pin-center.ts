"use client";
import { useLayoutEffect, type RefObject } from "react";

/**
 * 设计语言 H-A（11-21，H-新4）：还没问时问答卡和指标卡这一组上下居中（11-11 用户定，照留）；之后问答卡变高——
 * 输入好几行、开命令表、展开一张指标卡——不再跟着重新居中（整块往上跳），顶边钉在刚进页时的位置、往下长。
 * 变矮（清空输入、收起）就回到原位；窗口尺寸变了按那时的位置重新钉。只挪 --ck-nudge（globals.css 现状主题那段 position: relative + top），
 * 不改布局，量的是网格自己的 offsetTop（去掉已挪的那段），滚动不影响。换皮主题、问过之后不钉。
 * 人第一次在这一组里按下（点、按键）之前照常居中：刚进页时示例画进槽里、字体到了这类自己长高的，不算「跳」，不钉
 */
export function usePinCenter(网格: RefObject<HTMLDivElement | null>, 开: boolean) {
  useLayoutEffect(() => {
    const g = 网格.current;
    const 容器 = g?.parentElement;
    if (!开 || !g || !容器) return;
    let 顶 = 0;
    /* 「窗口变了」只认视口尺寸，不认 .cli-ck 自己的高：顶部有两行待办的人，问答卡多行时会把 .cli-ck 撑过 min-height
       （3704 实操 1024×768：636 → 721），原来拿容器高比，当成窗口变了重新居中、--ck-nudge 归 0，整块往上跳 */
    const 视口 = () => `${window.innerWidth}x${window.innerHeight}`;
    let 钉时视口 = "";
    let 挪 = 0;
    let 动过 = false;
    const 动了 = () => { 动过 = true; };
    const 量 = () => {
      const 原顶 = g.offsetTop - 挪;
      const v = 视口();
      // 还没人动过、窗口尺寸变了、或者变矮了回到比钉的位置还低：按现在的位置重新钉
      if (!动过 || v !== 钉时视口 || 原顶 >= 顶) {
        钉时视口 = v;
        顶 = 原顶;
      }
      const 该挪 = Math.round(顶 - 原顶);
      if (该挪 !== 挪) {
        挪 = 该挪;
        g.style.setProperty("--ck-nudge", `${挪}px`);
      }
    };
    量();
    const 看 = new ResizeObserver(量);
    看.observe(g);
    看.observe(容器);
    window.addEventListener("resize", 量);
    // 捕获阶段：里面的按钮、输入框自己拦了事件也算动过
    g.addEventListener("pointerdown", 动了, true);
    g.addEventListener("keydown", 动了, true);
    return () => {
      看.disconnect();
      window.removeEventListener("resize", 量);
      g.removeEventListener("pointerdown", 动了, true);
      g.removeEventListener("keydown", 动了, true);
      g.style.removeProperty("--ck-nudge");
    };
  }, [网格, 开]);
}
