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

  it("滚动恢复：内容晚撑高也恢复——每 200ms 试一次，够高才停，最多试 10 次", async () => {
    const m = await import("@/lib/swap-guard");
    m.记滚动();
    let 总高 = 500;
    let 次 = 0;
    const 排队: (() => void)[] = [];
    const w = window as unknown as { setTimeout: unknown; innerHeight: number };
    w.innerHeight = 800;
    w.setTimeout = (f: () => void) => { 排队.push(f); return 0; };
    vi.stubGlobal("document", { documentElement: { get scrollHeight() { return 总高; } }, querySelectorAll: () => [{ scrollTop: 0, scrollHeight: 3000, clientHeight: 800 }] });
    m.恢复滚动();
    const 滚 = window.scrollTo as unknown as { mock: { calls: unknown[][] } };
    expect(滚.mock.calls).toHaveLength(1);
    // 还没撑起来：一直排下一次
    while (排队.length && 次++ < 3) 排队.shift()!();
    expect(滚.mock.calls.length).toBe(4);
    expect(排队).toHaveLength(1);
    // 撑起来了（总高 − 窗口高 ≥ 120）：放完这一次就停
    总高 = 2000;
    排队.shift()!();
    expect(排队).toHaveLength(0);
    expect(滚.mock.calls.length).toBe(5);
  });

  it("滚动恢复：一直撑不起来也最多试 10 次", async () => {
    const m = await import("@/lib/swap-guard");
    m.记滚动();
    const 排队: (() => void)[] = [];
    const w = window as unknown as { setTimeout: unknown; innerHeight: number };
    w.innerHeight = 800;
    w.setTimeout = (f: () => void) => { 排队.push(f); return 0; };
    vi.stubGlobal("document", { documentElement: { scrollHeight: 500 }, querySelectorAll: () => [] });
    m.恢复滚动();
    let 次 = 0;
    while (排队.length && 次++ < 50) 排队.shift()!();
    expect((window.scrollTo as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(10);
  });

  it("5 分钟内已悄悄换过就不再悄悄换，过了 5 分钟又可以；不影响人手点刷新", async () => {
    const m = await import("@/lib/swap-guard");
    const 现 = { 后台多久: 60_000, 空闲多久: 0, 忙: 0, 弹层: false, 未提交: 0, 打字中: false };
    expect(m.近期换过()).toBe(false);
    expect(m.能静默换(现)).toBe(true);
    m.悄悄换();
    expect(m.近期换过()).toBe(true);
    expect(m.能静默换({ ...现, 刚换过: m.近期换过() })).toBe(false);
    expect(m.近期换过(Date.now() + 5 * 60_000 + 1000)).toBe(false);
  });

  it("换了地址不恢复", async () => {
    const m = await import("@/lib/swap-guard");
    m.记滚动();
    vi.stubGlobal("location", { pathname: "/projects", search: "" });
    m.恢复滚动();
    expect((window.scrollTo as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(0);
  });
});

describe("O3 PR-C 审查修复 1：忙的登记补漏", () => {
  beforeEach(() => { vi.resetModules(); 清登记(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("请求回调里抛错（r.clone 失败）也放掉，不永久忙", async () => {
    const 坏响应 = { body: {}, headers: new Headers({ "content-type": "text/event-stream" }), clone: () => { throw new Error("body used"); } };
    const 底 = vi.fn(async () => 坏响应);
    vi.stubGlobal("window", { fetch: Object.assign(底, { bind: () => 底 }) });
    const m = await import("@/lib/swap-guard");
    m.装请求计数();
    await (window as unknown as { fetch: (i: string, init: object) => Promise<unknown> }).fetch("/api/ai", { method: "POST" });
    await Promise.resolve();
    expect(m.忙数()).toBe(0);
  });

  it("正在打字：聚焦且有值的单行框算，空的 / 密码 / 复选框不算", async () => {
    const m = await import("@/lib/swap-guard");
    const 框 = (tagName: string, type: string, value: string) => ({ activeElement: { tagName, type, value, isContentEditable: false } }) as unknown as Document;
    expect(m.正在打字(框("INPUT", "text", "张"))).toBe(true);
    for (const t of ["search", "tel", "email", "url"]) expect(m.正在打字(框("INPUT", t, "x"))).toBe(true);
    expect(m.正在打字(框("INPUT", "text", "  "))).toBe(false);
    expect(m.正在打字(框("INPUT", "password", "x"))).toBe(false);
    expect(m.正在打字(框("INPUT", "checkbox", "on"))).toBe(false);
  });

  it("输入法组字中不换，上屏（compositionend）后才放", async () => {
    const 听: Record<string, () => void> = {};
    vi.stubGlobal("document", { addEventListener: (n: string, f: () => void) => { 听[n] = f; }, activeElement: null });
    const m = await import("@/lib/swap-guard");
    m.装输入监听();
    expect(m.正在打字()).toBe(false);
    听.compositionstart();
    expect(m.正在打字()).toBe(true);
    听.compositionend();
    expect(m.正在打字()).toBe(false);
  });

  it("点开 file input 算忙：选完（change）放；取消（cancel）放；回到页面 3 秒后放", async () => {
    vi.useFakeTimers();
    const 听: Record<string, (e?: unknown) => void> = {};
    const 窗听: Record<string, () => void> = {};
    vi.stubGlobal("window", { addEventListener: (n: string, f: () => void) => { 窗听[n] = f; }, removeEventListener: () => {} });
    vi.stubGlobal("document", { visibilityState: "hidden", addEventListener: (n: string, f: () => void) => { 听[n] = f; }, removeEventListener: () => {} });
    const m = await import("@/lib/swap-guard");
    m.装输入监听();
    const 点开 = () => {
      const 事: Record<string, () => void> = {};
      const 框 = { tagName: "INPUT", type: "file", addEventListener: (n: string, f: () => void) => { 事[n] = f; }, removeEventListener: () => {} };
      听.click({ target: 框 });
      return 事;
    };
    let 事 = 点开();
    expect(m.忙数()).toBe(1);
    事.change();
    expect(m.忙数()).toBe(0);
    事 = 点开();
    事.cancel();
    expect(m.忙数()).toBe(0);
    点开();
    expect(m.忙数()).toBe(1);
    (document as unknown as { visibilityState: string }).visibilityState = "visible";
    听.visibilitychange();
    vi.advanceTimersByTime(2_900);
    expect(m.忙数()).toBe(1);
    vi.advanceTimersByTime(200);
    expect(m.忙数()).toBe(0);
  });

  it("点开 file input 的兜底：下一次 pointerdown / keydown 放；都没有则 10 分钟上限强制放", async () => {
    vi.useFakeTimers();
    const 听: Record<string, (e?: unknown) => void> = {};
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal("document", {
      visibilityState: "hidden",
      addEventListener: (n: string, f: () => void) => { 听[n] = f; },
      removeEventListener: (n: string, f: () => void) => { if (听[n] === f) delete 听[n]; },
    });
    const m = await import("@/lib/swap-guard");
    m.装输入监听();
    const 点开 = () => 听.click({ target: { tagName: "INPUT", type: "file", addEventListener: () => {}, removeEventListener: () => {} } });
    点开();
    expect(m.忙数()).toBe(1);
    听.pointerdown();
    expect(m.忙数()).toBe(0);
    点开();
    expect(m.忙数()).toBe(1);
    听.keydown();
    expect(m.忙数()).toBe(0);
    点开();
    vi.advanceTimersByTime(10 * 60_000 - 1_000);
    expect(m.忙数()).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect(m.忙数()).toBe(0);
  });

  it("导出中登记忙：客户页导出的 effect 同时登记忙 / 卸载时放", async () => {
    const { readFileSync } = await import("node:fs");
    const 源 = readFileSync("src/app/(app)/customers/CustomersView.tsx", "utf8");
    expect(源).toMatch(/if \(!导出中\) return;\s*const 放忙 = 登记忙\("导出"\);/);
    expect(源).toMatch(/return \(\) => \{ 放忙\(\);/);
  });

  it("网页录：rec.start 抛错不留忙；成功后录音中算忙，停完放", async () => {
    let 抛 = true;
    const 轨 = { addEventListener() {}, removeEventListener() {}, stop() {} };
    class 假录 { state = "inactive"; mimeType = "audio/webm"; ondataavailable: unknown; onstop: (() => void) | null = null; onerror: unknown;
      static isTypeSupported() { return true; }
      start() { if (抛) throw new Error("start 失败"); this.state = "recording"; }
      stop() { this.state = "inactive"; this.onstop?.(); } }
    vi.stubGlobal("window", { MediaRecorder: 假录 });
    vi.stubGlobal("MediaRecorder", 假录);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const 流 = { getAudioTracks: () => [轨] } as unknown as MediaStream;
    const m = await import("@/lib/swap-guard");
    const { 开录 } = await import("@/components/CoachRecorder/web-recorder");
    expect(() => 开录(流, { 每片毫秒: 15_000, 片到了() {} })).toThrow("start 失败");
    expect(m.忙数()).toBe(0);
    抛 = false;
    const r = 开录(流, { 每片毫秒: 15_000, 片到了() {} });
    expect(m.忙数()).toBe(1);
    await r.停();
    expect(m.忙数()).toBe(0);
  });
});
