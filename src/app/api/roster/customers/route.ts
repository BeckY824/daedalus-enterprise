import { getCurrentUser } from "@/lib/auth";
import { 客户名单数据 } from "@/app/(app)/@pane/roster-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 客户详情中栏名单在后台换新（跳转优化 PR-A 审查补，lib/roster-refresh.ts）：名单挂在 layout 里、换人不重查，
 * 切回标签页或隔了 60 秒以上又换了一位时由名单自己来拉这一份。和进详情时服务端算的是同一个函数（@pane/roster-data.ts），范围、口径一样。
 * 只读；切换视图期间照样是被看的那个人的名单（getCurrentUser 认视图）。不缓存
 */
export async function GET() {
  if (!(await getCurrentUser())) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data } = await 客户名单数据();
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
