/**
 * 设计语言 H-B（11-22，全站外壳：左栏 / 顶栏、⌘K、铃铛；依据 现在-首页-20261121.md H1 / H2 / H3）：
 *   H-新11 铃铛悬停出提示「通知，N 条未读」；红数（含 99+）收在 32 的钮里，不压出钮、不压出左栏（窄栏同）
 *   H-新10 ⌘K 底部只一行三颗键；D01 计数 / 分组标题 / ⌘K 小标题 muted
 *   D28 390 顶栏「搜索」开同一张跳转单
 *   （对话区的 H-新6 / 9 / 16 留给首页对话新方案，本批不做）
 * 左栏、顶栏全站共用：首页、客户列表、客户详情（窄栏）、项目页 × 1024 / 1280 / 1366 / 390 各看一眼不挡：
 *   scrollWidth ≤ innerWidth、顶栏钮都在屏内、elementFromPoint 命中自己。
 * 换皮主题（账簿、科技）结构和文案照旧（用户 11-21「主题不动」，lib/use-skin.ts）。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, 壳包: string;
const 打包选项 = { bundle: true, write: false as const, format: "iife" as const, jsx: "automatic" as const, alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" as const }, logLevel: "silent" as const };

const 壳插件: Plugin = { name: "ent-design-hb-shell", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({push:p=>{window.__route=p},refresh(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^next\/link$/, "import React from 'react';export default function Link({href,onClick,prefetch,unstable_dynamicOnHover,children,...p}){return React.createElement('a',{...p,href,onClick:e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.__route=href}}},children)}");
  stub(/notice-actions$/, "export const 读我的通知=async()=>({行们:[],未读:window.__未读});export const 读未读通知数=async()=>window.__未读;export const 标已读=async()=>0;export const 全部标已读=async()=>0;");
  stub(/^\.\/giveup-actions$/, 补全动作桩("src/app/(app)/projects/[id]/giveup-actions.ts"));
  b.onResolve({ filter: /(^|\/)(WhatsNew|UpdateRow|FeedbackButton|AiCost|RailResizer|AwaitAssignTodo|RecordView|ProjectDetail|AiDock)$/ }, (a) => ({ path: a.path, namespace: "empty" }));
  b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "export default function Empty(){return null} export function AiMeterBar(){return null}" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  const 壳 = await build({ ...打包选项, plugins: [壳插件], stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import Shell from '@/components/AppShell';
    window.__route='';window.__未读=0;window.desktopNav={onGo:()=>()=>{},setCustomerLabel:async()=>true};
    const 长='某某超长贸易进出口有限公司'.repeat(4);
    function 正文(){return <div><h1 style={{margin:0}}>{location.pathname}</h1><p style={{overflowWrap:'anywhere'}}>{长.repeat(3)}</p></div>}
    const root=createRoot(document.getElementById('root'));
    window.__render=(未读)=>{window.__未读=未读;root.render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <Shell user={{id:'qa',name:'一个名字特别特别长的同事',email:'qa@example.test',role:'ADMIN',title:''}} workspace={{name:'工作区'}} desktop={false} 反馈去向="none"
        企业版项目={true} 企业版={true} 通知未读={未读} ai={{models:[]}} 要跟={{逾期:3,今天:120}}
        pane={null}
        全局搜索={async(q)=>({客户:[{id:'c1',name:长,附注:'负责人 甲',去:'/customers/c1'}],项目:[{id:'p1',name:'项目'+长,附注:'',去:'/projects/p1'}],联系人:[]})}><正文/></Shell>
    </BusinessProvider></App>)};` } });
  壳包 = "window.process = { env: {} };\n" + 壳.outputFiles[0].text;

  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 皮 = "now" | "ledger" | "tech";
const 网页 = (skin: 皮) => `<!doctype html><html${skin === "now" ? "" : ` data-skin="${skin}" data-paper="tone" data-mode="light"`}><meta charset='utf-8'><div id='root'></div></html>`;
async function 挂样式(page: Page, skin: 皮) {
  for (const f of ["globals.css", ...(skin === "now" ? [] : ["skins/shared.css", `skins/${skin}.css`])]) await page.addStyleTag({ path: path.resolve("src/app", f) });
}

async function 开壳(址: string, 宽: number, o: { 未读?: number; skin?: 皮 } = {}): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 宽, height: 820 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const skin = o.skin ?? "now";
  await page.route("http://hb.test/**", (r) => r.fulfill({ contentType: "text/html", body: 网页(skin) }));
  await page.goto(`http://hb.test${址}`);
  await 挂样式(page, skin);
  await page.addScriptTag({ content: 壳包 });
  await page.evaluate((n) => (window as unknown as { __render: (n: number) => void }).__render(n), o.未读 ?? 128);
  await (宽 < 768 ? page.getByRole("button", { name: "打开导航菜单" }) : page.getByRole("navigation", { name: "主导航" })).waitFor();
  return { page, errors };
}
const 不横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** 元素中心点 elementFromPoint 落在它自己（或它里面） */
const 点得到 = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
});
const 盒 = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; });
const 页们 = ["/dashboard", "/customers", "/customers/c1", "/projects/p1"];

it("H-新11 电脑：铃铛红数（含 99+）收在钮里、不压出左栏；悬停出提示；点得到。各页 × 1024 / 1280 / 1366 不横滚", async () => {
  for (const 址 of 页们) for (const 宽 of [1024, 1280, 1366]) {
    const { page, errors } = await 开壳(址, 宽, { 未读: 128 });
    try {
      const 钮 = await 盒(page, ".notice-bell");
      const 数 = await 盒(page, ".notice-bell-badge > .ant-badge-count");
      expect(await page.locator(".notice-bell-badge > .ant-badge-count").innerText(), `${址} ${宽}`).toBe("99+");
      expect(数.r, `${址} ${宽} 红数右缘`).toBeLessThanOrEqual(钮.r + 0.5);
      expect(数.t, `${址} ${宽} 红数上缘`).toBeGreaterThanOrEqual(钮.t - 0.5);
      const 栏 = await 盒(page, "nav.rail");
      expect(数.r, `${址} ${宽} 不压出左栏`).toBeLessThanOrEqual(栏.r);
      // 红数不挡点：点在红数上也是点在铃铛上
      expect(await page.evaluate(() => { const r = document.querySelector(".notice-bell-badge > .ant-badge-count")!.getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(".notice-bell"); }), `${址} ${宽}`).toBe(true);
      expect(await 点得到(page, ".notice-bell"), `${址} ${宽}`).toBe(true);
      expect(await 点得到(page, ".rail-search"), `${址} ${宽}`).toBe(true);
      expect(await 不横滚(page), `${址} ${宽}`).toBe(true);
      expect(await page.locator(".notice-bell").getAttribute("title")).toBeNull(); // 只出一种提示，不再叠浏览器原生那条
      if (址 === "/dashboard" && 宽 === 1280) {
        await page.locator(".notice-bell").hover();
        await expect.poll(() => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: /^通知，128 条未读$/ }).count()).toBe(1);
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("H-新11：没有未读时没有红数，提示只写「通知」", async () => {
  const { page, errors } = await 开壳("/customers", 1280, { 未读: 0 });
  try {
    expect(await page.locator(".notice-bell-badge > .ant-badge-count").count()).toBe(0);
    await page.locator(".notice-bell").hover();
    await expect.poll(() => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: /^通知$/ }).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("H-新10 / D01：⌘K 底部一行三颗键（长话收进悬停说明）；小标题、计数 muted；1024 / 1366 不横滚", async () => {
  for (const 宽 of [1024, 1366]) {
    const { page, errors } = await 开壳("/customers", 宽);
    try {
      await page.locator(".rail-search").click();
      const 脚 = page.locator(".cmdk-foot");
      await 脚.waitFor();
      expect(await 脚.innerText()).toMatch(/^↑↓ 选 · ↵ 去 · Esc 关$/);
      expect(await 脚.getAttribute("title")).toMatch(/回到输入框.*换一位.*跳转单/);
      const 行高 = await 脚.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.6);
      const 内高 = await 脚.evaluate((el) => { const s = getComputedStyle(el); return el.getBoundingClientRect().height - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom) - parseFloat(s.borderTopWidth); });
      expect(内高, `${宽} 一行`).toBeLessThan(行高 * 1.5);
      await page.locator(".cmdk-in input").fill("华东");
      await page.locator(".cmdk-sec").first().waitFor();
      const [小标题色, 灰] = await page.evaluate(() => [getComputedStyle(document.querySelector(".cmdk-sec")!).color, getComputedStyle(document.querySelector(".cmdk-foot")!).color]);
      expect(小标题色, "cmdk-sec = muted（和底部说明同色）").toBe(灰);
      expect(await 不横滚(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("D28 手机 390：各页顶栏有「搜索」（对话列表入口本批不加）；钮都在屏内、点得到；不横滚", async () => {
  for (const 址 of 页们) {
    const { page, errors } = await 开壳(址, 390);
    try {
      const 头 = page.locator(".ant-layout-header");
      expect(await 头.getByRole("button", { name: "搜索" }).count(), 址).toBe(1);
      expect(await 头.getByRole("button", { name: "对话列表" }).count(), 址).toBe(0);
      const 钮们 = await 头.locator("button").evaluateAll((bs) => bs.map((b) => {
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { 名: b.getAttribute("aria-label"), 右: r.right, 左: r.left, 中: !!hit && (hit === b || b.contains(hit)) };
      }));
      for (const x of 钮们) {
        expect(x.左, `${址} ${x.名}`).toBeGreaterThanOrEqual(0);
        expect(x.右, `${址} ${x.名}`).toBeLessThanOrEqual(390);
        expect(x.中, `${址} ${x.名} 点得到`).toBe(true);
      }
      expect(await 不横滚(page), 址).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("D28 手机：点「搜索」开跳转单，搜得到客户 / 项目，浮层不出屏", async () => {
  const { page, errors } = await 开壳("/customers", 390);
  try {
    await page.getByRole("button", { name: "搜索" }).click();
    const 框 = page.locator(".cmdk-in input");
    await 框.waitFor();
    await 框.fill("华东");
    await page.locator(".cmdk-sec", { hasText: "项目" }).waitFor();
    const 浮层 = await 盒(page, ".cmdk-root .ant-modal");
    expect(浮层.l).toBeGreaterThanOrEqual(0);
    expect(浮层.r).toBeLessThanOrEqual(390);
    expect(await 不横滚(page)).toBe(true);
    await page.locator(".cmdk-item .cmdk-row", { hasText: "项目" }).first().click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __route: string }).__route)).toBe("/projects/p1");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("换皮主题（账簿 / 科技）：铃铛照旧（原生 title、无提示类）、⌘K 底部长句照旧、手机顶栏不加搜索", async () => {
  for (const skin of ["ledger", "tech"] as const) {
    const 电脑 = await 开壳("/customers", 1280, { skin });
    try {
      expect(await 电脑.page.locator(".notice-bell-badge").count(), skin).toBe(0);
      expect(await 电脑.page.locator(".notice-bell").getAttribute("title"), skin).toBe("通知，128 条未读");
      await 电脑.page.locator(".rail-search").click();
      await 电脑.page.locator(".cmdk-foot").waitFor();
      expect(await 电脑.page.locator(".cmdk-foot").innerText(), skin).toMatch(/其余页面打开跳转单/);
      expect(电脑.errors).toEqual([]);
    } finally { await 电脑.page.close(); }
    const 手机 = await 开壳("/dashboard", 390, { skin });
    try {
      const 头 = 手机.page.locator(".ant-layout-header");
      expect(await 头.getByRole("button", { name: "搜索" }).count(), skin).toBe(0);
      expect(手机.errors).toEqual([]);
    } finally { await 手机.page.close(); }
  }
});
