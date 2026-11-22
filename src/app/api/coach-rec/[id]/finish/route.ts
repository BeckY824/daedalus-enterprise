import { 传完 } from "@/lib/enterprise/coach-rec-db";
import { 先过, 回 } from "../../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 传完（11-22 录音点评 PR2）：片齐了才拼成文件、进「待提交」；只有录的人，且仍能对这个项目发 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await 先过();
  if (me instanceof Response) return me;
  return 回(await 传完(me, (await ctx.params).id));
}
