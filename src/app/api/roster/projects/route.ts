import { getCurrentUser } from "@/lib/auth";
import { 项目名单数据 } from "@/app/(app)/@pane/roster-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 项目详情中栏名单在后台换新：同 /api/roster/customers。不是企业版、项目模式关着回 404 */
export async function GET() {
  if (!(await getCurrentUser())) return Response.json({ error: "请先登录" }, { status: 401 });
  const data = await 项目名单数据();
  if (!data) return Response.json({ error: "没有项目名单" }, { status: 404 });
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
