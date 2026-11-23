/**
 * 手机首页「+ → 查重」的小框（11-22 实操：390 宽右边伸出视口约 26px，整页能横着滚）：
 * 375 / 390 宽打开查重，小框（.ant-popover）左右都在屏里、留出页边，整页不横滚；查出一条长结果也不出屏。
 * 电脑宽照旧挂在「+」旁边往上开（不挪）。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "dedupe-pop-phone", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)CardScanKey$/, "export default function C(){return null}");
  stub(/(^|\/)RescueKey$/, "export default function R(){return null}");
  stub(/(^|\/)DedupeClaimKey$/, "export default function K(){return null}");
  stub(/customers\/RepeatInquiryKey$/, "export default function R(){return null}");
  stub(/number-actions$/, "export const 查号码=async()=>({ok:true,状态:'已有',值:'13800001111',提示:'这个号码已经在一位客户名下了，看看是不是同一个人再决定要不要建',撞:{id:'c1',name:'很长很长的一位客户名字用来量会不会把小框撑出屏幕右边',school:'广东省深圳市',salesOwnerName:'某某某'},归属地:'广东 深圳'});");
  stub(/^next\/link$/, "export default function L({children,href,...p}){return <a href={href} {...p}>{children}</a>}");
  stub(/^@\/lib\/ask-image$/, "export const 图片后缀=[];export const 图片类型=[];export const 是图片文件=()=>false;export const 认图成文本=async()=>({text:''});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ComposerPlus from '@/app/(app)/dashboard/ComposerPlus';
    function 壳({拍照}){const [files,setFiles]=useState([]);
      return <div className="cli-input cli-input-rich"><div className="cli-bar2"><div className="cli-bar2-l">
        <ComposerPlus 宽={false} 拍照={拍照} 在跑={false} files={files} setFiles={setFiles} 摆背调键={false} on切背调={()=>{}} 渠道名们={['展会']} on出卡={()=>{}} on存照片={()=>{}}/>
      </div></div></div>;}
    window.__render=(拍照)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><壳 拍照={拍照}/></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开查重(width: number, 手机: boolean, 暗 = false) {
  const page = await browser.newPage({ viewport: { width, height: 760 }, isMobile: 手机, hasTouch: 手机 }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://pop.test/**", r => r.fulfill({ contentType: "text/html", body: `<html data-mode='${暗 ? "dark" : "light"}'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><div id='root' style='padding:16px'></div></html>` }));
  await page.goto("http://pop.test");
  for (const f of 暗 ? ["globals.css", "antd-dark.css", "dark.css"] : ["globals.css"]) await page.addStyleTag({ path: path.resolve("src/app", f) });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __render: (x: boolean) => void }).__render(x), 手机);
  await page.locator("button[aria-label='更多入口']").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item")].some(e => e.textContent?.includes("查重")));
  await page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item").filter({ hasText: "查重" }).click();
  await page.locator(".home-dedupe").waitFor();
  // 等弹出动画放完、位置落定
  await page.waitForFunction(() => { const p = document.querySelector(".home-dedupe")?.closest(".ant-popover"); return !!p && !/-appear|-enter/.test(p.className); });
  await page.waitForTimeout(150);
  return { page, errors };
}
const 框边 = (page: import("playwright").Page) => page.evaluate(() => {
  // 小框那块底（.home-dedupe 到 .ant-popover 之间带底色的那层，含内边距）；antd 6 的类名换过，不按类名找
  let 左 = Infinity, 右 = -Infinity;
  for (let e: Element | null = document.querySelector(".home-dedupe"); e && !e.classList.contains("ant-popover"); e = e.parentElement) {
    const r = e.getBoundingClientRect(); 左 = Math.min(左, r.left); 右 = Math.max(右, r.right);
  }
  return { 左: Math.round(左), 右: Math.round(右), 宽: window.innerWidth, 横滚: document.documentElement.scrollWidth > window.innerWidth };
});

it.each([[375, false], [390, false], [375, true], [390, true]] as const)("手机 %i 宽（暗 %s）：查重小框左右都在屏里、各留至少 8px，整页不横滚；查出长结果也不出屏", async (w, 暗) => {
  const { page, errors } = await 开查重(w, true, 暗);
  try {
    let b = await 框边(page);
    expect(b.左, JSON.stringify(b)).toBeGreaterThanOrEqual(8);
    expect(b.右, JSON.stringify(b)).toBeLessThanOrEqual(w - 8);
    expect(b.横滚).toBe(false);
    await page.getByRole("textbox", { name: "要查的号码" }).fill("13800001111");
    await page.getByRole("button", { name: "查" }).click();
    await page.locator(".home-dedupe .ant-alert").waitFor();
    await page.waitForTimeout(150);
    b = await 框边(page);
    expect(b.右, JSON.stringify(b)).toBeLessThanOrEqual(w - 8);
    expect(b.左, JSON.stringify(b)).toBeGreaterThanOrEqual(8);
    expect(b.横滚).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("电脑 1280 宽：小框照旧在「+」旁边（左边不离开「+」太远），不出屏", async () => {
  const { page, errors } = await 开查重(1280, false);
  try {
    const b = await 框边(page);
    const 加 = await page.locator("button[aria-label='更多入口']").evaluate(e => Math.round(e.getBoundingClientRect().left));
    expect(Math.abs(b.左 - 加), JSON.stringify({ b, 加 })).toBeLessThanOrEqual(48);
    expect(b.右).toBeLessThanOrEqual(1280);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// 11-23 小修批：溢出类全宽扫一遍（浅深两色）——电脑 / 平板宽小框照旧往上开、左右都在屏里，查出长结果也不出屏、整页不横滚
it.each([768, 1024, 1199, 1200, 1240, 1440, 1536].flatMap((w) => [[w, false], [w, true]] as const))("%i 宽（暗 %s）：查重小框不出屏、整页不横滚", async (w, 暗) => {
  const { page, errors } = await 开查重(w, false, 暗);
  try {
    for (const 查了 of [false, true]) {
      if (查了) {
        await page.getByRole("textbox", { name: "要查的号码" }).fill("13800001111");
        await page.getByRole("button", { name: "查" }).click();
        await page.locator(".home-dedupe .ant-alert").waitFor();
        await page.waitForTimeout(150);
      }
      const b = await 框边(page);
      expect(b.左, JSON.stringify(b)).toBeGreaterThanOrEqual(0);
      expect(b.右, JSON.stringify(b)).toBeLessThanOrEqual(w);
      expect(b.横滚).toBe(false);
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
