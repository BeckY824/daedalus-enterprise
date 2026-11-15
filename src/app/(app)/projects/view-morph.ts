/**
 * 看板 ⇄ 列表原地变形（原型 pr.view / cu.view「改后」，同 ov.view 复盘待办的做法）：
 * 点切换时 量变形起点 记下每张卡（data-morph-key）/ 每一行（tr[data-row-key]）在屏上的位置；新样子画出来那一帧（useLayoutEffect 里）调 放变形，
 * 对得上的从旧位置滑到新位置，对不上的淡入。同一个键几张卡（客户看板一位客户几个项目）都从那一行长出来。
 * 只动视口里看得见的（看板几百张卡全量会卡、也看不清谁去了哪），再多于 变形上限 直接换。减弱动态由调用方先挡（量都不量）。
 * 动效时长从 MotionTheme 传进来，曲线读 <html> 上的 --ease-morph（WAAPI 认不了 var()），不写数。
 */
const 件选择 = "[data-morph-key], tr[data-row-key]";
/** 一次最多动多少件；视口里的件比这还多就直接换 */
export const 变形上限 = 80;

const 键of = (el: HTMLElement) => el.dataset.morphKey ?? el.dataset.rowKey ?? "";
const 在视口 = (r: DOMRect) => r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;

/** 量下现在每件的位置（同一个键取第一件：客户列表一行对一位客户） */
export function 量变形起点(根: HTMLElement | null): Map<string, DOMRect> | null {
  if (!根) return null;
  const m = new Map<string, DOMRect>();
  根.querySelectorAll<HTMLElement>(件选择).forEach((el) => {
    const k = 键of(el);
    const r = el.getBoundingClientRect();
    if (k && !m.has(k) && 在视口(r)) m.set(k, r);
  });
  return m;
}

/** 放：回 true = 至少一件对上、做了变形；false = 一件都没对上（调用方退回整块淡入） */
export function 放变形(根: HTMLElement | null, 起: Map<string, DOMRect>, 秒: number): boolean {
  if (!根) return false;
  const 件们 = [...根.querySelectorAll<HTMLElement>(件选择)].filter((el) => 在视口(el.getBoundingClientRect()));
  if (!件们.some((el) => 起.has(键of(el)))) return false;
  if (件们.length > 变形上限) return true;
  const ease = getComputedStyle(document.documentElement).getPropertyValue("--ease-morph").trim() || "linear";
  const 时 = { duration: 秒 * 1000, easing: ease };
  for (const el of 件们) {
    const 旧 = 起.get(键of(el));
    const 新 = el.getBoundingClientRect();
    if (旧) el.animate?.([{ transform: `translate(${Math.round(旧.left - 新.left)}px, ${Math.round(旧.top - 新.top)}px)`, opacity: 0.4 }, { transform: "none", opacity: 1 }], 时);
    else el.animate?.([{ opacity: 0 }, { opacity: 1 }], 时);
  }
  return true;
}
