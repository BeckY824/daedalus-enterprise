import { getCurrentUser } from "@/lib/auth";
import { 页面版本 } from "@/lib/page-version";
import { 认页面 } from "@/lib/page-fresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 「这页数据变了没」（跳转优化 PR-D，lib/page-version.ts）：登录后才答；只回一个短哈希，不回字段。
 * 前端（components/PageFreshness.tsx）在切到 / 切回客户详情、项目详情、客户列表时问一次，变了才 router.refresh。
 * 不缓存。
 */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return Response.json({ error: "请先登录" }, { status: 401 });
  const u = new URL(req.url);
  const kind = u.searchParams.get("kind");
  const id = u.searchParams.get("id") ?? "";
  const qs = u.searchParams.get("qs") ?? "";
  const 路径 = kind === "customer" ? `/customers/${id}` : kind === "project" ? `/projects/${id}` : kind === "customer-list" ? "/customers" : "";
  const 页 = 认页面(路径, qs);
  if (!页 || 页.种类 !== kind) return Response.json({ v: null }, { headers: { "Cache-Control": "no-store" } });
  try {
    const v = await 页面版本(页.种类, 页.id, new URLSearchParams(页.查询));
    return Response.json({ v }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ v: null }, { headers: { "Cache-Control": "no-store" } });
  }
}
