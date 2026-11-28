/**
 * 发版不打断（跳转优化 PR-C，11-24 定）：发过版了，这一页什么时候可以悄悄整页换成新版。
 *
 * 条件（components/UpdateBanner.tsx 用）：后台满 45 秒，或前台空闲 ≥10 分钟；且同时满足
 *   ① 没有进行中的 AI 流 / 上传 / 录音 / 导入 / 未返回的保存（登记忙）
 *   ② 没有弹层（antd 弹窗、抽屉）
 *   ③ 没有未提交录入（登记未提交：录入弹窗 / 就地改的格子 / 建档向导，加上正在打字的长文本框）
 * 不满足就不换，顶上那条「刷新」横幅照旧亮着，人自己点。
 *
 * 换之前：刷新前事件（FormDraft / form-guard 立刻落盘）+ 记滚动位置，reload 后恢复。
 * 纯函数 + 小登记表，不带 "use client"：单测直接引，碰 window / document 的在服务端是空操作。
 */
import { 浮层选择器 } from "@/lib/esc";
import { 存好再刷新, 记位事件 } from "@/lib/stale-deploy";

/** 页面在后台（标签页切走 / 窗口最小化）满多久可以换 */
export const 后台满毫秒 = 45_000;
/** 页面在前台、人没动静满多久可以换 */
export const 前台空闲毫秒 = 10 * 60_000;

// ── 登记表 ──
const 忙们 = new Map<number, string>();
let 忙号 = 0;
const 未提交们 = new Set<string>();

/** 开始一件不能被刷新打断的事（AI 回答、录音、上传……）；返回的函数在结束时调（多调无害） */
export function 登记忙(原因: string): () => void {
  const 号 = ++忙号;
  忙们.set(号, 原因);
  return () => {
    忙们.delete(号);
  };
}
export function 忙数(): number {
  return 忙们.size;
}

/** 某处有人填了还没提交的东西（键 = 草稿键，同一个弹窗同一个键）；提交 / 放弃 / 关掉时撤 */
export function 登记未提交(键: string): void {
  未提交们.add(键);
}
export function 撤未提交(键: string): void {
  未提交们.delete(键);
}
export function 未提交数(): number {
  return 未提交们.size;
}

/** 只给单测用 */
export function 清登记(): void {
  忙们.clear();
  未提交们.clear();
  组字中 = false;
  选文件放?.();
  选文件放 = null;
}

// ── 现场 ──
/**
 * 有没有弹层开着：antd 弹窗 / 抽屉、原生 dialog[open]、带 aria-modal 的，
 * 再加 esc.ts 那组开着的浮层（下拉、日期、气泡含 Popconfirm、⌘K），
 * 和自写浮层统一打的标记 data-swap-busy（给自写浮层加这个属性即可，不用改这里的类名表）
 */
export const 弹层选择器 = `${浮层选择器}, dialog[open], [aria-modal='true'], [data-swap-busy]`;
export function 有弹层(doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  if (!doc) return false;
  const 看得见 = (e: Element) => {
    const h = e as HTMLElement;
    return h.style.display !== "none" && !h.classList.contains("ant-modal-wrap-hidden") && (h.offsetParent !== null || getComputedStyle(h).position === "fixed");
  };
  for (const e of Array.from(doc.querySelectorAll(弹层选择器))) {
    if (看得见(e)) return true;
  }
  return false;
}

/** 输入法组字中（compositionstart 到 compositionend）：拼音还没上屏，换了就丢 */
let 组字中 = false;
/** 点开了文件选择（手机拍照会跳去相机，回来常超过 45 秒）：选完 / 取消 / 回到页面几秒后放 */
let 选文件放: (() => void) | null = null;
let 装了输入 = false;
const 选文件宽限毫秒 = 3_000;
export function 装输入监听(): void {
  if (装了输入 || typeof document === "undefined" || typeof document.addEventListener !== "function") return;
  装了输入 = true;
  document.addEventListener("compositionstart", () => { 组字中 = true; }, true);
  document.addEventListener("compositionend", () => { 组字中 = false; }, true);
  document.addEventListener("focusout", () => { 组字中 = false; }, true);
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.tagName !== "INPUT" || (t as HTMLInputElement).type !== "file") return;
      选文件放?.();
      const 放忙 = 登记忙("选文件");
      let 定时: ReturnType<typeof setTimeout> | undefined;
      const 放 = () => {
        clearTimeout(定时);
        放忙();
        t.removeEventListener("change", 放);
        t.removeEventListener("cancel", 放);
        document.removeEventListener("visibilitychange", 回来);
        window.removeEventListener("focus", 回来);
        if (选文件放 === 放) 选文件放 = null;
      };
      const 回来 = () => {
        if (document.visibilityState === "hidden") return;
        clearTimeout(定时);
        定时 = setTimeout(放, 选文件宽限毫秒);
      };
      t.addEventListener("change", 放);
      t.addEventListener("cancel", 放);
      document.addEventListener("visibilitychange", 回来);
      window.addEventListener("focus", 回来);
      选文件放 = 放;
    },
    true,
  );
}

/** 正在往长文本框（textarea / 可编辑区）或聚焦且有值的单行框（text / search / tel / email / url）里打字、里面有字，或输入法组字中：算未提交，哪怕那个框没接草稿 */
export function 正在打字(doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  if (!doc) return false;
  if (组字中) return true;
  const a = doc.activeElement as HTMLElement | null;
  if (!a) return false;
  if (a.tagName === "INPUT") {
    const 型 = ((a as HTMLInputElement).type || "text").toLowerCase();
    return ["text", "search", "tel", "email", "url"].includes(型) && (a as HTMLInputElement).value.trim() !== "";
  }
  if (a.tagName === "TEXTAREA") return (a as HTMLTextAreaElement).value.trim() !== "";
  if (a.isContentEditable) return (a.textContent ?? "").trim() !== "";
  return false;
}

export type 换版现场 = {
  /** 页面不可见多久（毫秒）；可见时 null */
  后台多久: number | null;
  /** 前台没动静多久（毫秒） */
  空闲多久: number;
  忙: number;
  弹层: boolean;
  未提交: number;
  打字中: boolean;
  /** 5 分钟内这个标签页已经悄悄换过一次 */
  刚换过?: boolean;
};

/** 该不该悄悄换：时间到了，而且三样都空 */
export function 能静默换(x: 换版现场): boolean {
  if (x.忙 > 0 || x.弹层 || x.未提交 > 0 || x.打字中 || x.刚换过) return false;
  if (x.后台多久 !== null) return x.后台多久 >= 后台满毫秒;
  return x.空闲多久 >= 前台空闲毫秒;
}

export function 取现场(后台起: number | null, 动静: number, 现在 = Date.now()): 换版现场 {
  return {
    后台多久: 后台起 === null ? null : 现在 - 后台起,
    空闲多久: 现在 - 动静,
    忙: 忙数(),
    弹层: 有弹层(),
    未提交: 未提交数(),
    打字中: 正在打字(),
    刚换过: 近期换过(现在),
  };
}

// ── 请求计数：不是 GET 的请求（server action、上传、AI 流）没回完就算忙 ──
let 装了 = false;
const 不算忙 = /\/api\/(version|client-report)(\?|$)/;
export function 装请求计数(): void {
  if (装了 || typeof window === "undefined" || typeof window.fetch !== "function") return;
  装了 = true;
  const 原 = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const 方法 = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const 地址 = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (方法 === "GET" || 方法 === "HEAD" || 不算忙.test(地址)) return 原(input, init);
    const 放 = 登记忙(`${方法} ${地址.slice(0, 60)}`);
    const p = 原(input, init);
    p.then(
      (r) => {
        // 流式回答：头回来了、正文还在流，等读完。回调里任何一步抛错都要放，不然永久忙
        // （停止流必须用 AbortController：abort 后 read 会 reject，走 catch 放掉；不要只丢掉 reader）
        try {
          const 流 = r.body && /event-stream|x-ndjson/i.test(r.headers.get("content-type") ?? "");
          if (!流) return 放();
          const rd = r.clone().body!.getReader();
          const 抽 = (): Promise<void> => rd.read().then((v) => (v.done ? 放() : 抽()));
          抽().catch(放);
        } catch {
          放();
        }
      },
      放,
    );
    return p;
  };
}

// ── 滚动位置：换之前记，换之后恢复 ──
const 滚动键 = "daedalus:换版滚动";
const 滚动有效毫秒 = 2 * 60_000;
const 滚动间隔毫秒 = 200;
const 滚动试次 = 10;
const 滚动容器 = "main.app-content, .pane-rows";

/** 换之前记：当前路径 + 窗口 / 主区 / 列表的滚动 */
export function 记滚动(): void {
  try {
    const 们 = Array.from(document.querySelectorAll<HTMLElement>(滚动容器)).map((e, i) => [i, e.scrollTop] as const);
    sessionStorage.setItem(滚动键, JSON.stringify({ at: Date.now(), 路径: location.pathname + location.search, 窗: window.scrollY, 们 }));
  } catch {
    /* 隐私模式：不记就是回到顶 */
  }
}

/** 换之后恢复（只认同一个地址、2 分钟内）；等内容撑起来再放，放两次 */
export function 恢复滚动(): void {
  try {
    const raw = sessionStorage.getItem(滚动键);
    if (!raw) return;
    sessionStorage.removeItem(滚动键);
    const r = JSON.parse(raw) as { at: number; 路径: string; 窗: number; 们: [number, number][] };
    if (Date.now() - r.at > 滚动有效毫秒 || r.路径 !== location.pathname + location.search) return;
    // 内容是慢慢撑起来的：每 200ms 放一次，页面够高、各容器够高就停，最多 2 秒（再高的页面此时也该好了）
    const 够 = (总: number | undefined, 可视: number | undefined, 目标: number) => 总 === undefined || 可视 === undefined || 总 - 可视 >= 目标 - 1;
    let 次 = 0;
    const 放 = () => {
      window.scrollTo(0, r.窗 || 0);
      const 容器们 = document.querySelectorAll<HTMLElement>(滚动容器);
      let 全够 = 够(document.documentElement?.scrollHeight, window.innerHeight, r.窗 || 0);
      for (const [i, top] of r.们) {
        const e = 容器们[i];
        if (!e) continue;
        e.scrollTop = top;
        if (!够(e.scrollHeight, e.clientHeight, top)) 全够 = false;
      }
      // 够了也至少再放一次：浏览器自己的滚动还原可能在第一次之后又把位置拉回去
      if ((!全够 || 次 < 1) && ++次 < 滚动试次) window.setTimeout(放, 滚动间隔毫秒);
    };
    requestAnimationFrame(放);
  } catch {
    /* 坏了就不恢复 */
  }
}

/** 悄悄换：和人点「刷新」同一条路（存好再刷新：刷新前事件 + 记位事件，再整页重载） */
export function 悄悄换(): void {
  try {
    sessionStorage.setItem(静默换键, String(Date.now()));
  } catch {
    /* 隐私模式：记不下就算了 */
  }
  存好再刷新();
}

/** 防循环：刚悄悄换过（5 分钟内，同一个标签页）就不再悄悄换——万一落到旧进程上，换完还是旧的，会一直刷。人手点「刷新」不受限 */
const 静默换键 = "daedalus:静默换过";
const 静默换间隔毫秒 = 5 * 60_000;
export function 近期换过(现在 = Date.now()): boolean {
  try {
    const t = Number(sessionStorage.getItem(静默换键));
    return t > 0 && 现在 - t < 静默换间隔毫秒;
  } catch {
    return false;
  }
}

/** 挂上监听：「存好再刷新」发记位事件时记滚动。返回摘掉的函数 */
export function 听记位(): () => void {
  window.addEventListener(记位事件, 记滚动);
  return () => window.removeEventListener(记位事件, 记滚动);
}
