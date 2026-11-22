import { 重试整理 } from "@/lib/enterprise/coach-rec-db";
import { 先过, 回 } from "../../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 重试整理（11-22 录音点评 PR4）：只有录的人；整理失败 → 转写中，从头再交一次；占 AI 限频（5 分钟 30 次） */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await 先过();
  if (me instanceof Response) return me;
  return 回(await 重试整理(me, (await ctx.params).id));
}
