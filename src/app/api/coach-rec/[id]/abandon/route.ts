import { 放弃录音 } from "@/lib/enterprise/coach-rec-db";
import { 先过, 回 } from "../../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 放弃 / 删掉（11-22 录音点评 PR2）：只有录的人；已传的片、文件当场删；已经放弃的当成功 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await 先过();
  if (me instanceof Response) return me;
  return 回(await 放弃录音(me, (await ctx.params).id));
}
