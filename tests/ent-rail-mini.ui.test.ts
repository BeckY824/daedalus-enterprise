/**
 * 客户详情上左栏收成图标窄栏（11-12 客户详情第 1 批，AppShell 的 rail-mini，路由判断在 lib/rail-mini.ts）：
 *   /customers/<id> 收成 56 宽、只留图标，悬停 / 键盘聚焦在右边冒出名字，每项有 aria-label；
 *   列表 /customers、/customers/recent、别的页照旧 220；手机宽度不渲染左栏，不受影响；
 *   1024 / 1280 / 1366 下窄栏里的东西不横向撑出、账号菜单点得开
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 左栏收窄 } from "@/lib/rail-mini";

describe("左栏收窄（路由）", () => {
  it("只认客户详情 /customers/<id>", () => {
    expect(["/customers/c1", "/customers/abc123", "/customers/c1?tab=x"].map(左栏收窄)).toEqual([true, true, true]);
    expect(["/customers", "/customers/", "/customers/recent", "/customers/new", "/customers/c1/edit", "/projects/p1", "/pool", "/dashboard", "", null, undefined].map(左栏收窄)).toEqual(Array(11).fill(false));
  });
});

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-rail-mini", setup(b) {
  b.onResolve({ filter: /^next\/(navigation|link)$/ }, a => ({ path: a.path, namespace: "fixture" }));
  b.onResolve({ filter: /(^|\/)(WhatsNew|UpdateRow|AiTasks|AiDock|FeedbackButton|AiCost|RailResizer|LeadFullNotices|RecordView|ProjectDetail|NoticeBell)$/ }, a => ({ path: a.path, namespace: "empty-child" }));
  b.onLoad({ filter: /.*/, namespace: "empty-child" }, () => ({ contents: "export default function Empty(){return null} export function AiMeterBar(){return null}" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ resolveDir: process.cwd(), contents: a.path === "next/link"
    ? `import React from 'react';export default function Link({href,onClick,prefetch,unstable_dynamicOnHover,children,...p}){return React.createElement('a',{...p,href,onClick:e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.__route=href}}},children)}`
    : `export const useRouter=()=>({push:p=>window.__route=p,refresh:()=>{}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);` }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import Shell from '@/components/AppShell';
    const root=createRoot(document.getElementById('root'));window.__route='';window.desktopNav={onGo:()=>()=>{},setCustomerLabel:async()=>true};
    window.__render=()=>root.render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><Shell user={{id:'qa',name:'一个名字特别特别长的同事',email:'qa@example.test',role:'ADMIN',title:''}} workspace={{name:'工作区'}} desktop={false} 反馈去向="none" 企业版项目={true} 企业版={true} pane={null} ai={null} 要跟={{逾期:3,今天:120}}><div>正文</div></Shell></BusinessProvider></App>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

/** 样式表要真的挂上：窄栏的宽度、藏字都在 globals.css 里 */
async function 打开(址: string, width = 1280): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto(`http://ent.test${址}`);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
  await page.getByRole("navigation", { name: "主导航" }).waitFor();
  return { page, errors };
}
const 栏宽 = (page: Page) => page.locator("nav.rail").evaluate(el => Math.round(el.getBoundingClientRect().width));
const 窄态 = (page: Page) => page.locator(".shell").evaluate(el => el.classList.contains("rail-mini"));

it("客户详情：壳上有 rail-mini，左栏 56 宽、字藏起来只留图标；每项有 aria-label；不横向撑出", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 打开("/customers/c1", w);
    try {
      expect(await 窄态(page), `${w}`).toBe(true);
      expect(await 栏宽(page), `${w}`).toBe(56);
      const 项 = page.locator("nav.rail a.rail-item");
      expect(await 项.evaluateAll(as => as.map(a => a.getAttribute("aria-label")?.split("，")[0]))).toEqual(["首页", "复盘", "渠道", "公海", "客户", "项目"]);
      // 名字都藏了：导航项、搜索框、账号名都看不见
      expect(await 项.locator("b").evaluateAll(bs => bs.filter(b => (b as HTMLElement).offsetParent !== null).length)).toBe(0);
      expect(await page.locator(".rail-search > span:not(.anticon)").isVisible()).toBe(false);
      expect(await page.locator(".rail-search .anticon-search").isVisible()).toBe(true);
      expect(await page.locator(".rail-user b").isVisible()).toBe(false);
      // 图标、要跟的红数、头像都还在，而且不伸出左栏
      const 出界 = await page.locator("nav.rail").evaluate(nav => {
        const 右 = nav.getBoundingClientRect().right;
        return [...nav.querySelectorAll("a, button, .rail-count")].filter(el => (el as HTMLElement).offsetParent !== null && el.getBoundingClientRect().right > 右 + 0.5).map(el => el.className);
      });
      expect(出界, `${w}`).toEqual([]);
      expect(await page.locator(".rail-count").innerText()).toBe("99+");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("客户详情：悬停导航项右边冒出名字；键盘 Tab 聚焦也冒；账号菜单点得开", async () => {
  const { page, errors } = await 打开("/customers/c1", 1280);
  try {
    await page.locator("nav.rail a.rail-item[aria-label='复盘']").hover();
    await expect.poll(() => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: /^复盘$/ }).count()).toBe(1);
    await page.mouse.move(800, 400);
    await page.locator("nav.rail a.rail-item[aria-label='渠道']").focus();
    await expect.poll(() => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: /^渠道$/ }).count()).toBe(1);
    await page.getByRole("button", { name: /账号菜单/ }).click();
    await page.getByRole("menuitem", { name: /退出登录/ }).waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("客户列表、最近、项目详情：没有 rail-mini，左栏照旧 220、名字写出来、悬停不冒提示", async () => {
  for (const 址 of ["/customers", "/customers/recent", "/projects/p1"]) {
    const { page, errors } = await 打开(址, 1280);
    try {
      expect(await 窄态(page), 址).toBe(false);
      expect(await 栏宽(page), 址).toBe(220);
      expect(await page.locator("nav.rail a.rail-item b").first().isVisible()).toBe(true);
      await page.locator("nav.rail a.rail-item[aria-label='复盘']").hover();
      await page.waitForTimeout(400);
      expect(await page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").count(), 址).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("手机宽度：客户详情也不渲染左栏（导航换成顶栏下拉），不受窄栏影响", async () => {
  // 手机分支没有「主导航」这个 nav，不能用 打开（它等的就是那个 nav）
  const p = await browser.newPage({ viewport: { width: 390, height: 800 } }); p.setDefaultTimeout(5000);
  const errs: string[] = []; p.on("pageerror", e => errs.push(e.message));
  await p.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await p.goto("http://ent.test/customers/c1");
  await p.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await p.addScriptTag({ content: bundle });
  await p.evaluate(() => (window as unknown as { __render: () => void }).__render());
  try {
    await p.getByRole("button", { name: "打开导航菜单" }).waitFor();
    expect(await p.locator("nav.rail").count()).toBe(0);
    expect(await p.locator(".rail-mini").count()).toBe(0);
    expect(errs).toEqual([]);
  } finally { await p.close(); }
});
