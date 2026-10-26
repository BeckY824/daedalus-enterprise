/**
 * 企业版只用项目一条线（2026-10-26 用户定：去掉商机，线索改名「新线索」，首页改成对话框）。
 *
 *   左栏：企业版项目没有「商机」，「线索」叫「新线索」；开关关（团队版项目模式、个人版）和原来一样
 *   ⌘K：企业版项目没有商机、商机管道两条，换成项目
 *   没配 AI 的首页：企业版项目不是数据看板，是一张「AI 未配置」卡；管理员才有「去配置 AI」
 *   Windows 1024 / 1280 / 1366 宽度下左栏和那张卡不横向溢出
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-project-only", setup(b) {
  b.onResolve({ filter: /^next\/(navigation|link)$/ }, a => ({ path: a.path, namespace: "fixture" }));
  b.onResolve({ filter: /(^|\/)(UpdateRow|WhatsNew|AiTasks|AiDock|FeedbackButton|AiCost|RailResizer|LeadFullNotices)$/ }, a => ({ path: a.path, namespace: "empty-child" }));
  b.onLoad({ filter: /.*/, namespace: "empty-child" }, () => ({ contents: "export default function Empty(){return null} export function AiMeterBar(){return null}" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ resolveDir: process.cwd(), contents: a.path === "next/link"
    ? `import React from 'react';export default function Link({href,onClick,prefetch,children,...p}){return React.createElement('a',{...p,href,onClick:e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.__route=href}}},children)}`
    : `export const useRouter=()=>({push:p=>window.__route=p,refresh:()=>{}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);` }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import Shell from '@/components/AppShell';import NoAiHome from '@/app/(app)/dashboard/NoAiHome';
    const root=createRoot(document.getElementById('root'));window.__route='';window.desktopNav={onGo:()=>()=>{},setCustomerLabel:async()=>true};
    window.__render=(企业版项目,管理员)=>root.render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><Shell user={{id:'qa',name:'QA',email:'qa@example.test',role:管理员?'ADMIN':'MEMBER',title:''}} workspace={{name:'某某超长名字的企业版工作区',multiple:false,billing:false}} desktop={false} 反馈去向="github" 企业版项目={企业版项目} pane={null} ai={null} 要跟={{逾期:0,今天:0}}><NoAiHome 管理员={管理员}/></Shell></BusinessProvider></App>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(企业版项目: boolean, 管理员 = true, width = 1280): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/dashboard"); await page.addScriptTag({ content: bundle });
  await page.evaluate(([v, a]) => (window as unknown as { __render: (v: boolean, a: boolean) => void }).__render(v, a), [企业版项目, 管理员] as const);
  await page.getByRole("navigation", { name: "主导航" }).waitFor();
  return { page, errors };
}
const 左栏 = (page: Page) => page.getByRole("navigation", { name: "主导航" }).innerText();

it("企业版项目：左栏没有「商机」，线索叫「新线索」，项目还在", async () => {
  const { page, errors } = await 打开(true);
  const t = await 左栏(page);
  expect(t).not.toMatch(/商机/);
  expect(t).toContain("新线索");
  expect(t).toContain("项目");
  expect(errors).toEqual([]); await page.close();
});

it("开关关（团队版项目模式）：左栏照旧有「商机」，线索不改名", async () => {
  const { page, errors } = await 打开(false);
  const t = await 左栏(page);
  expect(t).toContain("商机");
  expect(t).not.toContain("新线索");
  expect(t).toMatch(/线索/);
  expect(errors).toEqual([]); await page.close();
});

it("⌘K：企业版项目没有商机两条，换成项目；开关关照旧", async () => {
  for (const 企业版项目 of [true, false]) {
    const { page } = await 打开(企业版项目);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog"); await dialog.waitFor();
    await dialog.locator("input").fill("商机");
    const t = await dialog.innerText();
    if (企业版项目) expect(t).not.toMatch(/商机管道/);
    else expect(t).toContain("商机管道");
    if (企业版项目) {
      await dialog.locator("input").fill("项目");
      expect(await dialog.innerText()).toContain("线索、商机、订单三个阶段");
    }
    await page.close();
  }
});

it("没配 AI 的企业版首页：管理员有「去配置 AI」，成员没有；不是数据看板", async () => {
  const 管 = await 打开(true, true);
  await 管.page.getByRole("button", { name: /去配置 AI/ }).click();
  expect(await 管.page.evaluate(() => Reflect.get(window, "__route"))).toBe("/settings?tab=ai");
  expect(await 管.page.locator("main, body").first().innerText()).toContain("AI 未配置");
  await 管.page.close();
  const 员 = await 打开(true, false);
  expect(await 员.page.getByRole("button", { name: /去配置 AI/ }).count()).toBe(0);
  expect(await 员.page.locator("body").innerText()).toContain("请找管理员");
  await 员.page.getByRole("button", { name: "看项目" }).click();
  expect(await 员.page.evaluate(() => Reflect.get(window, "__route"))).toBe("/projects");
  expect(员.errors).toEqual([]); await 员.page.close();
});

it.each([1024, 1280, 1366])("Windows %ipx：页面不横向溢出，卡上按钮都在可视区", async (w) => {
  const { page } = await 打开(true, true, w);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const name of ["去配置 AI", "看项目", "新线索", "客户"]) {
    // antd 两个字的按钮会在字中间插空格（「客 户」），按去掉空格后的文字找
    const box = await page.locator(".start-a button").filter({ hasText: new RegExp(name.split("").join("\\s?")) }).first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(w);
    const 点中 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box!.x + box!.width / 2, box!.y + box!.height / 2]);
    expect(点中.replace(/\s/g, "")).toContain(name.replace(/\s/g, ""));
  }
  await page.close();
});
