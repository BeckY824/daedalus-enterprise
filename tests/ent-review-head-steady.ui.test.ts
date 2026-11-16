/**
 * 复盘页「页头不跳」（前端改版逐块确认 ov.layout）：切到「卡点」时，上方「我的 / 团队」+ 人员下拉不再消失（整页上跳一截），
 * 留在原地、变淡、点不了——卡点看谁按角色开关定，不跟人员选择（page.tsx 卡点分支注释）。
 * 回到「任务」照旧能点。Windows 1024 宽：人员那一行在卡点页签和任务页签高度一样，页签的顶不挪。
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
    const 选人={选项:[{value:'u2',label:'某某超长名字的华东区域销售管理'}],当前:'',我:'u1'};
    window.__画=(页签)=>createRoot(document.getElementById('root')).render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <DataShell view="现在" 项目 选人={选人} 页签={页签}><div>内容</div></DataShell>
    </BusinessProvider></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(页签: string, width = 1024): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 700 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/overview"); await page.addScriptTag({ content: bundle });
  await page.evaluate((t) => (window as unknown as { __画: (t: string) => void }).__画(t), 页签);
  await page.getByRole("tab", { name: "卡点" }).waitFor();
  return { page, errors };
}

it("卡点页签：人员选择还在原地，点不了", async () => {
  const { page, errors } = await 打开("block");
  expect(await page.getByRole("combobox", { name: "看谁的" }).isDisabled()).toBe(true);
  expect(await page.getByRole("radio", { name: "我的" }).isDisabled()).toBe(true);
  expect(await page.getByTitle("卡点按角色定能看谁，不跟这里的人员选择").count()).toBe(1);
  expect(errors).toEqual([]);
  await page.close();
});

it("任务页签：人员选择照旧能点", async () => {
  const { page, errors } = await 打开("todo");
  expect(await page.getByRole("combobox", { name: "看谁的" }).isDisabled()).toBe(false);
  expect(await page.getByRole("radio", { name: "我的" }).isDisabled()).toBe(false);
  expect(errors).toEqual([]);
  await page.close();
});

it("1024 / 1280 / 1366：卡点和任务页签的页签顶线一样高，不横向溢出", async () => {
  for (const w of [1024, 1280, 1366]) {
    const tops: number[] = [];
    for (const t of ["todo", "block"]) {
      const { page } = await 打开(t, w);
      tops.push(await page.getByRole("tab", { name: "卡点" }).evaluate((el) => Math.round(el.getBoundingClientRect().top)));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.close();
    }
    expect(tops[1], `${w} 宽`).toBe(tops[0]);
  }
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
