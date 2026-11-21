/**
 * 飞书网页 JSAPI 鉴权签名（11-21，PR1 录音实测页 /mic-test.html 用）。
 *
 * 网页应用在飞书里调 tt.getRecorderManager 这类接口前，要先 h5sdk.config({ appId, timestamp, nonceStr, signature, jsApiList })。
 * signature 要用 app_secret 换来的 jsapi_ticket 算，所以只能在服务端算，浏览器只拿到签名本身：
 *
 *   令牌   复用推送那份（feishu-push.ts 飞书租户令牌，凭据 = Setting entConn.feishu，没存就看 ENT_FEISHU_APP_ID / ENT_FEISHU_APP_SECRET）
 *   票     POST /open-apis/jssdk/ticket/get（Authorization: Bearer 租户令牌）→ data.ticket、data.expire_in（秒）
 *   签名   sha1("jsapi_ticket=<票>&noncestr=<随机串>&timestamp=<毫秒>&url=<页面地址去掉 # 以后>")
 *          （飞书官方示例 larksuite/lark-samples web_app_with_jssdk 同样写法；签名 10 分钟内有效、不复用，所以每次现算）
 *
 * 不存任何东西：票只在本进程内存里缓存到快过期（和令牌一样），不落库、不写文件；票本身不回给浏览器。
 * 只签本站的实测页地址（路径必须是 /mic-test.html；配了 ENT_PUBLIC_URL 就必须和它同源），别的地址一律不签。
 */
import { createHash, randomBytes } from "node:crypto";
import { 推送凭据, 飞书租户令牌, type 推送凭据 as 凭据 } from "./feishu-push";

/** 只给这几页签（现在只有实测页） */
export const 可签页面 = new Set(["/mic-test.html"]);

/** 飞书说令牌不对 / 过期了：换新令牌再拿一次票 */
const 令牌失效码 = new Set([99991661, 99991663, 99991668]);

let 票缓存: { 键: string; 值: string; 到期: number } | null = null;

/** 测试用 */
export function 清JSAPI票() {
  票缓存 = null;
}

export class 签名出错 extends Error {}

async function 拿票(c: 凭据, 已重试 = false): Promise<string> {
  const 键 = `${c.基址}|${c.appId}`;
  if (票缓存 && 票缓存.键 === 键 && 票缓存.到期 > Date.now()) return 票缓存.值;
  // 推送那边的错误消息只有 HTTP 状态和飞书 code / msg，不带凭据，原样转给页面看
  const 令牌 = await 飞书租户令牌(c, 已重试).catch((e: unknown) => {
    throw new 签名出错(e instanceof Error ? e.message : "拿令牌失败");
  });
  const res = await fetch(`${c.基址}/open-apis/jssdk/ticket/get`, {
    method: "POST",
    headers: { Authorization: `Bearer ${令牌}`, "Content-Type": "application/json; charset=utf-8" },
  });
  const j = (await res.json().catch(() => null)) as { code?: number; msg?: string; data?: { ticket?: unknown; expire_in?: unknown } } | null;
  if (!已重试 && typeof j?.code === "number" && 令牌失效码.has(j.code)) return 拿票(c, true);
  if (!res.ok || j?.code !== 0 || typeof j?.data?.ticket !== "string" || !j.data.ticket) {
    throw new 签名出错(`拿 jsapi_ticket 失败：HTTP ${res.status}，code ${j?.code ?? "?"} ${j?.msg ?? ""}`.trim());
  }
  const 秒 = typeof j.data.expire_in === "number" && j.data.expire_in > 0 ? j.data.expire_in : 7200;
  票缓存 = { 键, 值: j.data.ticket, 到期: Date.now() + Math.max(60, 秒 - 300) * 1000 };
  return 票缓存.值;
}

/** 纯函数：按飞书的拼法算签名 */
export function 算签名(票: string, 随机串: string, 时间戳: number, 地址: string): string {
  return createHash("sha1").update(`jsapi_ticket=${票}&noncestr=${随机串}&timestamp=${时间戳}&url=${地址}`, "utf8").digest("hex");
}

/**
 * 校验要签的地址：http(s)、路径在 可签页面 里、是本站：
 *   - 配了 ENT_PUBLIC_URL（c2 就是）→ 必须和它同源（协议 + 主机 + 端口）
 *   - 没配（本机、3703）→ 主机和这次请求的 Host / X-Forwarded-Host 之一相同
 * 合格返回去掉 # 之后的地址（飞书按这个比对），不合格返回 null
 */
export function 可签地址(raw: string | null, 本站: { 公开地址?: string | null; 请求主机?: readonly (string | null | undefined)[] }): string | null {
  if (!raw || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (!可签页面.has(u.pathname)) return null;
  const 公开 = 源(本站.公开地址);
  if (公开) {
    if (u.origin !== 公开) return null;
  } else {
    const 主机们 = new Set((本站.请求主机 ?? []).filter((h): h is string => typeof h === "string" && h.trim() !== "").map((h) => h.trim().toLowerCase()));
    if (!主机们.has(u.host.toLowerCase())) return null;
  }
  return raw.split("#")[0];
}

function 源(地址: string | null | undefined): string | null {
  if (!地址 || !地址.trim()) return null;
  try {
    const u = new URL(地址.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

export type JSAPI签名 = { appId: string; timestamp: number; nonceStr: string; signature: string };

/** 没配飞书应用返回 null；飞书那边出错抛 签名出错（消息里只有 HTTP 状态和飞书的 code / msg，不带凭据） */
export async function 签JSAPI(地址: string): Promise<JSAPI签名 | null> {
  const c = await 推送凭据();
  if (!c) return null;
  const 票 = await 拿票(c);
  const nonceStr = randomBytes(16).toString("hex");
  const timestamp = Date.now();
  return { appId: c.appId, timestamp, nonceStr, signature: 算签名(票, nonceStr, timestamp, 地址) };
}
