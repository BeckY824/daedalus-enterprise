/**
 * 登录后回哪（?next=）的校验（2026-11-06）：只收本站的相对路径，别的一律当没有。
 * 这个值来自 URL，会写进 Location 头，放过一个 //evil.com 就成了开放跳转，所以每种绕法都要挡：
 * 双斜杠、反斜杠（浏览器把 \ 当 /）、制表符和换行（URL 解析时被吞掉）、编码过的以上几种（多层也算）、/..//evil 这种归一化后才露出来的。
 * 跑在 Edge（proxy）和 Node（登录页、飞书路由），不能引数据库。
 */
const 最长 = 1024;
const 最多解码层数 = 3;
const 假站 = "http://x.invalid";
/** 回到这些地方没有意义：登录相关的页会再弹回来，接口和静态资源不是给人看的页 */
const 不回 = ["/login", "/signup", "/forgot", "/api", "/_next"];

const 形状对 = (s: string) => s.startsWith("/") && !s.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(s);

/** 只看路径那段：查询串里的 %25、%2F 是正常内容，解它只会误伤 */
const 路径段 = (s: string) => s.split(/[?#]/, 1)[0];

function 归一路径(路径: string): string | null {
  try {
    const u = new URL(路径, 假站);
    return u.origin === 假站 && 形状对(u.pathname) ? u.pathname : null;
  } catch {
    return null;
  }
}

/** 合格就返回规整后的路径（路径 + 查询 + 锚点，非 ASCII 已编码，能放进 Location 头）；不合格返回 null */
export function 站内路径(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || raw.length > 最长 || !形状对(raw)) return null;
  let 这层 = 路径段(raw);
  for (let 层 = 0; ; 层++) {
    const 归一 = 归一路径(这层);
    if (!形状对(这层) || !归一) return null;
    if (不回.some((p) => 归一 === p || 归一.startsWith(`${p}/`))) return null;
    let 下层: string;
    try {
      下层 = decodeURIComponent(这层);
    } catch {
      return null;
    }
    if (下层 === 这层) break;
    if (层 >= 最多解码层数) return null;
    这层 = 下层;
  }
  const u = new URL(raw, 假站);
  const 结果 = u.pathname + u.search + u.hash;
  return 结果.length > 最长 ? null : 结果;
}

/** 接飞书入口的地址：带上登录后回哪 */
export const 飞书登录地址 = (去处?: string | null) => `/api/auth/feishu${去处 ? `?next=${encodeURIComponent(去处)}` : ""}`;
