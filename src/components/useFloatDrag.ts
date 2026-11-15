"use client";
/**
 * AI 浮窗能拖（用户 11-15：「可以拖动这个对话框，目前是不能移动的」）。
 *
 * - 按住顶上的把手（或头一行的空白处）拖到哪儿就停哪儿；按钮、输入框照旧是按钮、输入框，不抢
 * - 四边至少留 8px，拖不出窗口；窗口缩小、浮窗长高（问过之后向上长成对话）时自动收回窗口里
 * - 位置按人记在这台电脑上（localStorage，读写都 try/catch，读不到就是默认位置）
 * - 双击把手回到默认位置；把手能 Tab 到，方向键挪（一下 16px，按住 Shift 一下 64px）
 * - 不加惯性、不加回弹：松手就停（减弱动态下也一样，本来就没有位移动画）
 *
 * 位置记的是「左边 + 离窗口底」：浮窗是从底下往上长的，按底记，长高了底不动、往上长，和默认位置一个长法。
 * 摆的时候不走 React state：直接在元素上写 CSS 变量和 data-moved（React 不管这两样，重渲染不会把它们冲掉），
 * 样子在 globals.css 的 .dock-float[data-moved]。
 */
import { useEffect, useRef, type RefObject } from "react";

export type 浮窗位置 = { left: number; bottom: number };

/** 四边至少留多少 */
export const 留边 = 8;
const 一步 = 16;
const 大步 = 64;

export function 浮窗位置键(人: string): string {
  return `ai-float-pos:${人}`;
}

export function 读浮窗位置(键: string): 浮窗位置 | null {
  try {
    const raw = window.localStorage.getItem(键);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<浮窗位置>;
    return typeof p.left === "number" && typeof p.bottom === "number" && Number.isFinite(p.left) && Number.isFinite(p.bottom) ? { left: p.left, bottom: p.bottom } : null;
  } catch {
    return null;
  }
}

function 记(键: string, p: 浮窗位置 | null) {
  try {
    if (p) window.localStorage.setItem(键, JSON.stringify({ left: Math.round(p.left), bottom: Math.round(p.bottom) }));
    else window.localStorage.removeItem(键);
  } catch {
    /* 无痕窗口存不了：这次照样能拖，下次回默认位置 */
  }
}

/** 夹进窗口：四边留 8px。比窗口还宽 / 高的，贴左 / 贴底 */
export function 夹进窗口(p: 浮窗位置, 宽: number, 高: number, 窗宽: number, 窗高: number): 浮窗位置 {
  const 夹 = (v: number, 小: number, 大: number) => Math.max(小, Math.min(v, Math.max(小, 大)));
  return { left: 夹(p.left, 留边, 窗宽 - 宽 - 留边), bottom: 夹(p.bottom, 留边, 窗高 - 高 - 留边) };
}

/** 按人摆的位置（夹进窗口后）写到元素上；null = 回默认位置（居中贴底，样子在 globals.css） */
function 摆到(el: HTMLElement | null, p: 浮窗位置 | null) {
  if (!el) return;
  if (!p) {
    el.removeAttribute("data-moved");
    el.style.removeProperty("--float-x");
    el.style.removeProperty("--float-y");
    return;
  }
  const c = 夹进窗口(p, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight);
  el.style.setProperty("--float-x", `${Math.round(c.left)}px`);
  el.style.setProperty("--float-y", `${Math.round(c.bottom)}px`);
  el.setAttribute("data-moved", "");
}

/** 头一行里这些东西照旧归自己（点、打字、选），按在上面不开始拖 */
const 不拖 = "button, a, input, textarea, select, [contenteditable], [role=button], [role=menuitem]";

export function useFloatDrag(框: RefObject<HTMLElement | null>, 键: string, 开着: boolean) {
  /** 人摆的位置（没夹之前的）；null = 默认位置 */
  const 位 = useRef<浮窗位置 | null>(null);

  // 开的时候读一次记下的位置；窗口缩放、浮窗长高时重新夹（只是摆，不改记下的那个：窗口放大回来还回原处）
  useEffect(() => {
    const el = 框.current;
    if (!开着 || !el) return;
    位.current = 读浮窗位置(键);
    const 摆 = () => 摆到(el, 位.current);
    摆();
    window.addEventListener("resize", 摆);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(摆);
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", 摆);
      ro?.disconnect();
    };
  }, [框, 键, 开着]);

  /** 现在实际在哪（夹过的）：从默认位置第一次挪时从这儿起 */
  const 现在 = (): 浮窗位置 => {
    const r = 框.current!.getBoundingClientRect();
    return { left: r.left, bottom: window.innerHeight - r.bottom };
  };
  const 定 = (p: 浮窗位置) => {
    const el = 框.current;
    if (!el) return;
    位.current = 夹进窗口(p, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight);
    摆到(el, 位.current);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !框.current) return;
    const t = e.target as Element;
    const 是把手 = !!t.closest?.("[data-float-grip]");
    if (!是把手 && t.closest?.(不拖)) return;
    e.preventDefault();
    const 起 = 现在();
    const x0 = e.clientX;
    const y0 = e.clientY;
    // 抓住按下的那个（把手或头一行）：按在把手上时 click / dblclick 照旧落在把手上（双击复位要认它）
    const 手 = (是把手 ? t.closest<HTMLElement>("[data-float-grip]") : null) ?? e.currentTarget;
    手.setPointerCapture?.(e.pointerId);
    框.current.setAttribute("data-dragging", "");
    const 移 = (ev: PointerEvent) => 定({ left: 起.left + ev.clientX - x0, bottom: 起.bottom - (ev.clientY - y0) });
    const 放 = () => {
      手.removeEventListener("pointermove", 移);
      手.removeEventListener("pointerup", 放);
      手.removeEventListener("pointercancel", 放);
      框.current?.removeAttribute("data-dragging");
      // 只按了一下没动：不算摆过，不记
      if (位.current) 记(键, 位.current);
    };
    手.addEventListener("pointermove", 移);
    手.addEventListener("pointerup", 放);
    手.addEventListener("pointercancel", 放);
  };

  /** 双击把手：回默认位置，记下的也清掉 */
  const 复位 = () => {
    位.current = null;
    记(键, null);
    摆到(框.current, null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const 步 = e.shiftKey ? 大步 : 一步;
    const 差: Record<string, [number, number]> = { ArrowLeft: [-步, 0], ArrowRight: [步, 0], ArrowUp: [0, 步], ArrowDown: [0, -步] };
    const d = 差[e.key];
    if (!d) return;
    e.preventDefault();
    const 起 = 位.current ? 夹进窗口(位.current, 框.current!.offsetWidth, 框.current!.offsetHeight, window.innerWidth, window.innerHeight) : 现在();
    定({ left: 起.left + d[0], bottom: 起.bottom + d[1] });
    记(键, 位.current);
  };

  return { onPointerDown, onKeyDown, 复位 };
}
