import { 提交整理 } from "@/lib/enterprise/coach-rec-db";
import { 先过, 回 } from "../../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 提交整理（11-22 录音点评 PR4）：只有录的人；待提交 → 转写中（排队，1 号进程的转写钟接着做）。要录音点评能用（开关 + 密钥 + ffmpeg） */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await 先过();
  if (me instanceof Response) return me;
  return 回(await 提交整理(me, (await ctx.params).id));
}
