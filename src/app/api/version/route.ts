import { NextResponse } from "next/server";
import { 本次构建号 } from "@/lib/build-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 这一份服务端是哪一次构建（lib/build-id.ts）。页面上的 UpdateBanner 切回窗口时、每 5 分钟问一次，
 * 和打开页面时的编号不一样 = 发过版了，顶上提示刷新（lib/stale-deploy.ts）。
 *
 * 不看登录态、不碰库：编号本来就在静态资源路径和页面数据里，没有可藏的；多问一次也只是读一个内存里的串。
 * 除了 id 什么都不回（同 /api/health 的规矩）。不缓存：nginx、浏览器都不许记住旧编号
 */
export async function GET() {
  return NextResponse.json({ id: 本次构建号() }, { headers: { "Cache-Control": "no-store" } });
}
