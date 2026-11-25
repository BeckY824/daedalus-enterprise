import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { 意图预取, 排预热, 重置预取闸, 预取闸状态, 常用在前, 意图间隔, 预热间隔 } from "@/lib/prefetch-full";

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

  it("当前这页、10 秒内刚取过的不再发；缓存被清（onInvalidate）后再要就照发", () => {
    const { router, 发了 } = 假路由();
    意图预取(router, "/customers/x");
    expect(发了).toEqual([]);
    意图预取(router, "/pool");
    vi.advanceTimersByTime(意图间隔 + 10);
    意图预取(router, "/pool");
    vi.advanceTimersByTime(意图间隔 + 10);
    expect(发了.map((x) => x.href)).toEqual(["/pool"]);
    发了[0].失效?.();
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
    排预热(router, ["/a", "/b"], 失效);
    排预热(router, ["/b"], 失效);
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
    排预热(router, ["/c"], undefined, 意图间隔);
    expect(发了.map((x) => x.href)).toEqual(["/a", "/b"]);
    vi.advanceTimersByTime(预热间隔);
    expect(发了.map((x) => x.href)).toEqual(["/a", "/b", "/c"]);
  });

  it("手机菜单那批用 意图间隔；常用的几页排前面", () => {
    const { router, 发了 } = 假路由();
    排预热(router, 常用在前(["/dashboard", "/overview", "/channels", "/pool", "/customers?page=2"]), undefined, 意图间隔);
    vi.advanceTimersByTime(意图间隔 * 4);
    expect(发了.map((x) => x.href)).toEqual(["/customers?page=2", "/pool", "/dashboard", "/overview", "/channels"]);
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
