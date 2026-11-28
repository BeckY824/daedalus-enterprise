/**
 * 发版不打断（PR-C，lib/swap-guard.ts）：静默换版的条件、登记表、请求计数、滚动位置。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { 前台空闲毫秒, 后台满毫秒, 登记忙, 登记未提交, 撤未提交, 清登记, 能静默换, 忙数, 未提交数, 取现场, type 换版现场 } from "@/lib/swap-guard";

const 空闲现场: 换版现场 = { 后台多久: null, 空闲多久: 0, 忙: 0, 弹层: false, 未提交: 0, 打字中: false };

describe("能静默换：时间", () => {
  it("后台不满 45 秒不换，满了换", () => {
    expect(能静默换({ ...空闲现场, 后台多久: 后台满毫秒 - 1 })).toBe(false);
    expect(能静默换({ ...空闲现场, 后台多久: 后台满毫秒 })).toBe(true);
  });
  it("前台空闲不满 10 分钟不换，满了换", () => {
    expect(能静默换({ ...空闲现场, 空闲多久: 前台空闲毫秒 - 1 })).toBe(false);
    expect(能静默换({ ...空闲现场, 空闲多久: 前台空闲毫秒 })).toBe(true);
  });
  it("在后台时认后台时长，不拿前台空闲凑数", () => {
    expect(能静默换({ ...空闲现场, 后台多久: 10_000, 空闲多久: 前台空闲毫秒 * 2 })).toBe(false);
  });
});

describe("能静默换：时间到了也不换的", () => {
  const 到点 = { ...空闲现场, 后台多久: 后台满毫秒 * 2 };
  it.each([
    ["有进行中的事", { 忙: 1 }],
    ["有弹层", { 弹层: true }],
    ["有未提交录入", { 未提交: 1 }],
    ["正在长文本框里打字", { 打字中: true }],
  ])("%s", (_n, 改) => {
    expect(能静默换({ ...到点, ...改 })).toBe(false);
  });
});

describe("登记表", () => {
  afterEach(() => 清登记());
  it("忙：登记、放掉；多放无害", () => {
    const 放 = 登记忙("AI");
    const 放2 = 登记忙("上传");
    expect(忙数()).toBe(2);
    放();
    放();
    expect(忙数()).toBe(1);
    放2();
    expect(忙数()).toBe(0);
  });
  it("未提交：同一个键登记两次算一个，撤掉归零", () => {
    登记未提交("a");
    登记未提交("a");
    登记未提交("b");
    expect(未提交数()).toBe(2);
    撤未提交("a");
    撤未提交("b");
    expect(未提交数()).toBe(0);
  });
  it("取现场：时长按传进去的时刻算", () => {
    登记忙("x");
    const 现 = 取现场(1000, 500, 61_000);
    expect(现.后台多久).toBe(60_000);
    expect(现.空闲多久).toBe(60_500);
    expect(现.忙).toBe(1);
  });
});

describe("请求计数 / 滚动（浏览器环境，用最小桩）", () => {
  let 存: Record<string, string>;
  beforeEach(() => {
    vi.resetModules();
    清登记();
    存 = {};
    const 事件: Record<string, (() => void)[]> = {};
    vi.stubGlobal("window", {
      fetch: vi.fn(async (_i: unknown, init?: { method?: string }) => ({ body: null, headers: new Headers(), ok: true, method: init?.method })),
      scrollY: 120,
      scrollTo: vi.fn(),
      setTimeout: (f: () => void) => { f(); return 0; },
      addEventListener: (n: string, f: () => void) => { (事件[n] ??= []).push(f); },
      removeEventListener: () => {},
      dispatchEvent: (e: Event) => { (事件[e.type] ?? []).forEach((f) => f()); return true; },
      location: { reload: vi.fn() },
    });
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => 存[k] ?? null, setItem: (k: string, v: string) => { 存[k] = v; }, removeItem: (k: string) => { delete 存[k]; } });
    vi.stubGlobal("location", { pathname: "/customers", search: "?q=1" });
    vi.stubGlobal("document", { querySelectorAll: () => [{ scrollTop: 300 }] });
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => f());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POST 没回完算忙，回完放掉；GET 和 /api/version 不算", async () => {
    const 待: ((v: unknown) => void)[] = [];
    const 底 = vi.fn(() => new Promise((r) => { 待.push(r); }));
    (window as unknown as { fetch: unknown }).fetch = Object.assign(底, { bind: () => 底 });
    const m = await import("@/lib/swap-guard");
    m.装请求计数();
    const w = window as unknown as { fetch: (i: string, init?: { method?: string }) => Promise<unknown> };
    void w.fetch("/api/version", { method: "POST" });
    void w.fetch("/customers", { method: "GET" });
    expect(m.忙数()).toBe(0);
    const p = w.fetch("/api/ai/stream", { method: "POST" });
    expect(m.忙数()).toBe(1);
    待[待.length - 1]({ body: null, headers: new Headers() });
    await p;
    await Promise.resolve();
    expect(m.忙数()).toBe(0);
  });

  it("POST 请求失败也放掉", async () => {
    const 底 = vi.fn(() => Promise.reject(new Error("断网")));
    (window as unknown as { fetch: unknown }).fetch = Object.assign(底, { bind: () => 底 });
    const m = await import("@/lib/swap-guard");
    m.装请求计数();
    const w = window as unknown as { fetch: (i: string, init?: { method?: string }) => Promise<unknown> };
    await w.fetch("/x", { method: "POST" }).catch(() => {});
    await Promise.resolve();
    expect(m.忙数()).toBe(0);
  });

  it("记滚动 → 恢复滚动：同一个地址恢复，恢复一次就删", async () => {
    const m = await import("@/lib/swap-guard");
    m.记滚动();
    expect(Object.keys(存)).toContain("daedalus:换版滚动");
    m.恢复滚动();
    expect((window.scrollTo as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]).toEqual([0, 120]);
    expect(Object.keys(存)).toHaveLength(0);
  });

  it("换了地址不恢复", async () => {
    const m = await import("@/lib/swap-guard");
    m.记滚动();
    vi.stubGlobal("location", { pathname: "/projects", search: "" });
    m.恢复滚动();
    expect((window.scrollTo as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(0);
  });
});
