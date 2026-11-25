/**
 * F-052 记沟通的框里就地说「这样写会被判为无意义，不能保存」（客户详情 / 记跟进弹窗 FollowUpForm）：
 *   - 空内容不出；写「开店」出一行，说还差几个字；写够就消失；改成跟进任务 / 提醒不出
 *   - 开关「无意义沟通不能保存」关着（沟通判定须知 回 拦:false）：说「不算有效沟通」，不说不能保存
 *   - 服务端拦下（saveFollowUp 回 无意义）：原因浮在保存键上、框不关、内容留着
 *   - 一行：放不下用「…」，手机 390 宽不出横向滚动
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "f052-meaning-hint", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;export const 沟通判定须知=async()=>window.__判定??null;", "async()=>null"));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  stub(/projects\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "export const 项目沟通须知=async()=>({ok:true,能记:false});"));
  stub(/^\.\/actions$/, "export const saveFollowUp=async x=>{window.__存=x;return window.__回??{ok:true,id:'f1'}},completePlan=async()=>({ok:true});export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'n1'});");
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
    window.__render=()=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>
      <FollowUpForm open onClose={()=>{window.__关了=true}} onSaved={()=>{}} customerId="c1" aiEnabled={false} record={null}
        contacts={[]} opportunities={[]} projects={[{id:'p1',name:'一号项目'}]} 有WhatsApp={false}/>
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(opt: { 判定?: unknown; 回?: unknown; 宽?: number } = {}) {
  const page = await browser.newPage({ viewport: { width: opt.宽 ?? 1366, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://f052.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://f052.test"); await page.addScriptTag({ content: bundle });
  await page.evaluate(({ 判定, 回 }) => { Reflect.set(window, "__判定", 判定); Reflect.set(window, "__回", 回); }, { 判定: opt.判定 ?? null, 回: opt.回 ?? null });
  // 全站样式里那一行的规矩（globals.css .follow-meaning）抄一份进来：量省略号、横向滚动
  await page.addStyleTag({ content: ".follow-meaning{display:block;max-width:100%;min-width:0;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" });
  await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
  await page.getByRole("button", { name: /保\s*存/ }).waitFor();
  return { page, errors };
}
const 行 = (page: Page) => page.getByTestId("follow-meaning");
async function 选(page: Page, 名: string, 项: string) {
  await page.locator(".ant-form-item").filter({ has: page.locator(`label:text-is("${名}")`) }).locator(".ant-select").click();
  await page.locator(".ant-select-dropdown:visible").getByTitle(项, { exact: true }).click();
}

it("空内容不出；写「开店」说不能保存、还差 2 个字；写够了消失；任务 / 提醒不出", async () => {
  const { page, errors } = await open({ 判定: { 拦: true, 占位词: ["跟进"] } });
  try {
    expect(await 行(page).count()).toBe(0);
    await page.locator("#content").fill("开店");
    await expect.poll(() => 行(page).innerText()).toBe("这样写会被判为无意义，不能保存：不足 4 个字，还差 2 个字");
    await page.locator("#content").fill("开店的事，客户下月开业");
    await expect.poll(() => 行(page).count()).toBe(0);
    await page.locator("#content").fill("跟进跟进");
    await expect.poll(() => 行(page).innerText()).toBe("只有「跟进」「已联系」这类占位词，不算有效沟通");
    await page.locator("#content").fill("开店");
    await 选(page, "沟通方式", "跟进任务");
    await expect.poll(() => 行(page).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("开关关着：只说不算有效沟通，不说不能保存", async () => {
  const { page } = await open({ 判定: { 拦: false, 占位词: [] } });
  try {
    await page.locator("#content").fill("开店");
    await expect.poll(() => 行(page).innerText()).toBe("不足 4 个字，还差 2 个字，不算有效沟通");
  } finally { await page.close(); }
});

it("服务端拦下：原因浮在保存键上，框不关、内容留着、不打对勾", async () => {
  const 话 = "这样写会被判为无意义，不能保存：不足 4 个字，还差 2 个字。请写清沟通内容";
  const { page } = await open({ 判定: { 拦: true, 占位词: [] }, 回: { ok: false, error: 话, 无意义: true } });
  try {
    await page.locator("#content").fill("开店");
    await page.getByRole("button", { name: /保\s*存/ }).click();
    await page.waitForFunction(() => Reflect.get(window, "__存"));
    await expect.poll(() => page.getByText(话).count()).toBeGreaterThan(0);
    expect(await page.locator("#content").inputValue()).toBe("开店");
    expect(await page.evaluate(() => Reflect.get(window, "__关了"))).toBeFalsy();
    expect(await page.getByRole("button", { name: /已记下/ }).count()).toBe(0);
  } finally { await page.close(); }
});

it("手机 390 宽：那一行一条，放不下省略号，不出横向滚动", async () => {
  const { page } = await open({ 判定: { 拦: true, 占位词: [] }, 宽: 390 });
  try {
    await page.locator("#content").fill("Call");
    await expect.poll(() => 行(page).count()).toBe(1);
    const 量 = await 行(page).evaluate((el) => ({ 高: el.getBoundingClientRect().height, 截: el.scrollWidth > el.clientWidth, 省: getComputedStyle(el).textOverflow }));
    expect(量.高).toBeLessThan(30);
    expect(量.截).toBe(true);
    expect(量.省).toBe("ellipsis");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await page.close(); }
});

/*
  首页 AI 项目沟通卡（ProjectProposalFields）：卡自己取一次开关（useFollowJudge），关着时那一行跟着说「不算有效沟通」。
  单独打一包，只渲染这张卡的格子（审查建议 4）
*/
it("首页 AI 项目沟通卡：开关关着说不算有效沟通，开着说不能保存", async () => {
  const 卡包 = (await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';
    import ProjectProposalFields from '@/components/ProjectProposalFields';
    function 卡(){const [d,setD]=useState({kind:'project_followup',targetId:'p1',targetName:'一号项目',type:'PHONE',content:'开店',下一步:'',下一步时间:'',要时间:false});
      return <ProjectProposalFields draft={d} setDraft={setD}/>;}
    window.__render=()=>createRoot(document.getElementById('root')).render(<ConfigProvider><App><卡/></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  for (const [判定, 话] of [[{ 拦: false, 占位词: [] }, "不足 4 个字，还差 2 个字，不算有效沟通"], [{ 拦: true, 占位词: [] }, "这样写会被判为无意义，不能保存：不足 4 个字，还差 2 个字"]] as const) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    try {
      await page.route("http://f052.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
      await page.goto("http://f052.test"); await page.addScriptTag({ content: 卡包 });
      await page.evaluate((x) => { Reflect.set(window, "__判定", x); }, 判定);
      await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
      await expect.poll(() => 行(page).innerText()).toBe(话);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
}, 60_000);
