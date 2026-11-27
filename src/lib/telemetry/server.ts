/**
 * 运行记录的服务端三件（批次 28-⑤）：
 *
 * 1. 慢请求：服务端处理超过 500 ms（CRM_TELEMETRY_SLOW_MS 可调）的页面 / 站内切页 / 服务器动作 / 接口，记路由模式和耗时。
 *    挂在 Node 自带的 diagnostics_channel「http.server.request.start」上，和 lib/request-log.ts（CRM_REQ_LOG，往 stdout 写）同一个落点、
 *    复用它的去查询串、按 routes-manifest 归路由、分请求种类；两者互不影响：那边是排查时临时开的明细，这边是常开的、落盘、给每日摘要用。
 *    和那边不同：这边也记 /api 接口（渠道页之类的慢可能在接口上），只跳过本来就长的（AI 流、MCP）和探活、上报自己
 * 2. 服务端出错：instrumentation.ts 的 onRequestError（渲染、路由、动作出错都会调）记一行，Next 的跳转信号不记
 * 3. 浏览器上报（app/api/client-report/route.ts）：限流、规整、补上角色和浏览器后落盘
 *
 * 字段规矩见 lib/telemetry/fields.ts，落盘见 lib/telemetry/store.ts，角色和短号见 lib/telemetry/who.ts
 */
import fs from "node:fs";
import path from "node:path";
import { 纯路径, 路由模式, 读路由表, 请求种类 } from "../request-log";
import { 认浏览器, 脱敏报错, 错误名, 认digest, 统一占位, 查询键名, 报错类们, type 一行, type 上报 } from "./fields";
import { 写一条, 遥测开着 } from "./store";
import { 认身份, type 身份 } from "./who";

type 头 = Record<string, string | string[] | undefined>;
type 环境 = Record<string, string | undefined>;
type 路由表 = ReturnType<typeof 读路由表>;

export const 默认慢阈值 = 500;
export function 慢阈值(env: 环境 = process.env): number {
  const n = Number(env.CRM_TELEMETRY_SLOW_MS ?? 默认慢阈值);
  return Number.isFinite(n) && n >= 0 ? n : 默认慢阈值;
}

/* ---------------- 路由表（只读一次） ---------------- */

let 表缓存: { 表: 路由表 } | undefined;
export function 路由表(env: 环境 = process.env): 路由表 {
  if (表缓存) return 表缓存.表;
  let 表: 路由表 = null;
  try {
    表 = 读路由表(JSON.parse(fs.readFileSync(path.join(process.cwd(), env.NEXT_DIST_DIR || ".next", "routes-manifest.json"), "utf8")));
  } catch {
    表 = null;
  }
  表缓存 = { 表 };
  return 表;
}

/** 浏览器报来的页面路径 → 路由模式（不带 id；对不上的记 (unmatched)，具体路径一律不落） */
export function 归路由(pathname: string, 表: 路由表 = 路由表()): string {
  return 统一占位(路由模式(纯路径(pathname), 表));
}

/* ---------------- 慢请求 ---------------- */

/** 本来就长、或是自己的，不算慢 */
const 不记的接口 = new Set(["/api/client-report", "/api/ai/stream", "/api/mcp", "/api/health", "/api/version"]);

export function 慢请求跳过(pathname: string): boolean {
  if (pathname.startsWith("/_next/") || pathname.startsWith("/ocr/") || pathname.startsWith("/ocr-files/") || pathname.startsWith("/geo/")) return true;
  if (不记的接口.has(pathname)) return true;
  const 末段 = pathname.slice(pathname.lastIndexOf("/") + 1);
  return 末段.includes(".");
}

export function 慢请求种类(pathname: string, h: 头): string {
  if (pathname === "/api" || pathname.startsWith("/api/")) return "API";
  const k = 请求种类(h);
  return k === "RSC" && h["next-router-prefetch"] ? "RSC预取" : k;
}

type 起点事件 = {
  request: { url?: string; headers: 头 };
  response: { statusCode: number; once(ev: "close", cb: () => void): unknown };
};

type 慢请求依赖 = {
  表: 路由表;
  门槛: number;
  写: (x: 一行) => void;
  认: (cookie: unknown) => Promise<身份>;
  现在?: () => number;
};

/** 一个请求开始时调：不该记的直接回；结束时超过门槛才认人、落盘。单拆出来给测试 */
export function 盯慢请求(e: 起点事件, d: 慢请求依赖) {
  const pathname = 纯路径(e.request.url ?? "/");
  if (慢请求跳过(pathname)) return;
  const 现在 = d.现在 ?? (() => performance.now());
  const 起 = 现在();
  const 墙钟 = Date.now();
  const qk = 查询键名(e.request.url);
  e.response.once("close", () => {
    try {
      const ms = Math.round(现在() - 起);
      if (ms < d.门槛) return;
      const h = e.request.headers;
      const 基: 一行 = {
        t: new Date(墙钟).toISOString(),
        k: "slow",
        src: "server",
        route: 统一占位(路由模式(pathname, d.表)),
        kind: 慢请求种类(pathname, h),
        ms,
        status: e.response.statusCode,
        role: "未登录",
        ...(qk ? { qk } : {}),
      };
      void d
        .认(h.cookie)
        .catch(() => ({ role: "未登录" }) as 身份)
        .then((谁) => d.写({ ...基, ...谁 }))
        .catch(() => null);
    } catch {
      /* 'close' 里抛出去是进程级未捕获异常：一律吞掉 */
    }
  });
}

let 开过 = false;
/** instrumentation.ts 调一次：企业版且没关（CRM_TELEMETRY=0）才订；回 true = 这次订上了 */
export async function 开慢请求记录(env: 环境 = process.env): Promise<boolean> {
  if (!遥测开着(env) || 开过) return false;
  开过 = true;
  const dc = await import("node:diagnostics_channel");
  const 依赖: 慢请求依赖 = { 表: 路由表(env), 门槛: 慢阈值(env), 写: (x) => void 写一条(x), 认: (c) => 认身份(c) };
  dc.subscribe("http.server.request.start", (msg) => {
    try {
      盯慢请求(msg as 起点事件, 依赖);
    } catch {
      /* 同上 */
    }
  });
  return true;
}

/* ---------------- 服务端出错 ---------------- */

/** Next 的控制流（redirect / notFound / 动态渲染退回），不是出错。同 lib/action-error.ts 是跳转信号 */
function 是跳转(e: unknown): boolean {
  const o = (e && typeof e === "object" ? e : {}) as { digest?: unknown; message?: unknown };
  const d = typeof o.digest === "string" ? o.digest : "";
  const m = typeof o.message === "string" ? o.message : "";
  return /^NEXT_|^DYNAMIC_SERVER_USAGE|^BAILOUT_TO_CLIENT_SIDE_RENDERING/.test(d) || /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(m);
}

/** onRequestError 那三个参数 → 一行；跳转信号回 null。routePath 本来就是路由模式（/customers/[id]） */
export function 服务端出错行(
  e: unknown,
  请求: { headers: 头 },
  场景: { routeType: string; routePath: string },
  谁: 身份,
  现在 = Date.now(),
): 一行 | null {
  if (是跳转(e)) return null;
  const o = (e && typeof e === "object" ? e : {}) as { name?: unknown; message?: unknown; digest?: unknown };
  const 浏览器 = 认浏览器(请求.headers["user-agent"]);
  const 行: 一行 = {
    t: new Date(现在).toISOString(),
    k: "err",
    src: "server",
    type: "服务端出错",
    name: 错误名(o.name),
    msg: 脱敏报错(typeof e === "string" ? e : o.message),
    route: 统一占位(String(场景.routePath || "(unmatched)").slice(0, 200)),
    kind: /^[a-z]{1,20}$/.test(场景.routeType) ? 场景.routeType : "其他",
    ...浏览器,
    ...谁,
  };
  const d = 认digest(o.digest);
  if (d) 行.digest = d;
  return 行;
}

/** instrumentation.ts onRequestError 调：开着才记，出什么错都不往外抛 */
export async function 记服务端出错(e: unknown, 请求: { headers: 头 }, 场景: { routeType: string; routePath: string }) {
  try {
    if (!遥测开着()) return;
    if (是跳转(e)) return;
    const 谁 = await 认身份(请求.headers.cookie);
    const 行 = 服务端出错行(e, 请求, 场景, 谁);
    if (行) 写一条(行);
  } catch {
    /* 不碍事 */
  }
}

/* ---------------- 浏览器上报：限流 ---------------- */

export const 包上限字节 = 4096;
/** 每个会话（没登录的按来源）10 分钟最多收 30 条；整个进程每分钟最多 300 条 */
export const 每会话上限 = 30;
export const 会话窗口毫秒 = 10 * 60_000;
export const 全局每分钟上限 = 300;

export class 限流器 {
  private 各键 = new Map<string, { 起: number; 次: number }>();
  private 全局 = { 起: 0, 次: 0 };
  constructor(
    private 每键 = 每会话上限,
    private 窗口 = 会话窗口毫秒,
    private 全局上限 = 全局每分钟上限,
  ) {}
  /** 回 true = 放行（并记一次） */
  过(键: string, 现在 = Date.now()): boolean {
    if (现在 - this.全局.起 >= 60_000) this.全局 = { 起: 现在, 次: 0 };
    if (this.全局.次 >= this.全局上限) return false;
    let x = this.各键.get(键);
    if (!x || 现在 - x.起 >= this.窗口) {
      if (this.各键.size >= 5000) for (const [k, v] of this.各键) if (现在 - v.起 >= this.窗口) this.各键.delete(k);
      if (this.各键.size >= 5000) return false;
      x = { 起: 现在, 次: 0 };
      this.各键.set(键, x);
    }
    if (x.次 >= this.每键) return false;
    x.次++;
    this.全局.次++;
    return true;
  }
}

/** 上报 + 请求头 → 落盘的一行 */
export function 上报成行(报: 上报, ua: unknown, 谁: 身份, 表: 路由表, 现在 = Date.now()): 一行 {
  const 行: 一行 = {
    t: new Date(现在).toISOString(),
    k: "err",
    src: "browser",
    type: 报错类们[报.类],
    name: 报.name,
    route: 归路由(报.path, 表),
    ...认浏览器(ua),
    ...谁,
  };
  if (报.msg) 行.msg = 报.msg;
  if (报.digest) 行.digest = 报.digest;
  return 行;
}
