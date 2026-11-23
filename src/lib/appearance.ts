/**
 * 外观：这台电脑上的样子（设置 → 外观）。**只换值，不换结构、不动数据，也不影响同事**。
 *
 * 外观只有一套，能换的只有明暗：挂在 <html data-mode> 上，只挂解出来的 light / dark——存的是 system（跟随系统）时
 * 按 prefers-color-scheme 解，系统一换当场跟着换（跟随系统的监听，components/ModeFollow.tsx）。
 * 暗色是一层中性 token 叠在 :root 上，见 src/app/dark.css；tests/dark-mode.test.ts 核对暗色块盖住了根里每个颜色类 token、
 * 正文和浅灰字对比度够。
 *
 * 存在浏览器本地（localStorage），不进库：外观是「我这台电脑怎么看」，不是团队配置。
 * 首次绘制前由 外观预设脚本 读出来挂上（layout.tsx 的 <head>），否则刷新时会先闪一下默认样子。
 * 以前这份里还存过主题（skin）、底色（paper / paperV），网页毛玻璃另存在 daedalus.webGlass（11-23 起都删了）：
 * 存量的这几项一律不读、不报错，界面照默认那套。
 */

import { 名单宽预设段 } from "./roster-width";

export const 外观键 = "daedalus.appearance";

export const 明暗表 = [
  { key: "light", 名: "浅色", 说明: "浅底深字" },
  { key: "dark", 名: "深色", 说明: "深底浅字，夜里不晃眼" },
  { key: "system", 名: "跟随系统", 说明: "系统换了这里跟着换" },
] as const;
export type 明暗 = (typeof 明暗表)[number]["key"];

export type 外观 = { mode: 明暗 };
export const 默认外观: 外观 = { mode: "light" };

const 系统暗查询 = "(prefers-color-scheme: dark)";

/** 系统现在是不是暗色（拿不到就当亮色） */
export function 系统是暗色() {
  try {
    return matchMedia(系统暗查询).matches;
  } catch {
    return false;
  }
}

/** 存的明暗 → 真正挂上去的 light / dark */
export function 解明暗(mode: 明暗, 系统暗: boolean = 系统是暗色()): "light" | "dark" {
  return mode === "system" ? (系统暗 ? "dark" : "light") : mode;
}

/** 跟随系统：系统明暗一换就调 回调；返回取消函数（拿不到 matchMedia 时什么都不做） */
export function 听系统明暗(回调: () => void) {
  try {
    const q = matchMedia(系统暗查询);
    q.addEventListener("change", 回调);
    return () => q.removeEventListener("change", 回调);
  } catch {
    return () => {};
  }
}

/** 本地存的东西不可信（旧版本、手改、坏 JSON）：认不出的一律回到默认 */
export function 读外观(raw: string | null | undefined): 外观 {
  let v: { mode?: unknown } = {};
  try {
    v = (raw ? (JSON.parse(raw) as { mode?: unknown }) : {}) ?? {};
  } catch {
    v = {};
  }
  return { mode: 明暗表.some((x) => x.key === v.mode) ? (v.mode as 明暗) : 默认外观.mode };
}

/** 把外观挂到 <html> 上 */
export function 挂外观(a: 外观, el: HTMLElement = document.documentElement) {
  el.dataset.mode = 解明暗(a.mode);
}

/**
 * 首次绘制前跑的那段。写成字符串塞进 <head>，它跑的时候 React 还没起来，所以不能 import 任何东西；
 * 认值的规矩和 读外观 / 解明暗 同一套（tests/appearance.test.ts 两边对一遍）。
 * Windows 上（网页和桌面端都算）顺手挂 os-win：globals.css 只有「压深浅灰字」那条不限 .shell-desktop，
 * 网页版在 Windows 上也要同样的字色；别的 os-win 规则都限在 .shell-desktop 里，网页不受影响。
 * 低配机（CPU ≤ 4 核或内存 ≤ 4GB，浏览器报得出来才算）挂 lite-fx：大面积 backdrop-filter 退回实色（⌘K 弹窗，PR2 外壳），
 * 整页模糊每帧都要重算，集显上会掉帧；报不出来的（老浏览器、Safari 没有 deviceMemory）按正常机器
 */
export const 外观预设脚本 = `(function(){try{var d=${JSON.stringify(默认外观)},v={};try{v=JSON.parse(localStorage.getItem(${JSON.stringify(外观键)})||"{}")||{};}catch(_){}var e=document.documentElement;var M=${JSON.stringify(明暗表.map((x) => x.key))},m=M.indexOf(v.mode)>-1?v.mode:d.mode;if(m==="system"){m="light";try{if(matchMedia(${JSON.stringify(系统暗查询)}).matches)m="dark";}catch(_){}}e.dataset.mode=m;if(/Windows/.test(navigator.userAgent))e.classList.add("os-win");try{var hc=navigator.hardwareConcurrency,dm=navigator.deviceMemory;if((hc>0&&hc<=4)||(dm>0&&dm<=4))e.classList.add("lite-fx");}catch(_){}${名单宽预设段}}catch(_){}})();`;
