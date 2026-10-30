import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createSession } from "@/lib/auth";
import { 飞书登录凭据, 换飞书身份, 认飞书用户, 对外地址, 回调路径, 飞书登录出错 } from "@/lib/enterprise/feishu-login";
import { 状态Cookie, 状态Cookie选项 } from "../state";

/**
 * 飞书授权完回到这里：核 state → 用 code 换飞书身份 → 认成 CRM 账号 → 发会话进首页。
 * 出错一律回登录页带原因（feishu-<原因>），登录页说人话；URL 里不带姓名。
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const store = await cookies();
  const 存的 = store.get(状态Cookie)?.value ?? "";
  store.set(状态Cookie, "", { ...状态Cookie选项, maxAge: 0 });

  const 凭据 = await 飞书登录凭据();
  if (!凭据) return 跳("/login?reason=feishu-off");
  if (q.get("error")) return 跳("/login?reason=feishu-denied");
  const state = q.get("state") ?? "";
  const code = q.get("code") ?? "";
  if (!存的 || !同(存的, state)) return 跳("/login?reason=feishu-state");
  if (!code) return 跳("/login?reason=feishu-exchange");

  try {
    const 身份 = await 换飞书身份(code, 对外地址(request.headers) + 回调路径, 凭据);
    const 用户 = await 认飞书用户(身份);
    await createSession(用户.id);
  } catch (e) {
    if (e instanceof 飞书登录出错) return 跳(`/login?reason=feishu-${e.原因}`);
    throw e;
  }
  return 跳("/start");
}

function 同(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function 跳(location: string) {
  return new NextResponse(null, { status: 307, headers: { Location: location } });
}
