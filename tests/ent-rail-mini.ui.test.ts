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
  b.onResolve({ filter: /(^|\/)(WhatsNew|UpdateRow|FeedbackButton|AiCost|RailResizer|LeadFullNotices|RecordView|ProjectDetail|NoticeBell)$/ }, a => ({ path: a.path, namespace: "empty-child" }));
  // AI 面板换成同样结构的假面板：<aside class="dock"> 里头一枚真的拖宽把手（和 AiDock 一样用 WidthHandle 面板把手）
  b.onResolve({ filter: /(^|\/)AiDock$/ }, a => ({ path: a.path, namespace: "dock" }));
  b.onLoad({ filter: /.*/, namespace: "dock" }, () => ({ resolveDir: process.cwd(), loader: "tsx", contents: "import WidthHandle, { 面板把手 } from '@/components/WidthHandle';export default function D(){return <aside className='dock' aria-label='AI 面板'><WidthHandle 规格={面板把手} /></aside>}" }));
  b.onLoad({ filter: /.*/, namespace: "empty-child" }, () => ({ contents: "export default function Empty(){return null} export function AiMeterBar(){return null}" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ resolveDir: process.cwd(), contents: a.path === "next/link"
    ? `import React from 'react';export default function Link({href,onClick,prefetch,unstable_dynamicOnHover,children,...p}){return React.createElement('a',{...p,href,onClick:e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.__route=href}}},children)}`
    : `export const useRouter=()=>({push:p=>window.__route=p,refresh:()=>{}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);` }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import Shell from '@/components/AppShell';import {runJob} from '@/lib/ai-jobs';window.__runJob=runJob;
    const root=createRoot(document.getElementById('root'));window.__route='';window.desktopNav={onGo:()=>()=>{},setCustomerLabel:async()=>true};
    window.__render=(带AI)=>root.render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><Shell user={{id:'qa',name:'一个名字特别特别长的同事',email:'qa@example.test',role:'ADMIN',title:''}} workspace={{name:'工作区'}} desktop={false} 反馈去向="none" 企业版项目={true} 企业版={true} pane={null} ai={带AI?{models:[]}:null} 要跟={{逾期:3,今天:120}}><div>正文</div></Shell></BusinessProvider></App>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

/** 样式表要真的挂上：窄栏的宽度、藏字都在 globals.css 里 */
async function 打开(址: string, width = 1280, 选项: { 带AI?: boolean; 动画?: boolean } = {}): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto(`http://ent.test${址}`);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.emulateMedia({ reducedMotion: 选项.动画 ? "no-preference" : "reduce" });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((a) => (window as unknown as { __render: (a: boolean) => void }).__render(a), !!选项.带AI);
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
      expect(await 项.evaluateAll(as => as.map(a => a.getAttribute("aria-label")?.split("，")[0]))).toEqual(["首页", "复盘", "渠道", "公海", "客户"]); // 11-12 第 3 批去掉「项目」
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
      // 要跟的红数原来挂在「项目」上；11-12 C1 挪到「客户」，56px 图标态的角标同一个
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
  await p.evaluate(() => (window as unknown as { __render: (a: boolean) => void }).__render(false));
  try {
    await p.getByRole("button", { name: "打开导航菜单" }).waitFor();
    expect(await p.locator("nav.rail").count()).toBe(0);
    expect(await p.locator(".rail-mini").count()).toBe(0);
    expect(errs).toEqual([]);
  } finally { await p.close(); }
});

const 再渲染 = (page: Page, 址: string) => page.evaluate((u) => { history.pushState(null, "", u); (window as unknown as { __render: (a: boolean) => void }).__render(true); }, 址);
/** 左栏宽度过渡几秒（减弱动态下全站把时长压成 0.01ms，按 < 1ms 算没有动画） */
const 过渡 = (page: Page) => page.locator("nav.rail").evaluate(el => Math.max(...getComputedStyle(el).transitionDuration.split(",").map(x => parseFloat(x))) >= 0.001 ? "有" : "0s");

it("窄态只藏左栏自己的拖宽把手：AI 面板左缘的拖宽把手还在、拖得到（审查 1）", async () => {
  const { page, errors } = await 打开("/customers/c1", 1366, { 带AI: true });
  try {
    expect(await 窄态(page)).toBe(true);
    const 面板把手 = page.locator("aside.dock > .rail-resizer");
    expect(await 面板把手.count()).toBe(1);
    expect(await 面板把手.evaluate(el => getComputedStyle(el).display)).not.toBe("none");
    // 样式规则本身也只命中 .rail 的直接子级
    const 规则 = await page.evaluate(() => [...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch { return []; } })
      .map(r => (r as CSSStyleRule).selectorText ?? "").filter(t => t.includes(".rail-mini") && t.includes(".rail-resizer")));
    expect(规则.length).toBeGreaterThan(0);
    expect(规则.every(t => t.split(",").filter(x => x.includes(".rail-resizer")).every(x => x.includes(".rail > .rail-resizer")))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("窄态下 AI 任务留一枚图标：跑着有进度线、答完打勾；悬停 / aria-label 说是哪件事，点得到、不伸出左栏（审查 3）", async () => {
  const { page, errors } = await 打开("/customers/c1", 1280, { 带AI: true });
  try {
    await page.evaluate(() => {
      const w = window as unknown as { __runJob: (k: string, fn: () => Promise<unknown>, m?: string, t?: { 名: string; 去?: string }) => void; __完?: () => void };
      w.__runJob("t1", () => new Promise((ok) => { w.__完 = () => ok({ ok: true, value: 1 }); }), undefined, { 名: "整理沟通记录", 去: "/customers/c1" });
    });
    const 条 = page.locator("nav.rail .aitasks .aitask");
    await 条.waitFor();
    expect(await 条.getAttribute("aria-label")).toMatch(/^整理沟通记录/);
    expect(await 条.locator(".anticon-sync").isVisible()).toBe(true);
    expect(await 条.locator(".aitask-bar").count()).toBe(1);
    expect(await 条.locator(".aitask-n").count()).toBe(0);
    const 出界 = await page.locator("nav.rail").evaluate(nav => nav.querySelector(".aitask")!.getBoundingClientRect().right > nav.getBoundingClientRect().right + 0.5);
    expect(出界).toBe(false);
    await 条.hover();
    await expect.poll(() => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: "整理沟通记录" }).count()).toBe(1);
    await page.evaluate(() => (window as unknown as { __完: () => void }).__完());
    await expect.poll(() => 条.locator(".anticon-check-circle").count()).toBe(1);
    expect(await 条.locator(".aitask-bar").count()).toBe(0);
    await 条.click();
    expect(await page.evaluate(() => (window as unknown as { __route: string }).__route)).toBe("/customers/c1");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("宽窄过渡只在切换那一下：首帧不动画，进出客户详情时挂一会儿 rail-anim；减弱动态下不动画（审查 4）", async () => {
  const { page, errors } = await 打开("/customers/c1", 1280, { 带AI: true, 动画: true });
  try {
    // 首帧（含刷新时读到存的宽度）：没有过渡
    expect(await page.locator(".shell.rail-anim").count()).toBe(0);
    expect(await 过渡(page)).toBe("0s");
    await 再渲染(page, "/customers");
    expect(await page.locator(".shell.rail-anim").count()).toBe(1);
    expect(await 过渡(page)).toBe("有");
    // 过一会儿自己摘掉，之后拖宽写入也不动画
    await expect.poll(() => page.locator(".shell.rail-anim").count(), { timeout: 2000 }).toBe(0);
    expect(await 过渡(page)).toBe("0s");
    expect(await 栏宽(page)).toBe(220);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  const 少动 = await 打开("/customers", 1280, { 带AI: true });
  try {
    await 再渲染(少动.page, "/customers/c1");
    expect(await 少动.page.locator(".shell.rail-anim").count()).toBe(1);
    expect(await 过渡(少动.page)).toBe("0s");
    expect(await 栏宽(少动.page)).toBe(56);
  } finally { await 少动.page.close(); }
});
