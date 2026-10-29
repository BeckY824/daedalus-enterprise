/**
 * 企业版首页四张指标卡（10-29 定稿：本月新增、重点项目、暂未跟进、即将逾期）：
 *   竖排四张，每张点进项目页对应的筛选 /projects?f=…；今日待办不再是卡（数在 数提醒，见 tests/ent-home-cards.test.ts）；
 *   暂未跟进、即将逾期有数时标危险色，0 是灰数。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-home-cards", setup(b) {
  b.onResolve({ filter: /^next\/link$/ }, a => ({ path: a.path, namespace: "stub", pluginData: "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import HomeCards from '@/app/(app)/dashboard/HomeCards';
    window.__画=(数)=>createRoot(document.getElementById('root')).render(<div style={{width:320}}><HomeCards 数={数}/></div>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(数: Record<string, number>): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1024, height: 800 }, reducedMotion: "reduce" }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/dashboard");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (o: unknown) => void }).__画(x), 数);
  await page.locator(".home-cards").waitFor();
  return { page, errors };
}

it("四张卡、顺序、链接；不再有今日待办和「另有 M 条逾期」", async () => {
  const { page, errors } = await 打开({ "month-new": 1, key: 2, "no-follow": 3, "due-soon": 4 });
  const 卡 = page.locator(".home-cards .home-card");
  await expect.poll(() => 卡.count()).toBe(4);
  expect(await 卡.locator(".home-card-k").allInnerTexts()).toEqual(["本月新增", "重点项目", "暂未跟进", "即将逾期"]);
  expect(await 卡.evaluateAll((els) => els.map((e) => e.getAttribute("href")))).toEqual(["/projects?f=month-new", "/projects?f=key", "/projects?f=no-follow", "/projects?f=due-soon"]);
  expect(await page.locator(".home-card-more").count()).toBe(0);
  expect(await page.getByText("今日待办").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

it("暂未跟进、即将逾期有数才标危险色；0 不着色", async () => {
  const { page, errors } = await 打开({ "month-new": 1, key: 2, "no-follow": 3, "due-soon": 0 });
  await expect.poll(() => page.locator(".home-cards .home-card").count()).toBe(4);
  expect(await page.locator(".home-card-warn").count()).toBe(1);
  expect(await page.locator(".home-card-warn .home-card-k").innerText()).toBe("暂未跟进");
  expect(await page.locator(".home-card-good").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});
