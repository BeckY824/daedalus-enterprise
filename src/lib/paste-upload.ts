"use client";

/**
 * 附件区接住剪贴板里的截图（11-17 员工反馈「附件不支持截图」）：截完图直接 Ctrl+V / ⌘V，
 * 走和点选上传同一条路（交 = 组件里 beforeUpload 用的那个 传一个），大小、张数、类型、权限照原来的校验。
 *
 * 什么时候接：
 * - 附件区在能传的时候（只读、视图中、传着、满了都不接，和上传按钮灰掉同一个条件）；
 * - 焦点在附件区里，或在它所在的范围里（弹窗 role=dialog、或标了 data-paste-scope 的卡片格 / 沟通行），
 *   且这个范围里只有这一个能传的附件区——一张卡上好几格时只认焦点所在那一格，不猜；
 * - 点在没法拿焦点的空白处（焦点落回 body）时，按最后一次按下鼠标的位置算；
 * - 焦点在输入框里、剪贴板里有文字：不拦，照常粘文字（Office 复制表格时文字和一张图一起来，以文字为准）；
 * - 别处已经处理过（defaultPrevented）不再接。不全局抢粘贴。
 *
 * 剪贴板截图没有文件名或叫 image.png 的，改名成「截图-YYYYMMDD-HHmmss.png」（北京时间），同一次粘了几张后面加 -2、-3
 */
import { useEffect, useRef, type RefObject } from "react";

/** 附件区所在的范围：弹窗、或者手动标了 data-paste-scope 的块（项目附件的一格、一条沟通） */
export const 粘贴范围选择器 = '[data-paste-scope], [role="dialog"]';
/** 能传的附件区根上挂这个属性：数一个范围里有几个能接粘贴的区 */
export const 粘贴标记 = "data-paste-upload";

const 图片扩展名: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" };

/** 截图-YYYYMMDD-HHmmss.png，北京时间（不随这台电脑的时区） */
export function 截图名(现在: Date = new Date(), 扩展名 = "png"): string {
  const d = new Date(现在.getTime() + 8 * 3600_000);
  const 两位 = (n: number) => String(n).padStart(2, "0");
  return `截图-${d.getUTCFullYear()}${两位(d.getUTCMonth() + 1)}${两位(d.getUTCDate())}-${两位(d.getUTCHours())}${两位(d.getUTCMinutes())}${两位(d.getUTCSeconds())}.${扩展名}`;
}

/** 剪贴板图片的「没名字」：空名、或浏览器给的默认名 image.png（image.jpg 之类同样） */
function 要改名(f: File): boolean {
  const 类 = (f.type || "").toLowerCase();
  if (类 && !类.startsWith("image/")) return false;
  const 名 = (f.name || "").trim();
  return !名 || /^image\.[a-z0-9]+$/i.test(名);
}

/** 剪贴板里的文件（files 没有就看 items 里 kind=file 的），截图改好名字；没有文件 = 空数组 */
export function 剪贴板文件(dt: DataTransfer | null | undefined, 现在: Date = new Date()): File[] {
  if (!dt) return [];
  let 们 = Array.from(dt.files ?? []);
  if (!们.length) {
    们 = Array.from(dt.items ?? [])
      .filter((x) => x.kind === "file")
      .map((x) => x.getAsFile())
      .filter((f): f is File => !!f);
  }
  let 第 = 0;
  return 们.map((f) => {
    if (!要改名(f)) return f;
    第++;
    const 名 = 截图名(现在, 图片扩展名[(f.type || "").toLowerCase()] ?? "png");
    return new File([f], 第 > 1 ? 名.replace(/\.(\w+)$/, `-${第}.$1`) : 名, { type: f.type || "image/png", lastModified: f.lastModified });
  });
}

const 不是打字的输入 = new Set(["checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image", "hidden"]);
function 是输入框(t: Element): boolean {
  const 标 = t.tagName?.toUpperCase();
  if (标 === "TEXTAREA") return true;
  if (标 === "INPUT") return !不是打字的输入.has(((t as HTMLInputElement).type || "text").toLowerCase());
  return !!(t as HTMLElement).isContentEditable;
}

export type 粘贴事件 = { target: EventTarget | null; clipboardData: DataTransfer | null; defaultPrevented: boolean; preventDefault(): void };

/**
 * 这次粘贴归不归这个附件区：归就 preventDefault、把文件交给 交，返回 true。
 * 最后点的：焦点在 body 上（点的是没法拿焦点的空白）时，拿最后一次按下鼠标的位置当落点
 */
export function 接粘贴(e: 粘贴事件, 面板: Element, 交: (文件们: File[]) => void, 选项: { 开着?: boolean; 最后点的?: EventTarget | null; 现在?: Date } = {}): boolean {
  if (选项.开着 === false || e.defaultPrevented) return false;
  let 落点 = e.target as Element | null;
  const 标 = 落点?.tagName?.toUpperCase();
  if (!落点 || 标 === "BODY" || 标 === "HTML") 落点 = (选项.最后点的 as Element | null) ?? null;
  if (!落点 || typeof 落点.tagName !== "string") return false;
  if (!面板.contains(落点)) {
    const 范围 = 面板.closest(粘贴范围选择器);
    if (!范围 || !范围.contains(落点)) return false;
    // 一个范围里有好几个能传的区（项目附件卡的几格、一页好几条沟通）：只认焦点所在那一个
    if (范围.querySelectorAll(`[${粘贴标记}]`).length !== 1) return false;
  }
  const dt = e.clipboardData;
  if (!dt) return false;
  if (落点 === e.target && 是输入框(落点) && (dt.getData("text/plain") ?? "").trim()) return false;
  const 们 = 剪贴板文件(dt, 选项.现在);
  if (!们.length) return false;
  e.preventDefault();
  交(们);
  return true;
}

/** 最后一次按下鼠标的位置（全页一个，捕获阶段记，不拦任何事） */
let 最后点的: EventTarget | null = null;
let 记着 = false;
function 记最后点的() {
  if (记着 || typeof document === "undefined") return;
  记着 = true;
  document.addEventListener("pointerdown", (e) => { 最后点的 = e.target; }, true);
}

/**
 * 附件区用：挂着时在 document 上听 paste，开着（能传、没灰）且归这个区的才接（接粘贴）。
 * 开着、交 每次渲染都可能换（交 = 组件里的 传一个），存在 ref 里，不因此重挂监听。英文名：钩子规则只认 use + 大写字母开头
 */
export function usePasteUpload(面板: RefObject<HTMLElement | null>, 开着: boolean, 交: (文件们: File[]) => void) {
  const 现 = useRef({ 开着, 交 });
  useEffect(() => { 现.current = { 开着, 交 }; });
  useEffect(() => {
    记最后点的();
    const 听 = (e: ClipboardEvent) => {
      const el = 面板.current;
      if (el) 接粘贴(e, el, (们) => 现.current.交(们), { 开着: 现.current.开着, 最后点的 });
    };
    document.addEventListener("paste", 听);
    return () => document.removeEventListener("paste", 听);
  }, [面板]);
}
