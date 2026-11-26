/**
 * 壳上的数晚到（11-26 客户页提速第三段，components/LateCount.tsx）：(app)/layout 不再等 数角标 / 客户总数 才吐壳，
 * 把 Promise 传给 AppShell，壳先出、数到了再填。这里钉：
 *   - 数没到：壳照常画（导航项、手机顶栏日历都在），只是没有红数；到了只多出那个数，导航项文字、日历钮都不挪位置
 *   - 到了以后 aria-label 跟上（读屏、e2e 认它）
 *   - router.refresh() 那种 transition 里换一个新的、还没到的 Promise：旧数留着、不闪回占位；新数到了再换
 *   - 左栏客户灰数（非企业版）同样晚到
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "shell-late-counts", setup(b) {
  b.onResolve({ filter: /^next\/(navigation|link)$/ }, a => ({ path: a.path, namespace: "fixture" }));
  b.onResolve({ filter: /(^|\/)(UpdateRow|WhatsNew|AiTasks|AiDock|FeedbackButton|AiCost|RailResizer|RecordView|ProjectDetail|NoticeBell)$/ }, a => ({ path: a.path, namespace: "empty-child" }));
  b.onLoad({ filter: /.*/, namespace: "empty-child" }, () => ({ contents: "export default function Empty(){return null} export function AiMeterBar(){return null}" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ resolveDir: process.cwd(), contents: a.path === "next/link"
    ? `import React from 'react';export default function Link({href,onClick,prefetch,children,...p}){return React.createElement('a',{...p,href,onClick:e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.__route=href}}},children)}`
    : `export const useRouter=()=>({push:p=>window.__route=p,refresh:()=>{}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);` }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `import React,{startTransition} from 'react';import {createRoot} from 'react-dom/client';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import Shell from '@/components/AppShell';
    const root=createRoot(document.getElementById('root'));window.desktopNav={onGo:()=>()=>{},setCustomerLabel:async()=>true};
    // 每画一次换一对新的、还没到的 Promise；__给要跟 / __给客户数 让它们到
    const 新=()=>{window.__要跟=new Promise(r=>{window.__给要跟=r});window.__客户数=new Promise(r=>{window.__给客户数=r})};
    const 画=()=>root.render(<BusinessProvider value={DEFAULT_BUSINESS}><Shell user={{id:'qa',name:'QA',email:'qa@example.test',role:'ADMIN',title:'管理员'}} workspace={{name:'QA工作区'}} desktop={false} 反馈去向="github" pane={null} ai={null} 要跟={window.__要跟} 计数={{'/customers':window.__客户数}}><div>页面</div></Shell></BusinessProvider>);
    新();画();
    // 和 router.refresh() 一样在 transition 里重画 layout：新 Promise 还没到
    window.__刷新=()=>{新();startTransition(()=>画())};`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 850 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://shell.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://shell.test/dashboard");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: "QA，账号菜单" }).first().waitFor();
  return { page, errors };
}
const 给 = (page: Page, k: "__给要跟" | "__给客户数", v: unknown) => page.evaluate(([k, v]) => (window as unknown as Record<string, (x: unknown) => void>)[k](v), [k, v] as const);

it("电脑宽：数没到壳照常出、没有红数；到了只多出红数和灰数，导航项文字不挪；refresh 换新 Promise 旧数留着", async () => {
  const { page, errors } = await open(1280);
  try {
    const 跟进 = page.locator("a.rail-item", { hasText: "跟进" });
    const 客户 = page.locator("a.rail-item", { hasText: "客户" }).first();
    expect(await 跟进.getAttribute("aria-label")).toBe("跟进");
    expect(await page.locator(".rail-count").count()).toBe(0);
    expect(await page.locator(".rail-num").count()).toBe(0);
    const 前 = { 跟进: await 跟进.locator("b").boundingBox(), 客户: await 客户.locator("b").boundingBox(), 行: await 跟进.boundingBox() };

    await 给(page, "__给要跟", { 逾期: 1, 今天: 2 });
    await 给(page, "__给客户数", 42);
    await expect.poll(() => page.locator(".rail-count").innerText()).toBe("3");
    await expect.poll(() => 跟进.getAttribute("aria-label")).toBe("跟进，要跟 3 条（逾期 1）");
    expect(await 客户.locator(".rail-num").innerText()).toBe("42");
    expect({ 跟进: await 跟进.locator("b").boundingBox(), 客户: await 客户.locator("b").boundingBox(), 行: await 跟进.boundingBox() }).toEqual(前);

    // refresh：新 Promise 还没到，旧数照旧摆着（不闪回占位）
    await page.evaluate(() => (window as unknown as { __刷新: () => void }).__刷新());
    await page.waitForTimeout(200);
    expect(await page.locator(".rail-count").innerText()).toBe("3");
    expect(await 跟进.getAttribute("aria-label")).toBe("跟进，要跟 3 条（逾期 1）");
    expect(await 客户.locator(".rail-num").innerText()).toBe("42");
    await 给(page, "__给要跟", { 逾期: 0, 今天: 5 });
    await 给(page, "__给客户数", 43);
    await expect.poll(() => page.locator(".rail-count").innerText()).toBe("5");
    await expect.poll(() => 跟进.getAttribute("aria-label")).toBe("跟进，要跟 5 条");
    expect(await 客户.locator(".rail-num").innerText()).toBe("43");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("手机宽：顶栏日历先出、不带数；到了挂上红数、aria-label 跟上，钮不挪位置", async () => {
  const { page, errors } = await open(390);
  try {
    const 日历 = page.getByRole("button", { name: /^跟进计划/ });
    expect(await 日历.getAttribute("aria-label")).toBe("跟进计划");
    const 前 = await 日历.boundingBox();
    await 给(page, "__给要跟", { 逾期: 1, 今天: 2 });
    await expect.poll(() => 日历.getAttribute("aria-label")).toBe("跟进计划，要跟 3 条（逾期 1）");
    expect(await page.locator(".ant-badge", { has: 日历 }).locator(".ant-badge-count").count()).toBe(1);
    expect(await 日历.boundingBox()).toEqual(前);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
