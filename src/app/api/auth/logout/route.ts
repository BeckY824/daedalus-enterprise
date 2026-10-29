import { NextResponse, type NextRequest } from "next/server";
import { destroySession } from "@/lib/auth";

/** 前端主动退出：清掉会话 Cookie，前端随后自己跳 /login。 */
export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true });
}

/**
 * 会话失效时的兜底出口：清掉 Cookie 再跳登录页。
 * requireUser() 检测到无效会话时会重定向到这里 —— 若直接跳 /login，
 * proxy.ts 见 Cookie 仍在会把请求弹回 /dashboard，导致死循环。
 */
export async function GET(request: NextRequest) {
  await destroySession();
  // 送回门口时带的原因（如 revoked / switched），原样带到登录页
  const reason = request.nextUrl.searchParams.get("reason");
  /*
    回**相对地址**，不拼 request.url（第六轮 r6-pkg B2）：standalone 服务把主机名规范成了 localhost，
    拼出来的绝对地址会把浏览器从原来的主机带到 localhost——之后的外观、列表列、停留页都存在另一个源上
  */
  return new NextResponse(null, {
    status: 307,
    headers: { Location: reason ? `/login?reason=${encodeURIComponent(reason)}` : "/login" },
  });
}
