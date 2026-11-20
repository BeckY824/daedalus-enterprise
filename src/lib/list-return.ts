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

/*
  11-20 用户：「之前筛选栏的保持，对其他页面也一样」——线索、渠道、联系人、跟进四张列表也记地址、滚动（29R 推广）。
  它们没有自己的详情页，点进去的是客户 / 项目详情：从那儿回来滚回原位，详情页「回到…」回最近看的那张列表
*/
export type 列表种 = "客户" | "公海" | "项目" | "线索" | "渠道" | "联系人" | "跟进";
export const 列表路径: Record<列表种, string> = {
  客户: "/customers",
  公海: "/pool",
  项目: "/projects",
  线索: "/leads",
  渠道: "/channels",
  联系人: "/contacts",
  跟进: "/follow-ups/plans",
};
const 全部列表种 = Object.keys(列表路径) as 列表种[];
export type 列表地址们 = Partial<Record<列表种, string>> & { 最近?: 列表种 };

const 地址键 = "crm:list-return:v1";
const 滚动键 = "crm:list-return-y:v1";

/** 路径 → 哪种列表；不是这几张列表的返回 null（详情、新建、交接这些子路径都不算） */
export function 列表种of(pathname: string): 列表种 | null {
  return 全部列表种.find((种) => 列表路径[种] === pathname) ?? null;
}

/** 左栏那一项的路径 → 它对应的列表种（企业版左栏：客户、公海、渠道；项目页入口 11-12 去掉了，团队版还有） */
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
  const 名 = 种 === "客户" ? `${客户叫法}列表` : 种 === "公海" ? "公海" : 种 === "跟进" ? "跟进计划" : `${种}列表`;
  const 页 = 页码of(href);
  return `回到${名}${页 > 1 ? `（第 ${页} 页）` : ""}`;
}

/** 只认站内这几张列表的地址，防坏数据把人带去别处 */
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
  for (const 种 of 全部列表种) if (合法地址(种, v[种])) out[种] = v[种] as string;
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

/*
  勾选和横向滚动（29R，11-20 员工反馈：「点进去再退出来，之前勾选设置的页面就全乱了」「刷新之后，之前设置的东西就没了」）：
  列表组件（components/DataList.tsx，给了 回来还原 的那几张）一挂上就按「这张表 + 这个地址」读回勾选和横滚位置。
  地址不一样（换了筛选、翻了页）就不还原：勾选只认眼前的行（list-select.ts 只留当前行）。
  和上面一样记在 sessionStorage（一个标签页一份，刷新还在、关了就没），存储被禁时退回这一页的内存，坏数据当没记。
*/
const 勾选键 = "crm:list-pick:v1";
/** 本地 = 在浏览器里分页的表（联系人、渠道）记的第几页、每页几条；服务端分页的表页码在地址栏里 */
export type 勾选记忆 = { href: string; ids: string[]; x: number; 本地?: { 当前: number; 每页: number } };

/** 地址栏现在的地址（路径 + 规整过的查询串，和 ListMemory 记的同一个写法） */
export function 当前列表地址(): string {
  if (typeof window === "undefined") return "";
  const q = new URLSearchParams(window.location.search).toString();
  return q ? `${window.location.pathname}?${q}` : window.location.pathname;
}

function 读勾选表(): Record<string, unknown> {
  return 解析<Record<string, unknown>>(读(勾选键));
}

/** 这张表在这个地址上记的勾选和横滚；没记过、地址对不上、坏数据都返回 null */
export function 读勾选(表: string, href: string): 勾选记忆 | null {
  const v = 读勾选表()[表] as { href?: unknown; ids?: unknown; x?: unknown } | undefined;
  if (!v || v.href !== href) return null;
  const ids = Array.isArray(v.ids) ? v.ids.filter((x): x is string => typeof x === "string").slice(0, 1000) : [];
  const x = typeof v.x === "number" && Number.isFinite(v.x) && v.x > 0 ? Math.round(v.x) : 0;
  const 本 = (v as { 本地?: { 当前?: unknown; 每页?: unknown } }).本地;
  const 正整数 = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 10000;
  return 本 && 正整数(本.当前) && 正整数(本.每页) ? { href, ids, x, 本地: { 当前: 本.当前 as number, 每页: 本.每页 as number } } : { href, ids, x };
}

function 写勾选(表: string, 记忆: 勾选记忆) {
  写(勾选键, JSON.stringify({ ...读勾选表(), [表]: 记忆 }));
}

/** 勾选变了就记；同一个地址上的横滚位置留着，换了地址横滚归零 */
export function 记勾选(表: string, href: string, ids: readonly string[]) {
  const 旧 = 读勾选(表, href);
  写勾选(表, { ...旧, href, ids: ids.slice(0, 1000), x: 旧?.x ?? 0 });
}

/** 表格横着滚了就记；同一个地址上的勾选留着，换了地址勾选清空 */
export function 记横滚(表: string, href: string, x: number) {
  const 旧 = 读勾选(表, href);
  写勾选(表, { ...旧, href, ids: 旧?.ids ?? [], x: Number.isFinite(x) && x > 0 ? Math.round(x) : 0 });
}

/** 浏览器里分页的表翻了页、换了每页条数就记；同一个地址上的勾选、横滚留着 */
export function 记本地页(表: string, href: string, 当前: number, 每页: number) {
  const 旧 = 读勾选(表, href);
  写勾选(表, { href, ids: 旧?.ids ?? [], x: 旧?.x ?? 0, 本地: { 当前, 每页 } });
}
