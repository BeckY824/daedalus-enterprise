import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* 11-04 用户：客户详情就地改的单选「没有初始值的选项，选了一个值无法回到 —，用户可能误触」。
   能清空的下拉（可清空）第一项放「—」，选它 = 存 null；必填的（不带可清空）不加。用真 InlineField */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "inline-dash", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^\.\.\/actions$/, "export const patchCustomer=async(...a)=>{(window.__存??=[]).push(a);return {ok:true};};");
  stub(/^\.\.\/useTransferConfirm$/, "export const useTransferConfirm=()=>async()=>true;");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>'/c';");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import InlineField from '@/app/(app)/customers/[id]/InlineField';
    const 选=[{value:'A',label:'A 级'},{value:'B',label:'B 级'}];
    createRoot(document.getElementById('root')).render(<App><div className='rec-page'><aside className='rec-rail rec-card' style={{width:260}}>
      <InlineField 空时横线 customerId='a' field='level' label='客户级别' kind='select' value='A' options={选} 可清空/>
      <InlineField 空时横线 customerId='a' field='customerType' label='客户类型' kind='select' value={null} options={选} 可清空/>
      <InlineField 空时横线 customerId='a' field='salesOwnerId' label='销售负责人' kind='select' value='A' options={选}/>
    </aside></div></App>);`, resolveDir: process.cwd(), loader: "jsx" },
    bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

it("可清空的下拉第一项「—」：选了存 null；本来空着选「—」不存；必填的不加「—」", async () => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
  try {
    await page.route("http://inline-dash.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
    await page.goto("http://inline-dash.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
    const 项 = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
    const 存 = () => page.evaluate(() => (window as unknown as { __存?: unknown[] }).__存 ?? []);
    const 收起 = () => page.waitForFunction(() => ![...document.querySelectorAll(".ant-select-dropdown")].some(e => (e as HTMLElement).offsetParent && !e.className.includes("hidden")));
    // 客户级别 A → 选「—」= 存 null
    await page.getByRole("button", { name: "编辑客户级别" }).click();
    await expect.poll(() => 项.allInnerTexts()).toEqual(["—", "A 级", "B 级"]);
    await 项.first().click();
    await expect.poll(存).toEqual([["a", "level", null]]);
    // 格子显示跟着 router.refresh 拿回的新值走（这里是桩），只核存的值
    await 收起();
    // 客户类型本来空着，选「—」不存
    await page.getByRole("button", { name: "编辑客户类型" }).click();
    await expect.poll(async () => (await 项.allInnerTexts())[0]).toBe("—");
    await 项.first().click();
    await page.waitForTimeout(200);
    expect(await 存()).toHaveLength(1);
    await 收起();
    // 必填的（没带可清空）不加「—」
    await page.getByRole("button", { name: "编辑销售负责人" }).click();
    await expect.poll(() => 项.allInnerTexts()).toEqual(["A 级", "B 级"]);
  } finally { await page.close(); }
});
