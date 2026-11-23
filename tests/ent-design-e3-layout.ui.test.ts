/**
 * 设计语言 E3 · 新线索（11-22；落地计划-客户详情设计 E3 节 → 落地计划-三页设计「E3 · 新线索」）：
 *   D09 行末「分配」「自动分配」用 L-B 定的行内款 .row-act（蓝字、不带框、悬停浅蓝底），不再是文字链；和公海「领取」同一个样
 *   D37 筛选行「全部成员」「全部进程」占位字墨色（原来 faint 2.21:1，像禁用），同 L-A
 *   D06 390 首屏多露行：页头副标题收起；筛选两排（①搜索 + 重置 … 列 ②负责人 · 进程 各半），同 L-A 的摆法
 *   D40 滚到底，末行「自动分配」不在右下 AI 球底下（壳的 .has-ai-fab 留白），1366 / 390 都点得中
 *   排版门槛：Windows 1024 / 1280 / 1366（左栏 220）+ 手机 390，超长项目名 / 客户名；页面不横滚、关键按钮 elementFromPoint 点得中
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, 包: string;
const 桩: Plugin = { name: "design-e3-leads", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  const 好 = "async()=>({ok:true})";
  stub(/^next\/link$/, "export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "", 好));
  stub(/^\.\.\/actions$/, `const f=${好};export const 编辑项目=f,改项目画像Action=f,勾项目交付=f;`);
  stub(/assign-actions$/, `const f=${好};export const 分配线索=f,自动分配线索=async()=>({ok:true,toUserId:'u1',接手人:'王1',已分:1,配额:null,为什么:'按顺序',还原:{原:'u1',待分配:null,公海:null}}),撤销自动分配=f,批量自动分配=f,本月分配情况=async()=>({月:'2026-11',人:[]}),我分出去的线索=async()=>[],项目分配线=async()=>null,分配带走的项目=async()=>({项目数:0,项目:[]});`);
  stub(/blocker-actions$/, `const f=${好};export const 发布卡点Action=f,认领卡点Action=f,完成卡点Action=f,删卡点Action=f,存卡点默认Action=f,存卡点角色开关Action=f,新增原因Action=f,改原因名Action=f,改原因状态Action=f,删原因Action=f,合并原因Action=f;`);
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[],取客户选项=async()=>null,取客户近况=async()=>null;");
  stub(/project-actions$/, "export const 给客户建项目=async()=>({ok:true});export const 新项目分配数据=async()=>null;export const 建项目带走的项目=async()=>({项目数:0,项目:[]});");
  stub(/new\/wizard-actions$/, "export const 取建档数据=async()=>null;");
  stub(/new\/ProjectWizard$/, "export const 建档弹窗=()=>null;");
  stub(/board-actions$/, "export const 再看一列=async()=>({ok:true,行:[],总:0}),再看项目页一列=async()=>({ok:true,行:[],总:0}),项目标签筛选项=async()=>[];");
  stub(/^next\/dynamic$/, "export default function d(){return function D(){return null}}");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

/** 壳：.has-ai-fab 给正文底下留 --ai-room，右下角一颗 AI 球（同 AppShell / AiFab 的类名） */
const 壳 = "<div class='has-ai-fab'><main class='app-content'><div id='root'></div></main><button class='ai-fab' aria-label='AI 助手'><span class='ai-fab-core'></span></button></div>";
beforeAll(async () => {
  包 = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Projects from '@/app/(app)/projects/ProjectsView';import {themeConfig} from '@/lib/theme';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购项目第二期';
    const 节点=['潜客培育','线索验证','线索推进'];
    const row=(i)=>({id:'p'+i,name:长+i,customerId:'c'+i,customerName:长,ownerId:'u'+(i%2),ownerName:'王'+i,phase:'线索',node:节点[i%3],result:null,exceptionCategory:null,exceptionReason:null,pooled:false,amount:1234567,currency:'CNY',updatedAt:'2026-11-20T00:00:00.000Z',下一步时间:'2026-11-24T00:00:00.000Z'});
    const 行=Array.from({length:20},(_,i)=>row(i+1));
    window.__render=(o={})=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN} theme={themeConfig} button={{autoInsertSpace:false}}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true,currency:'CNY'}}>
      <Projects 行={o.空?[]:行} 列={[]} 总数={o.空?0:57} 页={1} 每页={20} users={[{id:'u0',name:'王0',email:'a'},{id:'u1',name:'王1',email:'b'}]}
        filters={{keyword:'',ownerId:'',pool:'',phase:'',...(o.筛||{})}} 阶段={o.项目页?undefined:"线索"} 企业版 线索分配开着={o.能分!==false} 能自动分配={o.能分!==false}
        待分配={o.待分配?{条数:3,最早:'11-20 09:12'}:null} 能新建/>
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 参 = { 项目页?: boolean; 空?: boolean; 能分?: boolean; 待分配?: boolean; 筛?: Record<string, string> };
async function 开(w: number, o: 参 = {}): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: w, height: w < 768 ? 800 : 900 }, ...(w < 768 ? { isMobile: true, hasTouch: true } : {}) });
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://design-e3.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><html><style>body{margin:0}</style>${壳}</html>` }));
  await page.goto("http://design-e3.test/leads");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  // 正文的留白在壳的 .app-content 上（手机宽 globals.css 给 14px 12px）；电脑宽左边让出左栏 220
  await page.addStyleTag({ content: w >= 768 ? ".app-content{display:block;margin-left:220px;padding:22px 26px}" : ".app-content{display:block}" });
  await page.addScriptTag({ content: 包 });
  await page.evaluate((x) => (window as unknown as { __render: (x: object) => void }).__render(x), o);
  await page.locator(o.项目页 ? ".page-head" : o.空 ? ".list-none, .ant-empty, .empty" : "tr.ant-table-row").first().waitFor();
  if (process.env.E3_SHOT) await page.screenshot({ path: `${process.env.E3_SHOT}/e3-${w}-${Object.keys(o).join("_") || "base"}.png`, fullPage: true });
  return { page, errors };
}

const 页横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const 球框 = (page: Page) => page.locator(".ai-fab").evaluate((el) => { const r = el.getBoundingClientRect(); return { 左: r.left - 6, 上: r.top - 6 }; });
const 点得中 = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }));
const 框 = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { 左: r.left, 右: r.right, 上: r.top, 下: r.bottom, 宽: r.width, 高: r.height }; });

const 长 = "某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购项目第二期";
/** 计算出来的颜色值（rgb(…)），拿来和 CSS 变量比 */
const 色 = (page: Page, v: string) => page.evaluate((x) => { const d = document.createElement("span"); d.style.color = `var(${x})`; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }, v);
const 样 = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => { const s = getComputedStyle(el); return { 框: s.borderTopColor, 底: s.backgroundColor, 字: s.color, 影: s.boxShadow }; });

it("D09：行末「分配」「自动分配」是 L-B 的 .row-act 款——蓝字、不带框、底透明，悬停浅蓝底；字不被拆成「分 配」", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 分 = page.getByRole("button", { name: `分配 ${长}1`, exact: true });
    const 自 = page.getByRole("button", { name: `自动分配 ${长}1`, exact: true });
    for (const b of [分, 自]) {
      expect(await b.getAttribute("class")).toMatch(/\brow-act\b/);
      expect(await b.getAttribute("class")).not.toMatch(/ant-btn-variant-link/);
    }
    expect(await 分.innerText()).toBe("分配");
    expect(await 自.innerText()).toBe("自动分配");
    const 前 = await 分.evaluate((el) => { const s = getComputedStyle(el); return { 框: s.borderTopColor, 底: s.backgroundColor, 字: s.color }; });
    expect(前).toEqual({ 框: "rgba(0, 0, 0, 0)", 底: "rgba(0, 0, 0, 0)", 字: await 色(page, "--brand") });
    await 分.hover();
    await expect.poll(() => 分.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await page.evaluate(() => { const d = document.createElement("span"); d.style.color = "var(--brand-bg)"; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }));
    // 两颗一样高、同一行，在钉住的操作列里摆得下（不被裁）
    const [a, b] = [await 分.boundingBox(), await 自.boundingBox()];
    expect(a!.height).toBe(b!.height);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(1);
    const 格 = await page.locator("tr.ant-table-row").first().locator("td").last().boundingBox();
    expect(b!.x + b!.width).toBeLessThanOrEqual(格!.x + 格!.width);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D09：换了款，点了照旧——自动分配的结果原地写在这一行（已分给 王1 ✓），按钮收掉", async () => {
  const { page, errors } = await 开(1280);
  try {
    await page.getByRole("button", { name: `自动分配 ${长}1`, exact: true }).click();
    await page.locator(".assign-done", { hasText: "已分给 王1 ✓" }).waitFor();
    expect(await page.getByRole("button", { name: `自动分配 ${长}1`, exact: true }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D09：不能分配的人照旧没有这一列", async () => {
  const { page, errors } = await 开(1366, { 能分: false });
  try {
    expect(await page.getByRole("button", { name: `分配 ${长}1`, exact: true }).count()).toBe(0);
    expect(await page.locator(".ant-btn.row-act").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D37：筛选行「全部成员」「全部进程」占位字墨色（不再是 faint 像禁用）；选择框白底 + 看得见的框", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 占位 = page.locator(".list-bar .ant-select-placeholder");
    expect(await 占位.allInnerTexts()).toEqual(["全部成员", "全部进程"]);
    const 墨 = await 色(page, "--ink");
    expect(await 占位.evaluateAll((xs) => xs.map((x) => getComputedStyle(x).color))).toEqual([墨, 墨]);
    const 框样 = await 样(page, ".list-bar .ant-select");
    expect(框样.底).toBe("rgb(255, 255, 255)");
    expect(框样.框).toBe(await 色(page, "--field-line"));
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [1024, 1280, 1366]) {
  it(`${w} 宽 + 超长名字：筛选一行（搜索、两个下拉、「列」同一排），页面不横滚；首行「分配」「自动分配」、页头「新线索」都点得中`, async () => {
    const { page, errors } = await 开(w, { 待分配: true });
    try {
      const 顶 = await page.locator(".list-bar").evaluate((bar) => [...bar.querySelectorAll(":scope .ant-input-affix-wrapper, :scope .ant-select, :scope > .ant-btn")].map((el) => Math.round(el.getBoundingClientRect().top)));
      expect(顶.length).toBe(4);
      expect(new Set(顶).size).toBe(1);
      expect(await 页横滚(page)).toBe(false);
      expect(await 点得中(page, `[aria-label="分配 ${长}1"], [aria-label="自动分配 ${长}1"]`)).toEqual([true, true]);
      expect(await 点得中(page, ".page-head .ant-btn-primary")).toEqual([true]);
      // 副标题电脑宽照旧在
      expect(await page.locator(".page-head p").first().isVisible()).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("D06：390 首屏多露行——副标题收起，页头一排；筛选两排：①搜索 … 「列」②「全部成员」「全部进程」各占一半；页面不横滚", async () => {
  const { page, errors } = await 开(390, { 待分配: true });
  try {
    expect(await page.locator(".page-head p").first().isVisible()).toBe(false);
    const 标题 = await 框(page, ".page-head h1");
    const 主钮 = await 框(page, ".page-head .ant-btn-primary");
    expect(主钮.上).toBeLessThan(标题.下);
    const 搜 = await 框(page, ".list-bar .ant-input-affix-wrapper");
    const 列 = await 框(page, ".list-bar > .ant-btn");
    const [成员, 进程] = await page.locator(".list-bar .ant-select").evaluateAll((xs) => xs.map((el) => { const r = el.getBoundingClientRect(); return { 左: r.left, 右: r.right, 上: r.top, 宽: r.width }; }));
    // ①搜索和「列」一排，「列」顶到右边
    expect(Math.abs(搜.上 - 列.上)).toBeLessThan(2);
    expect(搜.宽).toBeGreaterThanOrEqual(150);
    const 栏 = await 框(page, ".list-bar");
    expect(Math.abs(列.右 - 栏.右)).toBeLessThan(1);
    // ②两个下拉同一排、在搜索下面、各约一半、左右撑满
    expect(Math.abs(成员.上 - 进程.上)).toBeLessThan(1);
    expect(成员.上).toBeGreaterThan(搜.下);
    expect(Math.abs(成员.宽 - 进程.宽)).toBeLessThan(2);
    expect(Math.abs(成员.左 - 栏.左)).toBeLessThan(1);
    expect(Math.abs(进程.右 - 栏.右)).toBeLessThan(1);
    // 两排筛选：表格紧跟在第二排下面（原来四排，「列」单独一排）
    const 表 = await 框(page, ".ant-table-thead");
    expect(表.上 - 成员.上).toBeLessThan(60);
    expect(await 页横滚(page)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D06：390 筛了东西，「重置」出来也在第一排（搜索和「列」之间），点得中；「列」不掉到第三排", async () => {
  const { page, errors } = await 开(390, { 筛: { ownerId: "u1" } });
  try {
    const 搜 = await 框(page, ".list-bar .ant-input-affix-wrapper");
    const 重置 = await 框(page, ".list-bar .list-reset");
    const 列 = await 框(page, ".list-bar > .ant-btn");
    expect(Math.abs(重置.上 - 搜.上)).toBeLessThan(2);
    expect(Math.abs(列.上 - 搜.上)).toBeLessThan(2);
    expect(重置.左).toBeGreaterThan(搜.右);
    expect(列.左).toBeGreaterThan(重置.右);
    expect(await 点得中(page, ".list-bar .list-reset")).toEqual([true]);
    expect(await 页横滚(page)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("390 触屏：「分配」「自动分配」点击区 44 高，点得中", async () => {
  const { page, errors } = await 开(390);
  try {
    const 高 = await page.locator(`[aria-label="分配 ${长}1"], [aria-label="自动分配 ${长}1"]`).evaluateAll((xs) => xs.map((x) => x.getBoundingClientRect().height));
    expect(高.every((h) => h >= 44)).toBe(true);
    expect(await 点得中(page, `[aria-label="分配 ${长}1"], [aria-label="自动分配 ${长}1"]`)).toEqual([true, true]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [1366, 390]) {
  it(`D40：滚到底，末行「自动分配」不在右下 AI 球底下、点得中（${w} 宽）`, async () => {
    const { page, errors } = await 开(w);
    try {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(100);
      const 末 = page.getByRole("button", { name: `自动分配 ${长}20`, exact: true });
      const 下 = await 末.evaluate((el) => el.getBoundingClientRect().bottom);
      expect(下).toBeLessThanOrEqual((await 球框(page)).上);
      expect(await 点得中(page, `[aria-label="自动分配 ${长}20"]`)).toEqual([true]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("项目页本身（不是新线索页）不挂 .leads-page：D37 / D06 只管新线索页（项目页归 E2）", async () => {
  const 新 = await 开(1366);
  try { expect(await 新.page.locator(".leads-page > .page-head").count()).toBe(1); } finally { await 新.page.close(); }
  const { page, errors } = await 开(1366, { 项目页: true });
  try {
    expect(await page.locator(".page-head h1").innerText()).toBe("项目");
    expect(await page.locator(".leads-page").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
