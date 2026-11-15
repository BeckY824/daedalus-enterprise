/**
 * 左栏空闲时的整页预热（10-27，components/AppShell.tsx）预热哪几页：部署时用环境变量 CRM_NAV_PREWARM 定（11-15）。
 *
 * 每次整页打开（刷新、新标签、从飞书点进来）都会把左栏主组几页整页渲染一遍：本机 8.6 万客户的库实测
 * 每次 5–6 页、合计约 1 秒服务器 CPU，是页面本身的 3–6 倍。1 核的服务器上这是能省下来的大头，所以做成可配：
 *
 *   不设 / 空 / all（不分大小写）= 照旧：左栏主组全部 + 企业版的新线索
 *   "0" / "none"                  = 不预热（悬停预取照旧：左栏 unstable_dynamicOnHover、列表行 RowLink）
 *   "/customers,/pool"            = 只预热列出的、且本来就在预热名单里的页（名单外的写了也不取）。
 *                                   每项去掉首尾空白和结尾的 /、没有开头的 / 就补上（"customers/" 等于 "/customers"）
 *   列表里一项都对不上能预热的页   = 不预热，并在服务端 console.warn 一次。按「不预热」处理更稳妥：
 *                                   设了列表就是想少取，写错了退回全部会悄悄把省下的 CPU 又花回去；退回不预热只是点左栏慢一点
 *
 * 服务端（(app)/layout.tsx）每次渲染读 process.env，经 props 传给 AppShell：改了重启服务就生效，不用重新构建。
 * 手机宽度（≤767px，同 AppShell 的 小屏）一律不预热：手机多半从飞书里点进来，每次都是整页打开，点左栏的机会少。
 *
 * 日志里分不出预热和真点击（lib/request-log.ts）：预热走 router.prefetch(href, { kind: FULL })，Next 16 发的请求头
 * 和站内切页一模一样（rsc + next-router-state-tree，不带 next-router-prefetch，见 next/dist/client/components/segment-cache/cache.js），
 * 也没有给它加请求头的口子（只能整个换掉 window.fetch，不值）。所以预热请求在慢请求日志里是不带 pf 的 RSC
 */
export type 预热设置 = "全部" | string[];

/** 会出现在预热名单里的页：企业版左栏五项 + 新线索，团队版左栏主组（AppShell 预热页）。只用来判断列表写没写错 */
export const 可预热页 = new Set(["/dashboard", "/overview", "/channels", "/pool", "/customers", "/projects", "/follow-ups/plans", "/leads"]);

function 规整(项: string): string {
  let s = 项.trim().replace(/\/+$/, "");
  if (s && !s.startsWith("/")) s = "/" + s;
  return s;
}

let 警告过 = false;

export function 读预热设置(值: string | undefined = process.env.CRM_NAV_PREWARM, 警告: (话: string) => void = (话) => console.warn(话)): 预热设置 {
  const v = (值 ?? "").trim();
  if (v === "" || v.toLowerCase() === "all") return "全部";
  if (v === "0" || v.toLowerCase() === "none") return [];
  const 列表 = [...new Set(v.split(",").map(规整).filter(Boolean))];
  if (!列表.some((k) => 可预热页.has(k)) && !警告过) {
    警告过 = true;
    警告(`[nav-prewarm] CRM_NAV_PREWARM=${JSON.stringify(v)} 里没有一项是能预热的页（${[...可预热页].join(",")}），按不预热处理`);
  }
  return 列表;
}

/** 本来的预热名单按设置筛一遍；顺序跟本来的名单走 */
export function 按设置筛(候选: string[], 设置: 预热设置): string[] {
  if (设置 === "全部") return 候选;
  const 要 = new Set(设置);
  return 候选.filter((k) => 要.has(k));
}

/** 测试用：让下一次解析能再警告 */
export function 重置预热警告() {
  警告过 = false;
}
