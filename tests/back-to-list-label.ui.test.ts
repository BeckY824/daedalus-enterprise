/**
 * 详情页页头「← 回到…列表」（BackToList）返回字和页名一致（#381 实操，PR #384 审查补组件级断言）：
 *   项目模式（企业版 + projectMode）线索页叫「新线索」，回去那一行写「回到新线索列表」；不开项目模式照旧「回到线索列表」。
 *   记过地址的（sessionStorage 里最近看的是线索第 2 页）带页码。lib/list-return 的 回列表文字 另有单测（tests/list-return.test.ts），这里钉组件传的叫法
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "back-to-list-label", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import BackToList from '@/components/BackToList';import {记地址} from '@/lib/list-return';
    if (window.__记) 记地址('线索', window.__记);
    createRoot(document.getElementById('root')).render(<>
      <div id="pm"><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><BackToList 默认="线索"/></BusinessProvider></div>
      <div id="plain"><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:false}}><BackToList 默认="线索"/></BusinessProvider></div>
    </>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 字(记?: string) {
  const page = await browser.newPage(); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://back.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://back.test/projects/p1");
  if (记) await page.evaluate((h) => { (window as unknown as { __记: string }).__记 = h; }, 记);
  await page.addScriptTag({ content: bundle });
  await page.locator("#plain [data-testid=back-to-list]").waitFor();
  const 读 = (sel: string) => page.locator(`${sel} [data-testid=back-to-list]`).evaluate((a) => ({ 字: a.textContent?.trim(), 读屏: a.getAttribute("aria-label"), 去: a.getAttribute("href") }));
  const r = { 项目模式: await 读("#pm"), 不开: await 读("#plain"), errors };
  await page.close();
  return r;
}

it("没记过地址：项目模式写「回到新线索列表」、不开写「回到线索列表」，都回 /leads；读屏念的同一句", async () => {
  const r = await 字();
  expect(r.项目模式).toEqual({ 字: "回到新线索列表", 读屏: "回到新线索列表", 去: "/leads" });
  expect(r.不开).toEqual({ 字: "回到线索列表", 读屏: "回到线索列表", 去: "/leads" });
  expect(r.errors).toEqual([]);
});

it("记过线索第 2 页：项目模式写「回到新线索列表（第 2 页）」、回原地址", async () => {
  const r = await 字("/leads?page=2");
  expect(r.项目模式).toEqual({ 字: "回到新线索列表（第 2 页）", 读屏: "回到新线索列表（第 2 页）", 去: "/leads?page=2" });
  expect(r.不开.字).toBe("回到线索列表（第 2 页）");
  expect(r.errors).toEqual([]);
});
