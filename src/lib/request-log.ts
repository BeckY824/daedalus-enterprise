/**
 * 慢请求日志（11-15，企业版体验优化第 0 批）：员工说「卡」时，能在 journal 里查到是哪类页面、多久、多大。
 *
 * 开：CRM_REQ_LOG=1（默认关）。只记耗时 ≥ CRM_REQ_LOG_MS 毫秒的（默认 200；设 0 全记，量预取次数时用）。
 * 每个到应用的页面（HTML）/ 站内切页与预取（RSC）/ server action（ACTION）请求结束时往 stdout 写一行：
 *
 *   [crm-req] {"t":"…","route":"/customers/[id]","kind":"RSC","ms":312,"bytes":20480,"status":200,"uid":"…","pf":1}
 *
 * - route 是路由模式（按构建产物 routes-manifest.json 对），不带具体 id、不带查询串；对不上的记 "(unmatched)"。
 *   所以搜索词、客户 id 一律进不了日志
 * - bytes 是这次响应写到连接上的字节数（含响应头；开了压缩就是压缩后的），keep-alive 连接上按前后差算
 * - uid 只记用户 id：proxy.ts 验过会话票后放进请求头 x-crm-uid。请求一进来（还没到 proxy）这里先把客户端自带的这个头删掉，
 *   结束时还在的只可能是 proxy 写的——不过 proxy 的路径（matcher 外的 /apix 之类）、proxy 抛错、proxy 当场跳转的都不带 uid。
 *   不记姓名、不查库
 * - pf=1：Next 的预取请求（next-router-prefetch 头）；abort=1：响应没写完连接就断了（人等不及走了）
 * - 左栏空闲整页预热（lib/nav-prewarm.ts）分不出来：Next 发的请求头和站内切页一样，记成不带 pf 的 RSC
 *
 * 落点：Node 自带的 diagnostics_channel「http.server.request.start」，在 instrumentation.ts 里订一次。
 * 不包 Next 的请求处理、不要自定义 server：next start 和 standalone server.js 都是同一个进程里的 http.Server，都会发这个事件。
 * 开销：每个请求一次 Map 查表 + 一个 close 监听；没到阈值的连 JSON 都不拼
 */
import fs from "node:fs";
import path from "node:path";

export const 日志前缀 = "[crm-req]";
import { 用户头 } from "./request-log-header";
import { 实例号 } from "./proc-lock";
export { 用户头 };

export type 请求种类 = "HTML" | "RSC" | "ACTION";

type 头 = Record<string, string | string[] | undefined>;

/** 不记的：静态资源、接口、Next 自己的文件。只看页面 / RSC / action */
export function 该跳过(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/") || pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/ocr/") || pathname.startsWith("/ocr-files/") || pathname.startsWith("/geo/")) return true;
  // 最后一段带点的是文件（favicon.ico、icon.svg、robots.txt…）
  const 末段 = pathname.slice(pathname.lastIndexOf("/") + 1);
  return 末段.includes(".");
}

export function 请求种类(headers: 头): 请求种类 {
  if (headers["next-action"]) return "ACTION";
  if (headers["rsc"] === "1") return "RSC";
  return "HTML";
}

type 路由表 = { 静态: Set<string>; 动态: { page: string; re: RegExp }[] };

/** routes-manifest.json 的 staticRoutes / dynamicRoutes（Next 按具体程度排好序了，按顺序对第一个） */
export function 读路由表(manifest: unknown): 路由表 | null {
  const m = manifest as { staticRoutes?: { page?: unknown }[]; dynamicRoutes?: { page?: unknown; regex?: unknown }[] } | null;
  if (!m || !Array.isArray(m.staticRoutes) || !Array.isArray(m.dynamicRoutes)) return null;
  const 静态 = new Set(m.staticRoutes.map((r) => r.page).filter((p): p is string => typeof p === "string"));
  const 动态: 路由表["动态"] = [];
  for (const r of m.dynamicRoutes) {
    if (typeof r.page !== "string" || typeof r.regex !== "string") continue;
    try {
      动态.push({ page: r.page, re: new RegExp(r.regex) });
    } catch {
      // 对不上就当没有这条
    }
  }
  return { 静态, 动态 };
}

/** 没有路由表（next dev、构建目录找不到）时的退路：像 id 的段（带数字、很长、非小写字母）换成 [x] */
function 粗归一(pathname: string): string {
  return pathname
    .split("/")
    .map((s) => (s === "" || /^[a-z][a-z-]{0,30}$/.test(s) ? s : "[x]"))
    .join("/");
}

/** 去查询串、去尾斜杠、去 Next 的 .rsc / .segments 后缀 */
export function 纯路径(url: string): string {
  let p = url;
  const q = p.search(/[?#]/);
  if (q >= 0) p = p.slice(0, q);
  const 段 = p.indexOf(".segments/");
  if (段 >= 0) p = p.slice(0, 段);
  if (p.endsWith(".rsc")) p = p.slice(0, -4);
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

export function 路由模式(pathname: string, 表: 路由表 | null): string {
  if (!表) return 粗归一(pathname);
  if (表.静态.has(pathname)) return pathname;
  for (const r of 表.动态) if (r.re.test(pathname)) return r.page;
  return "(unmatched)";
}

export type 一条 = {
  t: string;
  route: string;
  kind: 请求种类;
  ms: number;
  bytes: number;
  status: number;
  uid?: string;
  pf?: 1;
  abort?: 1;
  /** 多进程（11-16）：设了 CRM_INSTANCE 才带，journal 里分得清是哪个进程 */
  i?: number;
};

export function 拼一行(x: 一条): string {
  return `${日志前缀} ${JSON.stringify(x)}`;
}

export function 阈值(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.CRM_REQ_LOG_MS ?? 200);
  return Number.isFinite(n) && n >= 0 ? n : 200;
}

type 起点事件 = {
  request: { url?: string; method?: string; headers: 头 };
  response: { statusCode: number; writableFinished: boolean; once(ev: "close", cb: () => void): unknown };
  socket: { bytesWritten?: number } | null;
};

/** 一个请求开始时调：判断记不记、挂上结束时的监听。单独拆出来给测试用 */
export function 盯一个请求(e: 起点事件, 表: 路由表 | null, 门槛: number, 写: (行: string) => void, 现在 = () => performance.now()) {
  const { request, response, socket } = e;
  const pathname = 纯路径(request.url ?? "/");
  if (该跳过(pathname)) return;
  // 客户端自带的用户头不认：先删掉，之后再出现的只能是 proxy 验过票写进来的（resolve-routes 改的是同一个 req.headers）
  delete request.headers[用户头];
  const 起 = 现在();
  const 起字节 = socket?.bytesWritten ?? 0;
  const 墙钟 = Date.now();
  response.once("close", () => {
    // 'close' 里抛出去就是进程级的未捕获异常：记日志出了什么错都吞掉
    try {
      记一行();
    } catch {
      // 不碍事
    }
  });
  function 记一行() {
    const ms = Math.round(现在() - 起);
    if (ms < 门槛) return;
    const h = request.headers;
    const status = response.statusCode;
    const uid = typeof h[用户头] === "string" ? h[用户头] : undefined;
    const 行: 一条 = {
      t: new Date(墙钟).toISOString(),
      route: 路由模式(pathname, 表),
      kind: 请求种类(h),
      ms,
      bytes: Math.max(0, (socket?.bytesWritten ?? 起字节) - 起字节),
      status,
    };
    if (uid) 行.uid = uid;
    if (h["next-router-prefetch"]) 行.pf = 1;
    if (!response.writableFinished) 行.abort = 1;
    if (process.env.CRM_INSTANCE?.trim()) 行.i = 实例号();
    写(拼一行(行));
  }
}

let 开过 = false;

/** instrumentation.ts 调一次。CRM_REQ_LOG 不是 1 就什么都不做（不订阅、不读路由表）；回 true = 这次订上了 */
export async function 开请求日志(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (env.CRM_REQ_LOG !== "1" || 开过) return false;
  开过 = true;
  const dc = await import("node:diagnostics_channel");
  let 表: 路由表 | null = null;
  try {
    const 目录 = env.NEXT_DIST_DIR || ".next";
    表 = 读路由表(JSON.parse(fs.readFileSync(path.join(process.cwd(), 目录, "routes-manifest.json"), "utf8")));
  } catch {
    表 = null;
  }
  const 门槛 = 阈值(env);
  const 写 = (行: string) => {
    try {
      process.stdout.write(行 + "\n");
    } catch {
      // 日志写不出去不能拖垮请求
    }
  };
  dc.subscribe("http.server.request.start", (msg) => {
    try {
      盯一个请求(msg as 起点事件, 表, 门槛, 写);
    } catch {
      // 同上
    }
  });
  写(`${日志前缀} ${JSON.stringify({ start: true, thresholdMs: 门槛, routes: 表 ? 表.静态.size + 表.动态.length : 0 })}`);
  return true;
}
