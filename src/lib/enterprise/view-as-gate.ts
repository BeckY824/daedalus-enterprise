/**
 * 切换视图（只读预览，lib/enterprise/view-as.ts）期间 /api 的非 GET 一律 403，在进路由之前就挡住（proxy.ts 调）。
 * 只认开关开着（企业版 + CRM_ENT_VIEW_AS=1）、带着这个会话签的视图票（签名对、没过期、vb = 会话 sub）。
 * proxy 那一层连不了库，不核真身还是不是管理员——只会多拒、不会多放。退出登录（/api/auth/logout）放行，它顺手清视图票。
 * 只依赖 jose 和请求本身，proxy 里引得进来
 */
import { jwtVerify } from "jose";
import { 企业版 } from "./switch";

type 请求 = { method: string; nextUrl: { pathname: string }; cookies: { get(name: string): { value: string } | undefined } };

const 视图票名 = "crm_view_as";
const 会话票名 = "crm_session";
const 只读方法 = new Set(["GET", "HEAD", "OPTIONS"]);

export async function 视图挡写(request: 请求, 钥: Uint8Array): Promise<boolean> {
  if (!企业版() || process.env.CRM_ENT_VIEW_AS !== "1") return false;
  if (只读方法.has(request.method) || request.nextUrl.pathname === "/api/auth/logout") return false;
  const 票 = request.cookies.get(视图票名)?.value;
  const 会话票 = request.cookies.get(会话票名)?.value;
  if (!票 || !会话票) return false;
  try {
    const 会话 = (await jwtVerify(会话票, 钥)).payload;
    const { payload } = await jwtVerify(票, 钥);
    return typeof 会话.sub === "string" && payload.typ === "view-as" && payload.vb === 会话.sub && typeof payload.va === "string" && payload.va !== payload.vb;
  } catch {
    return false;
  }
}
