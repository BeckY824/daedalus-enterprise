import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { 意图预取, 排预热, 触摸预取, 清刚取过, 开预热器, 重置预取闸, 预取闸状态, 常用在前, 意图间隔, 预热间隔, 触摸等, 预热最短, 重热等 } from "@/lib/prefetch-full";

/**
 * 整页预取的闸（跳转优化 PR-B 11-25，lib/prefetch-full）：同一标签页的整页预取不一下子挤进服务器同一个进程。
 * router.prefetch 即发即走（Next 16.4 返回 undefined），所以用最小间隔近似「同时最多一个」。
 */
type 一次 = { href: string; 失效?: () => void };
function 假路由() {
  const 发了: 一次[] = [];
  const router = { prefetch: (href: string, o?: { onInvalidate?: () => void }) => void 发了.push({ href, 失效: o?.onInvalidate }) };
  return { router: router as unknown as Parameters<typeof 意图预取>[0], 发了 };
}

let 可见 = "visible";
const 听: Record<string, (() => void)[]> = {};
beforeEach(() => {
  vi.useFakeTimers();
  重置预取闸();
  可见 = "visible";
  for (const k of Object.keys(听)) delete 听[k];
  vi.stubGlobal("location", { pathname: "/customers/x", search: "" });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("document", {
    get visibilityState() {
      return 可见;
    },
    addEventListener: (t: string, f: () => void) => void (听[t] ??= []).push(f),
    removeEventListener: (t: string, f: () => void) => void (听[t] = (听[t] ?? []).filter((x) => x !== f)),
  });
});
afterEach(() => {
  重置预取闸();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("整页预取的闸", () => {
  it("悬停：第一个马上发；间隔内连着来的只留最后一个（后到的顶掉先到的）", () => {
    const { router, 发了 } = 假路由();
    意图预取(router, "/a");
    expect(发了.map((x) => x.href)).toEqual(["/a"]);
    vi.advanceTimersByTime(50);
    意图预取(router, "/b");
    vi.advanceTimersByTime(50);
    意图预取(router, "/c");
    expect(预取闸状态().待意图).toBe("/c");
    vi.advanceTimersByTime(意图间隔);
    expect(发了.map((x) => x.href)).toEqual(["/a", "/c"]);
  });

  it("当前这页、10 秒内刚取过的不再发；缓存被清（外壳 清刚取过）后再要就照发；悬停的不挂 onInvalidate", () => {
    const { router, 发了 } = 假路由();
    意图预取(router, "/customers/x");
    expect(发了).toEqual([]);
    意图预取(router, "/pool");
    vi.advanceTimersByTime(意图间隔 + 10);
    意图预取(router, "/pool");
    vi.advanceTimersByTime(意图间隔 + 10);
    expect(发了.map((x) => x.href)).toEqual(["/pool"]);
    // 悬停 / 触摸不挂 onInvalidate（Next 16.4.6 挂着时留着整棵页面树，审查 11-25）
    expect(发了[0].失效).toBeUndefined();
    清刚取过();
    意图预取(router, "/pool");
    expect(发了.map((x) => x.href)).toEqual(["/pool", "/pool"]);
  });

  it("预热一页一页地发，每页隔 预热间隔；中间来的悬停插到前面，预热再让开一个间隔", () => {
    const { router, 发了 } = 假路由();
    排预热(router, ["/dashboard", "/pool", "/customers", "/customers/x"]);
    expect(发了.map((x) => x.href)).toEqual(["/dashboard"]);
    vi.advanceTimersByTime(100);
    意图预取(router, "/overview");
    expect(发了.map((x) => x.href)).toEqual(["/dashboard", "/overview"]);
    vi.advanceTimersByTime(预热间隔 - 1);
    expect(发了).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(发了.map((x) => x.href)).toEqual(["/dashboard", "/overview", "/pool"]);
    vi.advanceTimersByTime(预热间隔 * 3);
    // /customers/x 是当前这页，不取
    expect(发了.map((x) => x.href)).toEqual(["/dashboard", "/overview", "/pool", "/customers"]);
  });

  it("预热挂的失效会带上（保存后重热靠它）；同一个地址在队里不重复排", () => {
    const { router, 发了 } = 假路由();
    const 失效 = vi.fn();
    排预热(router, ["/a", "/b"], { 失效 });
    排预热(router, ["/b"], { 失效 });
    expect(预取闸状态().预热队).toEqual(["/b"]);
    vi.advanceTimersByTime(预热间隔 * 2);
    expect(发了.map((x) => x.href)).toEqual(["/a", "/b"]);
    发了[1].失效?.();
    expect(失效).toHaveBeenCalledTimes(1);
  });

  it("标签页在后台不预热，回到前台接着发", () => {
    const { router, 发了 } = 假路由();
    可见 = "hidden";
    排预热(router, ["/a", "/b"]);
    vi.advanceTimersByTime(预热间隔 * 3);
    expect(发了).toEqual([]);
    可见 = "visible";
    for (const f of [...(听.visibilitychange ?? [])]) f();
    expect(发了.map((x) => x.href)).toEqual(["/a"]);
    vi.advanceTimersByTime(预热间隔);
    expect(发了.map((x) => x.href)).toEqual(["/a", "/b"]);
  });

  it("人按下去了（pointerdown）：预热让开一个间隔；队里没东西时不动", () => {
    const { router, 发了 } = 假路由();
    排预热(router, ["/a", "/b"]);
    expect(发了.map((x) => x.href)).toEqual(["/a"]);
    vi.advanceTimersByTime(500);
    for (const f of 听.pointerdown ?? []) f();
    vi.advanceTimersByTime(预热间隔 - 1);
    expect(发了).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(发了.map((x) => x.href)).toEqual(["/a", "/b"]);
    // 队空了再按：下一批第一页照样马上发
    for (const f of 听.pointerdown ?? []) f();
    排预热(router, ["/c"], { 间隔: 意图间隔 });
    expect(发了.map((x) => x.href)).toEqual(["/a", "/b"]);
    vi.advanceTimersByTime(预热间隔);
    expect(发了.map((x) => x.href)).toEqual(["/a", "/b", "/c"]);
  });

  it("手机菜单那批用 意图间隔；常用的几页排前面", () => {
    const { router, 发了 } = 假路由();
    排预热(router, 常用在前(["/dashboard", "/overview", "/channels", "/pool", "/customers?page=2"]), { 间隔: 意图间隔 });
    vi.advanceTimersByTime(意图间隔 * 4);
    expect(发了.map((x) => x.href)).toEqual(["/customers?page=2", "/pool", "/dashboard", "/overview", "/channels"]);
  });

  it("撤掉这一批：没发的不再发，别的批照旧；全撤空了钟也停", () => {
    const { router, 发了 } = 假路由();
    const 撤菜单 = 排预热(router, ["/a", "/b", "/c"], { 间隔: 意图间隔 });
    排预热(router, ["/d"]);
    expect(发了.map((x) => x.href)).toEqual(["/a"]);
    撤菜单();
    expect(预取闸状态().预热队).toEqual(["/d"]);
    vi.advanceTimersByTime(预热间隔 * 3);
    expect(发了.map((x) => x.href)).toEqual(["/a", "/d"]);
    const 撤 = 排预热(router, ["/e", "/f"]);
    撤();
    expect(预取闸状态().预热队).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("地址在发出去那一刻才算（左栏地址：带记住的列表参数）；按排进来的键去重", () => {
    const { router, 发了 } = 假路由();
    let 记住 = "";
    排预热(router, ["/a", "/customers"], { 解析: (k) => (k === "/customers" ? `/customers${记住}` : k) });
    排预热(router, ["/customers"]);
    expect(预取闸状态().预热队).toEqual(["/customers"]);
    记住 = "?stage=x";
    vi.advanceTimersByTime(预热间隔);
    expect(发了.map((x) => x.href)).toEqual(["/a", "/customers?stage=x"]);
  });

  it("「刚取过」写入时扫掉超过 10 秒的旧记录", () => {
    const { router } = 假路由();
    意图预取(router, "/a");
    vi.advanceTimersByTime(5_000);
    意图预取(router, "/b");
    vi.advanceTimersByTime(6_000);
    意图预取(router, "/c");
    expect(预取闸状态().刚取过.sort()).toEqual(["/b", "/c"]);
  });

  it("省流量不取", () => {
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    const { router, 发了 } = 假路由();
    意图预取(router, "/a");
    排预热(router, ["/b"]);
    vi.advanceTimersByTime(5000);
    expect(发了).toEqual([]);
  });
});

describe("触摸预取（滑动列表不取，审查 11-25）", () => {
  const 触 = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });
  const 派 = (type: string, e: unknown = {}) => {
    for (const f of [...(听[type] ?? [])]) (f as (e: unknown) => void)(e);
  };

  it("按住不动 90ms 才取；取了之后监听都摘掉", () => {
    const { router, 发了 } = 假路由();
    触摸预取(router, "/a", { x: 10, y: 10 });
    vi.advanceTimersByTime(触摸等 - 1);
    expect(发了).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(发了.map((x) => x.href)).toEqual(["/a"]);
    for (const t of ["touchmove", "scroll", "touchcancel", "touchend"]) expect(听[t] ?? []).toHaveLength(0);
  });

  it("滑动：90ms 内挪了 10px 以上就不取；挪一点点（手指抖）照取", () => {
    const { router, 发了 } = 假路由();
    触摸预取(router, "/a", { x: 10, y: 10 });
    派("touchmove", 触(14, 13));
    vi.advanceTimersByTime(触摸等);
    expect(发了.map((x) => x.href)).toEqual(["/a"]);
    // 连着滑一串行：每一行都是按下去马上挪开，一个都不取
    for (let i = 0; i < 10; i++) {
      触摸预取(router, `/row${i}`, { x: 100, y: 300 });
      vi.advanceTimersByTime(30);
      派("touchmove", 触(100, 300 - 25));
      vi.advanceTimersByTime(300);
    }
    expect(发了.map((x) => x.href)).toEqual(["/a"]);
    expect(预取闸状态().触摸等着).toBe(false);
  });

  it("页面滚了：不取", () => {
    const { router, 发了 } = 假路由();
    触摸预取(router, "/a", { x: 0, y: 0 });
    派("scroll");
    vi.advanceTimersByTime(1000);
    expect(发了).toEqual([]);
  });

  it("触摸被取消：不取", () => {
    const { router, 发了 } = 假路由();
    触摸预取(router, "/b", { x: 0, y: 0 });
    派("touchcancel");
    vi.advanceTimersByTime(1000);
    expect(发了).toEqual([]);
  });

  it("轻点（90ms 内抬起来、没挪）：抬起那一下就取", () => {
    const { router, 发了 } = 假路由();
    触摸预取(router, "/a", { x: 0, y: 0 });
    vi.advanceTimersByTime(40);
    派("touchend");
    expect(发了.map((x) => x.href)).toEqual(["/a"]);
    vi.advanceTimersByTime(1000);
    expect(发了).toHaveLength(1);
  });

  it("没给起点：只要挪了就不取", () => {
    const { router, 发了 } = 假路由();
    触摸预取(router, "/a");
    派("touchmove", 触(0, 1));
    vi.advanceTimersByTime(1000);
    expect(发了).toEqual([]);
  });
});

describe("外壳的预热调度（开预热器：重热只一轮、限频、整批撤）", () => {
  const 名单 = ["/customers", "/pool", "/projects", "/dashboard", "/overview", "/leads"];
  /** Next 清预取缓存：已经发出去的那几页各叫一次自己的 onInvalidate */
  const 清缓存 = (发了: 一次[]) => 发了.forEach((x) => x.失效?.());

  it("第一次热整份；连着存三下（每下都清缓存）只在最后一下 2 秒后重热一轮，只热前 2 页", () => {
    vi.setSystemTime(1_000_000);
    const { router, 发了 } = 假路由();
    const 器 = 开预热器(router, 名单);
    器.热();
    vi.advanceTimersByTime(预热间隔 * 名单.length);
    expect(发了.map((x) => x.href)).toEqual(名单);
    vi.advanceTimersByTime(预热最短);
    const 前 = 发了.length;
    清缓存(发了);
    vi.advanceTimersByTime(800);
    清缓存(发了);
    vi.advanceTimersByTime(800);
    清缓存(发了);
    vi.advanceTimersByTime(重热等 - 1);
    expect(发了).toHaveLength(前);
    vi.advanceTimersByTime(1 + 预热间隔 * 5);
    expect(发了.slice(前).map((x) => x.href)).toEqual(["/customers", "/pool"]);
    器.停();
  });

  it("限频：60 秒内存了不马上热，顺延到满 60 秒那一刻补热一轮、只热前 2 页；回到页面也不提前", () => {
    vi.setSystemTime(2_000_000);
    const { router, 发了 } = 假路由();
    const 器 = 开预热器(router, 名单);
    器.热();
    vi.advanceTimersByTime(预热间隔 * 名单.length);
    expect(发了).toHaveLength(名单.length);
    清缓存(发了);
    vi.advanceTimersByTime(重热等 + 预热间隔 * 3);
    for (const f of [...(听.visibilitychange ?? [])]) f();
    vi.advanceTimersByTime(预热间隔 * 3);
    expect(发了).toHaveLength(名单.length);
    // 到「上次预热 + 60 秒」前一刻还没热
    vi.advanceTimersByTime(2_000_000 + 预热最短 - 1 - Date.now());
    expect(发了).toHaveLength(名单.length);
    vi.advanceTimersByTime(1 + 预热间隔 * 3);
    expect(发了.slice(名单.length).map((x) => x.href)).toEqual(["/customers", "/pool"]);
    // 补的这一轮之后不再自己热
    vi.advanceTimersByTime(预热最短 * 3);
    expect(发了).toHaveLength(名单.length + 2);
    器.停();
  });

  it("限频内连着存三下（隔得开、各自都走到了 热()）：只挂一个顺延钟，到 60 秒只补一轮", () => {
    vi.setSystemTime(2_500_000);
    const { router, 发了 } = 假路由();
    const 器 = 开预热器(router, 名单);
    器.热();
    vi.advanceTimersByTime(预热间隔 * 名单.length);
    for (let i = 0; i < 3; i++) {
      清缓存(发了.slice(0, 名单.length));
      vi.advanceTimersByTime(重热等 + 10_000);
    }
    expect(发了).toHaveLength(名单.length);
    vi.advanceTimersByTime(预热最短);
    expect(发了.slice(名单.length).map((x) => x.href)).toEqual(["/customers", "/pool"]);
    vi.advanceTimersByTime(预热最短 * 3);
    expect(发了).toHaveLength(名单.length + 2);
    器.停();
  });

  it("限频按标签页算：外壳重挂（新的预热器）也不在 60 秒内再热，满 60 秒才热", () => {
    vi.setSystemTime(3_000_000);
    const { router, 发了 } = 假路由();
    const 一 = 开预热器(router, ["/customers"]);
    一.热();
    一.停();
    const 二 = 开预热器(router, ["/customers"]);
    二.热();
    vi.advanceTimersByTime(预热间隔 * 3);
    expect(发了).toHaveLength(1);
    vi.advanceTimersByTime(预热最短);
    expect(发了).toHaveLength(2);
    二.停();
  });

  it("在后台不热；回到前台补上整份", () => {
    vi.setSystemTime(4_000_000);
    const { router, 发了 } = 假路由();
    可见 = "hidden";
    const 器 = 开预热器(router, ["/customers", "/pool", "/projects"]);
    器.热();
    vi.advanceTimersByTime(预热间隔 * 3);
    expect(发了).toEqual([]);
    可见 = "visible";
    for (const f of [...(听.visibilitychange ?? [])]) f();
    vi.advanceTimersByTime(预热间隔 * 3);
    expect(发了.map((x) => x.href)).toEqual(["/customers", "/pool", "/projects"]);
    器.停();
  });

  it("停()：没发的整批撤掉，重热钟也停；之后清缓存不再重热", () => {
    vi.setSystemTime(5_000_000);
    const { router, 发了 } = 假路由();
    const 器 = 开预热器(router, 名单);
    器.热();
    expect(发了).toHaveLength(1);
    // 停之前先让缓存清一次，重热钟挂上，停()才有钟可撤
    清缓存(发了);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    器.停();
    expect(vi.getTimerCount()).toBe(0);
    expect(预取闸状态().预热队).toEqual([]);
    vi.advanceTimersByTime(预热最短 * 2);
    清缓存(发了);
    vi.advanceTimersByTime(重热等 * 2);
    expect(发了).toHaveLength(1);
    expect(听.visibilitychange ?? []).toHaveLength(0);
  });

  it("停()：限频内已经挂上的顺延钟也一起停", () => {
    vi.setSystemTime(5_500_000);
    const { router, 发了 } = 假路由();
    const 器 = 开预热器(router, ["/customers"]);
    器.热();
    器.热();
    expect(发了).toHaveLength(1);
    器.停();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(预热最短 * 2);
    expect(发了).toHaveLength(1);
  });

  it("当前这页先不取，离开后补上；地址发出去那一刻按 解析 算", () => {
    vi.setSystemTime(6_000_000);
    vi.stubGlobal("location", { pathname: "/customers", search: "" });
    const { router, 发了 } = 假路由();
    const 器 = 开预热器(router, ["/customers", "/pool"], { 解析: (k) => (k === "/customers" ? "/customers?stage=x" : k) });
    器.热();
    vi.advanceTimersByTime(预热间隔 * 2);
    expect(发了.map((x) => x.href)).toEqual(["/pool"]);
    vi.stubGlobal("location", { pathname: "/customers/abc", search: "" });
    器.补漏();
    vi.advanceTimersByTime(预热间隔);
    expect(发了.map((x) => x.href)).toEqual(["/pool", "/customers?stage=x"]);
    器.停();
  });

  it("手机菜单那一批：关了就撤，没发的不再发", () => {
    const { router, 发了 } = 假路由();
    const 撤 = 排预热(router, ["/customers", "/pool", "/projects", "/dashboard"], { 间隔: 意图间隔 });
    vi.advanceTimersByTime(意图间隔);
    expect(发了.map((x) => x.href)).toEqual(["/customers", "/pool"]);
    撤();
    vi.advanceTimersByTime(意图间隔 * 5);
    expect(发了.map((x) => x.href)).toEqual(["/customers", "/pool"]);
  });
});
