/**
 * 11-18 审核第四波追加的界面（1024 / 1280 / 1366，都不横向撑出）：
 *   - 列表批量转让框（TransferDialog）指定分配也先定方向（P-转-26，第 13 条）：预看给了定向才摆方向格，下拉只列这个方向能接的人；
 *     换方向把不合的人清掉；交上去带方向；默认挑的（上次转给的）不在这个方向里也清掉
 *   - 统计卡小字另有去处（统计 P2-2）：「公海里还有 N 个进行中的项目」单独一个链接去 /pool，不套进卡身链接（不嵌套 <a>）
 *   - 列表页脚写单位（统计 P2-2，公海页）：给了 单位 就替换「共 N 条」
 *   - 首页（没配 AI）摆待复核（节点 P2-3）：VerifyInbox 在首页待办区
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, 包: string;
const 桩: Plugin = { name: "wave4b", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__push=u},replace(){},prefetch(){}});export const usePathname=()=>'/x';export const useSearchParams=()=>new URLSearchParams('');");
  stub(/^next\/link$/, "export default function L({prefetch,scroll,replace,href,...p}){return <a href={href} {...p}/>}");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/leads\/assign-actions$|^\.\/assign-actions$/, 补全动作桩("src/app/(app)/leads/assign-actions.ts", "export const 关满额提醒=async()=>({ok:true});"));
  stub(/projects\/actions$|^\.\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "export const 市场复核Action=async()=>({ok:true}),总管理终判Action=async()=>({ok:true});"));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  包 = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import TransferDialog from '@/app/(app)/customers/TransferDialog';
    import {StatCard} from '@/components/ui';
    import DataList from '@/components/DataList';
    import NoAiHome from '@/app/(app)/dashboard/NoAiHome';
    import VerifyInbox from '@/app/(app)/projects/VerifyInbox';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 壳=(x)=><ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><div className='main app-content'>{x}</div></BusinessProvider></App></ConfigProvider>;
    const 长='某某超长贸易进出口有限公司'.repeat(4);
    window.__转=({定向})=>root.render(壳(<TransferDialog open onClose={()=>{}} 题={'把 2 位客户转给'} 人们={[{value:'u2',label:'内贸小张'},{value:'u3',label:'外贸小李'},{value:'u4',label:'外贸管'+长}]}
      原因选项={['客户迁移','其他']} 自己='qa' 做={(id,因,向)=>{window.__做={id,因,...(向?{向}:{})};return {ok:true}}}
      自动={{预看:async()=>({可:0,不可:[],...(定向?{定向}:{})}),做:async()=>({ok:false,error:'桩'})}}/>));
    window.__卡=()=>root.render(壳(<div className='stat-grid'><StatCard icon={null} color='var(--brand)' label='异常项目' value={3} href='/projects?x=1' note='公海里还有 4 个进行中的项目' noteHref='/pool'/></div>));
    window.__表=({项目})=>root.render(壳(<DataList 页='wave4b' 列={[{title:'名',key:'name',常驻:true,render:(_,r)=>r.name}]} 行={[{id:'a',name:长},{id:'b',name:'乙'}]} 空库={false} 空态={{title:'空'}}
      分页={{当前页:1,每页:20,总数:2,翻页:()=>{},单位:(n)=>项目?<>{n} 行：客户 1 位、项目 1 个</>:<>{n} 位客户</>}}/>));
    window.__首页=()=>root.render(壳(<NoAiHome 管理员={false} 待复核={<VerifyInbox 们={[{projectId:'p1',项目:长,负责人:'小王',步:'市场复核',无效原因:'空号',初判说明:null,复核说明:null,异议说明:null,更新于:'2026-11-18T10:00:00.000Z'}]}/>}/>));
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(画: string, 参: unknown, width: number, 上次?: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 860 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://wave4b.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://wave4b.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  if (上次) await page.evaluate(v => localStorage.setItem("cust-transfer-last", v), 上次);
  await page.addScriptTag({ content: 包 });
  await page.evaluate(([f, x]) => (window as unknown as Record<string, (x: unknown) => void>)[f as string](x), [画, 参] as const);
  return { page, errors };
}
const 不横溢 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const 下拉项 = async (page: Page) => (await page.locator(".ant-select-dropdown:visible .ant-select-item-option").allInnerTexts()).map(x => x.trim());

it("批量转让框：预看给了定向——方向格默认内贸、下拉只列内贸能接的；改外贸只列外贸销售（不含外贸销售管理）、清掉不合的人；交上去带方向", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 开("__转", { 定向: { 候选表: { 内贸: ["u2"], 外贸: ["u3"] }, 默认线: "内贸" } }, w);
    try {
      const 框 = page.getByRole("dialog");
      await 框.getByTestId("transfer-direction-row").waitFor();
      expect(await 框.getByTestId("transfer-direction-why").innerText()).toContain("只能指定给内贸事业部的销售、销售管理");
      await 框.getByRole("combobox", { name: "转给谁" }).click();
      await expect.poll(() => 下拉项(page)).toEqual(["内贸小张"]);
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: "内贸小张" }).click();
      await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
      await 框.getByTestId("transfer-direction").click();
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: /^外贸$/ }).click();
      expect(await 框.getByTestId("transfer-direction-why").innerText()).toContain("你改成了外贸");
      expect(await 框.getByTestId("transfer-direction-why").innerText()).toContain("不含外贸销售管理");
      expect(await 框.locator(".ant-select-selection-item").filter({ hasText: "内贸小张" }).count()).toBe(0);
      await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
      await 框.getByRole("combobox", { name: "转给谁" }).click();
      await expect.poll(() => 下拉项(page)).toEqual(["外贸小李"]);
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: "外贸小李" }).click();
      const 原因 = 框.getByRole("radiogroup", { name: /转让原因/ });
      if (await 原因.count()) await 原因.getByRole("radio", { name: "客户迁移" }).click();
      await 框.getByRole("button", { name: /转给|转\s*让|确\s*定/ }).last().click();
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__做") ?? null)).toMatchObject({ id: "u3", 向: "外贸" });
      expect(await 不横溢(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("批量转让框：上次转给的人不在默认方向里——不默认带着他；没给定向（不是市场成员要按方向指定的）不摆方向格、全列", async () => {
  const 有 = await 开("__转", { 定向: { 候选表: { 内贸: ["u2"], 外贸: ["u3"] }, 默认线: "内贸" } }, 1280, "u4");
  try {
    const 框 = 有.page.getByRole("dialog");
    await 框.getByTestId("transfer-direction-row").waitFor();
    await expect.poll(() => 框.locator(".ant-select-selection-item").filter({ hasText: "外贸管" }).count()).toBe(0);
    expect(有.errors).toEqual([]);
  } finally { await 有.page.close(); }
  const 无 = await 开("__转", {}, 1280);
  try {
    const 框 = 无.page.getByRole("dialog");
    await 框.getByRole("combobox", { name: "转给谁" }).click();
    await expect.poll(() => 下拉项(无.page)).toHaveLength(3);
    expect(await 框.getByTestId("transfer-direction-row").count()).toBe(0);
    expect(无.errors).toEqual([]);
  } finally { await 无.page.close(); }
});

it("统计卡小字另有去处：卡身去明细、「公海里还有 N 个进行中的项目」单独去 /pool，没有嵌套链接", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 开("__卡", null, w);
    try {
      const 小字 = page.getByRole("link", { name: "公海里还有 4 个进行中的项目" });
      await 小字.waitFor();
      expect(await 小字.getAttribute("href")).toBe("/pool");
      expect(await page.getByRole("link", { name: /异常项目：3，查看明细/ }).getAttribute("href")).toBe("/projects?x=1");
      expect(await page.locator("a a").count()).toBe(0);
      expect(await 不横溢(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("列表页脚写单位：只有客户行写「N 位客户」，有项目行写「N 行：客户 X 位、项目 Y 个」", async () => {
  for (const w of [1024, 1280, 1366]) {
    for (const 项目 of [false, true]) {
      const { page, errors } = await 开("__表", { 项目 }, w);
      try {
        const 脚 = page.locator(".ant-pagination-total-text");
        await 脚.waitFor();
        await expect.poll(() => 脚.innerText()).toBe(项目 ? "2 行：客户 1 位、项目 1 个" : "2 位客户");
        expect(await 不横溢(page)).toBe(true);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }
  }
});

it("首页（没配 AI）待办区摆待复核：项目名、这一步要我做什么；超长项目名不撑出", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 开("__首页", null, w);
    try {
      await page.getByText("等你复核").first().waitFor();
      expect(await page.locator("body").innerText()).toContain("某某超长贸易进出口有限公司");
      expect(await 不横溢(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
