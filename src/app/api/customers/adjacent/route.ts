import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { 找相邻带页, 查询串of, 客户列表取页 } from "@/app/(app)/customers/[id]/adjacent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 客户详情「上一条 / 下一条」要相邻两位的 id（E-332，规矩见 customers/[id]/adjacent.ts）。
 *   GET ?id=客户&href=进来前那张列表的地址&page=这位在第几页  → { 上, 下 } | null
 * 用 GET 不用服务端动作：动作在浏览器里排队串行，按金额 / 最近跟进排序要扫整个范围，相邻没回来之前详情页的保存、记一笔都得排在它后面；
 * GET 不进那条队，换人 / 离开时浏览器还能直接 abort。
 * 只给 id 和它在第几页，不给名单；可见范围走列表同一套查询（限定层），这里不另判权限。
 * 这一期只认客户列表（/customers）的地址，别的一律 null
 */
export async function GET(req: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const id = q.get("id") ?? "";
  const 原href = q.get("href") ?? "";
  const href = 原href.length <= 4000 ? 原href : "";
  const 页 = Number(q.get("page"));
  if (!id || id.length > 64 || href.split("?")[0] !== "/customers") return NextResponse.json(null);
  const page = Number.isSafeInteger(页) && 页 > 0 ? 页 : 1;
  const 取页 = await 客户列表取页(查询串of(href));
  return NextResponse.json(取页 ? await 找相邻带页(id, page, 取页) : null, { headers: { "Cache-Control": "no-store" } });
}
