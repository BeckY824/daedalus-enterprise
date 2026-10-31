/**
 * 公海：多项目客户项目随客户整体转让（10-27 会议，服务端规则见 org-rules.test.ts / ent-pool-rules.test.ts）。
 *
 *   设置 → 「多项目客户的公海走法」只读说明，没有二选一的单选
 *   Windows 1024 / 1280 / 1366：设置页不横向撑出
 *   公海页的属性筛选（10-31）：全部 / 线索池 / 商机池 / 其他，1024 宽（左边留出导航）一排不折行、页面不横向撑出；1280 宽入池原因 / 排序 / 搜索在同一行
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
  stub(/blocker-actions$/, `const f=${空跑};export const 存卡点默认Action=f;`);
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
    stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
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
    const 行=[{id:'c1',种:'客户',customerId:'c1',projectId:null,客户名:'某某超长名字的智能制造装备与工业自动化系统集成有限公司',项目名:null,进程:null,属性:'其他',最后跟进:null,入池时间:new Date().toISOString(),创建时间:new Date().toISOString(),类:'主动退回',累计:1,进程明细:null,入池原因:'—',快捷:'首次退回',原负责人是我:false}];
    // 1024 宽：左边 220 的导航 + 内容区 24 内边距，同 app 外框
    window.__render=()=>createRoot(document.getElementById('root')).render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <div style={{display:'flex'}}><nav style={{width:220,flex:'none'}}/><main style={{flex:1,minWidth:0,padding:24}}>
        <Pool 行={行} 总数={1} 当前页={1} pageSize={20} 快捷数={快捷数} 属性数={{全部:99999,线索池:33333,商机池:33333,其他:33333}} 截断={false} 库里有 filters={{keyword:'',attr:'其他',quick:'',sort:''}} 能标无效 能恢复 能分配 users={[]} 持有={null}/>
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
    expect(await 卡.innerText()).toContain("项目随客户整体转让");
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

it.each([1024, 1280])("公海页 %ipx：属性筛选 全部 / 线索池 / 商机池 / 其他 一排不折行，页面不横向撑出", async (w) => {
  const page = await browser.newPage({ viewport: { width: w, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.route("http://route.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
    await page.goto("http://route.test/pool"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 公海bundle });
    await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
    const 筛 = page.locator(".ant-segmented").first();
    await 筛.waitFor();
    const 项 = await 筛.locator(".ant-segmented-item").evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { 字: (e.textContent ?? "").trim(), 顶: Math.round(r.top), 高: Math.round(r.height), 选中: e.classList.contains("ant-segmented-item-selected") }; }));
    expect(项.map(x => x.字)).toEqual(["全部 99999", "线索池 33333", "商机池 33333", "其他 33333"]);
    // 一排：顶对齐，每一项都是单行高（不在格子里折成两行）
    expect(new Set(项.map(x => x.顶)).size).toBe(1);
    const 单行 = Math.min(...项.map(x => x.高));
    for (const x of 项) expect(x.高, x.字).toBeLessThanOrEqual(单行 + 1);
    expect(项.find(x => x.选中)?.字).toBe("其他 33333");
    // 10-31 晚：入池原因、排序、搜索和属性同一行（1280 放得下；1024 允许挤到下一行）
    if (w >= 1280) {
      const 中 = await page.evaluate(() => [".ant-segmented", ".ant-select", ".ant-input-affix-wrapper"].map(q => { const r = document.querySelector(q)!.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }));
      expect(Math.max(...中) - Math.min(...中)).toBeLessThanOrEqual(3);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
