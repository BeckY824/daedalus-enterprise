/**
 * 企业版运行记录（批次 28-⑤）：字段过滤、脱敏、上报接口（限流、大小上限、没登录只收旧浏览器）、慢请求阈值、
 * 服务端出错、落盘滚动和保留、每日摘要脚本、浏览器那头的去重和上限。不连库（角色查询换成假的）、不起服务。
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SignJWT } from "jose";

vi.mock("@/lib/prisma", () => ({
  prisma: { entMember: { findUnique: async ({ where }: { where: { userId: string } }) => (where.userId === "u-norole" ? null : { bizRole: "sales, sales_mgr" }) } },
}));

import { 认浏览器, 脱敏报错, 规整上报, 指纹, 首行上限 } from "@/lib/telemetry/fields";
import { 写一条, 清旧文件, 遥测开着, 遥测目录, 重置写状态, 单文件上限字节 } from "@/lib/telemetry/store";
import { 盯慢请求, 慢阈值, 服务端出错行, 限流器, 慢请求跳过, 归路由 } from "@/lib/telemetry/server";
import { 认身份, 人员短号, 取会话票, 清角色缓存 } from "@/lib/telemetry/who";
import { readSecret } from "@/lib/secret";
import { 汇总, 读记录, 分位 } from "../scripts/telemetry-daily.mjs";

const 根 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-telemetry-"));
afterAll(() => fs.rmSync(根, { recursive: true, force: true }));
let 目录 = "";
let 序 = 0;
beforeEach(() => {
  目录 = path.join(根, `d${++序}`);
  process.env.CRM_TELEMETRY_DIR = 目录;
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.CRM_TELEMETRY;
  重置写状态();
  清角色缓存();
});

const 读全部 = (d = 目录) =>
  fs.existsSync(d)
    ? fs.readdirSync(d).flatMap((f) => fs.readFileSync(path.join(d, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>))
    : [];

const 票 = (sub: string) => new SignJWT({ sub, ims: Date.now() }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1d").sign(new TextEncoder().encode(readSecret()));

const UA_360_86 = "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36 QIHU 360SE";
const UA_SAFARI_156 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15";
const UA_FEISHU = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Lark/7.20.0 LarkLocale/zh_CN";

describe("字段：浏览器只认名、主版本、系统大类、壳", () => {
  it("86 内核的 360、Win7", () => expect(认浏览器(UA_360_86)).toEqual({ br: "Chrome 86", os: "Windows 7", shell: "360" }));
  it("Safari 留小版本（16.4 那条线）", () => expect(认浏览器(UA_SAFARI_156)).toEqual({ br: "Safari 15.6", os: "macOS" }));
  it("飞书里打开", () => expect(认浏览器(UA_FEISHU)).toEqual({ br: "Chrome 120", os: "macOS", shell: "飞书" }));
  it("Edge 先于 Chrome；没有 UA 记其他", () => {
    expect(认浏览器("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/118.0 Safari/537.36 Edg/118.0.2088").br).toBe("Edge 118");
    expect(认浏览器(undefined)).toEqual({ br: "其他", os: "其他" });
  });
});

describe("字段：报错脱敏", () => {
  it("只取第一行、网址邮箱电话 id 换掉", () => {
    const s = 脱敏报错("Failed at https://crm.example.test/customers/abc?name=张三 for bob@acme.com tel +86 138-0013-8000 id cm9x8y7z6w5v4u3t2s1r0q\n    at foo (x.js:1:2)");
    expect(s).toBe("Failed at [url] for [email] tel # id [id]");
  });
  it("引号里的：像标识符的留，像名字的换成 …", () => {
    expect(脱敏报错("Cannot read properties of undefined (reading 'name')")).toBe("Cannot read properties of undefined (reading 'name')");
    expect(脱敏报错(`Customer "Acme Trading Ltd" not found`)).toBe(`Customer "…" not found`);
  });
  it("带中文的整句不记原文，只记指纹（同一句同一个指纹）", () => {
    const a = 脱敏报错("客户张三已存在");
    expect(a).toMatch(/^中文提示#[0-9a-f]{8}$/);
    expect(a).not.toContain("张三");
    expect(脱敏报错("客户张三已存在")).toBe(a);
    expect(脱敏报错("客户「李四」电话 13800138000 重复")).toBe(`中文提示#${指纹("客户「…」电话 # 重复")}`);
  });
  it("截到 200 字；不是字符串回空", () => {
    expect(脱敏报错("x ".repeat(500)).length).toBeLessThanOrEqual(首行上限);
    expect(脱敏报错({ a: 1 })).toBe("");
  });
});

describe("字段：上报包只认几个键", () => {
  it("表单、cookie、多余的键一律丢", () => {
    const r = 规整上报({ k: "error", n: "TypeError", m: "x is not a function", d: "12345", p: "/customers/abc", form: { 电话: "138" }, cookie: "crm_session=xx" });
    expect(r).toEqual({ 类: "error", name: "TypeError", msg: "x is not a function", digest: "12345", path: "/customers/abc" });
  });
  it("认不出的类别、不是对象回 null", () => {
    expect(规整上报({ k: "whatever" })).toBeNull();
    expect(规整上报({ k: "__proto__" })).toBeNull();
    expect(规整上报("x")).toBeNull();
    expect(规整上报([])).toBeNull();
  });
  it("旧浏览器只留认得的特性代号；动作失败只认四类", () => {
    expect(规整上报({ k: "old", f: "lb,sc,<script>", p: "/login" })).toEqual({ 类: "old", name: "旧浏览器", msg: "缺 lb,sc", path: "/login" });
    expect(规整上报({ k: "action", n: "网络", m: "Failed to fetch" })?.name).toBe("网络");
    expect(规整上报({ k: "action", n: "张三" })?.name).toBe("服务端");
    expect(规整上报({ k: "error", n: "张三 的错" })?.name).toBe("Error");
  });
  it("路径归成路由模式，具体 id 不落", () => {
    expect(归路由("/customers/cm9x8y7z6w5v4u3t2s1r0q?tab=1", null)).toBe("/customers/[id]");
  });
});

describe("落盘：按天一个文件，留 14 天，单文件封顶", () => {
  it("开关：只在企业版开，CRM_TELEMETRY=0 关", () => {
    expect(遥测开着({ CRM_ENTERPRISE: "1" })).toBe(true);
    expect(遥测开着({ CRM_ENTERPRISE: "1", CRM_TELEMETRY: "0" })).toBe(false);
    expect(遥测开着({})).toBe(false);
    expect(遥测目录({ DATABASE_URL: "file:/data/crm.db" })).toBe(path.join("/data", "telemetry"));
  });

  it("写进 tel-日期.p进程号.jsonl；跨天写新文件、删 14 天前的", () => {
    const t0 = Date.parse("2026-11-18T10:00:00Z");
    expect(写一条({ t: "x", k: "err", src: "server", route: "/", role: "sales" }, { 现在: t0 })).toBe(true);
    expect(fs.readdirSync(目录)).toEqual(["tel-2026-11-18.p1.jsonl"]);
    for (const d of ["2026-11-04", "2026-11-05", "2026-11-17"]) fs.writeFileSync(path.join(目录, `tel-${d}.p2.jsonl`), "");
    fs.writeFileSync(path.join(目录, "别的文件.txt"), "");
    expect(写一条({ t: "y", k: "err", src: "server", route: "/", role: "sales" }, { 现在: t0 + 86_400_000 })).toBe(true);
    // 11-19 起留 14 天 = 11-06 及以后
    expect(fs.readdirSync(目录).sort()).toEqual(["tel-2026-11-17.p2.jsonl", "tel-2026-11-18.p1.jsonl", "tel-2026-11-19.p1.jsonl", "别的文件.txt"]);
    expect(清旧文件(目录, t0 + 30 * 86_400_000)).toBe(3);
  });

  it("单个文件到 20MB 当天不再写", () => {
    const t0 = Date.parse("2026-11-18T10:00:00Z");
    fs.mkdirSync(目录, { recursive: true });
    const f = path.join(目录, "tel-2026-11-18.p1.jsonl");
    fs.writeFileSync(f, "");
    fs.truncateSync(f, 单文件上限字节 - 10);
    expect(写一条({ t: "x", k: "err", src: "server", route: "/", role: "sales" }, { 现在: t0 })).toBe(false);
  });
});

describe("谁：只记业务角色和当天短号", () => {
  it("cookie 里只取会话票", () => {
    expect(取会话票("a=1; crm_session=abc.def; crm_view_as=zz")).toBe("abc.def");
    expect(取会话票(undefined)).toBeNull();
  });
  it("验过票才认；角色按固定顺序；没设角色记「无角色」", async () => {
    const 现在 = Date.parse("2026-11-18T10:00:00Z");
    const a = await 认身份(`crm_session=${await 票("u-1")}`, { 现在 });
    expect(a.role).toBe("sales_mgr,sales");
    expect(a.u).toMatch(/^[0-9a-f]{8}$/);
    expect(a.u).not.toContain("u-1");
    expect((await 认身份(`crm_session=${await 票("u-norole")}`, { 现在 })).role).toBe("无角色");
    expect(await 认身份("crm_session=伪造的票")).toEqual({ role: "未登录" });
    expect(await 认身份("")).toEqual({ role: "未登录" });
  });
  it("短号同一天同一人相同，隔天就变", () => {
    const d1 = Date.parse("2026-11-18T01:00:00Z");
    expect(人员短号("u-1", d1)).toBe(人员短号("u-1", d1 + 3600_000));
    expect(人员短号("u-1", d1)).not.toBe(人员短号("u-1", d1 + 86_400_000));
    expect(人员短号("u-1", d1)).not.toBe(人员短号("u-2", d1));
  });
});

describe("慢请求：超过门槛才记", () => {
  type 回调 = () => void;
  function 造(url: string, headers: Record<string, string> = {}) {
    let 收尾: 回调 = () => {};
    return {
      e: { request: { url, headers }, response: { statusCode: 200, once: (_: "close", cb: 回调) => { 收尾 = cb; } } },
      关: () => 收尾(),
    };
  }
  async function 跑(url: string, ms: number, headers: Record<string, string> = {}) {
    const 写了: Record<string, unknown>[] = [];
    let t = 0;
    const x = 造(url, headers);
    盯慢请求(x.e, { 表: null, 门槛: 500, 写: (r) => 写了.push(r), 认: async () => ({ role: "sales", u: "abcd1234" }), 现在: () => t });
    t = ms;
    x.关();
    await new Promise((r) => setTimeout(r, 0));
    return 写了;
  }

  it("默认门槛 500，可用 CRM_TELEMETRY_SLOW_MS 调", () => {
    expect(慢阈值({})).toBe(500);
    expect(慢阈值({ CRM_TELEMETRY_SLOW_MS: "800" })).toBe(800);
    expect(慢阈值({ CRM_TELEMETRY_SLOW_MS: "abc" })).toBe(500);
  });

  it("499 不记，500 记；只有路由模式、种类、耗时、状态、角色", async () => {
    expect(await 跑("/channels?kw=张三", 499)).toEqual([]);
    const [r] = await 跑("/customers/cm9x8y7z6w5v4u3t2s1r0q?tab=x", 1234, { cookie: "crm_session=x", "user-agent": UA_360_86 });
    expect(r).toMatchObject({ k: "slow", src: "server", route: "/customers/[id]", kind: "HTML", ms: 1234, status: 200, role: "sales", u: "abcd1234" });
    expect(JSON.stringify(r)).not.toMatch(/cm9x8y7|tab=|crm_session|cookie/);
  });

  it("接口、动作、预取各记各的种类；静态资源、上报自己、AI 流不记", async () => {
    expect((await 跑("/api/attachments", 600))[0].kind).toBe("API");
    expect((await 跑("/customers", 600, { "next-action": "abc" }))[0].kind).toBe("ACTION");
    expect((await 跑("/customers", 600, { rsc: "1", "next-router-prefetch": "1" }))[0].kind).toBe("RSC预取");
    for (const p of ["/_next/static/a.js", "/api/client-report", "/api/ai/stream", "/favicon.ico"]) expect(慢请求跳过(p)).toBe(true);
    expect(await 跑("/api/client-report", 5000)).toEqual([]);
  });
});

describe("服务端出错", () => {
  const 谁 = { role: "director", u: "deadbeef" };
  it("跳转信号不记", () => {
    expect(服务端出错行(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }), { headers: {} }, { routeType: "render", routePath: "/x" }, 谁)).toBeNull();
  });
  it("记路由模式、错误名、脱敏首行、digest、角色", () => {
    const r = 服务端出错行(Object.assign(new TypeError("bad value bob@acme.com\nstack"), { digest: "998877" }), { headers: { "user-agent": UA_FEISHU, cookie: "crm_session=x" } }, { routeType: "action", routePath: "/customers/[id]" }, 谁);
    expect(r).toMatchObject({ k: "err", src: "server", type: "服务端出错", name: "TypeError", msg: "bad value [email]", digest: "998877", route: "/customers/[id]", kind: "action", br: "Chrome 120", shell: "飞书", role: "director" });
    expect(JSON.stringify(r)).not.toContain("crm_session");
  });
});

describe("上报接口 POST /api/client-report", () => {
  const 叫 = async (体: string, headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/client-report/route");
    const { NextRequest } = await import("next/server");
    return POST(new NextRequest("http://localhost/api/client-report", { method: "POST", body: 体, headers: { "user-agent": UA_360_86, ...headers } }));
  };

  it("没登录：旧浏览器收（只记版本和路由），别的不落", async () => {
    const r = await 叫(JSON.stringify({ k: "old", f: "lb,fl,sc", p: "/login" }), { "x-forwarded-for": "10.0.0.1" });
    expect(r.status).toBe(204);
    expect((await 叫(JSON.stringify({ k: "error", m: "x" }), { "x-forwarded-for": "10.0.0.1" })).status).toBe(204);
    const 行们 = 读全部();
    expect(行们).toHaveLength(1);
    expect(行们[0]).toMatchObject({ k: "err", src: "browser", type: "旧浏览器", msg: "缺 lb,fl,sc", br: "Chrome 86", os: "Windows 7", shell: "360", role: "未登录" });
    expect(行们[0].u).toBeUndefined();
    expect(JSON.stringify(行们[0])).not.toMatch(/10\.0\.0\.1/);
  });

  it("登录了：报错脱敏后落，带角色和短号；不落 cookie、IP、多余字段", async () => {
    const r = await 叫(JSON.stringify({ k: "error", n: "TypeError", m: "Customer \"Acme Ltd\" phone 13800138000 failed", p: "/customers/cm9x8y7z6w5v4u3t2s1r0q?q=张三", 表单: { 名: "张三" } }), { cookie: `crm_session=${await 票("u-1")}`, "x-forwarded-for": "10.0.0.2" });
    expect(r.status).toBe(204);
    const [行] = 读全部();
    expect(行).toMatchObject({ type: "未捕获错误", name: "TypeError", msg: 'Customer "…" phone # failed', route: "/customers/[id]", role: "sales_mgr,sales" });
    expect(行.u).toMatch(/^[0-9a-f]{8}$/);
    expect(Object.keys(行).sort()).toEqual(["br", "k", "msg", "name", "os", "role", "route", "shell", "src", "t", "type", "u"]);
    expect(JSON.stringify(行)).not.toMatch(/张三|Acme|13800138000|10\.0\.0\.2|crm_session|cm9x8y7/);
  });

  it("包超过 4KB 回 413、坏 JSON 回 400，都不落", async () => {
    expect((await 叫(JSON.stringify({ k: "error", m: "x".repeat(5000) }))).status).toBe(413);
    expect((await 叫("{not json")).status).toBe(400);
    expect((await 叫(JSON.stringify({ k: "nope" }))).status).toBe(400);
    expect(读全部()).toEqual([]);
  });

  it("每会话 10 分钟 30 条，超了 429", async () => {
    const h = { "x-forwarded-for": "10.9.9.9" };
    const 码: number[] = [];
    for (let i = 0; i < 32; i++) 码.push((await 叫(JSON.stringify({ k: "old", p: "/login" }), h)).status);
    expect(码.slice(0, 30).every((c) => c === 204)).toBe(true);
    expect(码.slice(30)).toEqual([429, 429]);
    expect(读全部()).toHaveLength(30);
  });

  it("不是企业版、或关了：204，什么都不落", async () => {
    process.env.CRM_TELEMETRY = "0";
    expect((await 叫(JSON.stringify({ k: "old", p: "/login" }), { "x-forwarded-for": "10.0.0.3" })).status).toBe(204);
    process.env.CRM_TELEMETRY = "";
    delete process.env.CRM_ENTERPRISE;
    expect((await 叫(JSON.stringify({ k: "old", p: "/login" }), { "x-forwarded-for": "10.0.0.3" })).status).toBe(204);
    expect(读全部()).toEqual([]);
  });

  it("限流器：窗口过了重新计；全局每分钟封顶", () => {
    const l = new 限流器(2, 1000, 3);
    expect([l.过("a", 0), l.过("a", 1), l.过("a", 2)]).toEqual([true, true, false]);
    expect(l.过("a", 1001)).toBe(true);
    expect(l.过("b", 1002)).toBe(false); // 全局这一分钟已 3 条
    expect(l.过("b", 61_000)).toBe(true);
  });
});

describe("每日摘要脚本", () => {
  const 现在 = Date.parse("2026-11-18T06:00:00Z");
  const 时 = (h: number) => new Date(现在 - h * 3600_000).toISOString();
  const 记录 = [
    { t: 时(1), k: "err", src: "browser", type: "旧浏览器", name: "旧浏览器", msg: "缺 lb,fl,sc", route: "/login", br: "Chrome 86", os: "Windows 7", shell: "360", role: "未登录" },
    { t: 时(2), k: "err", src: "browser", type: "旧浏览器", name: "旧浏览器", msg: "缺 lb,fl,sc", route: "/login", br: "Chrome 86", os: "Windows 7", shell: "360", role: "未登录" },
    { t: 时(3), k: "err", src: "browser", type: "未捕获错误", name: "TypeError", msg: "x is not a function", route: "/channels", br: "Chrome 120", os: "macOS", role: "sales", u: "aaaa0001" },
    { t: 时(3), k: "err", src: "browser", type: "未捕获错误", name: "TypeError", msg: "x is not a function", route: "/channels", br: "Chrome 120", os: "macOS", role: "sales", u: "aaaa0002" },
    ...[600, 700, 800, 900, 3000].map((ms, i) => ({ t: 时(4 + i), k: "slow", src: "server", route: "/channels", kind: "HTML", ms, status: 200, role: "marketing_mgr" })),
    { t: 时(5), k: "slow", src: "server", route: "/api/attachments", kind: "API", ms: 520, status: 502, role: "sales" },
    { t: 时(30), k: "slow", src: "server", route: "/old", kind: "HTML", ms: 9999, status: 200, role: "sales" },
  ];

  it("分位数：最近秩", () => {
    expect(分位([600, 700, 800, 900, 3000], 0.5)).toBe(800);
    expect(分位([600, 700, 800, 900, 3000], 0.95)).toBe(3000);
    expect(分位([], 0.5)).toBe(0);
  });

  it("读最近 24 小时、按组汇总", () => {
    const d = path.join(根, "daily");
    fs.mkdirSync(d, { recursive: true });
    const 按天 = new Map<string, string[]>();
    for (const r of 记录) {
      const f = `tel-${r.t.slice(0, 10)}.p1.jsonl`;
      按天.set(f, [...(按天.get(f) ?? []), JSON.stringify(r)]);
    }
    for (const [f, ls] of 按天) fs.writeFileSync(path.join(d, f), ls.join("\n") + "\n坏行{\n");
    const { 记录: 读到, 坏行 } = 读记录(d, 现在 - 24 * 3600_000, 现在);
    expect(读到).toHaveLength(记录.length - 1);
    expect(坏行).toBeGreaterThan(0);

    const 文 = 汇总(读到, { 起: 现在 - 24 * 3600_000, 止: 现在 });
    expect(文).toContain("报错 4 条");
    expect(文).toContain("慢请求 6 条");
    expect(文).toMatch(/2 次\s+0 人 \| 旧浏览器 \| \/login \| Chrome 86（Windows 7 壳:360） \| 未登录×2/);
    expect(文).toMatch(/2 次\s+2 人 \| 未捕获错误\/TypeError \| \/channels \| Chrome 120/);
    expect(文).toMatch(/5 次 \| p50\s+800 ms \| p95\s+3000 ms \| 最慢\s+3000 ms \| HTML \/channels \| marketing_mgr×5/);
    expect(文).toMatch(/1 次 .* API \/api\/attachments \| 5xx 1/);
    expect(文).not.toContain("/old");

    // 命令行：服务器上那样跑
    const out = execFileSync(process.execPath, [path.resolve(__dirname, "../scripts/telemetry-daily.mjs"), d, "--now", new Date(现在).toISOString()], { encoding: "utf8" });
    expect(out).toContain("HTML /channels");
    expect(汇总([], { 起: 0, 止: 1 })).toContain("没有记录");
  });
});

describe("浏览器那头：攒着、去重、每页上限", () => {
  it("没装上之前攒着；装上一起发；同样的只报一次；最多 10 条", async () => {
    const 发了: string[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const 原 = { window: g.window, navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"), location: g.location };
    g.window = {};
    Object.defineProperty(globalThis, "navigator", { value: { sendBeacon: (_u: string, b: string) => (发了.push(b), true) }, configurable: true });
    g.location = { pathname: "/channels" };
    try {
      const m = await import("@/lib/telemetry/report-client");
      m.重置上报();
      m.报错("boundary", Object.assign(new Error("boom"), { digest: "123" }));
      expect(发了).toHaveLength(0);
      m.开上报();
      expect(JSON.parse(发了[0])).toEqual({ k: "boundary", n: "Error", m: "boom", d: "123", p: "/channels" });
      m.报错("boundary", Object.assign(new Error("boom"), { digest: "123" }));
      expect(发了).toHaveLength(1);
      for (let i = 0; i < 20; i++) m.报错("error", new Error(`e${i}`));
      expect(发了).toHaveLength(10);
    } finally {
      g.window = 原.window;
      if (原.navigator) Object.defineProperty(globalThis, "navigator", 原.navigator);
      g.location = 原.location;
    }
  });
});
