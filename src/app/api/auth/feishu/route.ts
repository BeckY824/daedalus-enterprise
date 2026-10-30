import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { 飞书登录凭据, 飞书授权地址, 对外地址, 回调路径 } from "@/lib/enterprise/feishu-login";
import { 状态Cookie, 状态Cookie选项 } from "./state";

/**
 * 用飞书登录的入口：登录页的「用飞书登录」按钮、飞书工作台里应用的主页都指到这里。
 * 已经登录就直接进；否则发一个一次性 state（防跨站伪造回调），跳飞书授权页。
 * Location 写相对地址或飞书的绝对地址，不拼 request.url（同 logout：standalone 会把主机名换成 localhost）。
 */
export async function GET(request: NextRequest) {
  const 凭据 = await 飞书登录凭据();
  if (!凭据) return 跳("/login?reason=feishu-off");
  if (await getCurrentUser()) return 跳("/start");
  const state = randomBytes(16).toString("hex");
  (await cookies()).set(状态Cookie, state, 状态Cookie选项);
  return 跳(飞书授权地址(凭据.appId, 对外地址(request.headers) + 回调路径, state));
}

function 跳(location: string) {
  return new NextResponse(null, { status: 307, headers: { Location: location } });
}
