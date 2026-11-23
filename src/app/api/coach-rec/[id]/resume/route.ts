import { 接着录 } from "@/lib/enterprise/coach-rec-db";
import { 先过, 回 } from "../../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 再按住补一段（11-22 录音点评 PR3）：只有录的人；录的、待提交 → 上传中，下一段从 段数 + 1 传 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await 先过();
  if (me instanceof Response) return me;
  return 回(await 接着录(me, (await ctx.params).id));
}
