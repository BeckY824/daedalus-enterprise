import { 存录音草稿 } from "@/lib/enterprise/coach-rec-db";
import { 先过, 回 } from "../../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 稍后再发（11-22 录音点评 PR5）：{ title, body } 存成草稿（空也行）。只有录的人；待确认、整理失败的才能存 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await 先过();
  if (me instanceof Response) return me;
  const 体 = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!体 || typeof 体 !== "object") return Response.json({ error: "参数不对" }, { status: 400 });
  return 回(await 存录音草稿(me, (await ctx.params).id, { title: 体.title, body: 体.body }));
}
