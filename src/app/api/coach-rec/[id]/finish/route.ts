import { 传完 } from "@/lib/enterprise/coach-rec-db";
import { 先过, 回 } from "../../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 传完（11-22 录音点评 PR2）：片齐了才拼成文件、进「待提交」；只有录的人，且仍能对这个项目发。
 * PR3：录的（按住说话、点按录音）被打断时请求体带 { 打断: { 秒, 原因 } }，记进这条录音的打断记录（原因只收 coach-rec.ts 打断原因们）
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await 先过();
  if (me instanceof Response) return me;
  const 体 = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  return 回(await 传完(me, (await ctx.params).id, 体 && typeof 体 === "object" ? 体.打断 : undefined));
}
