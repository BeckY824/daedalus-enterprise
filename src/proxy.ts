import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { 企业版 } from "@/lib/enterprise/switch";
import { 企业版跳转 } from "@/lib/enterprise/web-paths";

/**
 * 与 lib/auth.ts 保持一致：生产环境缺少 AUTH_SECRET 时直接失败，
 * 不允许静默回落到硬编码默认值（那等于放任任何人伪造登录凭证）。
 */
function readSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET 未设置或长度不足 32 位，拒绝启动。");
  }
  return "dev-only-secret-change-me-in-production";
}

const SECRET = new TextEncoder().encode(readSecret());

const COOKIE = "crm_session";

/** 与 lib/auth.ts 的 COOKIE_SECURE 一致（那边连着数据库，Edge 里引不进来） */
const COOKIE_SECURE =
  process.env.COOKIE_SECURE === "true" ||
  (process.env.COOKIE_SECURE === undefined && process.env.NODE_ENV === "production");

/**
 * 保持登录（2026-10-30）：会话 30 天（lib/auth.ts SESSION_DAYS），每天第一次打开页面时顺延成从今天起再 30 天。
 * 天天用的人永远不用再登录；连着 30 天没打开才要重新登。
 */
const SESSION_DAYS = 30;
const 顺延间隔秒 = 24 * 60 * 60;

/**
 * 校验 JWT 的签名与有效期。这里跑在 Edge 运行时，连不了数据库，
 * 所以"用户是否仍然存在/在职"由 (app)/layout.tsx 的 getCurrentUser 复查。
 */
async function readSession(request: NextRequest): Promise<JWTPayload | null> {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return null;
  try {
    return (await jwtVerify(token, SECRET)).payload;
  } catch {
    return null;
  }
}

/**
 * 签发够一天了就换一张新票：内容原样（sub、ims、托管版的 ws / sc），只换 iat 和到期。
 * ims（首次签发的毫秒时刻）不动，改密码作废照样认得出这是旧会话（lib/tenant/session-cutoff.ts）；
 * 没有 ims 的老票不顺延——它们作废要按 iat 比，顺延等于把它洗白。
 */
async function 顺延(payload: JWTPayload): Promise<string | null> {
  if (typeof payload.ims !== "number" || typeof payload.iat !== "number") return null;
  if (Date.now() / 1000 - payload.iat < 顺延间隔秒) return null;
  const { iat, exp, nbf, ...留 } = payload;
  return new SignJWT(留).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${SESSION_DAYS}d`).sign(SECRET);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // 企业版网页里不留我们云端 / 桌面端的页面（注册、条款、手机伴侣、反馈），见 lib/enterprise/web-paths.ts
  if (企业版()) {
    const 去 = 企业版跳转(pathname);
    if (去) {
      const url = request.nextUrl.clone();
      url.pathname = 去;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }
  const session = await readSession(request);
  const valid = session !== null;

  // 未登录也能看的页面。注册页只在托管版有内容，自部署版进去会被服务端动作拒绝；
  // /admin 是我们的运营台，不属于任何工作区，用它自己的 ADMIN_TOKEN 保护；
  // /terms 与 /privacy 是注册前要读的条款，当然不能要求先登录；
  // /forgot 是找回密码，忘了密码的人当然是未登录状态；
  // /m 是手机版（2026-10-15）：页面本身没有数据，数据在手机本地、接口凭手机自己的令牌（Bearer），不用网页会话
  const 公开 =
    pathname === "/login" || pathname === "/signup" || pathname === "/forgot" || pathname === "/terms" || pathname === "/privacy" || pathname.startsWith("/admin") ||
    pathname === "/m" || pathname.startsWith("/m/");

  if (!valid && !公开) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const res = NextResponse.redirect(url);
    // 过期/损坏的 Cookie 就地清掉，避免下一次请求再走一遍
    res.cookies.delete(COOKIE);
    return res;
  }

  // 已登录时把登录/注册页弹回应用内。这两个不弹：
  //   /admin  —— 我们自己常是登录状态，弹了就进不去运营台；
  //   /forgot —— 要允许「已登录的人也能给自己重置」：密码泄露了想立刻换掉，
  //              弹回去他就没路走了（应用内还没有改密码的入口）。
  if (valid && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  /**
   * /reports 并进了 /overview（见 app/(app)/reports/page.tsx，那份留着兜底）。跳转放在这里而不是页面里：
   * 页面里的 redirect() 碰上已经开始流式输出的布局，Next 只能退成客户端跳转——旧书签点进来
   * 先看到一页空白的外壳再跳（e2e 零数据巡检 600ms 时抓到的就是这一瞬）。这里是一个干净的 307。
   * 不写进 next.config 的 redirects：目标里有中文，那边会把它解码进 Location 头，直接 500。
   */
  if (valid && pathname === "/reports") {
    const url = request.nextUrl.clone();
    url.pathname = "/overview";
    url.search = "";
    url.searchParams.set("view", "本年");
    return NextResponse.redirect(url);
  }

  /**
   * 把路径写进请求头：(app)/layout.tsx 要按路由决定中栏放什么（首页放「今天」、学员放列表），
   * 而 Server Component 的布局拿不到路径，只有这里能给。只是一个只读的提示，不涉及权限。
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  const 新票 = session ? await 顺延(session) : null;
  if (新票) {
    res.cookies.set(COOKIE, 新票, { httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE, path: "/", maxAge: SESSION_DAYS * 24 * 60 * 60 });
  }
  return res;
}

export const config = {
  // 排除 API 路由与静态资源；/api/auth/logout 需要能自行清 Cookie 后跳转
  matcher: ["/((?!api|_next/static|_next/image|ocr/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
