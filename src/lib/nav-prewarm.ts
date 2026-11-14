/**
 * 左栏空闲时的整页预热（10-27，components/AppShell.tsx）预热哪几页：部署时用环境变量 CRM_NAV_PREWARM 定（11-15）。
 *
 * 每次整页打开（刷新、新标签、从飞书点进来）都会把左栏主组几页整页渲染一遍：本机 8.6 万客户的库实测
 * 每次 5–6 页、合计约 1 秒服务器 CPU，是页面本身的 3–6 倍。1 核的服务器上这是能省下来的大头，所以做成可配：
 *
 *   不设 / 空        = 照旧：左栏主组全部 + 企业版的新线索
 *   "0" / "none"     = 不预热（悬停预取照旧：左栏 unstable_dynamicOnHover、列表行 RowLink）
 *   "/customers,/pool" = 只预热列出的、且本来就在预热名单里的页（名单外的写了也不取）
 *
 * 服务端（(app)/layout.tsx）每次渲染读 process.env，经 props 传给 AppShell：改了重启服务就生效，不用重新构建。
 * 手机宽度（≤767px，同 AppShell 的 小屏）一律不预热：手机多半从飞书里点进来，每次都是整页打开，点左栏的机会少。
 */
export type 预热设置 = "全部" | string[];

export function 读预热设置(值: string | undefined = process.env.CRM_NAV_PREWARM): 预热设置 {
  const v = (值 ?? "").trim();
  if (v === "") return "全部";
  if (v === "0" || v.toLowerCase() === "none") return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 本来的预热名单按设置筛一遍；顺序跟本来的名单走 */
export function 按设置筛(候选: string[], 设置: 预热设置): string[] {
  if (设置 === "全部") return 候选;
  const 要 = new Set(设置);
  return 候选.filter((k) => 要.has(k));
}
