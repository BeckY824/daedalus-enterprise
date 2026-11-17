/**
 * 25C 补草稿的几个表单在真浏览器里（复盘第 1 类：刷新 / 发版后已经打的字不能丢）：
 *   1. 线索转项目弹窗：打了沟通内容 → 整页刷新 → 再打开同一条线索，字带回、框里一行「已带回…」；转成了草稿清掉
 *   2. 教练主题回复：打了回复 → 刷新带回；回出去了清掉，接着再打的字照样留草稿（交完清空接着用的框）
 *   3. 同号再录「这次的情况」：刷新带回；写进去了清掉
 *   1024 / 1280 / 1366 宽：带回那一行不撑出横向滚动
 * 服务端动作换成假的（esbuild 打包时替掉），同 tests/stale-deploy.ui.test.ts 那套桩
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "form-draft-25c-ui", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/coach-topic-actions$/, 补全动作桩("src/app/(app)/customers/[id]/coach-topic-actions.ts", "export const 回复主题动作=async(...a)=>{(window.__回||=[]).push(a);return{ok:true}};"));
  stub(/same-number-actions$/, 补全动作桩("src/app/(app)/customers/same-number-actions.ts", "export const 同号协同录入=async(...a)=>{(window.__同号||=[]).push(a);return{ok:true,反馈:'已写进现有项目'}};"));
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ConvertProjectModal from '@/app/(app)/leads/ConvertProjectModal';import CoachTopics from '@/app/(app)/projects/[id]/CoachTopics';
    import SameNumberEntry from '@/app/(app)/projects/new/SameNumberEntry';import {我Provider} from '@/lib/me-client';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 主题={id:'t1',node:'方案报价',title:'报价太慢',body:'下次先给区间价',status:'待回复',createdAt:'2026-11-17T01:00:00.000Z',closedAt:null,
      作者:{name:'教练乙',身份:'销售教练'},关的人:null,回复们:[],能回:true,能关:false,能删:false};
    const 数据={们:[主题],能发:false,填写人:null,负责人:null,项目名:'项目',当前节点:'方案报价',待回复数:1,冻结:false};
    const root=createRoot(document.getElementById('root'));
    function 转(){const [lead,set]=React.useState({id:'L1',name:'线索甲'});return <ConvertProjectModal lead={lead} 要下一步={false} 说明="会建一位客户" 关={()=>set(null)} 交={async(f)=>{(window.__转||=[]).push(f);set(null);return true;}}/>;}
    window.__render=(哪个)=>root.render(<ConfigProvider locale={zhCN}><App><我Provider value={{id:'qa',name:'组长甲'}}><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      {哪个==='转'?<转/>:哪个==='主题'?<CoachTopics 数据={数据}/>:<SameNumberEntry 类型="手机号" 值="13800001111" 渠道们={[]} 默认渠道={null} 情况={{有项目:true}}/>}
    </BusinessProvider></我Provider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 窗 = Window & { __render: (哪个: string) => void; __转?: unknown[]; __回?: unknown[][]; __同号?: unknown[][] };

async function 开(width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 860 } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("http://drafts.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://drafts.test/x");
  return { page, errors };
}
/** 装上（第一次）或「刷新后」重装：整页重载，localStorage 还在 */
async function 装(page: Page, 哪个: "转" | "主题" | "同号", 刷新 = false) {
  if (刷新) await page.reload();
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(x => (window as unknown as 窗).__render(x), 哪个);
}
const 草稿们 = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("daedalus:草稿:")));
/** 草稿是值变了之后的 effect 里存的：等一帧 */
const 等存 = (page: Page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30))));

it.each([1024, 1280, 1366])("线索转项目 %ipx：打了的沟通内容刷新后带回；转成了草稿清掉", async (w) => {
  const { page, errors } = await 开(w);
  try {
    await 装(page, "转");
    await page.getByLabel("沟通内容").fill("客户要样品，下周寄");
    await 等存(page);
    expect(await 草稿们(page)).toEqual(["daedalus:草稿:qa:线索转项目:L1"]);
    await 装(page, "转", true);
    await expect.poll(() => page.getByLabel("沟通内容").inputValue()).toBe("客户要样品，下周寄");
    await page.getByText("已带回上次没提交的内容").waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const 行 = (await page.locator(".draft-hint").boundingBox())!;
    expect(行.x + 行.width).toBeLessThanOrEqual(w);
    await page.getByRole("button", { name: "转为项目" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as 窗).__转?.length ?? 0)).toBe(1);
    await expect.poll(() => 草稿们(page)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("线索转项目：点取消草稿删掉", async () => {
  const { page } = await 开();
  try {
    await 装(page, "转");
    await page.getByLabel("沟通内容").fill("先记一句");
    await 等存(page);
    expect((await 草稿们(page)).length).toBe(1);
    await page.getByRole("button", { name: /取\s*消/ }).click();
    await expect.poll(() => 草稿们(page)).toEqual([]);
  } finally { await page.close(); }
});

it("教练主题回复：刷新带回；回出去了清掉，接着再打的字照样留草稿", async () => {
  const { page, errors } = await 开(1024);
  try {
    await 装(page, "主题");
    await page.getByLabel("回复这个主题").fill("收到，下次先报区间");
    await 等存(page);
    expect(await 草稿们(page)).toEqual(["daedalus:草稿:qa:主题回复:t1"]);
    await 装(page, "主题", true);
    await expect.poll(() => page.getByLabel("回复这个主题").inputValue()).toBe("收到，下次先报区间");
    await page.getByText("已带回上次没提交的内容").waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByTestId("coach-topic-reply").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as 窗).__回?.length ?? 0)).toBe(1);
    await expect.poll(() => page.getByLabel("回复这个主题").inputValue()).toBe("");
    await expect.poll(() => 草稿们(page)).toEqual([]);
    await page.getByLabel("回复这个主题").fill("再补一句");
    await 等存(page);
    expect(await 草稿们(page)).toEqual(["daedalus:草稿:qa:主题回复:t1"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("同号再录：这次的情况刷新带回；写进去了清掉", async () => {
  const { page, errors } = await 开();
  try {
    await 装(page, "同号");
    await page.getByLabel("这次的情况").fill("展会上又遇到，要报价单");
    await 等存(page);
    expect(await 草稿们(page)).toEqual(["daedalus:草稿:qa:同号再录:手机号:13800001111"]);
    await 装(page, "同号", true);
    await expect.poll(() => page.getByLabel("这次的情况").inputValue()).toBe("展会上又遇到，要报价单");
    await page.getByRole("button", { name: "写进现有项目" }).click();
    await page.getByText("已写进现有项目").waitFor();
    await expect.poll(() => 草稿们(page)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
