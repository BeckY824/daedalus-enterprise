/**
 * 先出缓存、后台更新（跳转优化 PR-D，11-28）：客户端路由缓存调到 300 秒后，切回刚看过的页直接出缓存；
 * 这里是纯函数部分——认「这是哪一页」、判「要不要后台刷新」。碰 window 的在 components/PageFreshness.tsx。
 * 不带 "use client"：单测直接引。
 *
 * 阶段 1 只管三页：客户详情、项目详情、客户列表（其余页下一阶段）。
 */

/** 客户端路由缓存多久算新（next.config.ts staleTimes.dynamic，要同步；static 仍是 60）。超过它 Next 自己重取，不用我们再问 */
export const 缓存秒 = 300;

/** 权限 / 归属变更、发版之类「缓存里的都不可信了」的通知：PageFreshness 听到就后台换新（弹层 / 打字 / 忙时等空） */
export const 数据失效事件 = "crm:data-stale";

export type 页面种类 = "customer" | "project" | "customer-list";
export type 页面 = { 种类: 页面种类; id: string; 查询: string };

const 编号 = /^[A-Za-z0-9_-]{1,64}$/;
/** 列表上带这些筛选的不问版本（关键词、号码搜索要跑重查询；导入批次另有口径）：认页面回 null，落到 60 秒兜底（回来超 60 秒才刷），不拖慢 */
const 重筛选 = ["keyword", "phone", "batch"];

/**
 * /customers/<x>、/projects/<x> 下固定子目录（不是客户 / 项目编号）：不算详情页。
 * 新增子目录时补这里；tests/page-fresh.test.ts 扫 src/app/(app)/{customers,projects}/ 下的目录守着
 */
export const 非详情子路径: Record<"customers" | "projects", readonly string[]> = {
  customers: ["new", "dupes", "merge-requests"],
  projects: ["new", "attach", "handover"],
};

/** 地址 → 客户 / 项目详情的「区 + 末段」；固定子目录、多级路径返回 null（SlotSkeleton 骨架和认页面共用，不查编号格式） */
export function 详情地址(路径: string): { 区: "customers" | "projects"; 段: string } | null {
  const m = /^\/(customers|projects)\/([^/]+)$/.exec(路径.replace(/\/+$/, ""));
  if (!m) return null;
  const 区 = m[1] as "customers" | "projects";
  if (非详情子路径[区].includes(m[2])) return null;
  return { 区, 段: m[2] };
}

/** 地址 → 是哪一页；不是这三页返回 null */
export function 认页面(路径: string, 查询串: string): 页面 | null {
  const 干净 = 路径.replace(/\/+$/, "");
  const 详情 = 详情地址(干净);
  if (详情 && 编号.test(详情.段)) {
    return { 种类: 详情.区 === "customers" ? "customer" : "project", id: 详情.段, 查询: "" };
  }
  if (干净 === "/customers") {
    const q = new URLSearchParams(查询串);
    if (重筛选.some((k) => q.has(k))) return null;
    return { 种类: "customer-list", id: "", 查询: q.toString() };
  }
  return null;
}

export function 页面键(p: 页面): string {
  return `${p.种类}:${p.id}:${p.查询}`;
}

/**
 * 页面渲染时服务端当时的版本号（components/RenderedVersion 随页面下发、挂载时登记在这）：
 * 前端用「现在的版本 vs 这页渲染时的版本」比，不猜缓存多旧（预取 / 预热进来的页、缓存里放了几分钟的页都照样比得出来）。
 * 页面卸载时撤；只在浏览器里用，服务端渲染不碰。
 */
const 渲染版们 = new Map<string, string>();
export function 记渲染版(键: string, 版: string): void {
  渲染版们.set(键, 版);
}
export function 撤渲染版(键: string, 版: string): void {
  if (渲染版们.get(键) === 版) 渲染版们.delete(键);
}
export function 取渲染版(键: string): string | undefined {
  return 渲染版们.get(键);
}

/** 版本接口对「读不到主体（被删 / 被转走看不到）」回的值 */
export const 页已没了 = "gone";
/** 渲染时和现在都是 gone：没有可比的基线，改走 60 秒兜底（该兜底刷新），别永不刷 */
export function 该走兜底(渲染版: string | undefined | null, 现版: string | null): boolean {
  return 渲染版 === 页已没了 && 现版 === 页已没了;
}

/**
 * 到了这一页：要不要后台刷新。渲染时的版本和现在的版本都有、且不同才刷；
 * 没登记（页面还没渲染出来 / 服务端没算出版本）或现在的拿不到 → 不刷。
 */
export function 该后台刷新(渲染版: string | undefined | null, 现版: string | null): boolean {
  if (!渲染版 || !现版) return false;
  return 渲染版 !== 现版;
}

/** 没纳入「这页变了没」的页（公海、看板、首页、跟进计划、项目列表、线索……），保持以前 60 秒缓存的效果：回来距上次取的超过 60 秒就刷 */
export const 兜底秒 = 60;
/**
 * 距上次取这页过了多久 → 要不要 router.refresh。60 秒内不刷（和以前一样走缓存）；
 * 到了 300 秒缓存期 Next 自己已经重取，不再刷。没记过（第一次来）不刷。
 */
export function 该兜底刷新(上次: number | undefined, 现在: number): boolean {
  if (上次 === undefined) return false;
  const 过 = 现在 - 上次;
  return 过 > 兜底秒 * 1000 && 过 < 缓存秒 * 1000;
}

/** 清掉超过缓存期的记录（Map 只增不减会越攒越多） */
export function 清旧记录(m: Map<string, number>, 现在: number): void {
  for (const [k, t] of m) if (现在 - t >= 缓存秒 * 1000) m.delete(k);
}

/** 问版本的地址 */
export function 版本地址(p: 页面): string {
  const q = new URLSearchParams({ kind: p.种类 });
  if (p.id) q.set("id", p.id);
  if (p.查询) q.set("qs", p.查询);
  return `/api/page-version?${q.toString()}`;
}

/**
 * 铃铛问回来的「最新通知时间」：比上次见到的新 = 来了新通知 → 发数据失效事件。第一次问（没有上次）只记不发。
 * 电脑壳和手机壳各挂一份铃铛，上次见到的记在模块级、两份共用：同一条新通知只有先问回来的那份发。
 */
export function 来了新通知(上次: number | null, 现在: number): boolean {
  return 上次 !== null && 现在 > 上次;
}

/** 刷新合并：距上次 router.refresh 不到这么久就不再刷（失效事件、版本不同、兜底几路同时来也只刷一次） */
export const 刷新合并毫秒 = 2000;
export function 该合并跳过(上次刷: number, 现在: number): boolean {
  return 上次刷 > 0 && 现在 - 上次刷 < 刷新合并毫秒;
}

/**
 * 导航刚取过新数据就不再兜底刷新（11-28 修：回 A 出 2 个 RSC）：
 * 60–300 秒后回到某页，Next 自己会对过期的缓存条目重取一次（非预取 RSC）；兜底刷新若再补一次（判忙推迟 5 秒后才发），就是第 2 个。
 * 这里记「每个 路径+查询 最近一次非预取 RSC 回来的时刻」（装取数记录 包 window.fetch 记），兜底刷新前看：
 * 取于不早于「判定时刻往前 5 秒」= 导航已带来新数据，兜底不刷。数据失效事件（权限 / 归属）、版本不同、发过版不看这个，照刷。
 */
export const 新取回溯毫秒 = 5000;
const 导航取们 = new Map<string, number>();
export function 记导航取(键: string, 时刻: number): void {
  导航取们.delete(键);
  // 超 200 条删最旧的（Map 按插入顺序，重记先删再放 = 最新在后），不整表清空
  while (导航取们.size >= 200) {
    const 最旧 = 导航取们.keys().next();
    if (最旧.done) break;
    导航取们.delete(最旧.value);
  }
  导航取们.set(键, 时刻);
}
export function 取导航取(键: string): number | undefined {
  return 导航取们.get(键);
}
/** 导航已带新数据：最近一次非预取 RSC 回来的时刻 ≥ 判定时刻 − 5 秒 */
export function 导航已取新(取于: number | undefined, 判定于: number): boolean {
  return 取于 !== undefined && 取于 >= 判定于 - 新取回溯毫秒;
}
/** 地址（可带 _rsc 参数）→ 路径+查询（去掉 _rsc），和 PageFreshness 的「路径?查询」同一格式 */
export function 导航取键(地址: string): string | null {
  try {
    const u = new URL(地址, "http://x");
    u.searchParams.delete("_rsc");
    return `${u.pathname}?${u.searchParams.toString()}`;
  } catch {
    return null;
  }
}
/**
 * 「能刷就刷，忙就隔 5 秒再看，最多等 2 分钟」的调度（从 PageFreshness 抽出，便于测）。
 * 强刷待：不带键的调用（失效事件、版本不同）排队后，期间来的带键兜底调用一律按不带键处理——
 * 不清掉排队中的强刷定时、也不因「导航已取新」跳过；真刷了或放弃时才解除。
 */
export type 空了刷依赖 = {
  忙: () => boolean;
  现在: () => number;
  刷: () => void;
  取导航取: (键: string) => number | undefined;
  合并跳过: () => boolean;
  记刷: (于: number) => void;
  设钟: (f: () => void, 毫秒: number) => number;
  清钟: (id: number) => void;
  重试毫秒: number;
  最多等毫秒: number;
};
export function 建空了刷(d: 空了刷依赖): (起: number, 页记键?: string) => void {
  let 钟 = 0;
  let 强刷待 = false;
  const 空了刷 = (起: number, 页记键?: string): void => {
    // 已有强刷排着队：带键兜底调用不覆盖它（不清它的定时、不因导航已取新跳过），它到点自会刷
    if (页记键 !== undefined && 强刷待) return;
    if (页记键 === undefined) 强刷待 = true;
    const 键 = 页记键;
    d.清钟(钟);
    if (键 !== undefined && 导航已取新(d.取导航取(键), 起)) return;
    if (!d.忙()) {
      强刷待 = false;
      if (d.合并跳过()) return;
      d.记刷(d.现在());
      d.刷();
      return;
    }
    if (d.现在() - 起 >= d.最多等毫秒) {
      强刷待 = false;
      return;
    }
    钟 = d.设钟(() => 空了刷(起, 键), d.重试毫秒);
  };
  return 空了刷;
}
function 头值(h: Headers, 名: string): string | null {
  return h.get(名);
}
let 装了取数 = false;
/** 包 window.fetch：记非预取的 RSC GET 回来的时刻（预取不算：它只带壳不带动态数据）。只装一次 */
export function 装取数记录(): void {
  if (装了取数 || typeof window === "undefined" || typeof window.fetch !== "function") return;
  装了取数 = true;
  const 原 = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const p = 原(input, init);
    try {
      const req = typeof Request !== "undefined" && input instanceof Request ? input : null;
      const 方法 = (init?.method ?? req?.method ?? "GET").toUpperCase();
      // 头只建一次 Headers，再逐个读
      const hs = init?.headers ? new Headers(init.headers) : req ? req.headers : null;
      const 头 = (n: string) => (hs ? 头值(hs, n) : null);
      if (方法 === "GET" && 头("rsc") === "1" && !头("next-router-prefetch") && !头("next-router-segment-prefetch")) {
        const 地址 = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const 键 = 导航取键(地址);
        if (键) p.then((r) => { if (r.ok) 记导航取(键, Date.now()); }, () => {});
      }
    } catch {
      // 记不上就当没记，兜底照旧
    }
    return p;
  };
}

/** 一份铃铛：那颗钮 + 是不是手机壳那份 */
export type 铃铛位 = { 钮: { current: { getClientRects(): ArrayLike<unknown> } | null }; 手机: boolean };

/** 这份铃铛要不要问通知：看得见的问；都看不见时手机那份兜底问（没手机那份就电脑那份），保证至少一份在问 */
export function 该我问(我: 铃铛位, 们: Iterable<铃铛位>): boolean {
  if (!我.钮.current || 我.钮.current.getClientRects().length !== 0) return true;
  let 有手机 = 我.手机;
  for (const x of 们) {
    if (x === 我) continue;
    if (x.钮.current && x.钮.current.getClientRects().length !== 0) return false;
    if (x.手机) 有手机 = true;
  }
  return 我.手机 || !有手机;
}
