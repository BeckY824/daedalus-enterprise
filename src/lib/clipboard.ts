"use client";

import { useCallback } from "react";

/**
 * 复制到剪贴板。原来十处各写一份，一半没接失败：没授权、窗口没焦点、非 https 时
 * writeText 会拒绝，人点了没反应，控制台多一条未处理的报错。
 */

export const 复制失败文案 = "复制不了，请手动选中复制";

/** 写进剪贴板，成了回 true；失败不抛（navigator.clipboard 不存在也算失败） */
export async function 复制文字(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 客户服务器可能不是 https：那里没有 navigator.clipboard，退回浏览器的老办法
    return 老办法复制(text);
  }
}

/** 放一个看不见的输入框、选中、execCommand("copy")。弹窗开着时放进弹窗里，不然焦点被弹窗抢回去就选不中了 */
function 老办法复制(text: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;
  const 原焦点 = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const 框 = document.createElement("textarea");
  框.value = text;
  框.readOnly = true;
  框.setAttribute("aria-hidden", "true");
  框.tabIndex = -1;
  框.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none";
  (原焦点?.closest('[role="dialog"]') ?? document.body).appendChild(框);
  try {
    框.focus({ preventScroll: true });
    框.select();
    框.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    框.remove();
    原焦点?.focus({ preventScroll: true });
  }
}

/**
 * 在刚点的那颗键正上方浮一句（原型 g.save / g.notice：反馈在原处，不弹顶部提示）。
 * 成了停 1.4 秒、没成停 4 秒（和 SaveButton 一样长，没成要读原因）。读屏：成了 role=status，没成 role=alert。
 * 找不到刚点的键（焦点在 body 上）就浮在窗口下方正中。样式在 globals.css 的 .copy-tip（动效走令牌）。
 */
function 原处说一句(话: string, 成了: boolean, 键: Element | null) {
  if (typeof document === "undefined" || !document.body) return;
  document.querySelectorAll(".copy-tip").forEach((x) => x.remove());
  const 签 = document.createElement("div");
  签.className = `copy-tip${成了 ? "" : " is-bad"}`;
  签.setAttribute("role", 成了 ? "status" : "alert");
  签.textContent = 话;
  const 框 = 键 && 键 !== document.body ? 键.getBoundingClientRect() : null;
  if (框 && 框.width > 0) {
    签.style.left = `${Math.round(框.left + 框.width / 2)}px`;
    签.style.top = `${Math.max(8, Math.round(框.top - 6))}px`;
  } else 签.classList.add("is-free");
  (键?.closest('[role="dialog"]') ?? document.body).appendChild(签);
  setTimeout(() => 签.remove(), 成了 ? 1400 : 4000);
}

/** 复制并说一句：成了说 成功，不成说 失败（各处可以给自己的说法），话浮在刚点的那颗键上方。函数引用稳定，可以放进依赖数组 */
export function useCopy() {
  return useCallback(async (text: string, 成功: string, 失败 = 复制失败文案) => {
    const 键 = typeof document === "undefined" ? null : document.activeElement;
    const ok = await 复制文字(text);
    原处说一句(ok ? 成功 : 失败, ok, 键);
    return ok;
  }, []);
}
