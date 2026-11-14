import { 取样式, 号的样子 } from "@/lib/antd-css-store";

/**
 * antd 服务端样式外链（11-15，lib/antd-css-store.ts）：页面里 <link> 指过来的那一批。
 * 号由正文所在的那批 key 定，同号正文不变，浏览器可以一直缓存。只是样式，不认人（登录页也要用）。
 * 没记过的号（进程重启前发出去的页面、乱写的）= 404
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const 正文 = 号的样子.test(id) ? 取样式(id) : undefined;
  if (!正文) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(正文, {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
