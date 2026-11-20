/**
 * 列表筛选保持推到别的页（29R 推广，11-20 用户：「之前筛选栏的保持，对其他页面也一样」）。
 * 筛选在地址栏的（客户、公海、项目、线索）本来就跟着地址走，见 ent-cust-list-phone-state.ui.test.ts；
 * 这里是筛选放在本页 state 里的三张：点进客户详情再回来（重新挂上）、刷新，筛选、第几页、看法都还在，桌面宽和手机宽都一样。
 *   - 联系人：职位 / 角色筛选 + 浏览器里分页的第几页（DataList 回来还原）
 *   - 渠道：属性筛选 + 第几页
 *   - 跟进计划：「待办 / 已完成」「我的 / 全部成员」
 * 「回来」用整页重新加载模拟：组件重新挂上、sessionStorage 留着，和从详情页回来是同一条读的路。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser;
const 包: Record<"联系人" | "渠道" | "跟进", string> = { 联系人: "", 渠道: "", 跟进: "" };

const 打包 = async (name: string, stubs: [RegExp, string][], entry: string) => {
  const plugin: Plugin = { name, setup(b) {
    for (const [filter, code] of stubs) b.onResolve({ filter }, () => ({ path: name + String(filter), namespace: "stub", pluginData: code }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
  } };
  const r = await build({ stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  return r.outputFiles[0].text;
};
const 路由 = "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);";
const 壳头 = "import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';";
const 挂 = (x: string) => `createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS} timeZone={null}><我Provider value={{id:'me',name:'小王'}}>${x}</我Provider></BusinessProvider></App></ConfigProvider>);`;

beforeAll(async () => {
  包.联系人 = await 打包("keep-contacts", [
    [/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}"],
    [/^next\/navigation$/, 路由],
    [/\/ContactForm$/, "export default function F(){return null}"],
    [/\[id\]\/actions$/, "export const deleteUnassignedContact=async()=>({ok:true}),restoreContact=async()=>({ok:true});"],
    [/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;"],
  ], `${壳头}import Contacts from '@/app/(app)/contacts/ContactsView';
    const base={phone:null,email:null,wechat:null,isPrimary:false,remark:null,updatedAt:'2026-10-01T00:00:00.000Z',未归属:false,原来:null,customerId:'c',school:null,ownerName:'甲',ownerId:'a',ownerEmail:'a'};
    const rows=Array.from({length:30},(_,i)=>({...base,id:'k'+i,name:'联系人'+String(i+1).padStart(2,'0'),position:i<25?'采购':'财务',customerName:'某某公司'}));
    ${挂("<Contacts rows={rows} 总数={30} keyword='' 学员们={[]} users={[{id:'a',name:'甲',email:'a'}]}/>")}`);
  包.渠道 = await 打包("keep-channels", [
    [/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}"],
    [/^next\/navigation$/, 路由],
    [/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;"],
    [/^\.\/ChannelDrawer$/, "export default function D(){return null}"],
    [/^\.\/actions$/, "const f=async()=>({ok:true});export const saveChannel=f,toggleChannel=f,deleteChannel=f,saveMainChannel=f,toggleMainChannel=f,deleteMainChannel=f;"],
  ], `${壳头}import ChannelsView from '@/app/(app)/channels/ChannelsView';
    const users=[{id:'me',name:'小王',email:'s1',role:'ADMIN',active:true}];
    const 统={关联线索:1,有效线索:1,关联商机:0,关联订单:0,关联项目:1,累计成交:[],当前投入:[],产出比:null,产出比说明:'还没录投入',累计运营天数:3,线索转商机:{分子:0,分母:1,比例:0},商机转订单:{分子:0,分母:0,比例:null}};
    const 两位=(i)=>String(i).padStart(2,'0');
    const rows=Array.from({length:50},(_,i)=>({id:'c'+i,name:(i<30?'私域':'公域')+'|账号'+两位(i+1),phone:null,remark:null,active:true,attr:i<30?'私域运营':'公域引流',platform:'抖音',mainId:null,strategies:[],endDate:null,
      createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',createdByName:'QA',channelOwnerId:'me',channelOwnerName:'小王',统计:统}));
    ${挂("<ChannelsView rows={rows} users={users} 属性选项={['私域运营','公域引流']} 能管/>")}`);
  包.跟进 = await 打包("keep-plans", [
    [/^next\/navigation$/, 路由],
    [/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}"],
    [/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null")],
    [/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;"],
    [/(customers\/\[id\]\/|^\.\/)actions$/, "export const toggleTask=async()=>({ok:true}),completePlan=toggleTask,deletePlan=toggleTask,deleteTask=toggleTask,saveFollowUp=toggleTask,撤销记一笔=toggleTask,沟通可选项目=async()=>({ok:true,项目们:null,能建项目:true});"],
    [/customers\/\[id\]\/(PlanForm|TaskForm)$/, "export default function C(){return null}"],
  ], `${壳头}import PlansView from '@/app/(app)/follow-ups/plans/PlansView';
    const 老='2020-01-01T00:00:00.000Z';
    const 计划=(id,o,on)=>({id,subject:'回访'+id,plannedAt:老,plannedHasTime:true,method:'电话沟通',updatedAt:老,customerId:'c'+id,customerName:'客户'+id,ownerId:o,ownerName:on});
    const 做完=(k)=>({key:k,kind:'plan',标题:'做完'+k,方式:'电话沟通',计划时间:老,完成时间:老,customerId:'c1',customerName:'客户1',ownerId:'me',ownerName:'我'});
    ${挂("<PlansView meId='me' 全员={false} 预选客户={null} 直接新建={false} plans={[计划('p1','me','我'),计划('p2','u1','同事')]} tasks={[]} done={[做完('plan:d1')]} 项目下一步={[]}/>")}`);
  browser = await chromium.launch();
}, 180_000);
afterAll(async () => { await browser?.close(); });

async function 新页(宽: number, errors: string[]) {
  const page = await browser.newPage({ viewport: { width: 宽, height: 800 } });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://keep.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  return page;
}
async function 挂上(page: Page, 哪个: keyof typeof 包, 等: string) {
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: 包[哪个] });
  await page.locator(等).first().waitFor();
}
/** 重新挂上：整页重新加载（sessionStorage 留着）再把同一个组件挂上 */
async function 回来(page: Page, 哪个: keyof typeof 包, 等: string) {
  await page.reload();
  await 挂上(page, 哪个, 等);
}
const 行名 = (page: Page) => page.locator("tr.ant-table-row").allInnerTexts();
const 当前页 = (page: Page) => page.locator(".ant-pagination-item-active").innerText();
async function 选(page: Page, 占位: string, 项: string) {
  await page.locator(".ant-select", { hasText: 占位 }).first().click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: 项 }).first().click();
}

for (const 宽 of [1366, 375]) {
  it(`联系人（${宽} 宽）：职位筛「采购」翻到第 2 页 → 回来 / 刷新，筛选和第 2 页都在；重置后回来是全部 30 位`, async () => {
    const errors: string[] = [];
    const page = await 新页(宽, errors);
    try {
      await page.goto("http://keep.test/contacts");
      await 挂上(page, "联系人", "tr.ant-table-row");
      await 选(page, "全部职位 / 角色", "采购");
      await page.locator(".ant-pagination-item-2").click();
      await expect.poll(async () => (await 行名(page)).length).toBe(5);
      await 回来(page, "联系人", "tr.ant-table-row");
      await expect.poll(() => 当前页(page)).toBe("2");
      expect((await 行名(page)).length).toBe(5);
      expect((await 行名(page)).every((t) => t.includes("采购"))).toBe(true);
      expect(await page.locator(".ant-select", { hasText: "采购" }).count()).toBeGreaterThan(0);
      // 重置：回来是全部 30 位（第几页照旧留着，和不刷新时一样）
      await page.getByRole("button", { name: /重置/ }).click();
      await 回来(page, "联系人", "tr.ant-table-row");
      await expect.poll(() => page.locator(".ant-pagination-total-text").innerText()).toContain("30");
      expect(await page.locator(".ant-select", { hasText: "采购" }).count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

for (const 宽 of [1366, 375]) {
  it(`渠道（${宽} 宽）：属性筛「私域运营」翻到第 2 页 → 回来 / 刷新，筛选和第 2 页都在`, async () => {
    const errors: string[] = [];
    const page = await 新页(宽, errors);
    try {
      await page.goto("http://keep.test/channels");
      await 挂上(page, "渠道", "tr.ant-table-row");
      await 选(page, "全部属性", "私域运营");
      await page.locator(".ant-pagination-item-2").click();
      await expect.poll(async () => (await 行名(page)).length).toBe(10);
      await 回来(page, "渠道", "tr.ant-table-row");
      await expect.poll(() => 当前页(page)).toBe("2");
      const 名们 = await 行名(page);
      expect(名们.length).toBe(10);
      expect(名们.every((t) => t.includes("私域"))).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

for (const 宽 of [1366, 375]) {
  it(`跟进计划（${宽} 宽）：切到「已完成」「全部成员」→ 回来 / 刷新还在`, async () => {
    const errors: string[] = [];
    const page = await 新页(宽, errors);
    try {
      await page.goto("http://keep.test/follow-ups/plans");
      await 挂上(page, "跟进", ".plan-row");
      await page.locator(".ant-segmented-item", { hasText: "全部成员" }).click();
      await page.locator(".ant-segmented-item", { hasText: /^已完成/ }).click();
      await page.getByText("做完plan:d1").waitFor();
      await 回来(page, "跟进", ".ant-segmented");
      await page.getByText("做完plan:d1").waitFor();
      const 选中的 = await page.locator(".ant-segmented-item-selected").allInnerTexts();
      expect(选中的.map((t) => t.trim().replace(/\s*\d+$/, ""))).toEqual(["已完成", "全部成员"]);
      // 切回待办：回来还是待办，「全部成员」照旧
      await page.locator(".ant-segmented-item", { hasText: "待办" }).click();
      await 回来(page, "跟进", ".plan-row");
      expect((await page.locator(".ant-segmented-item-selected").allInnerTexts()).map((t) => t.trim())).toEqual(["待办", "全部成员"]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}
