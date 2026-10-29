/**
 * 企业版首页「今日待办」卡（P15 审后补，10-29 总控）：
 *   大数字只算今天到期，点了去 /overview?ownerId=我&f=today；
 *   逾期 > 0 时卡下面另起一行「另有 M 条逾期」，危险色，点了去 /overview?ownerId=我&f=overdue；逾期 = 0 不显示。
 *   这行不套在卡的链接里面（链接里不能再有链接），.home-card 照旧是四张。
 * 数字 = 落点列表条数在 tests/ent-home-cards.test.ts 里对拍（库里）。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-home-todo-card", setup(b) {
  b.onResolve({ filter: /^next\/link$/ }, a => ({ path: a.path, namespace: "stub", pluginData: "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import HomeCards from '@/app/(app)/dashboard/HomeCards';
    window.__画=(数)=>createRoot(document.getElementById('root')).render(<div style={{width:320}}><HomeCards 数={数} 我="u1"/></div>);
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

it("有逾期：卡下面一行「另有 M 条逾期」，危险色，去逾期；大卡去今天到期；卡还是四张", async () => {
  const { page, errors } = await 打开({ "month-new": 1, key: 2, "today-todo": 3, "month-won": 0, 逾期待办: 5 });
  await expect.poll(() => page.locator(".home-cards .home-card").count()).toBe(4);
  const 卡 = page.locator(".home-card", { hasText: "今日待办" });
  expect(await 卡.getAttribute("href")).toBe("/overview?ownerId=u1&f=today");
  const 行 = page.locator(".home-card-more");
  expect(await 行.innerText()).toBe("另有 5 条逾期");
  expect(await 行.getAttribute("href")).toBe("/overview?ownerId=u1&f=overdue");
  // 不在卡的链接里面
  expect(await page.locator(".home-card .home-card-more").count()).toBe(0);
  // 危险色：和 --danger-text 一样
  const [色, 危险] = await 行.evaluate((el) => {
    const t = document.createElement("span"); t.style.color = "var(--danger-text)"; document.body.append(t);
    return [getComputedStyle(el).color, getComputedStyle(t).color];
  });
  expect(色).toBe(危险);
  // 紧贴在今日待办卡下面
  const a = (await 卡.boundingBox())!, b = (await 行.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  expect(b.y - (a.y + a.height)).toBeLessThan(12);
  expect(errors).toEqual([]);
  await page.close();
});

it("逾期 = 0：不显示那一行", async () => {
  const { page, errors } = await 打开({ "month-new": 1, key: 2, "today-todo": 3, "month-won": 0, 逾期待办: 0 });
  await expect.poll(() => page.locator(".home-cards .home-card").count()).toBe(4);
  expect(await page.locator(".home-card-more").count()).toBe(0);
  expect(await page.locator(".home-card-stack").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});
