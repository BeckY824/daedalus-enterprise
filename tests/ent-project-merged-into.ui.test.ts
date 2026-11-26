import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* 合并客户第二批 2a · 项目详情顶上「已并入 → 留下的项目」（projects/[id]/MergedIntoLine.tsx）：真组件 + globals.css + merge.css，只桩掉 merge-actions。钉的是：
   被并掉的项目顶上一行写并进了哪个（点得过去）、谁、何时并的；有权（能撤）的带「撤回」→ 后果框 → 撤回项目合并单(单号) → 原处写撤回结果（全还原 / 留下几条没还原）；
   没权、过了 30 天（能撤 false）不摆按钮，过了 30 天（过期话）在按钮的位置写明「合并已超过 30 天，不能撤回」；没并入画空。1280 / 390 不横滚，一行省略、悬停看全（title），390 点一下展开，按钮 ≥ 44 */
let browser: Browser, bundle: string;
const 长名 = "超长的留下项目名称用来看会不会撑破".repeat(8);
const 动作 = `
  export const 撤回项目合并单=async(id)=>{(window.__调??=[]).push(['撤回',id]);return window.__撤回结果??{ok:true,没还原:[]}};`;
const plugin: Plugin = { name: "merged-into", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)merge-actions$/, 补全动作桩("src/app/(app)/customers/merge-actions.ts", 动作));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷新=(window.__刷新||0)+1},push(){},replace(){},prefetch(){}});");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import MergedIntoLine from '@/app/(app)/projects/[id]/MergedIntoLine';
    window.__render=(单,嵌入)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><div style={{padding:16}}>
      <MergedIntoLine 单={单} 项目名="重复的那条线索" 去={单?'/customers/c1?project='+单.到id:null} 嵌入={嵌入}/></div></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 单 = (改: object = {}) => ({ mergeId: "pm1", 到id: "pa", 到: 长名, at: "2026-11-20T06:05:00.000Z", 谁: "测试销售甲", 能撤: true, ...改 });

async function open(width: number, 单值: object | null, 设: Record<string, unknown> = {}, 嵌入 = false) {
  const page = await browser.newPage({ viewport: { width, height: width < 768 ? 844 : 900 } }); page.setDefaultTimeout(5000);
  const 错: string[] = [];
  page.on("pageerror", e => 错.push(String(e)));
  page.on("console", m => { if (m.type() === "error") 错.push(m.text()); });
  await page.route("http://into.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://into.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ path: path.resolve("src/app/(app)/customers/merge.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => Object.assign(window, x), 设);
  await page.evaluate(([u, e]) => (window as unknown as { __render: (u: unknown, e: boolean) => void }).__render(u, e), [单值, 嵌入] as const);
  return { page, 错 };
}
const 调 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? []);
const 横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

for (const 宽 of [1280, 390]) {
  it(`${宽}：有权 —— 一行写并进了哪个（点得过去）、谁、何时；省略、悬停看全；撤回 → 后果框 → 撤回项目合并单 → 原处写全部还原了`, async () => {
    const { page, 错 } = await open(宽, 单(), {}, 宽 < 768);
    try {
      const 行 = page.getByTestId("project-merged-into");
      await 行.waitFor();
      if (宽 < 768) expect(await page.locator(".cd-notice > .mrg-into").count()).toBe(1);
      const 字 = page.getByTestId("project-merged-into-text");
      const 全 = await 字.getAttribute("title");
      expect(全).toContain(`已并入 → 「${长名}」（测试销售甲 `);
      expect(全).toContain("并入）");
      expect(await page.getByTestId("project-merged-into-link").getAttribute("href")).toBe("/customers/c1?project=pa");
      // 一行：放不下省略号
      expect(await 字.evaluate((e) => [getComputedStyle(e).whiteSpace, getComputedStyle(e).textOverflow, e.scrollWidth > e.clientWidth])).toEqual(["nowrap", "ellipsis", true]);
      expect(await 横滚(page)).toBe(false);
      const 钮 = page.getByTestId("project-merged-undo");
      expect((await 钮.innerText()).replace(/\s/g, "")).toBe("撤回");
      if (宽 < 768) {
        expect((await 钮.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        // 手机没有悬停：点一下这句展开看全，再点收起
        await 字.click({ position: { x: 4, y: 4 } });
        expect(await 字.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe("normal");
        expect(await 横滚(page)).toBe(false);
        await 字.click({ position: { x: 4, y: 4 } });
        expect(await 字.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe("nowrap");
      }
      await 钮.click();
      const 框 = page.locator(".csq");
      await 框.waitFor();
      const 框话 = await 框.innerText();
      expect(框话).toContain(`撤回合并：把「重复的那条线索」从「${长名}」拆回来？`);
      expect(框话).toContain("结局、线索验证清回合并前");
      expect(框话).toContain("「重复的那条线索」的项目组照旧，合并时没动过组员");
      await 框.getByRole("button", { name: "撤回合并" }).click();
      await page.getByTestId("project-merged-into-done").waitFor();
      expect(await page.getByTestId("project-merged-into-done").innerText()).toContain("已撤回，全部还原了");
      expect(await 调(page)).toEqual([["撤回", "pm1"]]);
      expect(await page.evaluate(() => (window as unknown as { __刷新?: number }).__刷新)).toBe(1);
      expect(await 横滚(page)).toBe(false);
      await page.getByRole("button", { name: "知道了" }).click();
      expect(await page.getByTestId("project-merged-into-done").count()).toBe(0);
      expect(错).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);

  it(`${宽}：没权 / 过了 30 天（能撤 false）只写已并入、不摆撤回；没并入画空`, async () => {
    const { page, 错 } = await open(宽, 单({ 能撤: false, 谁: "" }));
    try {
      await page.getByTestId("project-merged-into").waitFor();
      expect(await page.getByTestId("project-merged-undo").count()).toBe(0);
      expect(await page.getByTestId("project-merged-into-text").getAttribute("title")).toMatch(/^已并入 → 「.+」（\d{4}-\d{2}-\d{2} \d{2}:\d{2} 并入）$/);
      expect(await 横滚(page)).toBe(false);
      expect(错).toEqual([]);
    } finally { await page.close(); }
    // 过了撤回期限（过期话，load.ts 带；谁看都一样，系统管理员也不能代撤）：按钮的位置写明为什么没有撤回，一行不横滚、那句不省略
    const 过 = await open(宽, 单({ 能撤: false, 过期话: "（任意文案，界面照标记出话）" }), {}, 宽 < 768);
    try {
      const 话 = 过.page.getByTestId("project-merged-expired");
      await 话.waitFor();
      expect(await 话.innerText()).toBe("（任意文案，界面照标记出话）");
      expect(await 话.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      expect(await 过.page.getByTestId("project-merged-undo").count()).toBe(0);
      expect(await 过.page.getByTestId("project-merged-into-text").getAttribute("title")).toMatch(/；（任意文案，界面照标记出话）$/);
      const [行框, 话框] = await Promise.all([过.page.getByTestId("project-merged-into").boundingBox(), 话.boundingBox()]);
      expect(话框!.x + 话框!.width).toBeLessThanOrEqual(行框!.x + 行框!.width);
      expect(await 横滚(过.page)).toBe(false);
      expect(过.错).toEqual([]);
    } finally { await 过.page.close(); }
    // 有权、没过期：不写这句
    const 能 = await open(宽, 单());
    try {
      await 能.page.getByTestId("project-merged-undo").waitFor();
      expect(await 能.page.getByTestId("project-merged-expired").count()).toBe(0);
    } finally { await 能.page.close(); }
    const 空 = await open(宽, null, {}, true);
    try {
      await 空.page.waitForTimeout(200);
      expect(await 空.page.locator(".mrg-into, .cd-notice").count()).toBe(0);
    } finally { await 空.page.close(); }
  }, 60_000);
}

it("撤回留下没还原的：原处列出几条、各是为什么（同第一批）；没撤成把原因写在后果框里、框不关", async () => {
  const { page, 错 } = await open(390, 单(), { __撤回结果: { ok: true, 没还原: [{ 类: "沟通", id: "f1", 原因: "合并之后被改过（换了项目或删了）" }] } });
  try {
    await page.getByTestId("project-merged-undo").click();
    await page.locator(".csq").getByRole("button", { name: "撤回合并" }).click();
    await page.getByTestId("merge-undo-left").waitFor();
    expect(await page.getByTestId("project-merged-into-done").innerText()).toContain("已撤回；留下 1 条没还原：");
    expect(await page.getByTestId("merge-undo-left").innerText()).toContain("沟通：合并之后被改过（换了项目或删了）");
    expect(错).toEqual([]);
  } finally { await page.close(); }
  const 拦 = await open(1280, 单(), { __撤回结果: { ok: false, error: "「留下的线索」现在不归你负责，请找系统管理员撤回" } });
  try {
    await 拦.page.getByTestId("project-merged-undo").click();
    const 框 = 拦.page.locator(".csq");
    await 框.getByRole("button", { name: "撤回合并" }).click();
    await 框.getByText("现在不归你负责，请找系统管理员撤回").waitFor();
    expect(await 拦.page.getByTestId("project-merged-into").count()).toBe(1);
    expect(await 拦.page.getByTestId("project-merged-into-done").count()).toBe(0);
  } finally { await 拦.page.close(); }
}, 60_000);
