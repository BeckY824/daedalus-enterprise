import { 取给转写 } from "@/lib/enterprise/coach-rec-db";
import { 验取文件签名 } from "@/lib/enterprise/coach-rec-sign";
import { 发文件 } from "../../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type 参数 = { params: Promise<{ id: string }> };

/**
 * 给腾讯云取录音文件（11-22 录音点评 PR2 建好，PR4 转写 >5MB 时才签出地址，方案 §4.3）：
 *   - 不认会话，只认签名（lib/enterprise/coach-rec-sign.ts：HMAC、30 分钟过期、只能下签名里这一条）
 *   - 还要这条正在转写（状态 = 转写中）、开关开着；任一不对一律 404，不分说哪一条不对
 *   - 不写库、不记签名串
 * src/proxy.ts 的公开名单里放了这个前缀（/api 平时不经 proxy；带着切换视图票进来时也不跳登录）
 */
async function 出(req: Request, ctx: 参数, 只要头: boolean): Promise<Response> {
  const id = (await ctx.params).id;
  const q = new URL(req.url).searchParams;
  if (!验取文件签名(id, q.get("exp"), q.get("sig"))) return new Response("Not Found", { status: 404 });
  const f = await 取给转写(id);
  if (!f) return new Response("Not Found", { status: 404 });
  return 发文件(req, f, 只要头);
}
export function GET(req: Request, ctx: 参数) {
  return 出(req, ctx, false);
}
export function HEAD(req: Request, ctx: 参数) {
  return 出(req, ctx, true);
}
