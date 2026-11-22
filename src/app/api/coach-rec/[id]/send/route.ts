import { 发录音点评 } from "@/lib/enterprise/coach-topic-db";
import { 先过, 回 } from "../../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 发出录音点评（11-22 录音点评 PR5）：{ title, body }。只有录的人；待确认、整理失败的才能发；
 * 走发主题同一套权限、上限、通知（lib/enterprise/coach-topic-db.ts 发录音点评），录音改成已发出、记上主题编号
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await 先过();
  if (me instanceof Response) return me;
  const 体 = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!体 || typeof 体 !== "object") return Response.json({ error: "参数不对" }, { status: 400 });
  const r = await 发录音点评(me, (await ctx.params).id, { title: 体.title, body: 体.body, 版本: 体.版本 });
  return 回(r.ok ? r : { ok: false, error: r.error, 状态: "状态" in r ? r.状态 : 400 });
}
