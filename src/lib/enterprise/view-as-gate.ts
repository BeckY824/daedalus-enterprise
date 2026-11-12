/**
 * 切换视图（只读预览，lib/enterprise/view-as.ts）在 proxy 那一层的两道（proxy.ts 调）：
 *   - /api 的非 GET：带着这个会话签的有效视图票（签名对、没过期、vb = 会话 sub、vs = 会话 ims）一律 403「只读」；
 *     带着视图票但验不过（过期、旧版没绑会话、别的会话签的、伪造的）也 403「视角已失效，请刷新页面」——
 *     没刷新的页面还挂着只读横幅，不能悄悄以本人身份写进去。退出登录（/api/auth/logout）放行，它顺手清视图票
 *   - 页面请求（GET / HEAD）带着验不过的票：proxy 把票删掉、这次渲染也当没带（视图票判 回 "坏" 时，去掉视图票 改请求头）
 * 开关关着（CRM_ENT_VIEW_AS=0）、不是企业版：当没有这个功能，不认、不拒、不删。
 * proxy 那一层连不了库，不核真身还是不是管理员——只会多拒、不会多放。只依赖 jose 和请求本身，proxy 里引得进来
 */
import { jwtVerify } from "jose";
import { 企业版 } from "./switch";

type 请求 = { method: string; nextUrl: { pathname: string }; cookies: { get(name: string): { value: string } | undefined } };

export const 视图票名 = "crm_view_as";
const 会话票名 = "crm_session";
const 只读方法 = new Set(["GET", "HEAD", "OPTIONS"]);

/** 这个请求的视图票：没带（或开关关着、不是企业版）null，有效 "有效"，带着但验不过 "坏" */
export async function 视图票判(request: 请求, 钥: Uint8Array): Promise<"有效" | "坏" | null> {
  if (!企业版() || process.env.CRM_ENT_VIEW_AS === "0") return null;
  const 票 = request.cookies.get(视图票名)?.value;
  if (!票) return null;
  const 会话票 = request.cookies.get(会话票名)?.value;
  if (!会话票) return "坏";
  try {
    const 会话 = (await jwtVerify(会话票, 钥)).payload;
    const { payload } = await jwtVerify(票, 钥);
    const ims = typeof 会话.ims === "number" ? 会话.ims : 0; // 同 view-as.ts 会话时刻（这里不引那个文件：它带 react、库）
    const 对 = typeof 会话.sub === "string" && payload.typ === "view-as" && payload.vb === 会话.sub && payload.vs === ims && typeof payload.va === "string" && payload.va !== payload.vb;
    return 对 ? "有效" : "坏";
  } catch {
    return "坏";
  }
}

/** /api 非 GET 要不要挡：有效票回 "只读"，验不过的票回 "失效"，不挡回 null */
export async function 视图挡写(request: 请求, 钥: Uint8Array): Promise<"只读" | "失效" | null> {
  if (只读方法.has(request.method) || request.nextUrl.pathname === "/api/auth/logout") return null;
  const 判 = await 视图票判(request, 钥);
  return 判 === "有效" ? "只读" : 判 === "坏" ? "失效" : null;
}

/** 从 Cookie 请求头里去掉视图票（别的 cookie 原样留着）：proxy 删坏票时，这一次渲染也当没带 */
export function 去掉视图票(cookie头: string | null): string {
  return (cookie头 ?? "")
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x && x.split("=")[0].trim() !== 视图票名)
    .join("; ");
}
