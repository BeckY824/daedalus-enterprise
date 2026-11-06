import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { 飞书登录凭据, 飞书授权地址, 对外地址, 回调路径 } from "@/lib/enterprise/feishu-login";
import { 站内路径 } from "@/lib/safe-next";
import { 状态Cookie, 状态Cookie选项, 去处Cookie } from "./state";

/**
 * 用飞书登录的入口：登录页的「用飞书登录」按钮、飞书工作台里应用的主页都指到这里。
 * 已经登录就直接进；否则发一个一次性 state（防跨站伪造回调），跳飞书授权页。
 * 带 ?next= 的（点通知进来的）记进 Cookie，回调登录成功后回到那一页。
 * Location 写相对地址或飞书的绝对地址，不拼 request.url（同 logout：standalone 会把主机名换成 localhost）。
 */
export async function GET(request: NextRequest) {
  const 去处 = 站内路径(request.nextUrl.searchParams.get("next"));
  const 凭据 = await 飞书登录凭据();
  if (!凭据) return 跳(`/login?reason=feishu-off${去处 ? `&next=${encodeURIComponent(去处)}` : ""}`);
  if (await getCurrentUser()) return 跳(去处 ?? "/start");
  const state = randomBytes(16).toString("hex");
  const store = await cookies();
  store.set(状态Cookie, state, 状态Cookie选项);
  // 没带 next 的也写一次（清掉）：上一趟没走完留下的目标不能带到这一趟
  store.set(去处Cookie, 去处 ?? "", { ...状态Cookie选项, maxAge: 去处 ? 状态Cookie选项.maxAge : 0 });
  return 跳(飞书授权地址(凭据.appId, 对外地址(request.headers) + 回调路径, state));
}

function 跳(location: string) {
  return new NextResponse(null, { status: 307, headers: { Location: location } });
}
