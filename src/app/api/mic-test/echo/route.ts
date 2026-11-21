import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { 回显上限字节, 认格式, 读请求体, 超限 } from "@/lib/mic-test-echo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 录音实测页 /mic-test.html 的上传回显（11-21，录音点评 PR1，测网页录完传、飞书原生录完两种传法能不能传上来）。
 *
 * - 必须登录（/api 不经 proxy，这里自己查会话），未登录 401，请求体不读
 * - 一次 ≤20MB：声明的长度超了直接 413；没声明长度的边读边数，超了停下 413
 * - 只回「收到多少字节 + 前 16 字节认出的格式」；multipart（飞书 tt.uploadFile）另回文件那一段的字节数和格式
 * - 不落盘、不进库、不记请求体：读进内存数完就丢
 */
export async function POST(req: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const 声明 = Number(req.headers.get("content-length") ?? NaN);
  const 太大 = () => NextResponse.json({ error: `超过 ${回显上限字节 / 1024 / 1024}MB，没收` }, { status: 413 });
  if (Number.isFinite(声明) && 声明 > 回显上限字节) return 太大();
  let 体: Uint8Array;
  try {
    体 = await 读请求体(req.body);
  } catch (e) {
    if (e instanceof 超限) return 太大();
    return NextResponse.json({ error: "请求体没读完（连接断了？）" }, { status: 400 });
  }
  const 类型 = req.headers.get("content-type") ?? "";
  const 回 = { bytes: 体.byteLength, format: 认格式(体.subarray(0, 16)), head: 十六进制(体.subarray(0, 16)), contentType: 类型.slice(0, 100) } as Record<string, unknown>;
  if (/^multipart\/form-data/i.test(类型)) {
    try {
      const 表 = await new Response(体 as BodyInit, { headers: { "content-type": 类型 } }).formData();
      const 文件们: Record<string, unknown>[] = [];
      for (const [字段, 值] of 表.entries()) {
        if (typeof 值 === "string") continue;
        const 字节 = new Uint8Array(await 值.arrayBuffer());
        文件们.push({ field: 字段, name: 值.name.slice(0, 200), type: 值.type, bytes: 字节.byteLength, format: 认格式(字节.subarray(0, 16)), head: 十六进制(字节.subarray(0, 16)) });
      }
      回.files = 文件们;
    } catch {
      回.files = "multipart 解析失败";
    }
  }
  return NextResponse.json(回, { headers: { "Cache-Control": "no-store" } });
}

function 十六进制(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");
}
