/**
 * 离职交接看板：「另有 …」那一行带上主渠道数（迁移 118，主渠道负责人和子渠道负责人同一处交），
 * 「全部交给」的确认框里也写；名下只有主渠道、没有客户的人也出一张卡。
 * 1024 / 1280 / 1366 三个宽度量：超长人名、几样都有时这一行自己折行，页面不横滚、按钮点得中
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const 长人 = "名字特别特别长的一位同事".repeat(4);
const plugin: Plugin = { name: "handover-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/settings\/actions$/, "export const deactivateUser=async()=>({ok:true});");
  // 等确认那一格的撤回、改接手人（11-13）
  stub(/customers\/handover-actions$/, "export const 撤回交接=async()=>({ok:true,客户:0}),改接手人=async()=>({ok:true,客户:0});");
  stub(/^\.\/actions$/, `const 记=(名)=>async(...x)=>{(window.__交=window.__交||[]).push([名,...x]);return{ok:true,message:'好了'}};
    export const 交接客户=记('交接客户'),交接项目=记('交接项目'),交接全部=记('交接全部');`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import HandoverView from '@/app/(app)/projects/handover/HandoverView';
    const 长人=${JSON.stringify(长人)};
    const 人们=[
      {id:'a',name:长人,上级:长人,交接中:false,客户:[{id:'c1',name:'某某超长公司名'.repeat(8),项目数:3}],项目:[],其余:{线索:128,渠道:36,主渠道:12,待办:45}},
      {id:'b',name:'只剩主渠道的人',上级:null,交接中:false,客户:[],项目:[],其余:{线索:0,渠道:0,主渠道:2,待办:0}},
    ];
    window.__go=()=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>
      <HandoverView 人们={人们} 候选={[{id:'t',name:长人},{id:'u',name:'接手人'}]} 项目模式 系统管理员 下属={[]}/></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

for (const width of [1024, 1280, 1366]) {
  it(`${width} 宽：主渠道数写在「另有」那行和确认框里，不横滚、按钮点得中`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.route("http://src.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
      await page.goto("http://src.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
      await page.evaluate(() => (window as unknown as Record<string, () => void>).__go());
      const 卡们 = page.locator(".ant-card");
      await expect.poll(() => 卡们.count()).toBe(2);
      await expect.poll(() => 卡们.nth(0).innerText()).toContain("另有 128 条线索、36 个渠道、12 个主渠道、45 条挂在别人");
      expect(await 卡们.nth(1).innerText()).toContain("另有 2 个主渠道，「全部交给」时一起走");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      // 「另有」那行、两个「全部交给」按钮都在卡里面，没被挤出去；按钮中心点得中自己
      const 量 = await page.evaluate(() => [...document.querySelectorAll(".ant-card")].map((卡) => {
        const k = 卡.getBoundingClientRect();
        const 钮 = [...卡.querySelectorAll("button")].find((x) => x.textContent?.replace(/\s/g, "") === "全部交给")!;
        const r = 钮.getBoundingClientRect();
        const 文 = [...卡.querySelectorAll(".ant-typography")].find((x) => x.textContent?.startsWith("另有"))!.getBoundingClientRect();
        return { 钮在内: r.left >= k.left && r.right <= k.right, 文在内: 文.left >= k.left && 文.right <= k.right + 0.5, 点中: 钮.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
      }));
      expect(量).toEqual([{ 钮在内: true, 文在内: true, 点中: true }, { 钮在内: true, 文在内: true, 点中: true }]);
      // 只剩主渠道的人：选接手人 → 全部交给 → 确认框写「2 个主渠道」→ 确定后调 交接全部
      const 乙 = 卡们.nth(1);
      await 乙.locator(".ant-select").first().click();
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: /^接手人$/ }).click();
      await 乙.getByRole("button", { name: /全部交给/ }).click();
      const 框 = page.locator(".ant-modal-confirm");
      await 框.waitFor();
      expect(await 框.innerText()).toContain("2 个主渠道");
      await 框.getByRole("button", { name: /确\s*定|全部交给|交/ }).last().click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __交?: unknown[][] }).__交 ?? [])).toEqual([["交接全部", "b", "u"]]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);
}
