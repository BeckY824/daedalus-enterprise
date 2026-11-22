import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { 可签地址, 站点源, 签JSAPI, 签名出错 } from "@/lib/enterprise/feishu-jsapi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 飞书网页 JSAPI 鉴权签名（11-21 给录音实测页 /mic-test.html；11-22 PR3 起客户页、独立项目页的按住说话也用，lib/enterprise/feishu-jsapi.ts）。
 *
 * - 必须登录（/api 不经 proxy，这里自己查会话），未登录 401，一次飞书请求都不发
 * - 只返回 appId、timestamp、nonceStr、signature；jsapi_ticket 不出服务端
 * - 不写库、不写文件；票只在进程内存里缓存到快过期
 * - 没配 ENT_PUBLIC_URL：400「未配置站点地址」，一个都不签（Host / X-Forwarded-Host 能伪造，不拿来认本站）
 * - 只签和 ENT_PUBLIC_URL 同源的 /mic-test.html、/customers/<id>、/projects/<id> 地址，别的 400
 * - 没配飞书应用：503「未配置」，实测页照常测网页那几块
 */
export async function GET(req: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const 本站 = 站点源(process.env.ENT_PUBLIC_URL);
  if (!本站) return NextResponse.json({ error: "未配置站点地址（服务器没配 ENT_PUBLIC_URL），不签" }, { status: 400 });
  const 地址 = 可签地址(req.nextUrl.searchParams.get("url"), 本站);
  if (!地址) return NextResponse.json({ error: "只签本站实测页、客户页、项目页的地址" }, { status: 400 });
  try {
    const 签 = await 签JSAPI(地址);
    if (!签) return NextResponse.json({ error: "未配置飞书应用（库里的飞书连接或 ENT_FEISHU_APP_ID / ENT_FEISHU_APP_SECRET）" }, { status: 503 });
    return NextResponse.json(签, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const 话 = e instanceof 签名出错 ? e.message : "签名失败";
    return NextResponse.json({ error: 话 }, { status: 502 });
  }
}
