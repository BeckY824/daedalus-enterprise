/**
 * 录音点评接口（/api/coach-rec/**，11-22 录音点评 PR2）共用的几步：认人 → 开关 → 切换视图拒 → 回话。
 * 判权限在 lib/enterprise/coach-rec.ts（db 层调），这里只把顺序钉死：每个接口先过这三步再判权限。
 * /api 平时不经 proxy（请求体不被截断），这里自己查会话。只有 fetch/:id（腾讯云取文件）不认会话、只认签名，不走这里。
 */
import fs from "node:fs";
import { Readable } from "node:stream";
import { getCurrentUser } from "@/lib/auth";
import { 视图拒绝响应 } from "@/lib/enterprise/view-as";
import { 录音点评开着, 没开放话 } from "@/lib/enterprise/coach-rec-db";
import { 进程并发片数, 每人并发片数 } from "@/lib/enterprise/coach-rec";
import { 解析范围 } from "@/app/ocr-files/[...path]/route";

export type 登录的人 = { id: string; name: string; role: string };

/** 认人、开关、切换视图：过了回人，没过回 Response（401 / 404 / 403） */
export async function 先过(): Promise<登录的人 | Response> {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!(await 录音点评开着())) return Response.json({ error: 没开放话 }, { status: 404 });
  const 拒 = await 视图拒绝响应();
  if (拒) return 拒;
  return me as 登录的人;
}

const 不缓存 = { "Cache-Control": "no-store" } as const;
export function 回(r: ({ ok: true } & object) | { ok: false; error: string; 状态: number }): Response {
  if (!r.ok) return Response.json({ error: r.error }, { status: r.状态, headers: 不缓存 });
  return Response.json(r, { headers: 不缓存 });
}

/**
 * 每个进程同时最多收 进程并发片数 片、每人最多 每人并发片数 片（每片边收边写盘，不整片进内存；限的是同时开着的写盘和连接）。
 * 满了接口回 429 + Retry-After，浏览器隔几秒自己重试（不算进重试次数）；占的位在 finally 里还（传同一个人的编号）
 */
let 收着 = 0;
const 每人收着 = new Map<string, number>();
export function 占片位(userId: string): boolean {
  const 他的 = 每人收着.get(userId) ?? 0;
  if (收着 >= 进程并发片数 || 他的 >= 每人并发片数) return false;
  收着 += 1;
  每人收着.set(userId, 他的 + 1);
  return true;
}
export function 还片位(userId: string): void {
  收着 = Math.max(0, 收着 - 1);
  const 他的 = (每人收着.get(userId) ?? 0) - 1;
  if (他的 > 0) 每人收着.set(userId, 他的);
  else 每人收着.delete(userId);
}
export const 片位占着 = () => 收着;

/** 把一个录音文件按 Range 发出去（回放拖进度、腾讯云分段取都要）；带 sandbox + nosniff，同 api/attachments/[id] */
export function 发文件(req: Request, f: { 文件: string; 类型: string; 大小: number; 名?: string }, 只要头 = false): Response {
  const 头 = new Headers({
    "Content-Type": f.类型,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.名 ?? "audio")}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
  });
  const 段 = 解析范围(req.headers.get("range"), f.大小);
  if (段 === "超出") {
    头.set("Content-Range", `bytes */${f.大小}`);
    return new Response(null, { status: 416, headers: 头 });
  }
  const { 起, 止 } = 段 ?? { 起: 0, 止: f.大小 - 1 };
  头.set("Content-Length", String(f.大小 === 0 ? 0 : 止 - 起 + 1));
  if (段) 头.set("Content-Range", `bytes ${起}-${止}/${f.大小}`);
  const 体 = 只要头 || f.大小 === 0 ? null : (Readable.toWeb(fs.createReadStream(f.文件, { start: 起, end: 止 })) as ReadableStream);
  return new Response(体, { status: 段 ? 206 : 200, headers: 头 });
}
