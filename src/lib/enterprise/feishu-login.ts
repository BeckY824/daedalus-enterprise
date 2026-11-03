/**
 * 企业版：用飞书身份登录（2026-10-30）。
 *
 * 走飞书「网页应用」的 OAuth 授权码：
 *   /api/auth/feishu          → 跳飞书授权页（飞书客户端里打开是免确认的，等于点开就登录）
 *   /api/auth/feishu/callback → 拿 code 换 user_access_token → 读 open_id 和姓名 → 认成 CRM 账号 → 发会话
 *
 * 凭据和导入、通讯录同步同一份：Setting `entConn.feishu`，没存就看环境变量
 * ENT_FEISHU_APP_ID / ENT_FEISHU_APP_SECRET。没配就不显示「用飞书登录」。
 *
 * 认人：先按记下的 open_id（飞书通讯录同步也会写，lib/enterprise/org-sync.ts）；没记过就按飞书给的邮箱
 * （email / enterprise_email，11-03）找**在用**的账号，再不行按姓名找，正好一个、且它还没绑别的飞书身份，
 * 就绑上（User.feishuOpenId，migrations/098）。重名、没对上、已绑别人都不放行，叫管理员处理——
 * 宁可登不进，也不能登成别人。导入建的号邮箱多是占位，所以邮箱认不出时还按姓名。
 * 手机号：CRM 的账号没有手机号这一格，没法按它认。
 */
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { 企业版 } from "@/lib/enterprise/switch";
import { multiTenant } from "@/lib/tenant/context";
import { 读连接配置 } from "@/lib/enterprise-import/adapter";

export type 飞书凭据 = { appId: string; appSecret: string };

const 有值 = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** 只有自部署的企业版、且配了飞书应用，才能用飞书登录 */
export async function 飞书登录凭据(): Promise<飞书凭据 | null> {
  if (!企业版() || multiTenant()) return null;
  const c = (await 读连接配置("feishu")) ?? {};
  const appId = 有值(c.appId) ? c.appId : process.env.ENT_FEISHU_APP_ID;
  const appSecret = 有值(c.appSecret) ? c.appSecret : process.env.ENT_FEISHU_APP_SECRET;
  return 有值(appId) && 有值(appSecret) ? { appId: appId.trim(), appSecret: appSecret.trim() } : null;
}

/**
 * 浏览器看到的本站地址，用来拼回调地址（必须和飞书后台「重定向 URL」一字不差）。
 * 优先 ENT_PUBLIC_URL；否则看 nginx 转过来的 x-forwarded-proto / x-forwarded-host；再不行用 host。
 */
export function 对外地址(h: Headers): string {
  const 配的 = process.env.ENT_PUBLIC_URL;
  if (有值(配的)) return 配的.trim().replace(/\/+$/, "");
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "localhost";
  return `${proto}://${host}`;
}

export const 回调路径 = "/api/auth/feishu/callback";

export function 飞书授权地址(appId: string, redirectUri: string, state: string): string {
  const u = new URL("https://accounts.feishu.cn/open-apis/authen/v1/authorize");
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

export class 飞书登录出错 extends Error {
  constructor(public 原因: 飞书登录失败) {
    super(原因);
  }
}

/** 登录页按这个显示人话（/login?reason=feishu-<原因>）；URL 里不带姓名 */
export type 飞书登录失败 = "off" | "state" | "denied" | "exchange" | "nomatch" | "dup" | "taken" | "inactive";

const 超时毫秒 = 15_000;

/** 飞书登录拿到的身份：open_id、姓名、飞书上的邮箱（个人邮箱 + 企业邮箱，小写、去重；没给就空） */
export type 飞书身份 = { openId: string; name: string; 邮箱们?: string[] };

/** 用授权码换飞书身份：open_id + 姓名 + 邮箱 */
export async function 换飞书身份(code: string, redirectUri: string, 凭据: 飞书凭据): Promise<飞书身份> {
  let token: string;
  try {
    const r = await fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: 凭据.appId,
        client_secret: 凭据.appSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(超时毫秒),
    });
    const j = (await r.json().catch(() => null)) as { code?: number; access_token?: string } | null;
    if (!r.ok || !j || (j.code ?? 0) !== 0 || !有值(j.access_token)) throw new 飞书登录出错("exchange");
    token = j.access_token;
  } catch (e) {
    if (e instanceof 飞书登录出错) throw e;
    throw new 飞书登录出错("exchange");
  }
  try {
    const r = await fetch("https://open.feishu.cn/open-apis/authen/v1/user_info", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(超时毫秒),
    });
    const j = (await r.json().catch(() => null)) as
      | { code?: number; data?: { open_id?: string; name?: string; email?: string; enterprise_email?: string } }
      | null;
    const openId = j?.data?.open_id;
    if (!r.ok || !j || (j.code ?? 0) !== 0 || !有值(openId)) throw new 飞书登录出错("exchange");
    const 邮箱们 = [...new Set([j.data?.email, j.data?.enterprise_email].filter(有值).map((x) => x.trim().toLowerCase()))];
    return { openId, name: (j.data?.name ?? "").trim(), 邮箱们 };
  } catch (e) {
    if (e instanceof 飞书登录出错) throw e;
    throw new 飞书登录出错("exchange");
  }
}

/** 把飞书身份认成 CRM 账号；认不出就抛 飞书登录出错，带原因 */
export async function 认飞书用户(身份: 飞书身份): Promise<{ id: string; name: string }> {
  const 绑过 = await prisma.user.findUnique({ where: { feishuOpenId: 身份.openId }, select: { id: true, name: true, active: true } });
  if (绑过) {
    if (!绑过.active) throw new 飞书登录出错("inactive");
    return { id: 绑过.id, name: 绑过.name };
  }
  // 按邮箱认（登录名存的是小写）：在用的正好一个才绑；对上的都停用了说停用；一个没对上再按姓名
  const 邮箱们 = (身份.邮箱们 ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (邮箱们.length) {
    const 对上 = await prisma.user.findMany({ where: { email: { in: 邮箱们 } }, select: { id: true, name: true, active: true, feishuOpenId: true } });
    const 在用 = 对上.filter((u) => u.active);
    if (在用.length > 1) throw new 飞书登录出错("dup");
    if (在用.length === 1) return 绑上(在用[0], 身份.openId, "邮箱");
    if (对上.length) throw new 飞书登录出错("inactive");
  }
  if (!身份.name) throw new 飞书登录出错("nomatch");
  const 同名 = await prisma.user.findMany({
    where: { name: 身份.name, active: true },
    select: { id: true, name: true, feishuOpenId: true },
    take: 2,
  });
  if (同名.length === 0) {
    // 同名的号有，但停用了：说清是停用，而不是「没对上」
    const 停用 = await prisma.user.count({ where: { name: 身份.name, active: false } });
    throw new 飞书登录出错(停用 ? "inactive" : "nomatch");
  }
  if (同名.length > 1) throw new 飞书登录出错("dup");
  return 绑上(同名[0], 身份.openId, "姓名");
}

/** 认到的账号还没绑飞书身份才绑；已绑别的 = taken */
async function 绑上(他: { id: string; name: string; feishuOpenId: string | null }, openId: string, 按: "邮箱" | "姓名") {
  if (他.feishuOpenId) throw new 飞书登录出错("taken");
  // 只在还没绑的时候绑：两个请求同时到，后到的那个改不到行
  const 改了 = await prisma.user.updateMany({ where: { id: 他.id, feishuOpenId: null }, data: { feishuOpenId: openId } });
  if (改了.count !== 1) throw new 飞书登录出错("taken");
  await recordAudit({
    user: { id: 他.id, name: 他.name },
    action: "update",
    entity: "User",
    entityId: 他.id,
    summary: `第一次用飞书登录，按${按}绑定飞书身份`,
  });
  return { id: 他.id, name: 他.name };
}

/** 管理员解绑（换了飞书号、绑错了）：下次用飞书登录重新按邮箱、姓名认 */
export async function 解绑飞书(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { feishuOpenId: null } });
}
