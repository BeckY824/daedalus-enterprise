/**
 * 设计语言 HC-4（11-22，首页对话列表；依据 现在-首页对话-20261122.md HC-05 / HC-06，落地计划 HC-4 节；用户选 C4-B）：
 *   C4-B 选中行：行照现在内缩圆角（和左栏导航同一种行），当前对话只用 --brand-bg 浅蓝底，不加左竖条；悬停出 ⋯；组名 muted
 *   C13-A 390 抽屉：82% 宽，顶上「新建对话」，行 44 高，⋯ 触屏常显、点击区 44；点一条换过去并关抽屉；切换视角时抽屉里同样是空的
 *   电脑上中栏太窄时那只抽屉照旧 280
 *
 * 外面只摆一个 flex 外壳 + ConversationList 真组件（对话动作文件换桩，路由换桩）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ent-hc4", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__去=u},prefetch(){}});export const usePathname=()=>'/dashboard';export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^next\/link$/, "export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/\/threads$/, 补全动作桩("src/app/(app)/dashboard/threads.ts", ""));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ConversationList from '@/app/(app)/dashboard/ConversationList';
    import {切换视图Provider} from '@/components/ViewAsContext';
    import {设抽屉} from '@/lib/roster';
    const 时 = (天前, 时) => { const d = new Date(); d.setDate(d.getDate() - 天前); d.setHours(时, 12, 0, 0); return d.toISOString(); };
    const 长 = '某某超长贸易进出口有限公司上海分公司'.repeat(3);
    const 行们 = [
      { id: 'c1', title: '今天该跟谁', lastAskedAt: 时(0, 14), 条数: 4 },
      { id: 'c2', title: '今天该跟谁', lastAskedAt: 时(0, 9), 条数: 2 },
      { id: 'c3', title: '这个月各渠道新增多少', lastAskedAt: 时(1, 20), 条数: 6 },
      { id: 'c4', title: '帮我记一条：' + 长, lastAskedAt: 时(5, 10), 条数: 1 },
    ];
    window.__开抽屉 = () => 设抽屉('chat', true);
    window.__画 = (el, 在看) => createRoot(el).render(<ConfigProvider locale={zhCN}><App component={false}><切换视图Provider value={在看}><ConversationList rows={在看 ? [] : 行们} /></切换视图Provider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, plugins: [plugin], logLevel: "silent" });
  bundle = "window.process = { env: {} };\n" + r.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 开参 = { 宽: number; 在看?: boolean; 触屏?: boolean };
async function 开(o: 开参): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: o.宽, height: 844 }, reducedMotion: "reduce", timezoneId: "Asia/Shanghai", hasTouch: !!o.触屏 });
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://hc4.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><body style='margin:0'><div class='shell' style='display:flex;min-height:100vh'><nav style='width:220px;flex:none'></nav><div id='root' style='display:contents'></div><main class='main'></main></div></body></html>` }));
  await page.goto("http://hc4.test/dashboard?c=c2");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((在看) => (window as unknown as { __画: (el: Element, v: boolean) => void }).__画(document.getElementById("root")!, 在看), !!o.在看);
  await page.waitForTimeout(80);
  if (errors.length) throw new Error(errors.join("\n"));
  return { page, errors };
}
const 盒 = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height }; });
const 样 = (page: Page, sel: string, 属: string) => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), 属);
/** 把一个 token 解析成真颜色（rgb(...)），好和 getComputedStyle 对 */
const 色 = (page: Page, token: string) => page.evaluate((t) => { const d = document.createElement("div"); d.style.background = `var(${t})`; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; }, token);
const 不横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

it("C4-B（1366 中栏）：当前对话只浅蓝底、不加竖条，行内缩圆角 8；悬停别的行灰底、⋯ 悬停才出；组名 muted", async () => {
  const { page, errors } = await 开({ 宽: 1366 });
  try {
    await page.locator(".pane-chat .chat-row.on").waitFor();
    expect(await page.locator(".chat-row.on").count()).toBe(1);
    const 选 = ".pane-chat .chat-row.on";
    expect(await 样(page, 选, "background-color")).toBe(await 色(page, "--brand-bg"));
    // 不加竖条：没有内阴影、没有左边框
    expect(await 样(page, 选, "box-shadow")).toBe("none");
    expect(await 样(page, 选, "border-left-width")).toBe("0px");
    expect(await 样(page, 选, "border-top-left-radius")).toBe("8px");
    // 内缩：行左右都离中栏边 ≥ 8
    const 栏 = await 盒(page, ".pane-chat"), 行 = await 盒(page, 选);
    expect(行.l - 栏.l).toBeGreaterThanOrEqual(8);
    expect(栏.r - 行.r).toBeGreaterThanOrEqual(8);
    // 指上去还是浅蓝底
    await page.locator(选).hover();
    expect(await 样(page, 选, "background-color")).toBe(await 色(page, "--brand-bg"));
    // 别的行：平时没底色、⋯ 不显，悬停灰底 + ⋯ 出来
    const 别 = page.locator(".pane-chat .chat-row:not(.on)").nth(1);
    await page.mouse.move(1300, 800);
    expect(await 别.locator(".chat-row-m").evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
    await 别.hover();
    await expect.poll(() => 别.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await 色(page, "--hover"));
    await expect.poll(() => 别.locator(".chat-row-m").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    // 组名 muted
    expect(await 样(page, ".chat-g-h", "color")).toBe(await page.evaluate(() => { const d = document.createElement("div"); d.style.color = "var(--text-muted)"; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }));
    // 同名带时间（HC-1）照旧
    expect(await page.locator(".pane-chat .chat-row-tm").count()).toBe(2);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("C13-A（390）：左抽屉 82% 宽，顶上「新建对话」，行 44 高，⋯ 常显、44 见方；超长标题省略不撑宽；点一条换过去并关抽屉", async () => {
  const { page, errors } = await 开({ 宽: 390, 触屏: true });
  try {
    expect(await page.locator(".pane-drawer-chat").count()).toBe(0);
    await page.evaluate(() => (window as unknown as { __开抽屉: () => void }).__开抽屉());
    await page.locator(".pane-drawer-phone .chat-new").waitFor();
    const 抽 = await 盒(page, ".pane-drawer-phone .ant-drawer-content-wrapper");
    expect(Math.abs(抽.w - 390 * 0.82)).toBeLessThanOrEqual(1);
    expect(Math.abs(抽.l)).toBeLessThanOrEqual(1);
    // 「新建对话」在最上面（组名和行之前），整颗 44 高
    const 新 = await 盒(page, ".pane-drawer-phone .chat-new"), 首行 = await 盒(page, ".pane-drawer-phone .chat-row");
    expect(新.b).toBeLessThanOrEqual(首行.t);
    expect(新.h).toBeGreaterThanOrEqual(44);
    // 每行 44 高、⋯ 常显 44 见方、都在抽屉里
    const 行们 = await page.locator(".pane-drawer-phone .chat-row").evaluateAll((es) => es.map((e) => {
      const r = e.getBoundingClientRect(), m = e.querySelector(".chat-row-m");
      const mr = m?.getBoundingClientRect();
      return { h: r.height, l: r.left, r: r.right, m: mr ? { w: mr.width, h: mr.height, r: mr.right, op: getComputedStyle(m!).opacity } : null };
    }));
    expect(行们.length).toBe(4);
    for (const x of 行们) {
      expect(x.h, JSON.stringify(x)).toBeGreaterThanOrEqual(44);
      expect(x.l).toBeGreaterThanOrEqual(抽.l);
      expect(x.r).toBeLessThanOrEqual(抽.r + 0.5);
      expect(x.m!.w).toBeGreaterThanOrEqual(44);
      expect(x.m!.h).toBeGreaterThanOrEqual(44);
      expect(x.m!.op).toBe("1");
      expect(x.m!.r).toBeLessThanOrEqual(抽.r + 0.5);
    }
    // 当前那条浅蓝底、不加竖条
    expect(await 样(page, ".pane-drawer-phone .chat-row.on", "background-color")).toBe(await 色(page, "--brand-bg"));
    expect(await 样(page, ".pane-drawer-phone .chat-row.on", "box-shadow")).toBe("none");
    // 超长标题一行省略
    const 长行 = page.locator(".pane-drawer-phone .chat-row-b").last();
    expect(await 长行.evaluate((e) => e.scrollWidth > e.clientWidth && getComputedStyle(e).textOverflow === "ellipsis")).toBe(true);
    expect(await 不横滚(page)).toBe(true);
    // ⋯：重命名 / 删掉
    await page.locator(".pane-drawer-phone .chat-row-m").first().click();
    await page.getByRole("menuitem", { name: "重命名" }).waitFor();
    expect(await page.getByRole("menuitem", { name: "删掉" }).count()).toBe(1);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    // 点一条：换过去、抽屉关上
    await page.locator(".pane-drawer-phone .chat-row-b").nth(2).click();
    expect(await page.evaluate(() => (window as unknown as { __去: string }).__去)).toBe("/dashboard?c=c3");
    await expect.poll(() => page.locator(".pane-drawer-phone .ant-drawer-content-wrapper").isVisible()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("390 切换视角：抽屉里同样是空的，只写一句为什么", async () => {
  const { page, errors } = await 开({ 宽: 390, 在看: true, 触屏: true });
  try {
    await page.evaluate(() => (window as unknown as { __开抽屉: () => void }).__开抽屉());
    await page.locator(".pane-drawer-phone .pane-empty").waitFor();
    expect(await page.locator(".pane-drawer-phone .pane-empty").textContent()).toBe("视角查看时不显示对方的 AI 对话");
    expect(await page.locator(".pane-drawer-phone .chat-row").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("1024（中栏太窄成抽屉）：电脑上那只抽屉照旧 280、行照旧 30 档，不套手机样子", async () => {
  const { page, errors } = await 开({ 宽: 1024 });
  try {
    await page.evaluate(() => (window as unknown as { __开抽屉: () => void }).__开抽屉());
    await page.locator(".pane-drawer-chat .chat-row").first().waitFor();
    expect(await page.locator(".pane-drawer-phone").count()).toBe(0);
    expect(Math.round((await 盒(page, ".pane-drawer-chat .ant-drawer-content-wrapper")).w)).toBe(280);
    expect((await 盒(page, ".pane-drawer-chat .chat-row")).h).toBeLessThan(40);
    expect(await 样(page, ".pane-drawer-chat .chat-row.on", "background-color")).toBe(await 色(page, "--brand-bg"));
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
