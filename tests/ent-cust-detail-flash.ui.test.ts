/**
 * PR8 新建弹窗落到客户页（?project=<新项目>）：那颗项目卡亮 2 秒（PR7b 做）。
 *   进页面时地址带的那个亮，别的不亮；2 秒后自己收；只有一个项目时那张卡也亮
 *   只动透明度（叠一层 ::after），减弱动态下也照样只是淡入淡出，不缩放不位移
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, 包: string;
const 桩: Plugin = { name: "flash", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){}});export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^next\/link$/, "export default function L({prefetch,scroll,replace,...p}){return <a {...p}/>}");
  stub(/projects\/\[id\]\/ProjectDetail$/, "export default function D(){return null}");
  stub(/projects\/\[id\]\/ProjectFold$/, "export const FoldSplit=()=>null,ProjectFold=({children})=>children,模块钮色={};");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  包 = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ProjectSwitch} from '@/app/(app)/customers/[id]/ProjectZone';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司年度框架采购项目'.repeat(3);
    window.__render=({个数,当前})=>{
      const 页签们=[{id:'p1',name:'项目一',节点:'报价',阶段:'商机'},{id:'p2',name:长,节点:'线索验证',阶段:'线索'}].slice(0,个数);
      root.render(<div style={{width:640}}><ProjectSwitch 数据={{customerId:'c1',页签们,锁数:0}} 当前id={当前}/></div>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(查: string, p: { 个数: number; 当前: string }, reducedMotion: "reduce" | "no-preference" = "no-preference") {
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 }, reducedMotion }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://flash.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto(`http://flash.test/customers/c1${查}`); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 包 });
  await page.evaluate(x => (window as unknown as { __render: (x: object) => void }).__render(x), p);
  await page.locator(".cd-pj").waitFor();
  return { page, errors };
}

it("?project=p2：那颗亮、别的不亮，2 秒后收", async () => {
  const { page, errors } = await 开("?project=p2", { 个数: 2, 当前: "p2" });
  try {
    expect(await page.locator(".cd-pj-flash").count()).toBe(1);
    expect(await page.locator('[role=tab][href*="p2"]').getAttribute("class")).toContain("cd-pj-flash");
    expect(await page.locator('[role=tab][href*="p1"]').getAttribute("class")).not.toContain("cd-pj-flash");
    // 光圈在 ::after 上、亮着时不透明
    await expect.poll(() => page.locator(".cd-pj-flash").evaluate((el) => getComputedStyle(el, "::after").opacity)).toBe("1");
    await page.waitForTimeout(2200);
    expect(await page.locator(".cd-pj-flash").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("只有一个项目：那张卡也亮；地址不带 project 不亮", async () => {
  const 一 = await 开("?project=p1", { 个数: 1, 当前: "p1" });
  try { expect(await 一.page.locator(".cd-pj-one.cd-pj-flash").count()).toBe(1); } finally { await 一.page.close(); }
  const 二 = await 开("", { 个数: 2, 当前: "p1" });
  try { expect(await 二.page.locator(".cd-pj-flash").count()).toBe(0); } finally { await 二.page.close(); }
});

it("减弱动态：只淡（过渡、动画都只碰透明度，不缩放不位移）", async () => {
  const { page, errors } = await 开("?project=p2", { 个数: 2, 当前: "p2" }, "reduce");
  try {
    const 样 = await page.locator(".cd-pj-flash").evaluate((el) => {
      const s = getComputedStyle(el, "::after");
      return { 过渡: s.transitionProperty, 变形: s.transform };
    });
    expect(样.过渡).toBe("opacity");
    expect(样.变形).toBe("none");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
