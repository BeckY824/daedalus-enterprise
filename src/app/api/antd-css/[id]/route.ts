import { gzipSync } from "node:zlib";
import { 取样式, 号的样子, 记多少批 } from "@/lib/antd-css-store";

/** 压过的正文按号记着（同号正文不变）：一批 200 KB 压完约 25 KB，每批只压一次 */
const 压过的 = new Map<string, Buffer>();

/**
 * antd 服务端样式外链（11-15，lib/antd-css-store.ts）：页面里 <link> 指过来的那一批。
 * 号由正文所在的那批 key 定，同号正文不变，浏览器可以一直缓存。只是样式，不认人（登录页也要用）。
 * 自己 gzip：路由的响应 Next 不替我们压，前面的反代也不一定压 text/css（原来这段内联在 HTML 里跟着 HTML 压）。
 * 没记过的号（进程重启前发出去的页面、乱写的）= 404
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const 正文 = 号的样子.test(id) ? 取样式(id) : undefined;
  if (!正文) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const 头: Record<string, string> = {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
    Vary: "Accept-Encoding",
  };
  if (!/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) return new Response(正文, { headers: 头 });
  let 压 = 压过的.get(id);
  if (!压) {
    压 = gzipSync(正文);
    if (压过的.size >= 记多少批) 压过的.delete(压过的.keys().next().value!);
    压过的.set(id, 压);
  }
  return new Response(new Uint8Array(压), { headers: { ...头, "Content-Encoding": "gzip" } });
}
