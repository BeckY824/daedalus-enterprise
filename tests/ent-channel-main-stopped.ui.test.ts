/**
 * 渠道页：主渠道停用的界面（11-17 客户报，服务端见 ent-channel-main-stopped.test.ts）
 *
 *   按子渠道：子渠道自己开着、主渠道停了 → 渠道属性那格写「已停用」、整行压淡（和「主渠道」弹窗里那一行对得上），
 *     「⋯」里的启用灰掉、写去「主渠道」里启用；状态筛「已启用」不出它、筛「已停用」出它；详情写「停用（主渠道已停用）」
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "main-stopped-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  // 详情抽屉照真的画（要看渠道状态那一格），投入记录那几个调用给空
  stub(/^\.\/actions$/, `const 记=(名)=>async(...x)=>{(window.__存=window.__存||[]).push([名,...x]);return{ok:true,id:'x'}};
    export const saveChannel=记('saveChannel'),toggleChannel=记('toggleChannel'),deleteChannel=记('deleteChannel'),saveMainChannel=记('saveMainChannel'),toggleMainChannel=记('toggleMainChannel'),deleteMainChannel=记('deleteMainChannel');
    export const listChannelInvests=async()=>({ok:true,rows:[],能录:false}),addChannelInvest=记('addChannelInvest'),deleteChannelInvest=记('deleteChannelInvest');`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import ChannelsView from '@/app/(app)/channels/ChannelsView';
    const root=createRoot(document.getElementById('root'));
    const users=[{id:'me',name:'小王',email:'s1',role:'ADMIN',active:true}];
    const 统={关联线索:0,有效线索:0,关联商机:0,关联订单:0,关联项目:0,累计成交:[],当前投入:[],产出比:null,产出比说明:'还没录投入',累计运营天数:3,线索转商机:{分子:0,分母:0,比例:null},商机转订单:{分子:0,分母:0,比例:null}};
    const 行=(id,name,platform,mainId,active)=>({id,name,phone:null,remark:null,active,attr:'公域引流',platform,mainId,strategies:[],endDate:null,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',createdByName:'QA',channelOwnerId:'me',channelOwnerName:'小王',统计:统,客户数:0,投入数:0,项目数:0});
    const 主=(id,name,active)=>({id,name,allowSub:false,selfDev:false,category:null,active,sort:0,ownerId:null,ownerName:null,attr:null});
    // 停了的主渠道「门店甲」下挂着一个自己开着的同名单一入口；「抖音」正常；「空主渠道」下一个渠道都没有
    const 主们=[主('m1','门店甲',false),主('m2','抖音',true),主('m3','空主渠道',false)];
    const rows=[行('a','门店甲','门店甲','m1',true),行('b','抖音|官方号','抖音','m2',true)];
    window.__channels=()=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'me',name:'小王'}}>
      <ChannelsView rows={rows} users={users} 属性选项={['公域引流']} 能管 主渠道们={主们} 两层/>
    </我Provider></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open() {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://stopped.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://stopped.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as { __channels: () => void }).__channels());
  await page.locator(".chan-list .ant-table-tbody tr.ant-table-row").first().waitFor();
  return { page, errors };
}
const 列表行 = (page: Page, 名: string) => page.locator(".chan-list .ant-table-tbody tr.ant-table-row", { hasText: 名 }).first();
const 列表名们 = (page: Page) => page.locator(".chan-list .ant-table-tbody tr.ant-table-row .chan-name").allInnerTexts();
/** 状态筛选（两层时收在「更多筛选」里）选一项 */
async function 筛状态(page: Page, 值: string) {
  const 下拉 = page.locator(".ant-select:visible", { has: page.locator("[aria-label='状态']") });
  if (!(await 下拉.count())) await page.getByRole("button", { name: /^更多筛选/ }).click();
  await 下拉.first().click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: 值 }).click();
}
const 存了 = (page: Page) => page.evaluate(() => (window as unknown as { __存?: unknown[] }).__存 ?? []);

it("主渠道停了、子渠道自己开着：列表写已停用、压淡；⋯ 里启用灰掉；状态筛选按眼下的；详情写主渠道已停用", async () => {
  const { page, errors } = await open();
  try {
    const 门店 = 列表行(page, "门店甲");
    expect(await 门店.getAttribute("class")).toContain("row-off");
    expect(await 门店.locator(".chan-tags").innerText()).toContain("已停用");
    expect(await 列表行(page, "抖音|官方号").getAttribute("class")).not.toContain("row-off");
    expect(await 列表行(page, "抖音|官方号").innerText()).not.toContain("已停用");

    await 门店.getByRole("button", { name: "更多操作 门店甲" }).click();
    const 启用项 = page.locator(".ant-dropdown:visible .ant-dropdown-menu-item", { hasText: "启用" });
    await 启用项.waitFor();
    expect(await 启用项.getAttribute("class")).toContain("ant-dropdown-menu-item-disabled");
    expect(await 启用项.innerText()).toContain("主渠道「门店甲」已停用，先到「主渠道」里启用");
    await 启用项.click({ force: true });
    expect(await 存了(page)).toEqual([]);
    await page.keyboard.press("Escape");

    // 状态筛选：已启用不出它，已停用出它
    await 筛状态(page, "已启用");
    await expect.poll(() => 列表名们(page)).toEqual(["抖音|官方号"]);
    await 筛状态(page, "已停用");
    await expect.poll(() => 列表名们(page)).toEqual(["门店甲"]);
    await page.keyboard.press("Escape");

    await 列表行(page, "门店甲").locator(".chan-name").click();
    const 抽屉 = page.locator(".ant-drawer");
    await 抽屉.waitFor();
    expect(await 抽屉.locator(".ant-drawer-title").innerText()).toContain("已停用");
    expect(await 抽屉.locator(".ant-descriptions-item", { hasText: "渠道状态" }).innerText()).toContain("停用（主渠道已停用）");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
