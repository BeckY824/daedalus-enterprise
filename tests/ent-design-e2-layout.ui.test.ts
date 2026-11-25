/**
 * 设计语言 E2 · 项目页（11-22；落地计划-客户详情设计 E2 节）：
 *   D31「列表 | 看板」挪到筛选行最左、先「列表」后「看板」，搜索排第二（同客户页）；原来在页头右上、「看板 | 列表」。看板 / 列表两种看法都在筛选行；
 *       列表空库（筛选行不画）时那颗切换单独一行，回得到看板；阶段、进程同客户页带「挤」，1024 宽筛选行不折两排
 *   D29 不能新建的人（只读管理员、没设业务角色，服务端 能新建和领取 本来就拒）页头不摆「新增项目」、空态也不给「新增项目」
 *   K3  手机宽带「离职交接」的角色：标题块独占一行，不再挤成一字一行
 *   D40 滚到底，末行不在右下 AI 球底下（壳的 .has-ai-fab 留白）
 *   排版门槛：Windows 1024 / 1280 / 1366（左栏 220）+ 手机 390，超长项目名 / 客户名；页面不横滚、关键按钮 elementFromPoint 点得中
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, 包: string;
const 桩: Plugin = { name: "design-e2-projects", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  const 好 = "async()=>({ok:true})";
  stub(/^next\/link$/, "export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "", 好));
  stub(/^\.\.\/actions$/, `const f=${好};export const 编辑项目=f,改项目画像Action=f,勾项目交付=f;`);
  stub(/assign-actions$/, `const f=${好};export const 分配线索=f,自动分配线索=f,撤销自动分配=f,批量自动分配=f,本月分配情况=async()=>({月:'2026-11',人:[]}),我分出去的线索=async()=>[],项目分配线=async()=>null,分配带走的项目=async()=>({项目数:0,项目:[]});`);
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
    import Projects from '@/app/(app)/projects/ProjectsView';import {themeConfig} from '@/lib/theme';import {看板分列} from '@/lib/project/board';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购项目第二期';
    const 段=[['线索','潜客培育'],['商机','需求确认'],['商机','方案敲定']];
    const row=(i)=>({id:'p'+i,name:长+i,customerId:'c'+i,customerName:长,ownerId:'u'+(i%2),ownerName:'王'+i,phase:段[i%3][0],node:段[i%3][1],result:null,exceptionCategory:null,exceptionReason:null,pooled:false,amount:1234567,currency:'CNY',updatedAt:'2026-11-20T00:00:00.000Z',下一步时间:'2026-11-24T00:00:00.000Z'});
    const 行=Array.from({length:20},(_,i)=>row(i+1));
    window.__render=(o={})=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN} theme={themeConfig} button={{autoInsertSpace:false}}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true,currency:'CNY'}}>
      <Projects 行={o.空?[]:行} 列={看板分列(o.空?[]:行)} 总数={o.空?0:57} 页={1} 每页={20} users={[{id:'u0',name:'王0',email:'a'},{id:'u1',name:'王1',email:'b'}]}
        filters={{keyword:'',ownerId:'',pool:'',phase:'',...(o.筛||{})}} 企业版 能新建={o.能新建!==false} 待交接={o.交接??null}/>
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 参 = { 空?: boolean; 能新建?: boolean; 交接?: number; 筛?: Record<string, string> };
async function 开(w: number, o: 参 = {}, 看法: "列表" | "看板" = "列表"): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: w, height: w < 768 ? 800 : 900 }, ...(w < 768 ? { isMobile: true, hasTouch: true } : {}) });
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://design-e2.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><html><style>body{margin:0}</style>${壳}</html>` }));
  await page.goto("http://design-e2.test/projects");
  await page.evaluate((v) => { try { localStorage.setItem("projects-view", JSON.stringify(v)); } catch { /* 存不了就按默认 */ } }, 看法);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ content: w >= 768 ? ".app-content{display:block;margin-left:220px;padding:22px 26px}" : ".app-content{display:block}" });
  await page.addScriptTag({ content: 包 });
  await page.evaluate((x) => (window as unknown as { __render: (x: object) => void }).__render(x), o);
  await page.locator(".page-head").first().waitFor();
  if (process.env.E2_SHOT) await page.screenshot({ path: `${process.env.E2_SHOT}/e2-${w}-${看法}-${Object.keys(o).join("_") || "base"}.png`, fullPage: true });
  return { page, errors };
}

const 页横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const 球框 = (page: Page) => page.locator(".ai-fab").evaluate((el) => { const r = el.getBoundingClientRect(); return { 左: r.left - 6, 上: r.top - 6 }; });
const 点得中 = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }));
const 框 = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { 左: r.left, 右: r.right, 上: r.top, 下: r.bottom, 宽: r.width, 高: r.height }; });
const 切换 = (page: Page) => page.getByRole("radiogroup", { name: "列表 / 看板" });
const 切换字 = (page: Page) => 切换(page).locator(".ant-segmented-item-label").allInnerTexts();

it("D31：列表看法——「列表 | 看板」在筛选行最左、先列表后看板，搜索排第二；页头不再有这颗切换", async () => {
  const { page, errors } = await 开(1366);
  try {
    await page.locator("tr.ant-table-row").first().waitFor();
    expect(await page.locator(".page-head .ant-segmented").count()).toBe(0);
    expect(await 切换字(page)).toEqual(["列表", "看板"]);
    // 筛选行第一格就是切换，搜索紧跟在它右边
    expect(await page.locator(".list-bar > :first-child").evaluate((el) => el.classList.contains("list-view-seg"))).toBe(true);
    const 切 = await 框(page, ".list-bar .list-view-seg");
    const 搜 = await 框(page, ".list-bar .ant-input-affix-wrapper");
    expect(Math.abs(切.上 + 切.高 / 2 - (搜.上 + 搜.高 / 2))).toBeLessThan(2);
    expect(搜.左).toBeGreaterThan(切.右);
    const 别的左 = await page.locator(".list-bar .ant-select").evaluateAll((xs) => xs.map((x) => x.getBoundingClientRect().left));
    expect(别的左.every((x) => x > 搜.右)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D31：点「看板」换成看板，切换照旧在看板上面的筛选行最左；再点「列表」回到列表", async () => {
  const { page, errors } = await 开(1280);
  try {
    await page.locator("tr.ant-table-row").first().waitFor();
    await 切换(page).getByText("看板", { exact: true }).click();
    await page.locator(".pipe-col").first().waitFor();
    expect(await page.locator(".pipe-top > :first-child").evaluate((el) => el.classList.contains("list-view-seg"))).toBe(true);
    expect(await 切换字(page)).toEqual(["列表", "看板"]);
    expect(await page.locator(".page-head .ant-segmented").count()).toBe(0);
    await 切换(page).getByText("列表", { exact: true }).click();
    await page.locator("tr.ant-table-row").first().waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D31：列表一个项目都没有（筛选行不画）时切换单独一行，点得到「看板」回得去", async () => {
  const { page, errors } = await 开(1366, { 空: true });
  try {
    await page.locator(".cust-view-seg").waitFor();
    expect(await 切换字(page)).toEqual(["列表", "看板"]);
    await 切换(page).getByText("看板", { exact: true }).click();
    await page.locator(".pipe-top .list-view-seg").waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [1024, 1280, 1366]) {
  it(`${w} 宽 + 超长名字：筛选一行（切换、搜索、下拉、「列」同一排），页面不横滚；页头「新增项目」「离职交接」点得中`, async () => {
    const { page, errors } = await 开(w, { 交接: 3 });
    try {
      await page.locator("tr.ant-table-row").first().waitFor();
      const 中线 = await page.locator(".list-bar").evaluate((bar) => [...bar.querySelectorAll(":scope > .list-view-seg, :scope .ant-input-affix-wrapper, :scope .ant-select, :scope > .ant-btn")]
        .filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => { const r = el.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }));
      expect(中线.length).toBeGreaterThanOrEqual(3);
      expect(Math.max(...中线) - Math.min(...中线)).toBeLessThanOrEqual(2);
      expect(await 页横滚(page)).toBe(false);
      expect(await 点得中(page, ".page-head .ant-btn-primary")).toEqual([true]);
      expect(await page.locator(".page-head .ant-btn-primary").innerText()).toContain("新增项目");
      expect(await 点得中(page, ".page-head a[href='/projects/handover'] .ant-btn")).toEqual([true]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("D29：不能新建的人（只读管理员 / 没设业务角色）页头不摆「新增项目」，空态也不给「新增项目」", async () => {
  const 有 = await 开(1366, {}, "看板");
  try {
    expect(await 有.page.locator(".page-head").getByRole("button", { name: /新增项目/ }).count()).toBe(1);
  } finally { await 有.page.close(); }
  const 没 = await 开(1366, { 能新建: false }, "看板");
  try {
    expect(await 没.page.locator(".page-head").getByRole("button", { name: /新增项目/ }).count()).toBe(0);
    expect(没.errors).toEqual([]);
  } finally { await 没.page.close(); }
  const 空 = await 开(1366, { 能新建: false, 空: true, 筛: { keyword: "" } });
  try {
    await 空.page.locator(".cust-view-seg").waitFor();
    expect(await 空.page.getByRole("button", { name: /新增项目|新建第一个项目/ }).count()).toBe(0);
    expect(空.errors).toEqual([]);
  } finally { await 空.page.close(); }
});

// 29K（11-26）：375 也钉上（r7 实操 375 宽「项目」挤成一字一行）
for (const w of [390, 375]) it(`K3：${w} 带「离职交接」的角色——标题块独占一行，「项目」不挤成一字一行；按钮换到下一行、点得中；筛选同客户页三排`, async () => {
  const { page, errors } = await 开(w, { 交接: 3 });
  try {
    await page.locator("tr.ant-table-row").first().waitFor();
    const 头 = await 框(page, ".page-head");
    const 标题块 = await 框(page, ".page-head > :first-child");
    const 标题 = await 框(page, ".page-head h1");
    expect(标题块.宽).toBeGreaterThan(头.宽 - 2);
    // 「项目」两个字一行：高不超过一行半
    const 行高 = await page.locator(".page-head h1").evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height);
    expect(标题.高).toBeLessThan(行高 * 1.5);
    const 交接 = await 框(page, ".page-head a[href='/projects/handover'] .ant-btn");
    expect(交接.上).toBeGreaterThanOrEqual(标题.下);
    expect(await 点得中(page, ".page-head a[href='/projects/handover'] .ant-btn, .page-head .ant-btn-primary")).toEqual([true, true]);
    // 筛选：①「列表 | 看板」…「列」②搜索（+ 重置）③其余下拉、更多筛选
    const 切 = await 框(page, ".list-bar .list-view-seg");
    const 列 = await 框(page, ".list-bar > .ant-btn");
    const 搜 = await 框(page, ".list-bar .ant-input-affix-wrapper");
    expect(Math.abs(切.上 - 列.上)).toBeLessThan(6);
    expect(搜.上).toBeGreaterThan(切.下);
    expect(搜.宽).toBeGreaterThan(200);
    expect(await 页横滚(page)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// 29K（11-26）：768 / 1024 / 1280 带「离职交接」的角色，标题照样一行、两颗键点得中、页面不横滚
for (const w of [768, 1024, 1280]) it(`29K：${w} 宽带「离职交接」的角色，标题一行不挤、页头两颗键点得中、页面不横滚`, async () => {
  const { page, errors } = await 开(w, { 交接: 3 });
  try {
    await page.locator("tr.ant-table-row").first().waitFor();
    const 标题 = await 框(page, ".page-head h1");
    const 行高 = await page.locator(".page-head h1").evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height);
    expect(标题.高).toBeLessThan(行高 * 1.5);
    expect(await page.locator(".page-head h1").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await 点得中(page, ".page-head a[href='/projects/handover'] .ant-btn, .page-head .ant-btn-primary")).toEqual([true, true]);
    expect(await 页横滚(page)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [1366, 390]) {
  it(`D40：滚到底，末行不在右下 AI 球底下、项目名点得中（${w} 宽）`, async () => {
    const { page, errors } = await 开(w);
    try {
      await page.locator("tr.ant-table-row").first().waitFor();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(100);
      const 末行 = page.locator("tr.ant-table-row").last();
      const 下 = await 末行.evaluate((el) => el.getBoundingClientRect().bottom);
      expect(下).toBeLessThanOrEqual((await 球框(page)).上);
      expect(await 末行.locator("td").nth(1).evaluate((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + Math.min(40, r.width / 2), r.top + r.height / 2)); })).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}
