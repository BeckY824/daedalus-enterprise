/**
 * 企业版沟通方式下拉（10-31，components/FollowMethodSelect）：字典有方式就列方式，选了存 method、type 跟着推；
 * 新记默认手机通话；字典取不到（别的版本）还是原来的类型下拉。
 */
import { beforeAll, afterAll, it, expect } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "actions", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>window.__方式们;");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  stub(/projects\/actions$/, "export const 项目沟通须知=async()=>({ok:true,能记:false}),记项目沟通Action=async()=>({ok:true});");
  stub(/^\.\/actions$/, "export const saveFollowUp=async x=>{window.__calls.push(x);return {ok:true,id:'f1'}}; export const completePlan=async()=>({ok:true});export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'n1'});");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no'});");
  stub(/^\.\/CustomerPick$/, "export default function C(){return null}");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {App} from 'antd'; import C from '@/app/(app)/customers/[id]/FollowUpForm'; createRoot(document.getElementById('root')).render(<App><C open={true} onClose={()=>{}} onSaved={()=>{}} customerId="c1" aiEnabled={false}/></App>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 开 = async (方式们: string[] | null) => {
  const page = await browser.newPage(); page.setDefaultTimeout(5000);
  await page.route("http://follow-method.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://follow-method.test");
  await page.addScriptTag({ content: `window.__calls=[];window.__方式们=${JSON.stringify(方式们)};` });
  await page.addScriptTag({ content: bundle });
  return page;
};
const 填时间和内容 = async (page: import("playwright").Page, 内容: string) => {
  await page.locator("#occurredAt").fill("2026-10-20 10:00"); await page.locator("#occurredAt").press("Enter");
  await page.locator("#content").fill(内容);
};
const 存的 = (page: import("playwright").Page) => page.evaluate(() => (window as unknown as { __calls: Record<string, unknown>[] }).__calls);

it("字典有方式：默认手机通话，选 Telegram 存 method、type 记 OTHER", async () => {
  const page = await 开(["手机通话", "微信沟通", "Telegram"]);
  const 下拉 = page.getByRole("combobox", { name: "沟通方式" });
  await expect.poll(() => page.locator(".ant-form-item").filter({ hasText: "沟通方式" }).locator(".ant-select-content").innerText()).toBe("手机通话");
  await 下拉.click(); await page.getByTitle("Telegram", { exact: true }).click();
  await 填时间和内容(page, "在 Telegram 上聊了报价");
  await page.getByRole("button", { name: /保\s*存/ }).click();
  await expect.poll(async () => (await 存的(page)).length).toBe(1);
  expect((await 存的(page))[0]).toMatchObject({ type: "OTHER", method: "Telegram" });
  await page.close();
});

it("字典取不到：还是类型下拉，不带方式", async () => {
  const page = await 开(null);
  await page.getByRole("combobox", { name: "沟通方式" }).click();
  await page.getByTitle("邮件", { exact: false }).first().click();
  await 填时间和内容(page, "发了报价邮件");
  await page.getByRole("button", { name: /保\s*存/ }).click();
  await expect.poll(async () => (await 存的(page)).length).toBe(1);
  expect((await 存的(page))[0]).toMatchObject({ type: "EMAIL" });
  expect((await 存的(page))[0].method ?? null).toBeNull();
  await page.close();
});
