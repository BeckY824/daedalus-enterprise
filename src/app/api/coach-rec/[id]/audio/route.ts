import { 取原声 } from "@/lib/enterprise/coach-rec-db";
import { 先过, 发文件 } from "../../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type 参数 = { params: Promise<{ id: string }> };

/**
 * 听原声（11-22 录音点评 PR2）：录的人（草稿也能听）、发出后的项目负责人；支持 Range（拖进度）。
 * 类型按服务端认出的格式给，带 sandbox + nosniff；不给静态地址。切换视图时拒（同上传，方案 §5）
 * PR3：录了几段的待提交录音带 ?seg=N 听第 N 段
 */
async function 出(req: Request, ctx: 参数, 只要头: boolean): Promise<Response> {
  const me = await 先过();
  if (me instanceof Response) return me;
  const r = await 取原声(me, (await ctx.params).id, new URL(req.url).searchParams.get("seg") ?? undefined);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.状态 });
  return 发文件(req, r, 只要头);
}
export function GET(req: Request, ctx: 参数) {
  return 出(req, ctx, false);
}
export function HEAD(req: Request, ctx: 参数) {
  return 出(req, ctx, true);
}
