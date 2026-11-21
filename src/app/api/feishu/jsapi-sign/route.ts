import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { 可签地址, 签JSAPI, 签名出错 } from "@/lib/enterprise/feishu-jsapi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 飞书网页 JSAPI 鉴权签名（11-21，只给录音实测页 /mic-test.html 用，lib/enterprise/feishu-jsapi.ts）。
 *
 * - 必须登录（/api 不经 proxy，这里自己查会话），未登录 401，一次飞书请求都不发
 * - 只返回 appId、timestamp、nonceStr、signature；jsapi_ticket 不出服务端
 * - 不写库、不写文件；票只在进程内存里缓存到快过期
 * - 只签本站 /mic-test.html 的地址（配了 ENT_PUBLIC_URL 就要和它同源），别的 400
 * - 没配飞书应用：503「未配置」，实测页照常测网页那几块
 */
export async function GET(req: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const 地址 = 可签地址(req.nextUrl.searchParams.get("url"), {
    公开地址: process.env.ENT_PUBLIC_URL,
    请求主机: [req.headers.get("x-forwarded-host"), req.headers.get("host")],
  });
  if (!地址) return NextResponse.json({ error: "只签本站 /mic-test.html 的地址" }, { status: 400 });
  try {
    const 签 = await 签JSAPI(地址);
    if (!签) return NextResponse.json({ error: "未配置飞书应用（库里的飞书连接或 ENT_FEISHU_APP_ID / ENT_FEISHU_APP_SECRET）" }, { status: 503 });
    return NextResponse.json(签, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const 话 = e instanceof 签名出错 ? e.message : "签名失败";
    return NextResponse.json({ error: 话 }, { status: 502 });
  }
}
