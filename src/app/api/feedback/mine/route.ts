import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { multiTenant } from "@/lib/tenant/context";
import { 认领, 取Bearer } from "@/lib/tenant/device-token";
import { 我的反馈, 接着说 } from "@/lib/feedback-thread";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 「我的反馈」：我发过的反馈，和每条下面的往来（2026-10-19）。和 /api/feedback 一样一条路由两种身份：
 *
 *   云端（托管那台）—— 认设备令牌。**只回令牌对应的那个账号的**，令牌不对 401。
 *   其余部署（企业版、自部署）—— 没有我们的云，回「不可用」，页面据此只摆 GitHub issues 那条路。
 *   原来桌面端本地服务带设备令牌转去云端的那条分支，死代码第三批删了（企业版里 本地模式() 恒为假）。
 */
export async function GET(req: Request) {
  const bearer = 取Bearer(req);
  if (bearer && multiTenant()) {
    const who = await 认领(bearer);
    if (!who) return NextResponse.json({ error: "令牌无效" }, { status: 401 });
    return NextResponse.json({ 反馈: await 我的反馈(who.accountId) });
  }

  await requireUser();
  return NextResponse.json({ 可用: false, 反馈: [], 未读数: 0, 原因: "不是桌面端" });
}

/** 接着说：{ feedbackId, body, clientKey } */
export async function POST(req: Request) {
  let raw: { feedbackId?: unknown; body?: unknown; clientKey?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const feedbackId = typeof raw.feedbackId === "string" ? raw.feedbackId : "";
  const body = typeof raw.body === "string" ? raw.body : "";
  const clientKey = typeof raw.clientKey === "string" ? raw.clientKey : "";

  const bearer = 取Bearer(req);
  if (bearer && multiTenant()) {
    const who = await 认领(bearer);
    if (!who) return NextResponse.json({ error: "令牌无效" }, { status: 401 });
    const r = await 接着说({ accountId: who.accountId, feedbackId, body, clientKey });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, 消息: r.消息 });
  }

  await requireUser();
  return NextResponse.json({ error: "这个部署不往外发反馈" }, { status: 501 });
}
