"use client";
import { useEffect, useRef, type RefObject } from "react";
import { useMotionTheme } from "@/components/MotionTheme";
import { 少动 } from "@/lib/reduced-motion";

/** 行数超过这个就不做动画：一次量几百行的位置会卡，而且那么多行一起滑也看不清谁去了哪 */
export const 动画行上限 = 50;

/**
 * 表格换顺序时（点表头排序），行从旧位置滑到新位置（FLIP），不是瞬间换一张（ov.table）。
 * 盯着容器里的 tbody：React 挪动 <tr> 时 MutationObserver 在绘制前回调，
 * 先按上一次记下的位置把行反向挪回去，再用令牌时长滑到新位置。
 * 只认带 data-row-key 的行（antd 的测量行、空态行不算）；减弱动态、超过 动画行上限 行都直接换。
 */
export function useFlipRows(容器: RefObject<HTMLElement | null>) {
  const { 时长 } = useMotionTheme();
  useEffect(() => {
    const 根 = 容器.current;
    const tbody = 根?.querySelector("tbody");
    if (!根 || !tbody) return;
    const 行们 = () => [...tbody.querySelectorAll<HTMLTableRowElement>(":scope > tr[data-row-key]")];
    const 记 = () => new Map(行们().map((tr) => [tr.dataset.rowKey ?? "", tr.offsetTop]));
    let 旧 = 记();
    const 观察 = new MutationObserver(() => {
      const 现在 = 行们();
      if (!少动() && 现在.length <= 动画行上限) {
        // WAAPI 认不了 var()：从 <html> 上读当前主题的 --ease-morph（主题换了曲线也跟着走），读不到退回线性
        const ease = getComputedStyle(document.documentElement).getPropertyValue("--ease-morph").trim() || "linear";
        for (const tr of 现在) {
          const 前 = 旧.get(tr.dataset.rowKey ?? "");
          const 差 = 前 === undefined ? 0 : 前 - tr.offsetTop;
          if (差) tr.animate?.([{ transform: `translateY(${差}px)` }, { transform: "none" }], { duration: 时长.morph * 1000, easing: ease });
        }
      }
      旧 = 记();
    });
    观察.observe(tbody, { childList: true });
    return () => 观察.disconnect();
  }, [容器, 时长]);
}

/** 包一层就有：<FlipRows><Table …/></FlipRows> */
export default function FlipRows({ children }: { children: React.ReactNode }) {
  const 容器 = useRef<HTMLDivElement>(null);
  useFlipRows(容器);
  return <div ref={容器}>{children}</div>;
}
