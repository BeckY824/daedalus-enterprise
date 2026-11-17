/**
 * 扫名片识别文件（public/ocr/）的出口：next.config.ts 把 /ocr/* 在找 public 文件之前改写到这里（beforeFiles）。
 *
 * 2026-10-20 用户在伦敦第一次下载「识别模型没下载下来」：Next 自己出 public 文件时不带长度、断了从头来。这里换成：
 *   - 带 Content-Length（浏览器能显示进度）、ETag、认 Range：浏览器缓存里下了一半的文件，下次能接着下
 *     （Chrome 会自己带 Range + If-Range 续）
 * 11-17 起只回原文件，不再按 Accept-Encoding 挑预压缩的 .br / .gz、不带 Content-Encoding：
 * Next 16.4.5 起路由响应里的 Content-Encoding / Content-Length 会被 Next 删掉（GHSA-pc58-hwjq-p385），
 * 再给压缩字节，浏览器就把它当原文件读，识别模型直接坏掉。压缩交给 Next 的 compress 或前面的反代
 * （正式服务器打包时本来就不带 .br / .gz，一直回的是原文件）。Content-Length 照带，经 Next 出去时会被删，以实际传的为准。
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const 根 = path.join(process.cwd(), "public/ocr");

const 类型: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".tar": "application/x-tar",
  ".json": "application/json; charset=utf-8",
};

/** 只认单段 bytes=a-b / a- / -n；不合法的当没带（给整份），超出范围的回 416 */
export function 解析范围(range: string | null, 大小: number): { 起: number; 止: number } | "超出" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range?.trim() ?? "");
  if (!m || (!m[1] && !m[2])) return null;
  let 起: number, 止: number;
  if (!m[1]) { 起 = Math.max(0, 大小 - Number(m[2])); 止 = 大小 - 1; }
  else { 起 = Number(m[1]); 止 = m[2] ? Math.min(Number(m[2]), 大小 - 1) : 大小 - 1; }
  if (起 > 止 || 起 >= 大小) return "超出";
  return { 起, 止 };
}

/** 只许 public/ocr 下面、每一段都是普通文件名（不许 ..、隐藏文件） */
function 找文件(段们: string[]): string | null {
  if (!段们.length || 段们.some((s) => !/^[\w-][\w.-]*$/.test(s))) return null;
  const 文件 = path.join(根, ...段们);
  if (!文件.startsWith(根 + path.sep)) return null;
  try { return fs.statSync(文件).isFile() ? 文件 : null; } catch { return null; }
}

async function 出(req: Request, ctx: { params: Promise<{ path: string[] }> }, 只要头: boolean): Promise<Response> {
  const 文件 = 找文件((await ctx.params).path);
  if (!文件) return new Response("Not Found", { status: 404 });
  const 原 = fs.statSync(文件);
  const 总 = 原.size;
  // 后缀 -id 沿用原来「原文件」那一版的 ETag，浏览器里已缓存的原文件照样认
  const etag = `"${原.size.toString(36)}-${Math.floor(原.mtimeMs).toString(36)}-id"`;
  const 头 = new Headers({
    "Content-Type": 类型[path.extname(文件)] ?? "application/octet-stream",
    // manifest 每次构建都可能变（文件名带哈希），别的一年不变（目录 v1 换内容时改名）
    "Cache-Control": 文件.endsWith("manifest.json") ? "no-cache" : "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    ETag: etag,
  });
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: 头 });

  // If-Range 对不上（文件换过）就给整份
  const 认范围 = !req.headers.get("if-range") || req.headers.get("if-range") === etag;
  const 段 = 认范围 ? 解析范围(req.headers.get("range"), 总) : null;
  if (段 === "超出") {
    头.set("Content-Range", `bytes */${总}`);
    return new Response(null, { status: 416, headers: 头 });
  }
  const { 起, 止 } = 段 ?? { 起: 0, 止: 总 - 1 };
  头.set("Content-Length", String(止 - 起 + 1));
  if (段) 头.set("Content-Range", `bytes ${起}-${止}/${总}`);
  const 体 = 只要头 || 总 === 0 ? null : (Readable.toWeb(fs.createReadStream(文件, { start: 起, end: 止 })) as ReadableStream);
  return new Response(体, { status: 段 ? 206 : 200, headers: 头 });
}

export function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return 出(req, ctx, false);
}

export function HEAD(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return 出(req, ctx, true);
}
