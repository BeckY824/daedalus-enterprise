/**
 * 设计语言 C-A2（11-22）渠道筛选 + 列表 · 排版门槛：50 个长名渠道，1024 / 1280 / 1366 / 390 不横向溢出、点得中。
 *
 *   C1 筛选：下拉写「全部主渠道 / 全部属性 / 全部负责人」墨色（D37）；1280 / 1366「更多筛选」写字、1024 只留图标；有筛才出「重置」；
 *          390 搜索独占一排（D06）
 *   C3 说明并进表格卡头「渠道（50）· 统计：全部」+「?」（长说明在悬停），按主渠道写「主渠道（N）」
 *   C4 「录投入」文字按钮（不带框，D09）；「有效线索」表头「?」说清「—」和「0」（C-新5），「—」走 --empty-fg；
 *      末行留 --ai-safe（D40）；「⋯」菜单「删除」红字 + 分隔线（钉住列不压表头 C-新6 用 L-B 的 .list 渐隐修法，L-B 合后跟上 main 再量）
 *   换皮主题（账簿）：照旧（带框按钮、说明行、删除不红）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ca2-layout", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/actions$/, `const f=async()=>({ok:true,id:'x'});
    export const saveChannel=f,toggleChannel=f,deleteChannel=f,saveMainChannel=f,toggleMainChannel=f,deleteMainChannel=f,addChannelInvest=f,deleteChannelInvest=f;
    export const listChannelInvests=async()=>({ok:true,能录:window.__能录!==false,rows:[]});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import ChannelsView from '@/app/(app)/channels/ChannelsView';
    const 长='某某超长跨境电商直播间合作渠道华东区旗舰店'.repeat(2);
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true}];
    const 统=(n,i=0)=>({关联线索:n,有效线索:i%3===1?0:n,已判定:i%3===0?0:n,关联商机:1,关联订单:0,关联项目:n,累计成交:[],当前投入:[],产出比:null,产出比说明:'还没录投入',累计运营天数:3,线索转商机:{分子:1,分母:n,比例:1/n},商机转订单:{分子:0,分母:0,比例:null}});
    const 行=(i)=>({id:'c'+i,name:'渠道'+i+长,phone:null,remark:null,active:true,attr:i%3?'公域引流':'私域转化'+长,platform:'渠道'+i+长,mainId:'m1',strategies:[],endDate:null,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',createdByName:'QA',channelOwnerId:'me',channelOwnerName:'小王',统计:统(40+i,i),客户数:0,投入数:i<3?1:0,项目数:0});
    const rows=Array.from({length:50},(_,i)=>行(i));
    const 格=(i)=>({线索:i<4?900-i*10:40+i,已判定:i<4?800:30,有效:i<4?20:20,商机:i<4?0:3,订单:i<4?0:1,成交:[{币种:'CNY',合计:i===5?12800000000:3000000+i}],投入:i<3?[{币种:'CNY',合计:5326000}]:[],起线索:i<4?900:40+i,起有效:20,起转商机:i<4?0:3});
    const 份=()=>Object.fromEntries(rows.map((r,i)=>[r.id,格(i)]));
    const 底数={本月:份(),本季:份(),全部:份()};
    const 公格=(n)=>({线索:100,进:n,方式:{超时回收:1,被退回:n-1,回收站:0,判无效:0,验证判无效:0,离职交接:0},退回因:{['客户说预算要再批一下'+长]:n-1},无效因:{},验证无效因:{}});
    const 公底=Object.fromEntries(rows.slice(0,6).map((r,i)=>[r.id,{me:公格(12-i)}]));
    const 公海={视角:'市场管理',创建人们:[{id:'me',name:'小王'}],底:{本月:公底,本季:公底,全部:公底}};
    const 壳=(x)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'me',name:'小王'}}>{x}</我Provider></BusinessProvider></App></ConfigProvider>);
    window.__画=(o)=>壳(<ChannelsView rows={rows} users={users} 属性选项={['公域引流']} 能管={o.能管!==false} 能录={o.能录!==false} 看板底数={底数} 公海={o.公海===false?null:公海} 两层 主渠道们={[{id:'m1',name:'主渠道'+长,active:true,allowSub:true,attr:null,ownerId:null,owner:null}]}/>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

/** 内容区按真实页面算：≥768 左边留 232 侧栏 + 24 页边距；390 没侧栏、16 边距 */
async function 打开(width: number, o: Record<string, unknown> = {}, skin?: string, 触屏 = false): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: 触屏, isMobile: 触屏 }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const 窄 = width < 768;
  const 壳 = 窄 ? "padding:0 16px" : "margin-left:232px;padding:0 24px";
  await page.route("http://ca2.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><div id='root' style='${壳}'></div>` }));
  await page.goto("http://ca2.test/channels");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  if (skin) await page.evaluate((k) => { document.documentElement.dataset.skin = k; }, skin);
  await page.evaluate((x) => { (window as unknown as { __能录: boolean }).__能录 = x; }, o.能录 !== false);
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (o: unknown) => void }).__画(x), o);
  await page.locator(".chan-dash").waitFor();
  return { page, errors };
}
const 不溢出 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function 点得中(page: Page, loc: import("playwright").Locator) {
  await loc.scrollIntoViewIfNeeded();
  const b = (await loc.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  return loc.evaluate((e, [x, y]) => { const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h)); }, [b.x + b.width / 2, b.y + b.height / 2] as const);
}

/**
 * 像手指那样点按：按下停 150ms 再抬起。Playwright 的 tap() 是一瞬间的，测不出 trigger 带 click 时
 * 「按下 pointerenter 延时打开、抬起后 click 又切回关」那一闪（C-A1 3704 实操同一个坑）
 */
async function 指点(page: Page, loc: import("playwright").Locator) {
  await loc.scrollIntoViewIfNeeded();
  const b = (await loc.boundingBox())!;
  const s = await page.context().newCDPSession(page);
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
  await page.waitForTimeout(150);
  await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await s.detach();
}

/**
 * 行内文字钮（L-B .row-act 一种款，D09）：不带框、透明底、蓝字。按长相量，不认 antd 的 type 类名（渠道页不再自己设 type="link"）。
 * 颜色有过渡，等它停下
 */
async function 文字钮(page: Page, loc: import("playwright").Locator) {
  const 蓝 = await page.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--brand)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  await expect.poll(() => loc.evaluate((e) => { const c = getComputedStyle(e); return [c.borderTopColor, c.backgroundColor, c.color].join(" | "); }))
    .toBe(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)", 蓝].join(" | "));
}

const 字 = (s: string) => s.replace(/\s+/g, "");
const 表头 = (page: Page) => page.locator(".chan-list .ant-table-thead th").allInnerTexts().then((x) => x.map((t) => 字(t).replace("?", "")));
async function 列字(page: Page, 名: string) {
  const i = (await 表头(page)).indexOf(名);
  return page.locator(".chan-list .ant-table-tbody tr.ant-table-row").evaluateAll((trs, i) => trs.map((tr) => (tr.children[i] as HTMLElement).innerText.trim()), i);
}

it.each([1024, 1280, 1366, 390])("%ipx：筛选「全部 X」墨色、表格卡头「渠道（50）· 统计：全部」、录投入是文字钮点得中、不横滚", async (w) => {
  const { page, errors } = await 打开(w);
  try {
    expect(await 不溢出(page)).toBe(true);
    // C1：下拉占位字墨色，不是 faint
    const 色 = await page.locator(".chan-list .list-bar .ant-select-placeholder").evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
    const 墨 = await page.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--ink)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
    expect(色.length).toBeGreaterThanOrEqual(1);
    for (const c of 色) expect(c).toBe(墨);
    const 更多字 = await page.locator(".chan-list .cf-more-t").first().isVisible();
    expect(更多字).toBe(w >= 1200 || w < 768);
    expect(await page.locator(".chan-list .list-reset:not(.is-off)").count()).toBe(0);
    // C3：卡头
    const 头 = page.getByTestId("chan-period-note");
    expect(字(await 头.innerText())).toBe("渠道（50）·统计：全部?");
    expect((await 头.boundingBox())!.height).toBeGreaterThanOrEqual(47.5);
    // C4：录投入文字钮（不带框）、点得中；「—」和「0」分开写
    const 钮 = page.locator(".chan-list .ant-table-tbody tr.ant-table-row").first().getByRole("button", { name: /录投入/ });
    expect(await 钮.getAttribute("class")).not.toContain("ant-btn-link");
    await 文字钮(page, 钮);
    expect(await 点得中(page, 钮)).toBe(true);
    const 有效 = await 列字(page, "有效线索");
    expect(有效.slice(0, 3)).toEqual(["—", "0", "42"]);
    const 空色 = await page.locator(".chan-list .ant-table-tbody .chan-empty").first().evaluate((e) => getComputedStyle(e).color);
    const 灰 = await page.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--empty-fg)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
    expect(空色).toBe(灰);
    // 末行留 AI 安全区
    expect(await page.locator(".chan-list").evaluate((e) => getComputedStyle(e).paddingBottom)).toBe("72px");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("390：搜索框独占一排、不横滚；下拉都在视口里", async () => {
  const { page } = await 打开(390);
  try {
    const 搜 = (await page.locator(".chan-list .list-bar .ant-input-affix-wrapper").first().boundingBox())!;
    const 下拉们 = await page.locator(".chan-list .list-bar > .ant-space .ant-select").evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { top: b.top, right: b.right }; }));
    for (const d of 下拉们) { expect(d.top).toBeGreaterThan(搜.y + 搜.height - 1); expect(d.right).toBeLessThanOrEqual(390); }
    expect(搜.width).toBeGreaterThan(200);
    expect(await 不溢出(page)).toBe(true);
  } finally { await page.close(); }
});

it("「有效线索」表头「?」：悬停说清「—」和「0」，点了不排序", async () => {
  const { page } = await 打开(1366);
  try {
    const 前 = await 列字(page, "有效线索");
    const q = page.locator(".chan-list .ant-table-thead .chan-th .chan-dash-q");
    await q.hover();
    await expect.poll(() => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)", { hasText: "「—」= 这批线索销售还没在线索验证里判过" }).isVisible()).toBe(true);
    // 只出「?」这一个说明，不叠 antd 的「点击升序」（showSorterTooltip: false）
    await page.waitForTimeout(400);
    expect(await page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: /点击/ }).count()).toBe(0);
    await page.locator(".chan-list .ant-table-thead th:has(.chan-th) .ant-table-column-sorters").hover({ position: { x: 4, y: 8 } });
    await page.waitForTimeout(400);
    expect(await page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: /点击/ }).count()).toBe(0);
    await q.click();
    expect(await 列字(page, "有效线索")).toEqual(前);
    // 键盘：Tab 到「?」按 Enter，也不排序（Enter 不冒到表头那一格）
    await q.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    expect(await 列字(page, "有效线索")).toEqual(前);
    // C3「?」悬停写列表按哪种时间算
    await page.getByTestId("chan-period-note").locator(".chan-dash-q").hover();
    await expect.poll(() => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)", { hasText: "全部时间；在上方看板切换时段" }).isVisible()).toBe(true);
  } finally { await page.close(); }
});

it("390 触屏：点按表格卡头「?」、「有效线索」表头「?」，说明出来留住不闪；点表头「?」不排序", async () => {
  const { page, errors } = await 打开(390, {}, undefined, true);
  try {
    await 指点(page, page.getByTestId("chan-period-note").locator(".chan-dash-q"));
    const 时段 = page.locator(".ant-tooltip:not(.ant-tooltip-hidden)", { hasText: "全部时间；在上方看板切换时段" });
    await expect.poll(() => 时段.isVisible()).toBe(true);
    await page.waitForTimeout(500);
    expect(await 时段.isVisible()).toBe(true);
    const 前 = await 列字(page, "有效线索");
    await 指点(page, page.locator(".chan-list .ant-table-thead .chan-th .chan-dash-q"));
    const 区别 = page.locator(".ant-tooltip:not(.ant-tooltip-hidden)", { hasText: "「—」= 这批线索销售还没在线索验证里判过" });
    await expect.poll(() => 区别.isVisible()).toBe(true);
    await page.waitForTimeout(500);
    expect(await 区别.isVisible()).toBe(true);
    expect(await 列字(page, "有效线索")).toEqual(前);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1366, 1440])("%ipx：横滚停在最左，表头字不被钉住的操作列和渐隐压成半截（C-新6）", async (w) => {
  const { page, errors } = await 打开(w);
  try {
    const 框 = page.locator(".chan-list .ant-table-content");
    await 框.evaluate((e) => { e.scrollLeft = 0; });
    // 补宽在 effect 里量完再画一次：等它稳住
    const 量 = () => page.locator(".chan-list .ant-table-thead").evaluate((thead) => {
      const ths = [...thead.querySelectorAll<HTMLElement>("th")];
      const 操作左 = Math.min(...ths.filter((th) => th.classList.contains("ant-table-cell-fix-end")).map((th) => th.getBoundingClientRect().left));
      return ths.filter((th) => !th.classList.contains("ant-table-cell-fix-end") && !th.classList.contains("ant-table-cell-fix-start")).flatMap((th) => {
        const r = document.createRange();
        r.selectNodeContents(th.querySelector(".ant-table-column-title") ?? th);
        const b = r.getBoundingClientRect();
        if (!b.width) return [];
        // 看得见的（左沿在操作列左边）右沿要在渐隐左边；整个藏到操作列底下的不管
        return b.left < 操作左 && b.right > 操作左 - 24 ? [`${th.innerText.trim()} ${Math.round(b.left)}–${Math.round(b.right)}（操作列 ${Math.round(操作左)}）`] : [];
      });
    });
    await expect.poll(量).toEqual([]);
    // 真横滚着（不是表格刚好放得下）
    expect(await 框.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("「⋯」菜单：删除红字，前面一条分隔线；有关联数据的照旧灰显写原因", async () => {
  const { page } = await 打开(1366);
  try {
    await page.locator(".chan-list .ant-table-tbody tr.ant-table-row").first().getByRole("button", { name: /更多操作/ }).click();
    const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
    await 菜单.waitFor();
    const 项 = await 菜单.locator("> li").evaluateAll((lis) => lis.map((l) => l.className.includes("divider") ? "—" : (l.querySelector(".ant-dropdown-menu-title-content") as HTMLElement)?.innerText.split("\n")[0]));
    expect(项).toEqual(["编辑", "停用", "—", "删除"]);
    const 删 = 菜单.locator("li.ant-dropdown-menu-item", { hasText: "删除" });
    expect(await 删.getAttribute("class")).toContain("ant-dropdown-menu-item-danger");
    // 第 1 行录过投入：灰显 + 原因
    expect(await 删.getAttribute("class")).toContain("disabled");
    expect(await 删.innerText()).toContain("录过 1 笔投入");
  } finally { await page.close(); }
});

it("按主渠道：卡头「主渠道（1）」，编辑是文字钮（.row-act 一种款）", async () => {
  const { page } = await 打开(1280);
  try {
    await page.locator("[aria-label='统计口径']").getByText("按主渠道").click();
    await expect.poll(async () => 字(await page.getByTestId("chan-period-note").innerText())).toBe("主渠道（1）·统计：全部?");
    const 编辑 = page.locator(".chan-list .ant-table-tbody").getByRole("button", { name: /编辑主渠道/ });
    expect(await 编辑.getAttribute("class")).not.toContain("ant-btn-link");
    await 文字钮(page, 编辑);
  } finally { await page.close(); }
});

it("账簿主题：照旧（说明行、带框录投入、删除不红、没有「?」）", async () => {
  const { page, errors } = await 打开(1366, {}, "ledger");
  try {
    expect(await page.getByTestId("chan-period-note").locator(".chan-period-label").innerText()).toBe("列表统计：全部");
    expect(await page.locator(".chan-list .chan-th").count()).toBe(0);
    const 钮 = page.locator(".chan-list .ant-table-tbody tr.ant-table-row").first().getByRole("button", { name: /录投入/ });
    expect(await 钮.getAttribute("class")).not.toContain("ant-btn-link");
    // 账簿照旧带框
    expect(await 钮.evaluate((e) => getComputedStyle(e).borderTopColor)).not.toBe("rgba(0, 0, 0, 0)");
    await page.locator(".chan-list .ant-table-tbody tr.ant-table-row").nth(3).getByRole("button", { name: /更多操作/ }).click();
    const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
    await 菜单.waitFor();
    expect(await 菜单.locator(".ant-dropdown-menu-item-danger").count()).toBe(0);
    expect(await 菜单.locator(".ant-dropdown-menu-item-divider").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
