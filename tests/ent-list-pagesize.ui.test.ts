/**
 * 底部「条/页」换了要真的生效（11-17 渠道页报上来：选别的每页条数没反应）。
 *
 * 根因：分页对象里写死 pageSize，antd 把它当受控值，换了每页条数下一轮又被写死的值盖回去。
 *   - DataList 在浏览器里分页那一支（渠道页按子渠道 / 按主渠道、联系人、旧线索页都走它）：原来 pageSize: 20
 *   - 「我分出去的线索」弹窗（pageSize: 10）、导入第 3 步「要你确认的格子」（pageSize: 8）：
 *     超过 50 条 antd 自己摆出「条/页」，同样换了不生效
 *
 * 每张表：多于一页的行 → 默认那么多行；换一个每页条数 → 行数跟着变；在后面的页上换每页条数 → 回第一页
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "pagesize-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/ChannelDrawer$/, "export default function D(){return null}");
  const 空跑 = "async()=>({ok:true})";
  stub(/^\.\/actions$/, `const f=${空跑};export const saveChannel=f,toggleChannel=f,deleteChannel=f,saveMainChannel=f,toggleMainChannel=f,deleteMainChannel=f;`);
  // 「我分出去的线索」：60 条
  stub(/^\.\/assign-actions$/, `const f=${空跑};
    export const 分配线索=f,批量自动分配=f,本月分配情况=f,项目分配线=f,分配带走的项目=f;
    export const 我分出去的线索=async()=>Array.from({length:60},(_,i)=>({leadId:null,projectId:'p'+i,name:'分出去的第'+(i+1)+'条',status:'NEW',convertedAt:null,customerId:null,接手人:'小李',当前负责人:'小李',line:null,kind:'营销',分配时间:'2026-11-01T00:00:00.000Z'}));`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import ChannelsView from '@/app/(app)/channels/ChannelsView';
    import {AssignedOutButton} from '@/app/(app)/leads/AssignLead';
    import {复核} from '@/app/(app)/customers/import-steps';
    import {字段表} from '@/lib/import/fields';
    const root=createRoot(document.getElementById('root'));
    const 壳=(x)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'me',name:'小王'}}>{x}</我Provider></BusinessProvider></App></ConfigProvider>);
    const users=[{id:'me',name:'小王',email:'s1',role:'ADMIN',active:true}];
    const 统={关联线索:1,有效线索:1,关联商机:0,关联订单:0,关联项目:1,累计成交:[],当前投入:[],产出比:null,产出比说明:'还没录投入',累计运营天数:3,线索转商机:{分子:0,分母:1,比例:0},商机转订单:{分子:0,分母:0,比例:null}};
    const 两位=(i)=>String(i).padStart(2,'0');
    // 25 个子渠道挂在一个主渠道下；另有 25 个一个子渠道都没有的主渠道（按主渠道看共 26 行）
    const rows=Array.from({length:25},(_,i)=>({id:'c'+i,name:'抖音|账号'+两位(i+1),phone:null,remark:null,active:true,attr:'公域引流',platform:'抖音',mainId:'m0',strategies:[],endDate:null,
      createdAt:'2026-10-'+两位(28-i)+'T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',createdByName:'QA',channelOwnerId:'me',channelOwnerName:'小王',统计:统}));
    const 主=(id,name)=>({id,name,allowSub:true,selfDev:false,category:null,active:true,sort:0,ownerId:null,ownerName:null,attr:null});
    const 主们=[主('m0','抖音'),...Array.from({length:25},(_,i)=>主('m'+(i+1),'空主渠道'+两位(i+1)))];
    window.__channels=()=>壳(<ChannelsView rows={rows} users={users} 属性选项={['公域引流']} 能管 主渠道们={主们} 两层/>);
    window.__assigned=()=>壳(<AssignedOutButton/>);
    const 待复核=Array.from({length:60},(_,i)=>({列:3,列名:'客户等级',字段:'level',原值:'写法'+(i+1),说法:'读不懂',严重:'默认',几行:1}));
    window.__review=()=>壳(<复核 看={{待复核,挡下:[],进不了:0}} 改过={{}} set改过={()=>{}} 表={字段表(DEFAULT_BUSINESS)}/>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(画: string) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://pagesize.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://pagesize.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate((f) => (window as unknown as Record<string, () => void>)[f](), 画);
  return { page, errors };
}
const 行数 = (page: Page) => page.locator(".ant-table-tbody tr.ant-table-row").count();
const 首行 = (page: Page) => page.locator(".ant-table-tbody tr.ant-table-row").first().innerText();
/** 底部「条/页」下拉选一项 */
async function 选每页(page: Page, 条: number) {
  await page.locator(".ant-pagination-options .ant-select").click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: `${条} 条/页` }).click();
}
const 当前页 = (page: Page) => page.locator(".ant-pagination-item-active").innerText();

it("渠道页按子渠道：25 个渠道默认 20 行，换 50 条/页出全部 25 行、换 10 条/页剩 10 行；在第 2 页换每页条数回第一页", async () => {
  const { page, errors } = await open("__channels");
  try {
    await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor();
    expect(await 行数(page)).toBe(20);
    await 选每页(page, 50);
    await expect.poll(() => 行数(page)).toBe(25);
    await 选每页(page, 10);
    await expect.poll(() => 行数(page)).toBe(10);
    // 翻到第 2 页再换每页条数：回第一页（不停在第 2 页）
    await page.locator(".ant-pagination-item-2").click();
    await expect.poll(() => 首行(page)).toContain("账号11");
    await 选每页(page, 20);
    await expect.poll(() => 行数(page)).toBe(20);
    expect(await 当前页(page)).toBe("1");
    expect(await 首行(page)).toContain("账号01");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("渠道页按主渠道：26 个主渠道默认 20 行，换 50 条/页出全部 26 行", async () => {
  const { page, errors } = await open("__channels");
  try {
    await page.getByText("按主渠道", { exact: true }).click();
    await page.locator(".ant-table-tbody tr.ant-table-row", { hasText: "空主渠道01" }).waitFor();
    expect(await 行数(page)).toBe(20);
    await 选每页(page, 50);
    await expect.poll(() => 行数(page)).toBe(26);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("「我分出去的线索」60 条：默认 10 行，换 20 条/页出 20 行", async () => {
  const { page, errors } = await open("__assigned");
  try {
    await page.getByRole("button", { name: "我分出去的" }).click();
    await page.locator(".ant-modal .ant-table-tbody tr.ant-table-row").first().waitFor();
    expect(await 行数(page)).toBe(10);
    await 选每页(page, 20);
    await expect.poll(() => 行数(page)).toBe(20);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("导入「要你确认的格子」60 条：默认 8 行，换 20 条/页出 20 行", async () => {
  const { page, errors } = await open("__review");
  try {
    await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor();
    expect(await 行数(page)).toBe(8);
    await 选每页(page, 20);
    await expect.poll(() => 行数(page)).toBe(20);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
