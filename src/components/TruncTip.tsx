"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * 截了就悬停看全文（11-04 用户：「一行显示不下的用... 但是悬浮要做好，鼠标移上去可以看完整。」「所有页面都是这样」）。
 *
 * 全站只挂一个，在 (app) 布局里：鼠标停在某段字上，往上找最近一个**真被截了**的元素
 * （单行省略号、多行截断、nowrap + 超出隐藏，量 scrollWidth / scrollHeight），停 150ms 后在它上方浮出全文；
 * 上方放不下就放下方，左右夹在视口里。没截的不出。
 *
 * 元素自己挂了 title（异常说明、「无效客户：」前缀这类比字面多一层意思的）：浮层显示 title，
 * 浮着时先把 title 摘掉、移开再挂回，免得浏览器原生提示再叠一个。
 * 不想要的地方挂 data-no-tip。输入框、正在编辑的格不出。
 */
const 等 = 150;
const 往上找几层 = 6;

function 被截了(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  const 藏 = s.overflowX !== "visible" || s.overflowY !== "visible";
  if (!藏) return false;
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

function 找截了的(起: Element | null): HTMLElement | null {
  let el = 起 as HTMLElement | null;
  for (let i = 0; el && i < 往上找几层 && el !== document.body; i++, el = el.parentElement) {
    if (el.closest("[data-no-tip], input, textarea, select, [contenteditable=true], .ant-select-selector, .rec-field-editing, .trunc-tip")) return null;
    // 自己能滚的容器（列表外框、抽屉正文）不算「截」
    const s = getComputedStyle(el);
    if (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowY === "auto" || s.overflowY === "scroll") return null;
    if (被截了(el) && (el.innerText ?? "").trim()) return el;
  }
  return null;
}

export default function TruncTip() {
  const pathname = usePathname();

  useEffect(() => {
    const tip = document.createElement("div");
    tip.className = "trunc-tip";
    tip.setAttribute("role", "tooltip");
    tip.id = "trunc-tip";
    document.body.appendChild(tip);

    let 当前: HTMLElement | null = null;
    let 摘下的: { el: HTMLElement; title: string } | null = null;
    let 计时: number | undefined;

    function 收() {
      window.clearTimeout(计时);
      计时 = undefined;
      tip.classList.remove("is-on");
      if (当前) 当前.removeAttribute("aria-describedby");
      if (摘下的) {
        摘下的.el.setAttribute("title", 摘下的.title);
        摘下的 = null;
      }
      当前 = null;
    }

    function 出(el: HTMLElement) {
      if (!el.isConnected || !被截了(el)) return;
      // 自己或往上两层挂的 title（DataList 挂在格子上）：浮层用它，浮着时先摘掉免得原生提示叠一个
      let 题主 = el.closest("[title]") as HTMLElement | null;
      if (题主 && 题主 !== el && 题主 !== el.parentElement && 题主 !== el.parentElement?.parentElement) 题主 = null;
      const 题 = 题主?.getAttribute("title")?.trim() ?? "";
      // 一行显示的多行文字（需求描述、痛点）：一行里换行被压成空格，浮层用 data-tip 里的原文，保住分段
      const 原文 = (el.matches("[data-tip]") ? el : el.querySelector("[data-tip]"))?.getAttribute("data-tip")?.trim() ?? "";
      const 字 = (题 || 原文 || el.innerText || "").trim();
      if (!字) return;
      if (题主) {
        摘下的 = { el: 题主, title: 题主.getAttribute("title") ?? "" };
        题主.removeAttribute("title");
      }
      tip.textContent = 字;
      tip.style.left = "0px";
      tip.style.top = "0px";
      tip.classList.add("is-on");
      const r = el.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      const 边 = 8;
      const 隔 = 6;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      let top = r.top - t.height - 隔;
      if (top < 边) top = Math.min(r.bottom + 隔, vh - t.height - 边);
      const left = Math.max(边, Math.min(r.left, vw - t.width - 边));
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(Math.max(边, top))}px`;
      el.setAttribute("aria-describedby", tip.id);
    }

    function 进(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      const el = 找截了的(e.target as Element);
      if (el === 当前) return;
      收();
      if (!el) return;
      当前 = el;
      计时 = window.setTimeout(() => 当前 === el && 出(el), 等);
    }
    function 离(e: PointerEvent) {
      if (!当前) return;
      const 去 = e.relatedTarget as Node | null;
      if (去 && 当前.contains(去)) return;
      收();
    }
    const 键 = (e: KeyboardEvent) => e.key === "Escape" && 收();

    document.addEventListener("pointerover", 进);
    document.addEventListener("pointerout", 离);
    document.addEventListener("pointerdown", 收, true);
    document.addEventListener("keydown", 键);
    window.addEventListener("scroll", 收, true);
    window.addEventListener("blur", 收);
    return () => {
      收();
      document.removeEventListener("pointerover", 进);
      document.removeEventListener("pointerout", 离);
      document.removeEventListener("pointerdown", 收, true);
      document.removeEventListener("keydown", 键);
      window.removeEventListener("scroll", 收, true);
      window.removeEventListener("blur", 收);
      tip.remove();
    };
  }, []);

  // 换页就收：旧页上的元素没了，浮层不能留在半空
  useEffect(() => {
    document.getElementById("trunc-tip")?.classList.remove("is-on");
  }, [pathname]);

  return null;
}
