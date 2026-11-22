/**
 * 复盘页「页头不跳」（前端改版逐块确认 ov.layout）。
 * 设计语言 R-A（11-22）起，现状主题把「我的 / 团队」+ 人员下拉并进页签那一行的右端（四个页签共用）；
 * 卡点页签不跟人员选择（page.tsx 卡点分支注释），右端空着——行高跟页签走，切页签时页签的顶不挪。
 * 390：右端收成「看谁 ▾」，点开底部面板。换皮主题照旧：人员行在页签上面，卡点页签留在原地变淡、点不了。
 * Windows 1024 / 1280 / 1366：页签顶不挪、不横向溢出。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-review-head-steady", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){},prefetch(u){(window.__预取||(window.__预取=[])).push(u)}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import DataShell from '@/app/(app)/overview/DataShell';
    import {BusinessProvider} from '@/lib/business-client';
    import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 选项=[{value:'u2',label:'某某超长名字的华东区域销售管理'},{value:'u3',label:'Alexandria-Konstantinopoulou-华东华南两大区域渠道拓展专员'}];
    window.__画=(页签,当前='')=>createRoot(document.getElementById('root')).render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <DataShell view="现在" 项目 选人={{选项,当前,我:'u1'}} 页签={页签}><div>内容</div></DataShell>
    </BusinessProvider></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(页签: string, width = 1024, skin?: string, 当前 = ""): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 700 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/overview");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  if (skin) await page.evaluate((k) => { document.documentElement.dataset.skin = k; }, skin);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([t, d]) => (window as unknown as { __画: (t: string, d: string) => void }).__画(t, d), [页签, 当前] as const);
  await page.getByRole("tab", { name: "卡点" }).waitFor();
  return { page, errors };
}

it("现状主题 · 卡点页签：页签行右端不出人员选择（卡点按角色定能看谁）", async () => {
  const { page, errors } = await 打开("block");
  expect(await page.getByRole("combobox", { name: "看谁的" }).count()).toBe(0);
  expect(await page.getByRole("radio", { name: "我的" }).count()).toBe(0);
  expect(await page.locator(".data-shell-bar-who.is-na").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

it("现状主题 · 任务页签：人员选择在页签同一行右端，能点", async () => {
  const { page, errors } = await 打开("todo", 1280);
  const 下拉 = page.getByRole("combobox", { name: "看谁的" });
  expect(await 下拉.isDisabled()).toBe(false);
  expect(await page.getByRole("radio", { name: "我的" }).isDisabled()).toBe(false);
  const 签 = (await page.getByRole("tab", { name: "卡点" }).boundingBox())!;
  const 人 = (await page.locator(".data-shell-who-inline").boundingBox())!;
  // 同一行：人员控件的竖向中线落在页签那一格里，在页签右边
  expect(人.y + 人.height / 2).toBeGreaterThan(签.y);
  expect(人.y + 人.height / 2).toBeLessThan(签.y + 签.height);
  expect(人.x).toBeGreaterThan(签.x + 签.width);
  expect(errors).toEqual([]);
  await page.close();
});

it("1024 / 1280 / 1366：四个页签的页签顶线一样高，不横向溢出", async () => {
  for (const w of [1024, 1280, 1366]) {
    const tops: number[] = [];
    for (const t of ["todo", "block", "talk", "data"]) {
      const { page } = await 打开(t, w);
      tops.push(await page.getByRole("tab", { name: "卡点" }).evaluate((el) => Math.round(el.getBoundingClientRect().top)));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.close();
    }
    expect(new Set(tops).size, `${w} 宽 ${tops.join(",")}`).toBe(1);
  }
});

it("390：右端收成「看谁」钮，点开底部面板里有我的 / 团队和人员下拉；切卡点页签顶不挪", async () => {
  const { page, errors } = await 打开("todo", 390);
  expect(await page.locator(".data-shell-who-inline").isVisible()).toBe(false);
  const 钮 = page.locator(".data-shell-who-btn");
  expect(await 钮.isVisible()).toBe(true);
  const b = (await 钮.boundingBox())!;
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const 顶1 = await page.getByRole("tab", { name: "卡点" }).evaluate((el) => Math.round(el.getBoundingClientRect().top));
  await 钮.click();
  await page.locator(".data-shell-who-sheet").getByRole("combobox", { name: "看谁的" }).waitFor();
  expect(await page.locator(".data-shell-who-sheet").getByRole("radio", { name: "我的" }).count()).toBe(1);
  expect(errors).toEqual([]);
  await page.close();
  const 卡点 = await 打开("block", 390);
  const 顶2 = await 卡点.page.getByRole("tab", { name: "卡点" }).evaluate((el) => Math.round(el.getBoundingClientRect().top));
  expect(顶2).toBe(顶1);
  await 卡点.page.close();
});

it("390：选了长名字的人，四个页签都还在（「数据」没折进「⋯」）、「看谁」钮压在约 30vw；面板里选了人就收起", async () => {
  const { page, errors } = await 打开("todo", 390, undefined, "u3");
  const 钮 = page.locator(".data-shell-who-btn");
  expect(await 钮.innerText()).toContain("Alexandria");
  expect((await 钮.boundingBox())!.width).toBeLessThanOrEqual(390 * 0.3 + 1);
  expect(await page.locator(".data-shell-tabs .ant-tabs-nav-more").evaluate((e) => getComputedStyle(e).visibility !== "hidden" && (e as HTMLElement).offsetWidth > 0).catch(() => false)).toBe(false);
  for (const 名 of ["任务", "卡点", "沟通", "数据"]) {
    const t = (await page.getByRole("tab", { name: 名 }).boundingBox())!;
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width).toBeLessThanOrEqual((await 钮.boundingBox())!.x + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // 面板里选人：选了就收起
  await 钮.click();
  const 面板 = page.locator(".data-shell-who-sheet");
  const 开着 = () => 面板.first().isVisible().catch(() => false);
  await expect.poll(开着).toBe(true);
  await 面板.getByRole("combobox", { name: "看谁的" }).click();
  await page.locator(".ant-select-item-option").filter({ hasText: "某某超长名字" }).click();
  await expect.poll(开着).toBe(false);
  // 我的 / 团队 也一样
  await 钮.click();
  await expect.poll(开着).toBe(true);
  await 面板.getByText("团队", { exact: true }).waitFor();
  await 面板.getByText("团队", { exact: true }).click();
  await expect.poll(开着).toBe(false);
  expect(errors).toEqual([]);
  await page.close();
});

it("换皮主题（账簿）：照旧——人员行在页签上面，卡点页签留在原地变淡、点不了", async () => {
  const { page, errors } = await 打开("block", 1024, "ledger");
  expect(await page.getByRole("combobox", { name: "看谁的" }).isDisabled()).toBe(true);
  expect(await page.getByRole("radio", { name: "我的" }).isDisabled()).toBe(true);
  expect(await page.getByTitle("卡点按角色定能看谁，不跟这里的人员选择").count()).toBe(1);
  const 人 = (await page.locator(".data-shell-bar-who").boundingBox())!;
  const 签 = (await page.getByRole("tab", { name: "卡点" }).boundingBox())!;
  expect(人.y + 人.height).toBeLessThanOrEqual(签.y);
  expect(errors).toEqual([]);
  await page.close();
});

it("g.tabswitch：鼠标停在页签上就预取那一页；同一个页签只预取一次", async () => {
  const { page, errors } = await 打开("todo");
  await page.getByRole("tab", { name: "沟通" }).hover();
  await page.getByRole("tab", { name: "数据" }).hover();
  await page.getByRole("tab", { name: "沟通" }).hover();
  const 预取 = await page.evaluate(() => (window as unknown as { __预取?: string[] }).__预取 ?? []);
  expect(预取.length).toBe(2);
  expect(预取[0]).toMatch(/^\/overview\?.*tab=/);
  expect(new Set(预取).size).toBe(2);
  expect(errors).toEqual([]);
  await page.close();
});
