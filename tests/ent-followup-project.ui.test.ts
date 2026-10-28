/**
 * 企业版客户页记跟进默认挂项目（10-27 会议：「默认自动关联当前项目」；服务端规则见 ent-followup-project.test.ts）。
 *
 *   给了在推项目：「关联商机」换成「关联项目」，默认选第一个（页面按最近动过排）；必选，不能清空（10-28 A2）
 *   给了空列表：这一格还在，提示「没挂项目，建议先建项目」，照旧能记，交上去是 null
 *   编辑：不摆这一格，交上去不带 projectId
 *   开关关闭（页面不给 projects）：和原来一样是「关联商机」，交上去不带 projectId
 *   Windows 1024 / 1280 / 1366：超长项目名不横向撑出，「保存」点得中
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "followup-project-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  stub(/^\.\/actions$/, "export const saveFollowUp=async x=>{window.__存=x;return{ok:true,id:'f1'}},completePlan=async()=>({ok:true});");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no'});");
  stub(/^\.\/CustomerPick$/, "export default function C(){return null}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import FollowUpForm from '@/app/(app)/customers/[id]/FollowUpForm';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司年度框架采购项目'.repeat(5);
    window.__render=({项目,编辑})=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>
      <FollowUpForm open onClose={()=>{}} onSaved={()=>{}} customerId="c1" aiEnabled={false}
        record={编辑?{id:'f9',type:'PHONE',title:'',content:'原来的',status:'已完成',occurredAt:'2026-10-20T10:00:00.000Z',updatedAt:'2026-10-20T10:00:00.000Z'}:null}
        contacts={[]} opportunities={项目==null?[{id:'o1',name:'一个商机'}]:[]}
        projects={项目==='有'?[{id:'p1',name:长},{id:'p2',name:'二号项目'}]:项目==='空'?[]:null}/>
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
type 参数 = { 项目?: "有" | "空" | null; 编辑?: boolean };
async function open(p: 参数, width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://fup.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://fup.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(x => (window as unknown as { __render: (x: 参数) => void }).__render(x), p);
  await page.getByRole("button", { name: /保\s*存/ }).waitFor();
  return { page, errors };
}
async function 存(page: import("playwright").Page) {
  await page.locator("#content").fill("聊了报价");
  await page.getByRole("button", { name: /保\s*存/ }).click();
  await page.waitForFunction(() => Reflect.get(window, "__存"));
  return page.evaluate(() => Reflect.get(window, "__存") as Record<string, unknown>);
}
const 格 = (page: import("playwright").Page, 名: string) => page.locator(".ant-form-item").filter({ has: page.locator(`label:text-is("${名}")`) });

it("给了在推项目：「关联项目」默认选第一个，交上去带它；没有「关联商机」", async () => {
  const { page, errors } = await open({ 项目: "有" });
  try {
    expect(await 格(page, "关联商机").count()).toBe(0);
    expect(await 格(page, "关联项目").locator(".ant-select-content").innerText()).toContain("年度框架采购项目");
    expect((await 存(page)).projectId).toBe("p1");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("有在推项目时「关联项目」必选：没有清除按钮", async () => {
  const { page } = await open({ 项目: "有" });
  try {
    const 项 = 格(page, "关联项目");
    expect(await 项.locator(".ant-select-content-has-value").count()).toBe(1);
    await 项.locator(".ant-select").hover();
    expect(await 项.locator(".ant-select-clear").count()).toBe(0);
    expect(await 项.locator(".ant-form-item-required").count()).toBe(1);
  } finally { await page.close(); }
});

it("没有在推的项目：这一格提示一句，交上去是 null", async () => {
  const { page, errors } = await open({ 项目: "空" });
  try {
    expect(await 格(page, "关联项目").innerText()).toContain("没挂项目，建议先建项目");
    expect((await 存(page)).projectId).toBeNull();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("编辑：不摆「关联项目」，交上去不带 projectId", async () => {
  const { page, errors } = await open({ 项目: "有", 编辑: true });
  try {
    expect(await 格(page, "关联项目").count()).toBe(0);
    expect(await 格(page, "关联商机").count()).toBe(0);
    await page.getByRole("button", { name: /保\s*存/ }).click();
    await page.waitForFunction(() => Reflect.get(window, "__存"));
    expect(await page.evaluate(() => Reflect.get(window, "__存") as Record<string, unknown>)).not.toHaveProperty("projectId");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("开关关闭（不给 projects）：还是「关联商机」，交上去不带 projectId", async () => {
  const { page, errors } = await open({ 项目: null });
  try {
    expect(await 格(page, "关联商机").count()).toBe(1);
    expect(await 格(page, "关联项目").count()).toBe(0);
    expect(await 存(page)).not.toHaveProperty("projectId");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：超长项目名不横向撑出，「保存」点得中", async (w) => {
  const { page } = await open({ 项目: "有" }, w);
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const 框 = (await page.getByRole("dialog").boundingBox())!;
    const 项 = (await 格(page, "关联项目").boundingBox())!;
    expect(项.x + 项.width).toBeLessThanOrEqual(框.x + 框.width);
    const btn = page.getByRole("button", { name: /保\s*存/ });
    const box = (await btn.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(w);
    const 点中 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box.x + box.width / 2, box.y + box.height / 2]);
    expect(点中).toBe(await btn.textContent());
  } finally { await page.close(); }
});
