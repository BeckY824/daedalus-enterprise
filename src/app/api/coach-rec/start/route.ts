import { 开始录音 } from "@/lib/enterprise/coach-rec-db";
import { 先过, 回 } from "../common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 开始一条录音（11-22 录音点评 PR2）：{ projectId, sourceKind: "上传" | "网页录" | "飞书原生录", fileName?, bytes?, mime? }。
 * 传文件要报文件名和大小（≤200MB）。填写人 = 当前登录的人，不收 authorId。权限 = 对这个项目能发主题（lib/enterprise/coach-rec.ts）
 */
export async function POST(req: Request) {
  const me = await 先过();
  if (me instanceof Response) return me;
  const 体 = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!体 || typeof 体 !== "object") return Response.json({ error: "参数不对" }, { status: 400 });
  return 回(await 开始录音(me, { projectId: 体.projectId, sourceKind: 体.sourceKind, fileName: 体.fileName, bytes: 体.bytes, mime: 体.mime }));
}
