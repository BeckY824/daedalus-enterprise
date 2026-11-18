/**
 * 服务器动作报错的全局兜底（批次 25C，复盘第 1 类「发版后老页面提交失败」同类排查）：
 *
 * 1. 浏览器里没人接住的动作报错（unhandledrejection，components/UpdateBanner.tsx 听）：认得出的给一句中文（全局兜底话），
 *    不露英文、不白屏；认不出的（别的代码自己的错）不管
 * 2. 各处 catch、AI 卡、确认按钮：英文原文不给人看（给人看的错），换成中文；原文进日志（console.error）
 * 3. 服务端：instrumentation.ts 的 onRequestError 把动作报错记一行（动作出错日志行）：路由、动作编号、digest、原文，不带 cookie
 *
 * 「认得出」的几种（Next 16.4 客户端实际抛的）：
 * - 老版本动作：UnrecognizedActionError（lib/stale-deploy.ts）
 * - 断网：fetch 抛 TypeError，Chrome「Failed to fetch」、Firefox「NetworkError when attempting to fetch resource.」、Safari「Load failed」
 * - 超时：TimeoutError（AbortSignal.timeout）
 * - 服务端出错：生产构建里动作抛的错被换成「An error occurred in the Server Components render…」并带 digest；
 *   重启途中 nginx 回 502 错页时 Next 说「An unexpected response was received from the server.」；流断了 React 说「Connection closed.」
 * 人自己取消的（AbortError）、Next 的跳转信号（digest 以 NEXT_ 开头）不算出错。
 *
 * 4. 企业版运行记录（28-⑤）：给人看的错 认出是动作这一层的（旧版本 / 网络 / 超时 / 服务端），顺手报一条「动作失败」
 *    （lib/telemetry/report-client.ts，只在浏览器里、装上了才真发；服务端、单测里什么都不做）。没人接住的那种由 components/ErrorReporter.tsx 报
 *
 * 纯函数、不带 "use client"：服务端（instrumentation）、浏览器、单测（tests/action-error.test.ts）都能引
 */
import { 是旧版本动作错, 动作出错话 } from "./stale-deploy";
import { 报错 } from "./telemetry/report-client";

export const 网络断了话 = "网络断了一下，没连上服务器，请检查网络后再试";
export const 超时话 = "等了太久没有回应，请稍后再试";
/** 没人接住的服务端出错：后面带编号（digest），反馈时报这个编号就能在服务端日志里找到原文 */
export const 服务端出错话 = "刚才的操作没成功，请稍后再试";
/** AI 卡、AI 任务出错时的默认那句（上游英文原文不给人看） */
export const AI没答上来话 = "AI 这次没答上来，请稍后再试";

export type 动作错类 = "旧版本" | "网络" | "超时" | "服务端";

const 含中文 = /[一-鿿]/;
/**
 * 一段里夹着英文报错（三个以上连着的英文词、或 Error / ECONNRESET 这类）：中文句子里夹着也不给人看。
 * 「API Key」「WhatsApp」这种一两个词的产品名不算
 */
const 夹英文报错 = /[A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){2,}|\b(?:Error|Exception|ECONN\w*|ETIMEDOUT|ENOTFOUND)\b/;

function 名(e: unknown): string {
  return e && typeof e === "object" && typeof (e as { name?: unknown }).name === "string" ? (e as { name: string }).name : "";
}
function 原话(e: unknown): string {
  if (typeof e === "string") return e;
  return e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string" ? (e as { message: string }).message : "";
}
function 编号(e: unknown): string {
  return e && typeof e === "object" && typeof (e as { digest?: unknown }).digest === "string" ? (e as { digest: string }).digest : "";
}
/** Next 的控制流（redirect / notFound / 动态渲染退回），不是出错 */
function 是跳转信号(e: unknown): boolean {
  const d = 编号(e);
  return /^NEXT_|^DYNAMIC_SERVER_USAGE|^BAILOUT_TO_CLIENT_SIDE_RENDERING/.test(d) || /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(原话(e));
}

/** 是不是动作 / 请求这一层的出错、哪一种；别的（代码自己的错、取消、跳转）回 null */
export function 认动作错(e: unknown): 动作错类 | null {
  if (是旧版本动作错(e)) return "旧版本";
  if (!e || typeof e !== "object") return null;
  if (是跳转信号(e)) return null;
  const n = 名(e);
  const m = 原话(e);
  if (n === "AbortError") return null;
  if (n === "TimeoutError" || /\btimed? ?out\b|ETIMEDOUT/i.test(m)) return "超时";
  if (/Failed to fetch|NetworkError when attempting|^Load failed$|^fetch failed$|Network request failed/i.test(m)) return "网络";
  if (编号(e)) return "服务端";
  if (/Server Components render|An unexpected response was received from the server|^Connection closed\.?$/i.test(m)) return "服务端";
  return null;
}

/**
 * catch 里、AI 卡上给人看的那句：
 * - 自己写的中文（服务端回的 error、前端 new Error("…")）照原样给
 * - 老版本动作 → 「系统刚更新了，请刷新页面后再提交」（顺手点亮横幅）
 * - 断网 / 超时各一句；别的英文原文 → 原来那句（默认），原文进日志
 * 场合：日志前缀，排查时知道是哪一块（「AI 卡」「反馈」…）
 */
export function 给人看的错(e: unknown, 默认: string, 场合 = "出错"): string {
  const 类 = 认动作错(e);
  if (类) 报错("action", e, 类);
  if (类 === "旧版本") return 动作出错话(e, 默认);
  const 话 = 原话(e).trim();
  if (!类 && 话 && 含中文.test(话) && !夹英文报错.test(话) && !编号(e)) return 话;
  if (话 || e) console.error(`[${场合}] 换成中文给人看，原文：`, e);
  if (类 === "网络") return 网络断了话;
  if (类 === "超时") return 超时话;
  return 默认;
}

/** 没人接住的动作报错给人看的那句；不是动作这一层的错回 null（不管、照浏览器默认进控制台） */
export function 全局兜底话(e: unknown): string | null {
  const 类 = 认动作错(e);
  if (!类) return null;
  if (类 === "旧版本") return 动作出错话(e, 服务端出错话);
  if (类 === "网络") return 网络断了话;
  if (类 === "超时") return 超时话;
  const d = 编号(e);
  return d ? `${服务端出错话}（编号 ${d.slice(0, 16)}）` : 服务端出错话;
}

type 请求 = { path: string; method: string; headers: Record<string, string | string[] | undefined> };
type 场景 = { routeType: string; routePath: string };

/** 服务端日志那一行（instrumentation onRequestError 调）：只记动作；跳转信号不记；不带 cookie 等请求头 */
export function 动作出错日志行(e: unknown, 请求: 请求, 场景: 场景): string | null {
  if (场景.routeType !== "action") return null;
  if (是跳转信号(e)) return null;
  const 动作 = 请求.headers["next-action"];
  const 动作号 = Array.isArray(动作) ? 动作[0] : 动作;
  const 段 = [
    "[动作出错]",
    `${请求.method} ${请求.path}`,
    `路由=${场景.routePath}`,
    动作号 ? `动作=${String(动作号).slice(0, 64)}` : "",
    编号(e) ? `digest=${编号(e)}` : "",
    `${名(e) || "Error"}: ${原话(e).slice(0, 500)}`,
  ];
  return 段.filter(Boolean).join(" ");
}
