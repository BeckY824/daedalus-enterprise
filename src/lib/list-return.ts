/**
 * 列表记住位置 + 详情页「回到列表」（员工反馈 1A，11-16）：
 * 从客户列表、公海、项目（看板 / 列表）点进详情再回来，筛选、排序、页码、页签、滚动位置都还在。
 *
 * 筛选、排序、页码、页签本来就在地址栏（lib/url-filters.ts），看板 / 列表记在 cookie；丢的是「回哪个地址」和滚动位置：
 *   - 每种列表记住最近一次的完整地址（路径 + 查询串），详情页页头「回到列表」、从详情页点左栏「客户」「公海」都回这个地址
 *   - 滚动位置按种记着，从详情页回来（回到列表、左栏、浏览器后退）滚回去；从首页之类点左栏进来不滚
 * 记在 sessionStorage（一个标签页一份，关了就没）；存储被禁时退回这一页的内存，坏数据当没记。
 * 这里只有纯函数和读写，不碰界面；挂载和滚动在 components/ListReturn.tsx。
 */

export type 列表种 = "客户" | "公海" | "项目";
export type 列表地址们 = Partial<Record<列表种, string>> & { 最近?: 列表种 };

const 地址键 = "crm:list-return:v1";
const 滚动键 = "crm:list-return-y:v1";

/** 路径 → 哪种列表；不是这三张列表的返回 null（详情、新建、交接这些子路径都不算） */
export function 列表种of(pathname: string): 列表种 | null {
  if (pathname === "/customers") return "客户";
  if (pathname === "/pool") return "公海";
  if (pathname === "/projects") return "项目";
  return null;
}

/** 左栏那一项的路径 → 它对应的列表种（企业版左栏：客户、公海；项目页入口 11-12 去掉了，团队版还有） */
export const 左栏列表种 = (key: string): 列表种 | null => 列表种of(key);

/** /projects 下面不是项目详情的几个子页 */
const 项目子页 = new Set(["new", "handover", "attach"]);

/** 客户详情 /customers/<id>、项目详情 /projects/<id>：从这儿回列表才滚回原位、左栏才回记住的地址 */
export function 是详情页(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const m = /^\/(customers|projects)\/([^/]+)$/.exec(pathname);
  if (!m) return false;
  return !(m[1] === "projects" && 项目子页.has(m[2]));
}

/** 地址上的页码（没写 = 第 1 页；乱写的也当第 1 页） */
export function 页码of(href: string): number {
  const i = href.indexOf("?");
  if (i < 0) return 1;
  const n = Number(new URLSearchParams(href.slice(i + 1)).get("page"));
  return Number.isInteger(n) && n > 1 ? n : 1;
}

/** 「回到客户列表（第 3 页）」：第 1 页不写页码；客户跟着业务叫法 */
export function 回列表文字(种: 列表种, href: string, 客户叫法 = "客户"): string {
  const 名 = 种 === "客户" ? `${客户叫法}列表` : 种 === "公海" ? "公海" : "项目列表";
  const 页 = 页码of(href);
  return `回到${名}${页 > 1 ? `（第 ${页} 页）` : ""}`;
}

/** 只认站内这三张列表的地址，防坏数据把人带去别处 */
function 合法地址(种: 列表种, href: unknown): href is string {
  if (typeof href !== "string" || href.length > 4000) return false;
  const path = href.split("?")[0];
  return 列表种of(path) === 种;
}

const 内存: Record<string, string> = {};
function 读(键: string): string | null {
  try {
    const v = window.sessionStorage.getItem(键);
    if (v !== null) return v;
  } catch {
    /* 存储被禁：用这一页的内存 */
  }
  return 内存[键] ?? null;
}
function 写(键: string, v: string) {
  内存[键] = v;
  try {
    window.sessionStorage.setItem(键, v);
  } catch {
    /* 存不了就只留内存 */
  }
}

function 解析<T extends object>(raw: string | null): T {
  if (!raw) return {} as T;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

/** 记住的地址原样串（给 useSyncExternalStore 当快照：串不变就不重渲染） */
export const 地址快照 = (): string => 读(地址键) ?? "";

/** 把快照串解成地址表；不合法的项丢掉 */
export function 解析地址们(raw: string): 列表地址们 {
  const v = 解析<Record<string, unknown>>(raw);
  const out: 列表地址们 = {};
  for (const 种 of ["客户", "公海", "项目"] as const) if (合法地址(种, v[种])) out[种] = v[种] as string;
  if (typeof v.最近 === "string" && out[v.最近 as 列表种]) out.最近 = v.最近 as 列表种;
  return out;
}

const 听的 = new Set<() => void>();
/** 订阅地址变化：只有这个标签页自己写的（sessionStorage 本来就一个标签页一份） */
export function 订阅地址(cb: () => void): () => void {
  听的.add(cb);
  return () => void 听的.delete(cb);
}

/** 记下这种列表现在的地址，也记成「最近看的列表」 */
export function 记地址(种: 列表种, href: string) {
  if (!合法地址(种, href)) return;
  const 旧 = 地址快照();
  // 解析地址们 按固定顺序出键，再走一遍，串才稳定（同样的地址不重写、不通知）
  const 新 = JSON.stringify(解析地址们(JSON.stringify({ ...解析地址们(旧), [种]: href, 最近: 种 })));
  if (新 === 旧) return;
  写(地址键, 新);
  for (const cb of 听的) cb();
}

/** 滚动位置：按种记，带着当时的地址（地址不一样就不滚，免得翻到别的页还滚到老位置）。滚动时常写，不通知订阅的 */
export function 读滚动(种: 列表种): { href: string; y: number } | null {
  const v = 解析<Record<string, unknown>>(读(滚动键))[种] as { href?: unknown; y?: unknown } | undefined;
  if (!v || typeof v.href !== "string" || typeof v.y !== "number" || !Number.isFinite(v.y) || v.y < 0) return null;
  return { href: v.href, y: v.y };
}
export function 记滚动(种: 列表种, href: string, y: number) {
  const 全 = 解析<Record<string, unknown>>(读(滚动键));
  写(滚动键, JSON.stringify({ ...全, [种]: { href, y: Math.max(0, Math.round(y)) } }));
}
