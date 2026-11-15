"use client";
import { animate } from "motion/react";
import type { 动效 } from "@/lib/motion";

/**
 * 首页观感的两件小事（前端改版逐块确认 home.hero / home.threads），不碰数据。
 */

/** 和服务端 threads.ts 取标题 同一个截法：前 18 个字，再长加省略号。落库后列表里那条就是这个名字，占位行换成真行时字不跳 */
export function 截标题(问题: string): string {
  const t = 问题.trim().replace(/\s+/g, " ");
  return t.length > 18 ? `${t.slice(0, 18)}…` : t || "新对话";
}

/**
 * 对话列表顶上那一行占位（home.threads）：点了「新建对话」或这一屏问过了、但这条对话还没落库（没 id）时先占一行；
 * 标题 = 第一句截断（服务端落库也是这么取的），还没问 = 「新对话」。落库后 router.refresh 带回真行、对话 id 认领上，占位自己消失。
 * 地址上带着 ?c=（在看一条老对话）不占。
 */
export function 占位标题({ 第一句, 对话id, 刚新建, 看着老对话 }: { 第一句?: string; 对话id: string | null; 刚新建: boolean; 看着老对话: boolean }): string | null {
  if (对话id || 看着老对话) return null;
  if (第一句) return 截标题(第一句);
  return 刚新建 ? "新对话" : null;
}

/**
 * home.hero：点了一条示例，克隆一份从原处飞进输入框（形变那一档的时长和曲线，跟主题走），落地后再填字。
 * 克隆挂在 body 上、fixed 定位、aria-hidden、点不到；飞完就拆。减弱动态 / 量不到位置 = 不飞，直接返回。
 */
export async function 飞进去(从: HTMLElement, 到: HTMLElement, 效: 动效, 少动: boolean): Promise<void> {
  if (少动) return;
  const a = 从.getBoundingClientRect();
  const b = 到.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const 影 = 从.cloneNode(true) as HTMLElement;
  影.removeAttribute("id");
  影.setAttribute("aria-hidden", "true");
  影.classList.add("cli-q-fly");
  Object.assign(影.style, { position: "fixed", left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, margin: "0", pointerEvents: "none", zIndex: "1000" });
  document.body.append(影);
  从.style.visibility = "hidden";
  try {
    await animate(
      影,
      { x: [0, b.left - a.left + 8], y: [0, b.top - a.top + 4], opacity: [1, 0.2] },
      { duration: 效.时长.morph, ease: 效.曲线.morph },
    );
  } finally {
    影.remove();
    从.style.visibility = "";
  }
}
