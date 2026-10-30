/**
 * 新建跟进弹窗打开以后，项目列表晚到、「有没有 WhatsApp 号」后变，不许把人已经填的清掉（2026-10-28）。
 *
 *   原来初始化的 effect 依赖里带着默认项目和有WhatsApp：这两个一变就再 resetFields 一遍，
 *   人选好的类型、写了一半的内容整个没了。现在只在打开那一刻清表；之后只补空：
 *   projectId 空着、人没碰过才填默认项目；类型人没改过才跟着有没有 WhatsApp 走。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "followup-form-reset", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  stub(/projects\/actions$/, "export const 项目沟通须知=async()=>(window.__须知??{ok:true,能记:false}),记项目沟通Action=async(id,x)=>{window.__项目存={id,...x};return{ok:true,followUpId:'f1',自动推到:window.__推到}};");
  stub(/^\.\/actions$/, "export const saveFollowUp=async x=>{window.__存=x;return{ok:true,id:'f1'}},completePlan=async()=>({ok:true});export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'n1'});");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no'});");
  stub(/^\.\/CustomerPick$/, "export default function C(){return null}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import FollowUpForm from '@/app/(app)/customers/[id]/FollowUpForm';
    const root=createRoot(document.getElementById('root'));
    window.__render=({项目,有WA})=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>
      <FollowUpForm open onClose={()=>{}} onSaved={()=>{}} customerId="c1" aiEnabled={false} record={null}
        contacts={[]} opportunities={[]} projects={项目} 有WhatsApp={有WA}/>
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 参数 = { 项目: { id: string; name: string }[] | null; 有WA: boolean };
const 渲染 = (page: Page, p: 参数) => page.evaluate(x => (window as unknown as { __render: (x: 参数) => void }).__render(x), p);
async function open(p: 参数) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://fup-reset.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://fup-reset.test"); await page.addScriptTag({ content: bundle });
  await 渲染(page, p);
  await page.getByRole("button", { name: /保\s*存/ }).waitFor();
  return { page, errors };
}
const 格 = (page: Page, 名: string) => page.locator(".ant-form-item").filter({ has: page.locator(`label:text-is("${名}")`) });
const 选中 = (page: Page, 名: string) => 格(page, 名).locator(".ant-select-content").innerText();
async function 选(page: Page, 名: string, 项: string) {
  await 格(page, 名).locator(".ant-select").click();
  await page.locator(".ant-select-dropdown:visible").getByTitle(项, { exact: true }).click();
}
async function 存(page: Page) {
  await page.getByRole("button", { name: /保\s*存/ }).click();
  await page.waitForFunction(() => Reflect.get(window, "__存"));
  return page.evaluate(() => Reflect.get(window, "__存") as Record<string, unknown>);
}
const 一号 = { id: "p1", name: "一号项目" }, 二号 = { id: "p2", name: "二号项目" }, 新项目 = { id: "p3", name: "新来的项目" };

it("打开后项目列表才到、WhatsApp 后变：人改的类型、写的内容都还在，项目补上第一个", async () => {
  const { page, errors } = await open({ 项目: [], 有WA: false });
  try {
    await 选(page, "沟通方式", "上门拜访");
    await page.locator("#title").fill("谈交期");
    await page.locator("#content").fill("聊了报价，下周再约");
    await 渲染(page, { 项目: [一号, 二号], 有WA: true });
    await expect.poll(() => 选中(page, "关联项目")).toContain("一号项目");
    expect(await 选中(page, "沟通方式")).toContain("上门拜访");
    expect(await page.locator("#title").inputValue()).toBe("谈交期");
    expect(await page.locator("#content").inputValue()).toBe("聊了报价，下周再约");
    expect(await 存(page)).toMatchObject({ type: "VISIT", title: "谈交期", content: "聊了报价，下周再约", projectId: "p1" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("类型人没碰过：跟着后到的 WhatsApp 号走，写的内容不丢", async () => {
  const { page, errors } = await open({ 项目: [一号], 有WA: false });
  try {
    expect(await 选中(page, "沟通方式")).toContain("电话沟通");
    await page.locator("#content").fill("发了目录");
    await 渲染(page, { 项目: [一号], 有WA: true });
    await expect.poll(() => 选中(page, "沟通方式")).toContain("WhatsApp");
    expect(await page.locator("#content").inputValue()).toBe("发了目录");
    expect(await 存(page)).toMatchObject({ type: "WHATSAPP", content: "发了目录", projectId: "p1" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("人自己挑了项目：后来列表换了第一个，也不改他挑的", async () => {
  const { page, errors } = await open({ 项目: [一号, 二号], 有WA: false });
  try {
    await 选(page, "关联项目", "二号项目");
    await page.locator("#content").fill("看了样品");
    await 渲染(page, { 项目: [新项目, 一号, 二号], 有WA: false });
    // 给新一轮渲染和 effect 留一拍，再看有没有被改
    await page.waitForTimeout(200);
    expect(await 选中(page, "关联项目")).toContain("二号项目");
    expect(await 存(page)).toMatchObject({ content: "看了样品", projectId: "p2" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
