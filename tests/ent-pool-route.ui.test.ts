/**
 * 公海：多项目客户项目随客户整体转让（10-27 会议，服务端规则见 org-rules.test.ts / ent-pool-rules.test.ts）。
 *
 *   设置 → 「多项目客户的公海走法」只读说明，没有二选一的单选
 *   Windows 1024 / 1280 / 1366：设置页不横向撑出
 *   公海页的属性筛选（10-31）：全部 / 线索池 / 商机池 / 订单池 / 客户池（11-11），1024 宽（左边留出导航）一排不折行、页面不横向撑出；1280 宽入池原因 / 排序 / 搜索在同一行
 * 开关关闭时组织规则是 null，这张卡不出现。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string, 公海bundle: string;
const plugin: Plugin = { name: "pool-route-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/blocker-actions$/, `const f=${空跑};export const 存卡点默认Action=f,存卡点角色开关Action=f,新增原因Action=f,改原因名Action=f,改原因状态Action=f,删原因Action=f,合并原因Action=f;`);
  stub(/\/projects\/actions$|\/ent-dict-actions$|\/commission-actions$/, `const f=${空跑};export const 加组员角色=f,改组员角色=f,加项目异常类别=f,改项目异常类别=f,改组织规则=f,预览超时回收=async()=>({ok:true,项目:[]}),改提成比例=f,改按人提成比例=f,加企业选项=f,改企业选项=f,存分配谁能用=f;`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import Settings from '@/app/(app)/settings/ProjectSettingsTab';
    import {默认卡点默认} from '@/lib/project/blocker-rules';import {默认组织规则} from '@/lib/project/org-rules';
    const root=createRoot(document.getElementById('root'));
    window.__render=(开)=>root.render(<App><div style={{maxWidth:640,padding:16}}><Settings 成员={[]} value={{角色们:[],类别们:[],组织规则:开?默认组织规则:null,持有:{},企业选项:null,卡点默认:默认卡点默认,提成比例:null,能改提成比例:false,挡:{字典:null,持有上限:null,节点时限:null,必填字段:null,阶段规则:null}}}/></div></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  // 公海页：PoolView 引的几个 server action 都回成功，不点
  const 公海插件: Plugin = { name: "pool-view-boundaries", setup(b) {
    const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
    const 好 = "async()=>({ok:true,updated:0})";
    stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){(window.__去=window.__去||[]).push(u)},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
    stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
    stub(/customers\/pool-actions$/, `const f=${好};export const 领取=f,分配公海=f,撤销公海=f;`);
    stub(/\/projects\/actions$/, `export const 领取项目=${好};`);
    stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
    stub(/^\.\/actions$/, `const f=${好};export const 标无效客户=f,恢复有效客户=f,分配公海项目=f,撤销公海项目=f;`);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
  } };
  公海bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import Pool from '@/app/(app)/pool/PoolView';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import {快捷们} from '@/lib/enterprise/unified-pool';
    const 快捷数=Object.fromEntries(快捷们.map(k=>[k,9999]));
    const 行=[{id:'c1',种:'客户',customerId:'c1',projectId:null,客户名:'某某超长名字的智能制造装备与工业自动化系统集成有限公司',项目名:null,进程:null,属性:'订单池',最后跟进:null,入池时间:new Date().toISOString(),创建时间:new Date().toISOString(),类:'主动退回',累计:1,进程明细:null,入池原因:'—',快捷:'首次退回',原负责人是我:false}];
    // 1024 宽：左边 220 的导航 + 内容区 24 内边距，同 app 外框
    window.__render=(quick='')=>createRoot(document.getElementById('root')).render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <div style={{display:'flex'}}><nav style={{width:220,flex:'none'}}/><main style={{flex:1,minWidth:0,padding:24}}>
        <Pool 行={行} 总数={1} 当前页={1} pageSize={20} 快捷数={快捷数} 属性数={{全部:99999,线索池:33333,商机池:33333,订单池:33333,客户池:33333}} 截断={false} 库里有 filters={{keyword:'',attr:'订单池',quick,sort:''}} 能标无效 能恢复 能分配 users={[]} 持有={null}/>
      </main></div></BusinessProvider></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [公海插件], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(开: boolean, width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://route.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://route.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(w => (window as unknown as { __render: (x: boolean) => void }).__render(w), 开);
  await page.locator(".ant-card").first().waitFor();
  return { page, errors };
}

it("多项目客户的公海走法：只读说明，没有二选一", async () => {
  const { page, errors } = await open(true);
  try {
    const 卡 = page.locator(".ant-card").filter({ hasText: "多项目客户的公海走法" });
    await 卡.waitFor();
    expect(await 卡.innerText()).toContain("项目退回、超时只进线索公海，客户不动");
    expect(await 卡.locator("input[type=radio]").count()).toBe(0);
    expect(await page.locator("[aria-label='多项目客户公海']").count()).toBe(0);
    expect(await page.getByText("项目可转让").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("开关关闭（组织规则为 null）：没有这张卡", async () => {
  const { page, errors } = await open(false);
  try {
    expect(await page.getByText("多项目客户的公海走法").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：设置页不横向撑出", async (w) => {
  const { page } = await open(true, w);
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：阶段规则里的字数上限（M-节点-03）两格都在、默认空着写「不设」，不出卡片、不横向撑出", async (w) => {
  const { page, errors } = await open(true, w);
  try {
    const 卡 = page.locator(".ant-card").filter({ hasText: "线索验证的字数上限" });
    await 卡.waitFor();
    const 卡框 = (await 卡.boundingBox())!;
    for (const k of ["培育计划", "无效原因"]) {
      const 格 = 卡.locator(`input[aria-label='${k}字数上限']`);
      expect(await 格.inputValue(), k).toBe("");
      expect(await 格.getAttribute("placeholder"), k).toBe("不设");
      const 框 = (await 格.boundingBox())!;
      expect(框.x + 框.width, k).toBeLessThanOrEqual(卡框.x + 卡框.width);
    }
    expect(await 卡.getByRole("button", { name: "保存字数上限" }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("公海页 %ipx：属性筛选 全部 / 线索池 / 商机池 / 订单池 / 客户池 一排不折行，页面不横向撑出", async (w) => {
  const page = await browser.newPage({ viewport: { width: w, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.route("http://route.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
    await page.goto("http://route.test/pool"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 公海bundle });
    await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
    const 筛 = page.locator(".ant-segmented").first();
    await 筛.waitFor();
    const 项 = await 筛.locator(".ant-segmented-item").evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { 字: (e.textContent ?? "").trim(), 顶: Math.round(r.top), 高: Math.round(r.height), 选中: e.classList.contains("ant-segmented-item-selected") }; }));
    expect(项.map(x => x.字)).toEqual(["全部 99999", "线索池 33333", "商机池 33333", "订单池 33333", "客户池 33333"]);
    // 一排：顶对齐，每一项都是单行高（不在格子里折成两行）
    expect(new Set(项.map(x => x.顶)).size).toBe(1);
    const 单行 = Math.min(...项.map(x => x.高));
    for (const x of 项) expect(x.高, x.字).toBeLessThanOrEqual(单行 + 1);
    expect(项.find(x => x.选中)?.字).toBe("订单池 33333");
    // 10-31 晚：入池原因、排序、搜索和属性同一行（1280 放得下；1024 允许挤到下一行）
    if (w >= 1280) {
      const 中 = await page.evaluate(() => [".ant-segmented", ".ant-select", ".ant-input-affix-wrapper"].map(q => { const r = document.querySelector(q)!.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }));
      expect(Math.max(...中) - Math.min(...中)).toBeLessThanOrEqual(3);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// P-公海-09（客户 11-09 回执 X1 = A）：「公海 + 标无效」在界面上统一叫「公海回收站」，公海页有入口（= 筛标了无效的）
it.each([1024, 1280, 1366])("公海页 %ipx：有「公海回收站」入口，点了筛无效；入池方式里不再叫「无效客户」；不横向撑出", async (w) => {
  const page = await browser.newPage({ viewport: { width: w, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.route("http://route.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
    await page.goto("http://route.test/pool"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 公海bundle });
    await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
    const 入口 = page.getByRole("button", { name: /公海回收站/ });
    await 入口.waitFor();
    expect((await 入口.innerText()).replace(/\s+/g, " ").trim()).toBe("公海回收站 9999");
    expect(await 入口.getAttribute("aria-pressed")).toBe("false");
    // 入口整个在屏里、单行，页面不横向撑出
    const 框 = await 入口.evaluate(e => { const r = e.getBoundingClientRect(); return { 右: r.right, 左: r.left, 高: r.height, 挡: !e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }; });
    expect([框.左 >= 0, 框.右 <= w, 框.高 <= 34, 框.挡]).toEqual([true, true, true, false]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // 入池方式下拉：那一项叫「公海回收站」
    await page.getByLabel("入池方式").click();
    const 项 = await page.locator(".ant-select-item-option").evaluateAll(els => els.map(e => (e.firstElementChild?.firstElementChild?.firstElementChild?.textContent ?? "").trim()));
    expect(项).toContain("公海回收站 9999");
    expect(项.join("|")).not.toContain("无效客户");
    await page.keyboard.press("Escape");
    // 点入口 = 筛标了无效的（地址栏参数照旧，老链接不坏）；再点一次取消
    await 入口.click();
    expect(await page.evaluate(() => (window as unknown as { __去: string[] }).__去.map(u => new URL(u, location.href).searchParams.get("quick")))).toEqual(["无效客户"]);
    expect(await 入口.getAttribute("aria-pressed")).toBe("true");
    expect(await page.locator(".ant-select").first().innerText()).toContain("公海回收站");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await 入口.click();
    expect(await page.evaluate(() => (window as unknown as { __去: string[] }).__去.map(u => new URL(u, location.href).searchParams.get("quick")))).toEqual(["无效客户", null]);
    expect(await 入口.getAttribute("aria-pressed")).toBe("false");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
