import { 丢掉这段 } from "@/lib/enterprise/coach-rec-db";
import { 先过, 回 } from "../../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 丢掉正在录的这一段（11-22 录音点评 PR3：上滑取消、不到 1 秒）：前面拼好的段留着回待提交；一段都没有的整条放弃 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await 先过();
  if (me instanceof Response) return me;
  return 回(await 丢掉这段(me, (await ctx.params).id));
}
