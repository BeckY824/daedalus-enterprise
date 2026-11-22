/**
 * 审核 11-18「新建入口与字段落库」新建弹窗（建档向导）那两条：
 *   P1-2 新客户摆客户地址三格（国家地区、省、市，照新建客户页），交进 企业资料，市场成员的分配方向先按它判
 *   P1-1 挑了老客户也摆「项目渠道」，默认带这位客户的来源渠道（P-删-03 建时可选）；没另选不交 channelId（服务端带客户来源）
 * 弹窗外壳和桩照 ent-create-modal.ui.test.ts；Windows 1024 / 1280 / 1366 量地址三格不溢出
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ent-audit-entry-wizard", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){(window.__跳=window.__跳??[]).push(u)},replace(){}});export const usePathname=()=>'/customers';");
  stub(/^next\/link$/, "export default function L({href,children,prefetch,...p}){return <a href={href} {...p}>{children}</a>}");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/^\.\.\/actions$/, "export const 建档向导=async(x)=>{(window.__调||=[]).push(['建档向导',x]);return {ok:true,customerId:'c1',projectId:'p1'}};export const 建档只建客户=async(x)=>{(window.__调||=[]).push(['建档只建客户',x]);return {ok:true,customerId:'c2',projectId:null}};");
  stub(/customers\/actions$/, "export const checkDuplicate=async()=>null;export const 推荐人候选=async()=>[];");
  stub(/(^|\/)number-actions$/, "export const 查号码=async(t,v)=>({ok:true,状态:'首次录入',提示:'首次录入',值:v,归属地:null});export const 查客户名=async()=>({ok:true,撞:null});export const 申请挂靠=async()=>({ok:true});export const 从回收站捞回=async()=>({ok:true});");
  stub(/customers\/RepeatInquiryKey$/, "export default function R(){return null}");
  stub(/customers\/DedupeClaimKey$/, "export default function D(){return null}");
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[{id:'c9',name:'华东展具',附注:null}];");
  stub(/customers\/\[id\]\/project-actions$/, "export const 给客户建项目=async(x)=>{(window.__调||=[]).push(['给客户建项目',x]);return {ok:true,projectId:'np9'}};export const 新项目分配数据=async()=>({分配方式们:[],默认分配方式:0,是销售:false,客户业务线:'外贸',客户区域线:null,客户有地址:false,客户电话线:null,客户渠道:'ch1'});export const 建项目带走的项目=async()=>({项目数:0,项目:[]});");
  stub(/same-number-actions$/, "export const 同号协同录入=async()=>({ok:true});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {建档弹窗} from '@/app/(app)/projects/new/ProjectWizard';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    const 渠道们=[{id:'ch1',name:'示例展会',attr:null,platform:'示例展会',active:true},{id:'ch2',name:'示例阿里国际站',attr:null,platform:'示例阿里国际站',active:true}];
    const 数据={users:[{id:'u1',name:'我自己',email:'a'}],要下一步:false,企业:{渠道们,节点们:['潜客培育','线索验证'],分配方式们:[{i:0,名:'指定分配'},{i:1,名:'自动分配'}],默认分配方式:0,是销售:!window.__市场,按区域:!!window.__市场,本人线:window.__本人线??null,客户只给自己:false}};
    function 页(){const [开,set开]=React.useState(true);return <建档弹窗 open={开} 标题={window.__标题||'新增客户'} 项目={window.__开关||'关'} 数据={数据} onClose={()=>set开(false)}/>;}
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'u1',name:'我自己'}}><页/></我Provider></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"', "process.env.CRM_ENTERPRISE": '"1"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(w: number, 设: Record<string, unknown> = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: w, height: 800 } }); page.setDefaultTimeout(5000);
  await page.route("http://npm.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://npm.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.evaluate((s) => { localStorage.clear(); Object.assign(window, s); }, 设);
  await page.addScriptTag({ content: bundle });
  await page.getByRole("dialog").getByText("首条沟通").first().waitFor();
  return page;
}
const 调 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? []);
const 选 = async (page: Page, 标签: string, 项: string) => {
  await page.getByRole("dialog").getByLabel(标签, { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").getByTitle(项, { exact: true }).click();
};

it("P1-2 新客户填客户地址（美国 / 洛杉矶）：国外不摆省；交的 企业资料 带国家和城市；市场成员分配方向按客户区域判外贸", async () => {
  const page = await 开(1280, { __开关: "锁开", __标题: "新线索", __市场: true, __本人线: "内贸" });
  try {
    const 框 = page.getByRole("dialog");
    expect(await 框.getByLabel("客户省").count()).toBe(1);
    await 框.getByLabel("客户国家地区").fill("美国");
    await page.keyboard.press("Escape");
    await expect.poll(() => 框.getByLabel("客户省").count()).toBe(0);
    await 框.getByLabel("客户市").fill("洛杉矶");
    await 选(page, "分配方式", "自动分配");
    await expect.poll(() => 框.getByTestId("wizard-direction-why").innerText()).toContain("按客户区域：外贸");
    await 框.getByLabel("号码", { exact: true }).fill("13905712266");
    await 框.getByLabel("客户名称").fill("示例美国公司");
    await 框.getByLabel("联系人姓名").fill("Tom");
    await 选(page, "渠道触点", "公司资源");
    await 框.getByLabel("项目名称").fill("示例美国公司-一期");
    await 框.getByLabel("沟通内容").fill("客户要报价");
    await 框.getByRole("button", { name: /^建\s*好/ }).click();
    await expect.poll(async () => (await 调(page)).find((x) => x[0] === "建档向导")).toBeTruthy();
    const 交 = (await 调(page)).find((x) => x[0] === "建档向导")![1] as { 客户: Record<string, unknown> };
    expect(交.客户.企业资料).toEqual({ addrCountry: "美国", addrProvince: null, addrCity: "洛杉矶" });
  } finally { await page.close(); }
});

it("P1-2 对照：国家空着填省市（浙江省 / 杭州市）交省市、分配方向内贸；地址三格都不填就不带 企业资料（只建客户照旧只带业务线）", async () => {
  const page = await 开(1280, { __开关: "锁开", __标题: "新线索", __市场: true, __本人线: "外贸" });
  try {
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("客户省").fill("浙江省");
    await 框.getByLabel("客户市").fill("杭州市");
    await 选(page, "分配方式", "自动分配");
    await expect.poll(() => 框.getByTestId("wizard-direction-why").innerText()).toContain("按客户区域：内贸");
    await 框.getByLabel("号码", { exact: true }).fill("13905712266");
    await 框.getByLabel("客户名称").fill("示例杭州公司");
    await 框.getByLabel("联系人姓名").fill("王总");
    await 选(page, "渠道触点", "公司资源");
    await 框.getByLabel("项目名称").fill("示例杭州公司-一期");
    await 框.getByLabel("沟通内容").fill("客户要报价");
    await 框.getByRole("button", { name: /^建\s*好/ }).click();
    await expect.poll(async () => (await 调(page)).find((x) => x[0] === "建档向导")).toBeTruthy();
    const 交 = (await 调(page)).find((x) => x[0] === "建档向导")![1] as { 客户: Record<string, unknown> };
    expect(交.客户.企业资料).toEqual({ addrCountry: null, addrProvince: "浙江省", addrCity: "杭州市" });
  } finally { await page.close(); }
  const 二 = await 开(1280);
  try {
    const 框 = 二.getByRole("dialog");
    await 框.getByLabel("号码", { exact: true }).fill("13905712267");
    await 框.getByLabel("客户名称").fill("示例无地址公司");
    await 框.getByLabel("联系人姓名").fill("李总");
    await 选(二, "渠道触点", "公司资源");
    await 选(二, "业务线", "内贸");
    await 框.getByLabel("沟通内容").fill("先建客户");
    await 框.getByRole("button", { name: /^建\s*好$/ }).click();
    await expect.poll(async () => (await 调(二)).find((x) => x[0] === "建档只建客户")).toBeTruthy();
    const 交 = (await 调(二)).find((x) => x[0] === "建档只建客户")![1] as { 客户: Record<string, unknown> };
    expect(交.客户.企业资料).toEqual({ bizLine: "内贸" });
  } finally { await 二.close(); }
});

it("P1-1 挑了老客户：摆「项目渠道」、默认是这位客户的来源渠道；没另选不交 channelId（服务端带客户来源）", async () => {
  const page = await 开(1280, { __开关: "开", __标题: "新增项目" });
  try {
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("客户名称").fill("华东");
    await page.locator(".ant-select-dropdown:visible").getByText("华东展具", { exact: false }).first().click();
    await 框.getByTestId("wizard-old-customer").waitFor();
    await 框.getByLabel("项目渠道").waitFor();
    await expect.poll(() => 框.locator("label", { has: page.getByLabel("项目渠道") }).innerText()).toContain("示例展会");
    expect(await 框.getByText("默认跟客户的渠道").count()).toBe(1);
    await 框.getByLabel("项目名称").fill("华东展具-二期");
    await 框.getByLabel("沟通内容").fill("老客户要加一套");
    await 框.getByRole("button", { name: /^建\s*好$/ }).click();
    await expect.poll(async () => (await 调(page)).find((x) => x[0] === "给客户建项目")).toBeTruthy();
    const 交 = (await 调(page)).find((x) => x[0] === "给客户建项目")![1] as { 项目: Record<string, unknown> };
    expect(交.项目.channelId).toBeUndefined();
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：客户地址三格 + 长城市名不横向溢出", async (w) => {
  const page = await 开(w, { __开关: "开" });
  try {
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("客户省").fill("新疆维吾尔自治区");
    await 框.getByLabel("客户市").fill("克孜勒苏柯尔克孜自治州阿图什市某某工业园区");
    const 量 = await page.evaluate(() => {
      const s = document.querySelector(".cr-sheet") as HTMLElement;
      const body = document.querySelector(".ant-modal-body") as HTMLElement;
      return { 表: s.scrollWidth - s.clientWidth, 体: body.scrollWidth - body.clientWidth, 页: document.documentElement.scrollWidth - window.innerWidth };
    });
    expect(量).toEqual({ 表: 0, 体: 0, 页: 0 });
  } finally { await page.close(); }
});
