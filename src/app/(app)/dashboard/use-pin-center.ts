"use client";
import { useLayoutEffect, type RefObject } from "react";

/**
 * 设计语言 H-A（11-21，H-新4）：还没问时问答卡和指标卡这一组上下居中（11-11 用户定，照留）；之后问答卡变高——
 * 输入好几行、开命令表、展开一张指标卡——不再跟着重新居中（整块往上跳），顶边钉在刚进页时的位置、往下长。
 * 变矮（清空输入、收起）就回到原位；窗口尺寸变了按那时的位置重新钉。只挪 --ck-nudge（globals.css 现状主题那段 position: relative + top），
 * 不改布局，量的是网格相对外层 .cli-ck 的位置（去掉已挪的那段），滚动、外面整体挪都不影响。换皮主题、问过之后不钉。
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
    /*
      量的是这一组相对外层 .cli-ck 上沿的位置（去掉已挪的那段），不是 offsetTop（#408 审查 + 3704 实操，11-22）：
      进页后这一组还会整体挪——换页淡入那层 motion.div 的 transform 收掉时 offsetParent 跟着变、offsetTop 一下差出正文内边距；
      正文上方晚挂一条提示——它自己和外层尺寸都没变，尺寸监听不触发，「顶」就过期了。第一次点开指标卡时原顶 ≥ 旧「顶」，
      走了「重新钉」，--ck-nudge 归 0，整块上移半个增量（销售 1024、1 行待办 19px）。相对外层量，外面怎么挪都不算
    */
    const 现顶 = () => g.getBoundingClientRect().top - 容器.getBoundingClientRect().top - 挪;
    const 动了 = () => {
      if (动过) return;
      // 第一次动：此刻还没改状态（捕获阶段，早于 React），先按现在的位置和视口钉一次，再算动过
      顶 = 现顶();
      钉时视口 = 视口();
      动过 = true;
    };
    const 量 = () => {
      const 原顶 = 现顶();
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
    /*
      捕获阶段：里面的按钮、输入框自己拦了事件也算动过。
      只认 pointerdown / keydown 不够（3703 补点 11-22）：没有按下那一下的点击（读屏、自动化、浏览器扩展里的 element.click()、
      部分触屏辅助）直接来一个 click，动过 一直是 false，展开指标卡就按「还没人动过」重新居中，整块上移半个卡高（1024 销售 19px）。
      click、input 也算：它们都在 React 改状态之前先到这里（捕获在 g 上，React 的冒泡处理在根上）
    */
    const 动过的事 = ["pointerdown", "keydown", "click", "input"] as const;
    for (const t of 动过的事) g.addEventListener(t, 动了, true);
    return () => {
      看.disconnect();
      window.removeEventListener("resize", 量);
      for (const t of 动过的事) g.removeEventListener(t, 动了, true);
      g.style.removeProperty("--ck-nudge");
    };
  }, [网格, 开]);
}
