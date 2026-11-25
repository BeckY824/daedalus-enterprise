"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

/**
 * 整页预取（10-27，企业版要上云服务器）。
 *
 * 服务端出页只要十几到几十毫秒，慢的是来回：本机看不出，放到云上每点一下都要等一趟网络。
 * Link 默认的预取只取到 loading.tsx 那层骨架，点进去还要再跑一趟拿数据；整页预取把数据也一起取回来，
 * 点下去直接从本地出页。取回的页按 next.config 的 staleTimes.static（60 秒）算新鲜，过了照常再问服务器。
 *
 * 只在人「要点了」的时候取：悬停停住一小会儿（扫过去的不算）、手指按下去、左栏空闲时预热那几项。
 * 列表一屏几十行，不能一进视口就全取（见 ui.tsx RowLink）。
 *
 * 跳转优化 PR-B（11-25）：同一个人的请求都粘在服务器的同一个进程上，预取和真点击排在同一条队里
 * （c2 慢的那些 RSC 同进程同时平均还有 5.8 个在跑，本机「点一位客户时同时有 3 个整页预取」186ms → 1247ms）。
 * 所以这个标签页里的整页预取都经过下面这道闸：
 * - 悬停 / 触摸（意图）：两次之间至少隔 意图间隔，隔不够的只留最后一个——鼠标从一串链接上滑过去，只取停下来的那个；
 * - 预热（空闲、保存后、回到页面、手机菜单打开）：排队一页一页地发，每页隔 预热间隔，刚有过意图也先让开；
 * - 当前这页、刚取过还没失效的，不再发；
 * - 手指按下去先等 触摸等（90ms），这期间手指挪了、页面滚了、触摸被取消就不取（滑动列表不算「要点了」，审查 11-25）；
 * - 一批预热可以整批撤掉（手机菜单关了、点了菜单项、外壳卸载）。
 * router.prefetch 即发即走（Next 16.4 返回 undefined，取消不了、也不知道什么时候回来，见 next/dist/client/components/prefetch.js），
 * 所以「同时最多一个」只能用最小间隔来近似：c2 详情 RSC p50 不到 200ms，间隔 300ms 时大多数上一个已经回来了。
 */
export const 整页 = PrefetchKind.FULL;

/** 悬停多久算「要点了」：鼠标从表格上扫过去，每行只停十几毫秒；从左栏一项滑到下一项也就几十毫秒（PR-B 70→120） */
export const 停住 = 120;
/** 两次意图预取之间至少隔多久；隔不够的先等着，等的时候又来一个就顶掉它 */
export const 意图间隔 = 300;
/** 预热队列每页之间隔多久；有意图预取刚发出去，预热也先让开这么久 */
export const 预热间隔 = 600;
/** 同一个地址取过、这么久之内又要取就不发（还没失效时 Next 自己也不会再去服务器，这里省掉白占的一个间隔） */
const 刚取过窗 = 10_000;
/** 手指按下去多久没挪才算「要点了」；这期间挪了 触摸移动 以上、滚了、取消了就不取 */
export const 触摸等 = 90;
const 触摸移动 = 10;

/** 系统开了省流量就不预取：省下的是对方的流量，不该替人花 */
export function 省流量() {
  if (typeof navigator === "undefined") return true;
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

type 路由 = ReturnType<typeof useRouter>;

/**
 * 直接整页取一个地址（不过闸）。取不到不报错：预取只是提速，失败了点下去照常走服务器；测试里假的 router 也没有 prefetch。
 * 失效 = Next 把这次取回来的清掉时叫一次（保存后清整个预取缓存、router.refresh，见 segment-cache/cache.js 的 onInvalidate）。
 * 只给要靠它重热的那一批挂（审查 11-25）：Next 16.4.6 的 attachInvalidationListener 挂着的时候连当时整棵页面树一起留着，悬停、触摸不挂
 */
export function 整页预取(router: 路由, href: string, 失效?: () => void) {
  if (typeof router.prefetch !== "function") return;
  try {
    router.prefetch(href, { kind: 整页, ...(失效 ? { onInvalidate: 失效 } : {}) });
  } catch {
    // 同上：不碍事
  }
}

/* ---------------- 闸：整个标签页一份（模块变量，只在浏览器里用） ---------------- */

let 待意图: { router: 路由; href: string } | null = null;
/** 键 = 排进来时的地址（去重、撤用）；解析 = 发出去那一刻算真地址（电脑左栏带记住的列表参数，审查 11-25） */
let 预热队: { router: 路由; 键: string; 解析?: (键: string) => string; 失效?: () => void; 间隔: number; 批: number }[] = [];
let 批号 = 0;
let 触摸: { 钟: ReturnType<typeof setTimeout>; 收: () => void } | null = null;
let 上次意图 = -Infinity;
let 上次发 = -Infinity;
let 钟: ReturnType<typeof setTimeout> | undefined;
const 刚取过 = new Map<string, number>();
let 听着回来 = false;
let 听着按下 = false;

/**
 * 人按下去了（点链接、点保存……多半马上就有一个真请求）：预热先让开一个间隔，不和它挤。
 * 意图预取不让：手指按到菜单项、列表行时要取的就是它
 */
function 让开() {
  // 队里没东西就没什么可让的（打开手机菜单那一下按的就是菜单键，紧接着才排队，不该把第一页往后推）
  if (!预热队.length) return;
  上次发 = Math.max(上次发, Date.now());
  if (预热队.length && !待意图) 定钟(预热队[0].间隔);
}

/** 测试用：闸里的状态清空 */
export function 重置预取闸() {
  clearTimeout(钟);
  钟 = undefined;
  待意图 = null;
  预热队 = [];
  上次意图 = -Infinity;
  上次发 = -Infinity;
  刚取过.clear();
  撤触摸();
  上次预热 = -Infinity;
  听着回来 = false;
  if (听着按下 && typeof document !== "undefined") document.removeEventListener("pointerdown", 让开, { capture: true });
  听着按下 = false;
}

/** 最常去的几页排在前面先热（保存后重热、手机菜单打开都按这个顺序）；其余照原来的顺序 */
const 常用 = ["/customers", "/pool", "/projects", "/dashboard"];
export function 常用在前(hrefs: string[]): string[] {
  const 位 = (h: string) => {
    const i = 常用.indexOf(h.split("?")[0]);
    return i < 0 ? 常用.length : i;
  };
  return hrefs.map((h, i) => [h, i] as const).sort((a, b) => 位(a[0]) - 位(b[0]) || a[1] - b[1]).map(([h]) => h);
}

/** 测试用：闸里现在有什么 */
export function 预取闸状态() {
  return { 待意图: 待意图?.href ?? null, 预热队: 预热队.map((x) => x.键), 触摸等着: !!触摸, 刚取过: [...刚取过.keys()] };
}

/** 预取缓存被清了（保存后、router.refresh）：「刚取过」不再算数。由挂了 失效 的那一方（外壳的预热）叫 */
export function 清刚取过() {
  刚取过.clear();
}

function 是当前页(href: string) {
  if (typeof location === "undefined") return false;
  return location.pathname + location.search === href || location.pathname === href;
}

function 不用取(href: string, 现在: number) {
  if (是当前页(href)) return true;
  const t = 刚取过.get(href);
  return t !== undefined && 现在 - t < 刚取过窗;
}

function 发(router: 路由, href: string, 现在: number, 失效?: () => void) {
  // 顺手扫掉过了窗口的旧记录：一直开着的标签页悬停过几百行，表不能只涨不落
  for (const [k, t] of 刚取过) if (现在 - t >= 刚取过窗) 刚取过.delete(k);
  刚取过.set(href, 现在);
  整页预取(router, href, 失效);
  上次发 = 现在;
}

function 定钟(毫秒: number) {
  clearTimeout(钟);
  钟 = setTimeout(泵, Math.max(0, 毫秒));
}

function 泵() {
  钟 = undefined;
  const 现在 = Date.now();
  if (待意图) {
    const 等 = 上次意图 + 意图间隔 - 现在;
    if (等 > 0) return 定钟(等);
    const { router, href } = 待意图;
    待意图 = null;
    if (!不用取(href, 现在)) {
      发(router, href, 现在);
      上次意图 = 现在;
    }
  }
  if (预热队.length === 0) return;
  // 标签页在后台不预热：回到前台再接着发（服务器的 CPU 不替看不见的页花）
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    if (!听着回来) {
      听着回来 = true;
      document.addEventListener("visibilitychange", function 回来() {
        if (document.visibilityState === "hidden") return;
        document.removeEventListener("visibilitychange", 回来);
        听着回来 = false;
        泵();
      });
    }
    return;
  }
  const 等 = 上次发 + 预热队[0].间隔 - 现在;
  if (等 > 0) return 定钟(等);
  // 跳过不用取的，发第一个要取的
  while (预热队.length) {
    const x = 预热队.shift()!;
    const href = x.解析 ? x.解析(x.键) : x.键;
    if (!href || 不用取(href, 现在)) continue;
    发(x.router, href, 现在, x.失效);
    break;
  }
  if (预热队.length) 定钟(预热队[0].间隔);
}

/** 意图预取：人停在一个链接上 / 手指按下去了。闸里只留最后一个 */
export function 意图预取(router: 路由, href: string) {
  if (!href || 省流量()) return;
  if (不用取(href, Date.now())) return;
  待意图 = { router, href };
  clearTimeout(钟);
  泵();
}

export type 预热选项 = {
  /** 取回来的被 Next 清掉时叫（保存后），同一批里每页都挂着，叫的人自己合并成一次 */
  失效?: () => void;
  /** 这一批每页之间隔多久（手机菜单打开是人马上要点，用 意图间隔） */
  间隔?: number;
  /** 发出去那一刻把排进来的地址算成真地址（左栏地址：在详情页时带上记住的列表参数） */
  解析?: (键: string) => string;
};

/**
 * 预热：排进队里一页一页地取。同一个地址已经在队里就不重复排。
 * 回一个「撤掉这一批」：还没发的从队里拿掉（已经发出去的收不回来）
 */
export function 排预热(router: 路由, hrefs: string[], 选项: 预热选项 = {}): () => void {
  if (省流量()) return () => {};
  if (!听着按下 && typeof document !== "undefined") {
    听着按下 = true;
    document.addEventListener("pointerdown", 让开, { capture: true, passive: true });
  }
  const 批 = ++批号;
  for (const 键 of hrefs) {
    if (!键 || 预热队.some((x) => x.键 === 键)) continue;
    预热队.push({ router, 键, 解析: 选项.解析, 失效: 选项.失效, 间隔: 选项.间隔 ?? 预热间隔, 批 });
  }
  if (钟 === undefined) 泵();
  return () => 撤预热(批);
}

function 撤预热(批: number) {
  const 前 = 预热队.length;
  预热队 = 预热队.filter((x) => x.批 !== 批);
  if (预热队.length === 前) return;
  // 队空了、也没有等着的意图：钟不用再走
  if (!预热队.length && !待意图) {
    clearTimeout(钟);
    钟 = undefined;
  }
}

function 撤触摸() {
  if (!触摸) return;
  clearTimeout(触摸.钟);
  触摸.收();
  触摸 = null;
}

/**
 * 触摸预取：手指按下去等 触摸等，没挪、没滚、没取消才算要点（再进意图预取那道闸）；手指先抬起来（轻点）就马上取。
 * 起点 = 按下那一点（touches[0]）；没给就是只要挪了就不取
 */
export function 触摸预取(router: 路由, href: string, 起点?: { x: number; y: number }) {
  撤触摸();
  if (!href || 省流量() || typeof document === "undefined") return;
  const 挪 = (e: Event) => {
    const t = (e as TouchEvent).touches?.[0];
    if (!起点 || !t || Math.hypot(t.clientX - 起点.x, t.clientY - 起点.y) > 触摸移动) 撤触摸();
  };
  const 抬 = () => {
    撤触摸();
    意图预取(router, href);
  };
  const 听 = { capture: true, passive: true } as const;
  document.addEventListener("touchmove", 挪, 听);
  document.addEventListener("scroll", 撤触摸, 听);
  document.addEventListener("touchcancel", 撤触摸, 听);
  document.addEventListener("touchend", 抬, 听);
  const 收 = () => {
    document.removeEventListener("touchmove", 挪, 听);
    document.removeEventListener("scroll", 撤触摸, 听);
    document.removeEventListener("touchcancel", 撤触摸, 听);
    document.removeEventListener("touchend", 抬, 听);
  };
  触摸 = {
    收,
    钟: setTimeout(() => {
      撤触摸();
      意图预取(router, href);
    }, 触摸等),
  };
}

/* ---------------- 外壳的预热调度（AppShell 用；拆出来好测） ---------------- */

/** 每个标签页两次预热之间至少隔多久（审查 11-25）：不到就顺延到「上次 + 这么久」那一刻再热 */
export const 预热最短 = 60_000;
/** 保存后、回到页面的重热只热常用在前的前几页（企业版默认名单 6 页整页，每存一下都全取一遍太重） */
export const 重热几页 = 2;
/** 保存后停多久再重热：连着存几下只算最后一下 */
export const 重热等 = 2000;
/** 这个标签页上次预热的时刻（模块变量：外壳重挂也算同一个标签页） */
let 上次预热 = -Infinity;

/**
 * 外壳的空闲预热 + 保存后重热 + 回到页面重热。要 = 预热名单（已按常用在前排好）。
 * - 热()：第一次热整份，之后只热前 重热几页；离上次不到 预热最短 就顺延——定一个钟到「上次预热 + 预热最短」再热，
 *   同一时刻只挂一个钟，重复叫不叠加（频率上限仍是每分钟一次，存了的改动最晚一分钟内也热上）；在后台不热（回到前台时补）；
 * - 保存后：Next 清预取缓存时叫这一批挂的 onInvalidate → 清「刚取过」→ 停 重热等 再 热()，连着几下合成一次；
 * - 回到页面（visibilitychange）离上次超过 预热最短 就 热()；
 * - 补漏()：热的时候正在眼前、没取的那页，人离开后补上（名单只配了这一页时不然一直没热过）；
 * - 停()：重热钟、顺延钟停掉、监听摘掉、还没发的整批撤掉。
 * c2 另把 CRM_NAV_PREWARM 配成 /customers,/pool，和限频一起把重热压到每分钟最多 2 页
 */
export function 开预热器(router: 路由, 要: string[], 选项: { 解析?: (键: string) => string; 能热?: () => boolean } = {}) {
  let 重热钟: ReturnType<typeof setTimeout> | undefined;
  let 顺延钟: ReturnType<typeof setTimeout> | undefined;
  let 停了 = false;
  let 整份热过 = false;
  let 漏: string[] = [];
  const 撤们: (() => void)[] = [];
  const 此页 = () => (typeof location === "undefined" ? "" : location.pathname);
  const 失效了 = () => {
    if (停了) return;
    // 预取缓存被清了：「刚取过」也不算数了（只有这一批挂 onInvalidate，悬停、触摸不挂）
    清刚取过();
    clearTimeout(重热钟);
    重热钟 = setTimeout(热, 重热等);
  };
  function 热() {
    if (停了 || (选项.能热 && !选项.能热())) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const 还差 = 上次预热 + 预热最短 - Date.now();
    if (还差 > 0) {
      // 限频内：顺延到满一分钟那一刻再热（已经挂着就不再挂；到点时在后台就照后台的规矩，回到前台再补）
      if (顺延钟 === undefined)
        顺延钟 = setTimeout(() => {
          顺延钟 = undefined;
          热();
        }, 还差);
      return;
    }
    clearTimeout(顺延钟);
    顺延钟 = undefined;
    上次预热 = Date.now();
    const 页们 = 整份热过 ? 要.slice(0, 重热几页) : 要;
    整份热过 = true;
    漏 = 页们.filter((k) => k === 此页());
    撤们.push(排预热(router, 页们.filter((k) => k !== 此页()), { 失效: 失效了, 解析: 选项.解析 }));
  }
  const 补漏 = () => {
    if (停了 || !漏.length || (选项.能热 && !选项.能热())) return;
    const 补 = 漏.filter((k) => k !== 此页());
    if (!补.length) return;
    漏 = 漏.filter((k) => !补.includes(k));
    撤们.push(排预热(router, 补, { 失效: 失效了, 解析: 选项.解析 }));
  };
  const 回来 = () => {
    if (document.visibilityState === "visible" && Date.now() - 上次预热 >= 预热最短) 热();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", 回来);
  return {
    热,
    补漏,
    停() {
      停了 = true;
      clearTimeout(重热钟);
      clearTimeout(顺延钟);
      撤们.forEach((f) => f());
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", 回来);
    },
  };
}

/** 从 React 的 onTouchStart 事件里取按下那一点 */
function 按下点(e?: { touches?: { length: number; [i: number]: { clientX: number; clientY: number } } }) {
  const t = e?.touches?.length ? e.touches[0] : undefined;
  return t ? { x: t.clientX, y: t.clientY } : undefined;
}

/**
 * 悬停 / 触摸预取：进 = onMouseEnter / onFocus（停住 120ms 才取），出 = onMouseLeave / onBlur，
 * 触 = onTouchStart（手机、平板：把事件一起给，按下 90ms 没挪才取；滑动列表时按到的那一行不取，见 触摸预取）
 */
export function useHoverPrefetch() {
  const router = useRouter();
  const 等 = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(等.current), []);
  const 进 = useCallback(
    (href: string | null | undefined) => {
      clearTimeout(等.current);
      if (!href || 省流量()) return;
      等.current = setTimeout(() => 意图预取(router, href), 停住);
    },
    [router],
  );
  const 出 = useCallback(() => clearTimeout(等.current), []);
  const 触 = useCallback(
    (href: string | null | undefined, e?: Parameters<typeof 按下点>[0]) => {
      clearTimeout(等.current);
      if (href) 触摸预取(router, href, 按下点(e));
    },
    [router],
  );
  return { 进, 出, 触 };
}
