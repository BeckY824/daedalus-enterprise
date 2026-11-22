import { 录音进度 } from "@/lib/enterprise/coach-rec-db";
import { 先过, 回 } from "../../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 进度（11-22 录音点评 PR2，续传用）：状态、已收到的片号和字节；只有录的人 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await 先过();
  if (me instanceof Response) return me;
  return 回(await 录音进度(me, (await ctx.params).id));
}
