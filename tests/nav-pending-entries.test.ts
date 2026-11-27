/**
 * 跳转优化 PR-A 审查补（11-24）：凡是跳进客户详情 / 项目详情的入口，都要给「点到了、在开」的反馈。
 *
 * 换客户、列表进详情时旧内容留到新内容就绪（[id] 层不放 loading，见 tests/nav-smooth-routes.test.ts），
 * 中间只靠顶上 2px 等待条 + 点的那一行 / 那张卡立刻高亮告诉人「在开」。漏一处，那一处点下去就是「没反应」——
 * 审查抓到客户看板卡、建完跳新客户、关联客户 / 挂靠 / 交接表里的名字都漏了。这里扫全仓钉住：
 *   1. `router.push / replace(...)`：参数是字面量且指向 `/customers/…`、`/projects/…` 详情的，一律不许——换成 useNavGo()（lib/nav-pending.ts）。
 *      参数不是字面量（变量、函数）的看不出去哪，必须写进下面的白名单并写清理由；指向详情的就改成 useNavGo，不进白名单
 *   2. `<Link href=…>`：href 指向详情的，链接里要有 `<LinkPending />`（或者直接用 RowLink，它自带）。
 *      href 不是字面量的：要么挂 `<LinkPending />`，要么写进白名单写清理由
 *   3. 裸 `<a href="/customers/…">`：整页重载、连壳带名单一起重来，一律不许（target="_blank" 新开一页的不算：本页不动）
 * 白名单里每一条都要真的还在代码里（删了代码就删白名单，不留死条）
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 根 = path.resolve(__dirname, "..");
function 列文件(dir: string, 出: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) 列文件(p, 出);
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) 出.push(p);
  }
  return 出;
}
const 文件们 = 列文件(path.join(根, "src")).map((p) => ({ 相对: path.relative(根, p), 文: fs.readFileSync(p, "utf8") }));

/** 字面量的开头（到第一个 `${` 或收尾引号）；不是字面量回 null */
function 字面开头(s: string): string | null {
  const q = s[0];
  if (q !== '"' && q !== "'" && q !== "`") return null;
  let i = 1;
  let 出 = "";
  while (i < s.length && s[i] !== q && !(q === "`" && s[i] === "$" && s[i + 1] === "{")) 出 += s[i++];
  return 出;
}
/**
 * 表达式可能落到的那几个字面量：本身是字面量、或者顶层是 `条件 ? 甲 : 乙`（分支再递归）。
 * 落点里有一个不是字面量（变量、函数、`??`）就回 null（说不准去哪）
 */
function 落点(expr: string): string[] | null {
  const e = expr.trim();
  const 首 = e[0];
  if ((首 === '"' || 首 === "'" || 首 === "`") && 读平衡(e, 0) === e.length) return [字面开头(e)!];
  let 深 = 0, 问 = -1, 冒 = -1, 嵌 = 0;
  for (let k = 0; k < e.length; k++) {
    const c = e[k];
    if (c === '"' || c === "'" || c === "`") { k = 读平衡(e, k) - 1; continue; }
    if ("({[".includes(c)) 深++;
    else if (")}]".includes(c)) 深--;
    else if (深 === 0 && c === "?") {
      if (e[k + 1] === "." || e[k + 1] === "?") { k++; continue; } // ?. 和 ?? 不是三元
      if (问 < 0) 问 = k; else 嵌++;
    } else if (深 === 0 && c === ":" && 问 >= 0) {
      if (嵌 > 0) 嵌--;
      else { 冒 = k; break; }
    }
  }
  if (问 < 0 || 冒 < 0) return null;
  const 甲 = 落点(e.slice(问 + 1, 冒)), 乙 = 落点(e.slice(冒 + 1));
  return 甲 && 乙 ? [...甲, ...乙] : null;
}
/** 去客户 / 项目详情（不算 /projects/attach、/projects/handover、/projects/new 这几个列表类的页） */
const 去详情 = (开头: string) => /^\/(customers|projects)\//.test(开头) && !/^\/projects\/(attach|handover|new)(\?|$)/.test(开头);

/** 从 i 起读一个平衡的 {…} / (…) / 引号串，回结束位置（不含） */
function 读平衡(s: string, i: number): number {
  const 开 = s[i];
  if (开 === '"' || 开 === "'" || 开 === "`") {
    let j = i + 1;
    while (j < s.length && s[j] !== 开) {
      if (s[j] === "\\") j++;
      else if (开 === "`" && s[j] === "$" && s[j + 1] === "{") j = 读平衡(s, j + 1) - 1;
      j++;
    }
    return j + 1;
  }
  const 关 = 开 === "{" ? "}" : 开 === "(" ? ")" : "]";
  let 深 = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'" || c === "`") {
      j = 读平衡(s, j) - 1;
      continue;
    }
    if (c === 开) 深++;
    else if (c === 关 && --深 === 0) return j + 1;
  }
  return s.length;
}

type 入口 = { 文件: string; 行: number; 参数: string };
const 行号 = (文: string, i: number) => 文.slice(0, i).split("\n").length;

/** 所有 router.push / replace 的第一个参数（原文，去掉首尾空白） */
function 路由跳转(): 入口[] {
  const 出: 入口[] = [];
  for (const { 相对, 文 } of 文件们) {
    if (相对 === "src/lib/nav-pending.ts") continue; // useNavGo 自己
    for (const m of 文.matchAll(/\brouter\.(push|replace)\(/g)) {
      const 起 = m.index! + m[0].length - 1;
      const 整 = 文.slice(起 + 1, 读平衡(文, 起) - 1);
      // 第一个参数：到顶层的逗号为止
      let 深 = 0, k = 0;
      for (; k < 整.length; k++) {
        const c = 整[k];
        if (c === '"' || c === "'" || c === "`") { k = 读平衡(整, k) - 1; continue; }
        if ("({[".includes(c)) 深++;
        else if (")}]".includes(c)) 深--;
        else if (c === "," && 深 === 0) break;
      }
      出.push({ 文件: 相对, 行: 行号(文, m.index!), 参数: 整.slice(0, k).trim() });
    }
  }
  return 出;
}

/** 所有 <Link …> 元素：href 原文、链接里有没有 <LinkPending */
function 链接们(): (入口 & { 有等: boolean })[] {
  const 出: (入口 & { 有等: boolean })[] = [];
  for (const { 相对, 文 } of 文件们) {
    for (const m of 文.matchAll(/<Link(?=[\s>])/g)) {
      // 读开标签：跳过 {…} 和引号串，到顶层的 > 为止
      let j = m.index! + m[0].length;
      let href = "";
      while (j < 文.length && 文[j] !== ">") {
        if (文.startsWith("href=", j)) {
          const 值起 = j + 5;
          const 值止 = 读平衡(文, 值起);
          href = 文.slice(值起, 值止);
          j = 值止;
          continue;
        }
        if (文[j] === "{" || 文[j] === '"' || 文[j] === "'") { j = 读平衡(文, j); continue; }
        j++;
      }
      const 自闭 = 文[j - 1] === "/";
      const 尾 = 自闭 ? j : 文.indexOf("</Link>", j);
      const 里 = 自闭 ? "" : 文.slice(j, 尾);
      // 注释里的「<Link>」、{...props} 透传的（RowLink 自己）没有 href：不算
      if (!href) continue;
      // href={…} 去掉外层花括号
      const 值 = href.startsWith("{") ? href.slice(1, -1).trim() : href;
      出.push({ 文件: 相对, 行: 行号(文, m.index!), 参数: 值, 有等: /<LinkPending\b/.test(里) });
    }
  }
  return 出;
}

/**
 * router.push / replace 参数不是字面量、确定不去别的详情的（文件 + 参数开头）。指向详情的不许进这里，改 useNavGo
 */
const 路由白名单: { 文件: string; 参数: string; 理由: string }[] = [
  { 文件: "src/app/(app)/customers/[id]/ProjectZone.tsx", 参数: "`${客户页}", 理由: "同一位客户页里把地址栏的 ?project= 对齐到显示的那个页签（replace，不加历史、不换段，旧内容本来就留着）" },
  { 文件: "src/app/(app)/projects/ProjectsView.tsx", 参数: "q.size ? `${window.location.pathname}", 理由: "列表本页改筛选参数（replace 同一页）" },
  { 文件: "src/app/(app)/follow-ups/plans/PlansView.tsx", 参数: "`${window.location.pathname}", 理由: "计划页本页改筛选参数，外面已经包着 开始翻 的 transition" },
  { 文件: "src/app/(app)/channels/ChannelDash.tsx", 参数: "qs ? `${路径}", 理由: "渠道页本页改筛选参数，外面包着 start 的 transition" },
  { 文件: "src/app/(app)/overview/DataShell.tsx", 参数: "url", 理由: "复盘页本页换页签 / 筛选（/overview?…）" },
  { 文件: "src/lib/url-filters.ts", 参数: "q.size ? `${path}", 理由: "各列表页共用的筛选写地址：本页改参数，外面包着 startTransition" },
  { 文件: "src/app/(app)/dashboard/StartCard.tsx", 参数: "u", 理由: "首页起步卡（企业版开始）：只去设置、客户列表、新建线索这几个列表类的页，不去详情" },
  { 文件: "src/app/(app)/customers/dupes/DupesView.tsx", 参数: "s ? `${疑似重复页}", 理由: "疑似重复清单本页换页签 / 页码（/customers/dupes?…），不去详情" },
  { 文件: "src/components/AppShell.tsx", 参数: "路径", 理由: "桌面壳原生菜单（window.desktopNav）发来的跳转；企业版网页里没有 desktopNav" },
];

/**
 * <Link> 的 href 不是字面量、确定不去详情的（文件 + href 开头）。去详情或说不准的挂 <LinkPending />，不进这里
 */
const 链接白名单: { 文件: string; 参数: string; 理由: string }[] = [
  { 文件: "src/app/(app)/channels/ChannelDrawer.tsx", 参数: "数字链接(", 理由: "渠道数字点进去是带筛选的项目 / 公海列表（lib/enterprise/channel-stats.ts 数字链接），不去详情" },
  { 文件: "src/app/(app)/channels/ChannelsView.tsx", 参数: "数字链接(", 理由: "同上：渠道表里的数字链到列表" },
  { 文件: "src/app/(app)/channels/RosterNote.tsx", 参数: "去.列表", 理由: "「项目列表里 N 条」：链到带筛选的项目列表" },
  { 文件: "src/app/(app)/channels/RosterNote.tsx", 参数: "去.公海", 理由: "「N 条在公海」：链到公海页" },
  { 文件: "src/app/(app)/overview/ProjectStatsView.tsx", 参数: "链(`/leads", 理由: "复盘统计里的人名链到线索列表（按负责人筛）" },
  { 文件: "src/app/(app)/overview/ProjectStatsView.tsx", 参数: "带批次(\"/pool", 理由: "复盘统计里的数字链到公海页（带批次筛选）" },
  { 文件: "src/app/(app)/customers/[id]/RecordView.tsx", 参数: "疑似重复页", 理由: "客户页顶上「去疑似重复清单 ›」：链到清单页（/customers/dupes），不去详情" },
  { 文件: "src/components/CustomerRoster.tsx", 参数: "底句.href", 理由: "名单底下「看全部」那句：/customers?scope=…（lib/enterprise/customer-scope.ts 名单底句）" },
  { 文件: "src/components/BackToList.tsx", 参数: "href", 理由: "详情页头的「回列表」：只回各模块的列表页" },
];

describe("进详情的入口都有等待反馈", () => {
  const 跳 = 路由跳转();
  const 链 = 链接们();

  it("扫得到东西（扫描本身没坏）", () => {
    expect(跳.length).toBeGreaterThan(30);
    expect(链.length).toBeGreaterThan(50);
    expect(链.some((x) => x.参数.startsWith("`/customers/"))).toBe(true);
  });

  it("router.push / replace 不直接去客户 / 项目详情（改 useNavGo）", () => {
    const 直去 = 跳.filter((x) => 落点(x.参数)?.some(去详情));
    expect(直去.map((x) => `${x.文件}:${x.行} ${x.参数}`), "换成 const 去页 = useNavGo(); 去页.push(…)").toEqual([]);
  });

  it("router.push / replace 的参数不是字面量的，都在白名单里写了理由", () => {
    const 没登记 = 跳.filter((x) => 落点(x.参数) === null && !路由白名单.some((w) => w.文件 === x.文件 && x.参数.startsWith(w.参数)));
    expect(没登记.map((x) => `${x.文件}:${x.行} ${x.参数}`), "去详情的改 useNavGo；确定不去详情的进 路由白名单 写理由").toEqual([]);
    const 死条 = 路由白名单.filter((w) => !跳.some((x) => x.文件 === w.文件 && x.参数.startsWith(w.参数)));
    expect(死条, "白名单里这几条在代码里已经没有了").toEqual([]);
    for (const w of 路由白名单) expect(w.理由.length, `${w.文件} ${w.参数} 要写理由`).toBeGreaterThan(8);
  });

  it("<Link> 去详情的都挂了 <LinkPending />（或用 RowLink）", () => {
    const 漏 = 链.filter((x) => !!落点(x.参数)?.some(去详情) && !x.有等);
    expect(漏.map((x) => `${x.文件}:${x.行} ${x.参数}`)).toEqual([]);
  });

  it("<Link> 的 href 不是字面量的：挂了 <LinkPending />，或在白名单里写了理由", () => {
    const 没登记 = 链.filter((x) => 落点(x.参数) === null && !x.有等 && !链接白名单.some((w) => w.文件 === x.文件 && x.参数.startsWith(w.参数)));
    expect(没登记.map((x) => `${x.文件}:${x.行} ${x.参数}`)).toEqual([]);
    const 死条 = 链接白名单.filter((w) => !链.some((x) => x.文件 === w.文件 && x.参数.startsWith(w.参数) && !x.有等));
    expect(死条, "白名单里这几条在代码里已经没有了（或已经挂上 LinkPending）").toEqual([]);
    for (const w of 链接白名单) expect(w.理由.length, `${w.文件} ${w.参数} 要写理由`).toBeGreaterThan(8);
  });

  it("没有裸 <a href> 进详情（整页重载）", () => {
    const 裸 = 文件们.flatMap(({ 相对, 文 }) =>
      // href 是字面量去详情的；或者表达式里带着去详情的字面量兜底（`x.地址 ?? \`/projects/…\``，3703 实操补：计划页项目名这样漏过）
      [...文.matchAll(/<a\s[^>]*href=(?:\{?\s*(["'`])|\{[^}>]*["'`])\/(customers|projects)\/[^>]*>/g)].filter((m) => !/target="_blank"/.test(m[0])).map((m) => `${相对}:${行号(文, m.index!)}`),
    );
    expect(裸, "换成 RowLink").toEqual([]);
  });
});
