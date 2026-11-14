import { gzipSync } from "node:zlib";
import { 取样式, 号的样子, 记多少批, 存正文, 要gzip } from "@/lib/antd-css-store";
import { 读盘 } from "@/lib/antd-css-disk";

/** 压过的正文按号记着（同号正文不变）：一批 200 KB 压完约 25 KB，每批只压一次 */
const 压过的 = new Map<string, Buffer>();

/**
 * antd 服务端样式外链（11-15，lib/antd-css-store.ts）：页面里 <link> 指过来的那一批。
 * 号按正文算（同号正文不变），浏览器可以一直缓存。只是样式，不认人（登录页也要用）。
 * 自己 gzip：路由的响应 Next 不替我们压，前面的反代也不一定压 text/css（原来这段内联在 HTML 里跟着 HTML 压）。
 * 进程里没有（重启 / 部署前发出去的页面）就读盘（lib/antd-css-disk.ts），读到了记进进程；盘上也没有、号乱写的 = 404
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let 正文 = 号的样子.test(id) ? 取样式(id) : undefined;
  if (正文 === undefined && 号的样子.test(id)) {
    正文 = 读盘(id);
    if (正文) 存正文(id, 正文);
  }
  if (!正文) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const 头: Record<string, string> = {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
    Vary: "Accept-Encoding",
  };
  if (!要gzip(req.headers.get("accept-encoding"))) return new Response(正文, { headers: 头 });
  let 压 = 压过的.get(id);
  if (!压) {
    压 = gzipSync(正文);
    if (压过的.size >= 记多少批) 压过的.delete(压过的.keys().next().value!);
    压过的.set(id, 压);
  }
  return new Response(new Uint8Array(压), { headers: { ...头, "Content-Encoding": "gzip" } });
}
