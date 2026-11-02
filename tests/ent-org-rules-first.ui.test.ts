/**
 * 设置 → 组织架构：组织规则放这一屏最上面（11-01 会议 §5「组织规则放设置首屏」）。
 *
 *   组织规则单独一块、排第一；通讯录同步挪到它下面，那段同步说明默认收起，点「同步说明」展开
 *   不能改的人：没有通讯录同步那块，组织规则照旧第一
 *   Windows 1024 / 1280 / 1366：不横向撑出
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "org-rules-first", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^\.\/LeadAssignCard$/, "export default function C(){return <div data-testid='lead-assign-card'/>}");
  stub(/^\.\/FeishuConnectCard$/, "export default function F(){return null}");
  stub(/^\.\/FeishuPushSwitch$/, "export default function P(){return null}");
  stub(/^\.\/org-actions$/, `const f=${空跑};export const 建部门=f,改部门=f,删部门=f,设规则=f,设字段权限=f,设改权限=f,设市场部门=f,设成员=f,
    设通讯录同步=f,立即同步通讯录=f,设职务对照=f,设通讯录凭据=f,设通讯录间隔=f,飞书表概况=async()=>({ok:false,error:'没接'}),
    通讯录概况=async()=>({ok:true,角色们:[],来源们:[{源:'feishu',名:'飞书',开:false,上次:null,角色对照:{},职务们:[],间隔分钟:60,凭据:{齐了:false,字段:[]}}]});`);
  stub(/^\.\.\/leads\/assign-actions$/, `export const 设不设配额=${空跑};export const 读线部门设置=async()=>({设的:{内贸:[],外贸:[]},还没勾:[],能改:true});export const 设线部门=${空跑};`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import OrgTab from '@/app/(app)/settings/OrgTab';
    const root=createRoot(document.getElementById('root'));
    const 人=(id,name,bizRole)=>({id,name,deptId:null,bizRole,line:null,managerId:null,dottedManagerId:null,自动上级:null});
    window.__render=({能改})=>root.render(<App><OrgTab value={{
      部门:[],成员:[人('a','某某超长名字的业务员'.repeat(3),'sales_mgr'),人('b','小王','sales')],能改,是老板:能改,
      规则开着:{按组织看客户:false,线索分配:true,字段权限:false,交接要确认:false,市场复核:true},字段权限:{},字段权限挡:null,改权限:{},线索分配:[]}}/></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(能改: boolean, width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://org.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://org.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(x => (window as unknown as { __render: (x: { 能改: boolean }) => void }).__render(x), { 能改 });
  await page.getByTestId("org-rules").waitFor();
  return { page, errors };
}
/** 这一屏每块卡片的标题，按页面上的先后 */
const 卡片顺序 = (page: import("playwright").Page) => page.locator(".ant-card-head-title").allInnerTexts();

it("组织规则排第一块，通讯录同步在它下面；同步说明默认收起，点开能看", async () => {
  const { page, errors } = await open(true);
  try {
    await page.getByTestId("org-sync").waitFor();
    const 顺序 = await 卡片顺序(page);
    expect(顺序[0]).toBe("组织规则");
    expect(顺序.indexOf("通讯录同步")).toBeGreaterThan(0);
    // 线索分配那块跟着组织规则（规则开了才有），通讯录同步在它后面
    expect(await page.evaluate(() => {
      const 分配 = document.querySelector("[data-testid=lead-assign-card]")!, 同步 = document.querySelector("[data-testid=org-sync]")!;
      return !!(分配.compareDocumentPosition(同步) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    const 说明 = page.getByTestId("org-sync-why");
    expect(await 说明.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    expect(await page.getByText("只读不写回", { exact: false }).isVisible()).toBe(false);
    await 说明.locator("summary").click();
    await page.getByText("只读不写回", { exact: false }).waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("不能改的人：没有通讯录同步，组织规则照旧第一", async () => {
  const { page, errors } = await open(false);
  try {
    const 顺序 = await 卡片顺序(page);
    expect(顺序[0]).toBe("组织规则");
    expect(顺序).not.toContain("通讯录同步");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：组织规则在首屏、不横向撑出", async (w) => {
  const { page } = await open(true, w);
  try {
    await page.getByTestId("org-sync").waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const box = (await page.getByTestId("org-rules").boundingBox())!;
    expect(box.y).toBeLessThan(900);
    expect(box.x + box.width).toBeLessThanOrEqual(w);
  } finally { await page.close(); }
});
