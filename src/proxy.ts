import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { 企业版 } from "@/lib/enterprise/switch";
import { 企业版跳转 } from "@/lib/enterprise/web-paths";
import { 站内路径 } from "@/lib/safe-next";
import { 视图只读话, 视图失效话 } from "@/lib/enterprise/view-as-words";
import { 视图挡写, 视图票判, 视图票名, 去掉视图票 } from "@/lib/enterprise/view-as-gate";

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

/**
 * 没登录打开某一页，登录后要回到这一页（11-06）：飞书里点通知的人多半是这样进来的，登录完进首页就丢了目标。
 * 只记打开页面（GET），首页类的不用记。查询串里的 _rsc 是 Next 自己的，不留
 */
function 登录后回来(request: NextRequest): string | null {
  const { pathname, search } = request.nextUrl;
  if (request.method !== "GET" || pathname === "/" || pathname === "/start" || pathname === "/dashboard") return null;
  const q = new URLSearchParams(search);
  q.delete("_rsc");
  const 串 = q.toString();
  return 站内路径(串 ? `${pathname}?${串}` : pathname);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // /api 只为切换视图进来：别的照旧不经过这里（登录跳转、页面跳转都不管 /api）
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    // 切换视图期间只读；带着验不过的视图票也拒（页面还挂着只读横幅，不能悄悄以本人身份写），见 view-as-gate.ts
    const 挡 = await 视图挡写(request, SECRET);
    if (挡) return NextResponse.json({ error: 挡 === "只读" ? 视图只读话 : 视图失效话 }, { status: 403 });
    return NextResponse.next();
  }
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
  // 视图票验不过（过期、旧版没绑会话、换了会话）：打开页面时删掉，这次渲染也当没带——只读横幅消失、以真身渲染。
  // 非 GET（server action）不删：那次写由 加上限定 拒、提示刷新（lib/enterprise/view-as.ts），删了的话再点一下就以真身写进去了
  const 坏视图票 = (request.method === "GET" || request.method === "HEAD") && (await 视图票判(request, SECRET)) === "坏";

  // 未登录也能看的页面。注册页只在托管版有内容，自部署版进去会被服务端动作拒绝；
  // /terms 与 /privacy 是注册前要读的条款，当然不能要求先登录；
  // /forgot 是找回密码，忘了密码的人当然是未登录状态；
  // /m 是手机版（2026-10-15）：页面本身没有数据，数据在手机本地、接口凭手机自己的令牌（Bearer），不用网页会话
  const 公开 =
    pathname === "/login" || pathname === "/signup" || pathname === "/forgot" || pathname === "/terms" || pathname === "/privacy" ||
    pathname === "/m" || pathname.startsWith("/m/");

  if (!valid && !公开) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const 回来 = 登录后回来(request);
    if (回来) {
      url.search = "";
      url.searchParams.set("next", 回来);
    }
    const res = NextResponse.redirect(url);
    // 过期/损坏的 Cookie 就地清掉，避免下一次请求再走一遍
    res.cookies.delete(COOKIE);
    if (坏视图票) res.cookies.delete(视图票名);
    return res;
  }

  // 已登录时把登录/注册页弹回应用内。/forgot 不弹：
  //   /forgot —— 要允许「已登录的人也能给自己重置」：密码泄露了想立刻换掉，
  //              弹回去他就没路走了（应用内还没有改密码的入口）。
  if (valid && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    // 已经登录了又点到带 next 的登录页（比如开着两个标签）：直接去要去的那页
    const 去处 = pathname === "/login" ? 站内路径(url.searchParams.get("next")) : null;
    if (去处) {
      const 目标 = new URL(去处, "http://x.invalid");
      url.pathname = 目标.pathname;
      url.search = 目标.search;
      url.hash = 目标.hash;
    } else {
      url.pathname = "/dashboard";
      url.searchParams.delete("next");
    }
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
  if (坏视图票) requestHeaders.set("cookie", 去掉视图票(request.headers.get("cookie")));
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  if (坏视图票) res.cookies.delete(视图票名);
  const 新票 = session ? await 顺延(session) : null;
  if (新票) {
    res.cookies.set(COOKIE, 新票, { httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE, path: "/", maxAge: SESSION_DAYS * 24 * 60 * 60 });
  }
  return res;
}

export const config = {
  // 排除 API 路由与静态资源（geo/ 是复盘页世界地图的国家边界）；/api/auth/logout 需要能自行清 Cookie 后跳转
  // /api/:path* 只为切换视图期间挡非 GET（见 视图挡写），别的一律原样放过
  matcher: ["/((?!api|_next/static|_next/image|ocr/|geo/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)", "/api/:path*"],
};
