/**
 * 设置 → 组织架构 → 组织规则：「超时未跟进自动转」开关（11-17 用户定「下一版给管理员一个开 / 关」）。
 *
 *   规则表里多一条，默认开；组织规则卡开头那句把默认开的都列出来
 *   系统管理员（能改）拨关：先弹后果框（P-界面-40 组织规则开关），写清不再提醒、不再自动转、已转的不收回；取消不动，确认才调 设规则(false, "超时自动转")
 *   不能改的人：开关灰着
 *   Windows 1024 / 1280 / 1366：说明不横向撑出
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "overdue-switch", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__refresh=(window.__refresh||0)+1},push(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^\.\/LeadAssignCard$/, "export default function C(){return null}");
  stub(/^\.\/FeishuConnectCard$/, "export default function F(){return null}");
  stub(/^\.\/FeishuPushSwitch$/, "export default function P(){return null}");
  stub(/^\.\/OrgSyncCard$/, "export default function S(){return null}");
  stub(/^\.\/org-actions$/, `const f=${空跑};export const 建部门=f,改部门=f,删部门=f,设字段权限=f,设改权限=f,设市场部门=f,设只看某人=f,设回收站副手=f,设成员=f;
    export const 设规则=async(...a)=>{(window.__调用||(window.__调用=[])).push(a);return{ok:true}};`);
  stub(/^\.\.\/leads\/assign-actions$/, `export const 设不设配额=${空跑};export const 读线部门设置=async()=>({设的:{内贸:[],外贸:[]},还没勾:[],能改:true});export const 设线部门=${空跑};`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import OrgTab from '@/app/(app)/settings/OrgTab';
    const root=createRoot(document.getElementById('root'));
    const 人=(id,name,bizRole)=>({id,name,deptId:null,bizRole,line:null,managerId:null,dottedManagerId:null});
    window.__render=({能改})=>root.render(<App><OrgTab value={{
      部门:[],成员:[人('a','老板','director'),人('b','小王','sales')],能改,是老板:能改,
      规则开着:{按组织看客户:false,线索分配:false,字段权限:false,市场复核:true,超时自动转:true},字段权限:{},字段权限挡:null,改权限:{},线索分配:null}}/></App>);
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
const 调用们 = (page: Page) => page.evaluate(() => (window as unknown as { __调用?: unknown[][] }).__调用 ?? []);

it("组织规则里有「超时未跟进自动转」，开着；开头那句列出默认开的两条", async () => {
  const { page, errors } = await open(true);
  try {
    const 开关 = page.getByTestId("org-rule-reply-overdue");
    expect(await 开关.getAttribute("aria-label")).toBe("超时未跟进自动转");
    expect(await 开关.isChecked()).toBe(true);
    expect(await 开关.isDisabled()).toBe(false);
    const 卡 = await page.getByTestId("org-rules").innerText();
    expect(卡).toContain("除了「无效线索要市场复核」「超时未跟进自动转」都默认关着");
    expect(卡).toContain("不再发超时提醒、不再自动转");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("拨关：先弹后果框写清已转的不收回；取消不动，确认才调 设规则(false, 超时自动转) 并刷新", async () => {
  const { page, errors } = await open(true);
  try {
    const 开关 = page.getByRole("switch", { name: "超时未跟进自动转" });
    await 开关.click();
    const 框 = page.getByRole("dialog", { name: "关掉「超时未跟进自动转」？" });
    await 框.waitFor();
    const 话 = await 框.innerText();
    expect(话).toContain("不再发超时提醒、不再自动转");
    expect(话).toContain("已经转出去的线索不收回");
    await 框.getByRole("button", { name: /取\s?消/ }).click();
    await 框.waitFor({ state: "detached" });
    expect(await 调用们(page)).toEqual([]);
    expect(await 开关.isChecked()).toBe(true);

    await 开关.click();
    await page.getByRole("dialog").getByRole("button", { name: "确认关掉" }).click();
    await page.waitForFunction(() => (window as unknown as { __refresh?: number }).__refresh === 1);
    expect(await 调用们(page)).toEqual([[false, "超时自动转"]]);
    expect(await 开关.isChecked()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("不能改的人（不是能管设置的系统管理员）：开关灰着", async () => {
  const { page, errors } = await open(false);
  try {
    expect(await page.getByRole("switch", { name: "超时未跟进自动转" }).isDisabled()).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：新开关那行不横向撑出", async (w) => {
  const { page } = await open(true, w);
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const box = (await page.getByTestId("org-rule-reply-overdue").locator("xpath=../..").boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(w);
  } finally { await page.close(); }
});
