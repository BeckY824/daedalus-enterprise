import { 取样式, 号的样子, 存正文 } from "@/lib/antd-css-store";
import { 读盘 } from "@/lib/antd-css-disk";

/**
 * antd 服务端样式外链（11-15，lib/antd-css-store.ts）：页面里 <link> 指过来的那一批。
 * 号按正文算（同号正文不变），浏览器可以一直缓存。只是样式，不认人（登录页也要用）。
 * 不自己 gzip（11-17）：Next 16.4.5 起路由响应里的 Content-Encoding / Content-Length 一律被删（GHSA-pc58-hwjq-p385），
 * 16.4.6 起路由响应改由 Next 自己压（next.config 的 compress，CRM_NO_COMPRESS=1 时交前面的反代压）。
 * 再自己压就是压两遍、头又被删：浏览器拿到的是 gzip 字节当 CSS，antd 服务端样式整批失效，要等水合后浏览器端补插。
 * 进程里没有（重启 / 部署前发出去的页面）就读盘（lib/antd-css-disk.ts），读到了记进进程；盘上也没有、号乱写的 = 404
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let 正文 = 号的样子.test(id) ? 取样式(id) : undefined;
  if (正文 === undefined && 号的样子.test(id)) {
    正文 = 读盘(id);
    if (正文) 存正文(id, 正文);
  }
  if (!正文) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(正文, {
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
