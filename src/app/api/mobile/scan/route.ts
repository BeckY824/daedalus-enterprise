import { NextResponse } from "next/server";
import { 认扫名片的人 as 认人, 建限次 } from "@/lib/card-scan/server/auth";
import { 语言表, 是名片语言 } from "@/lib/card-scan/langs";
import { 取识别池, 太忙 } from "@/lib/card-scan/server/pool";
import { recordAiUse } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 服务器认名片（2026-10-20，用户同意「服务器识别为主、本机识别兜底」：第一次也不用下 12 MB 识别文件）。
 *
 *   GET  打开扫名片时叫一声：能不能用（团队版、没超次数），能用就把识别线程先起好
 *   POST ?lang=中英  body = 手机压好的 JPEG（几百 KB，最多 2 MB）→ 一行一行回 JSON（application/x-ndjson）：
 *        {"排队":x}（前面还有 x 张，变了就再回一行）… 最后一行 {"框":[{poly,text,score}…]} 或 {"忙":true}（手机改用本机识别）
 *
 * 只给登录了的团队版账号（和连手机同一条：在团队、团队开着、有自己连上的设备）；按账号限流，防有人拿来刷。
 * 不扣次数。照片只在内存里：读进来 → 交给识别线程 → 认完就丢，不落盘、不打日志
 *
 * ?use=ask：首页对话框带图问（2026-11-17，lib/ask-image.ts）——认出来的字当附件文本随问题发给模型。
 * 企业版记一笔 ai_use（功能键 shot），和批次 20d 一样只记张数、字数、工具名，不记认出的字；认名片不带这个参数，照旧不记
 */

const 最大字节 = 2 * 1024 * 1024;
/**
 * 一张名片平常认 1–2 遍（中英，外文再换一种语言），最多 5 遍（倒过来、没线索时盲试阿拉伯 / 泰 / 印地），
 * 10 分钟 90 遍 ≈ 30 张以上，展会上一张张扫够用
 */
const 记一次 = 建限次(90);

export async function GET(req: Request) {
  const 人 = await 认人(req);
  if (人 instanceof NextResponse) return 人;
  取识别池().预热();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

/** 读请求体，超过上限就不读了 */
async function 读图(req: Request): Promise<Uint8Array | null> {
  const 说的 = Number(req.headers.get("content-length") ?? 0);
  if (说的 > 最大字节 || !req.body) return null;
  const 读 = req.body.getReader();
  const 块们: Uint8Array[] = [];
  let 共 = 0;
  for (;;) {
    const { done, value } = await 读.read();
    if (done) break;
    共 += value.byteLength;
    if (共 > 最大字节) { await 读.cancel().catch(() => undefined); return null; }
    块们.push(value);
  }
  if (!共) return null;
  const 图 = new Uint8Array(共);
  let i = 0;
  for (const b of 块们) { 图.set(b, i); i += b.byteLength; }
  return 图;
}

export async function POST(req: Request) {
  const 人 = await 认人(req);
  if (人 instanceof NextResponse) return 人;
  const 参数 = new URL(req.url).searchParams;
  const 语言 = 参数.get("lang") ?? "中英";
  const 对话框 = 参数.get("use") === "ask";
  if (!是名片语言(语言)) return NextResponse.json({ error: "不认识的名片语言" }, { status: 400 });
  if (!记一次(人.accountId)) return NextResponse.json({ error: "扫得太快了，先在手机上认" }, { status: 429 });
  const 图 = await 读图(req);
  if (!图) return NextResponse.json({ error: "照片太大或是空的" }, { status: 413 });

  const 编 = new TextEncoder();
  const 停 = new AbortController();
  req.signal?.addEventListener("abort", () => 停.abort(), { once: true });
  const 体 = new ReadableStream<Uint8Array>({
    async start(c) {
      const 行 = (x: unknown) => { try { c.enqueue(编.encode(JSON.stringify(x) + "\n")); } catch { /* 手机走了 */ } };
      let 上次 = -1;
      try {
        const 项们 = await 取识别池().认(图, 语言表[语言].模型, {
          signal: 停.signal,
          // 排着的时候每变一次报一行；排过队的轮到了再报一个 0（手机把「排队中」换回「正在认」）
          进: (前面) => { if (前面 !== 上次 && (前面 > 0 || 上次 > 0)) { 上次 = 前面; 行({ 排队: 前面 }); } },
        });
        行({ 框: 项们 });
        if (对话框 && 人.名字 !== undefined) {
          const 字数 = 项们.reduce((n, x) => n + (typeof x.text === "string" ? x.text.replace(/\s/g, "").length : 0), 0);
          // 留痕没记上不该让这张图算没认出来：框已经发出去了
          await recordAiUse({ id: 人.accountId, name: 人.名字 }, "shot", `截图识字：1 张，认出 ${字数} 字（服务器 OCR，首页对话框）`).catch(() => undefined);
        }
      } catch (e) {
        行(e instanceof 太忙 ? { 忙: true } : { 错: "服务器没认出来" });
      }
      try { c.close(); } catch { /* 手机走了 */ }
    },
    cancel() { 停.abort(); },
  });
  return new Response(体, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // 一行一行地推（排队位置），别让中间的代理攒着、压缩
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
