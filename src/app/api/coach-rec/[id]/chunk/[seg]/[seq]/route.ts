import { 收一片 } from "@/lib/enterprise/coach-rec-db";
import { 读段片, 片上限字节 } from "@/lib/enterprise/coach-rec";
import { 先过, 回, 占片位, 还片位 } from "../../../../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type 参数 = { params: Promise<{ id: string; seg: string; seq: string }> };

/**
 * 收一片（11-22 录音点评 PR2）：请求体就是这一片的字节（application/octet-stream），≤5MB；同一片重复传按片号覆盖。
 * 每片都重判权限（开始以后丢了权限、项目进了公海的就停）；第一片认文件头，认不出的拒收。
 * 每个进程同时最多收几片，满了 429 + Retry-After
 */
export async function PUT(req: Request, ctx: 参数) {
  const me = await 先过();
  if (me instanceof Response) return me;
  const { id, seg, seq } = await ctx.params;
  const 号 = 读段片(seg, seq);
  if (!号) return Response.json({ error: "段号、片号不对" }, { status: 400 });
  const 声明 = req.headers.get("content-length");
  const 声明字节 = 声明 !== null && /^\d+$/.test(声明) ? Number(声明) : null;
  if (声明字节 !== null && 声明字节 > 片上限字节) return Response.json({ error: `一片最多 ${片上限字节 / 1024 / 1024}MB` }, { status: 413 });
  if (!占片位()) return Response.json({ error: "同时在传的太多，稍后自动重试" }, { status: 429, headers: { "Retry-After": "3" } });
  try {
    return 回(await 收一片(me, id, 号.段, 号.片, req.body, 声明字节));
  } finally {
    还片位();
  }
}
