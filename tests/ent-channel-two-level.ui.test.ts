/**
 * 渠道两层收尾（11-10，P-渠道-01 附.5）的排版：
 *
 *   客户列表「客户来源」只显示主渠道，不带「|」；悬停（title）看「主|子」全称。超长主渠道名一行省略，页面不横向撑出
 *   渠道页页头「按子渠道 / 按主渠道」：切到按主渠道，一行一个主渠道、带子渠道数；历史渠道、已停用的带标签，标签点得中；
 *   点主渠道名回到按子渠道
 *
 * 1024 / 1280 / 1366 三个宽度都量（scrollWidth 看横滚、elementFromPoint 看点不点得中）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const 长主 = "某某超长跨境电商直播间合作主渠道（华东区）".repeat(3);
const 长子 = "某某超长子渠道账号名字".repeat(3);
const plugin: Plugin = { name: "two-level-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\/ImportDrawer$/, "export default function D(){return null}");
  stub(/^\.\/export-client$/, "export const 完整导出=async()=>({ok:true});");
  stub(/^\.\/pool-actions$/, `const f=${空跑};export const 放进公海=f,领取=f,分配公海=f,撤销公海=f,退回原因选项=async()=>[];`);
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/CustomerPick$/, "export default function C(){return null}");
  stub(/projects\/new\/ProjectWizard$/, "export function 建档弹窗(){return null}");
  stub(/^\.\/ChannelDrawer$/, "export default function D(){return null}");
  stub(/^\.\.\/channels\/actions$/, `export const saveChannel=${空跑};`);
  // 客户页、渠道页各自的 ./actions 都落到这一份
  stub(/^(\.\/|\.\.\/)actions$/, `const f=${空跑};
    export const saveCustomer=f,checkDuplicate=async()=>null,推荐人候选=async()=>[],patchCustomer=f,assignSalesOwner=f,bulkFollowStatus=f,撤销改负责人=f,deleteCustomers=f,
    删除前清点=async()=>({}),客户删除预检=async()=>({ok:true}),转走项目预览of=async()=>({项目数:0,项目:[]}),供应商候选=async()=>[],
    saveChannel=f,toggleChannel=f,deleteChannel=f,saveMainChannel=f,toggleMainChannel=f;`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import CustomersView from '@/app/(app)/customers/CustomersView';import ChannelsView from '@/app/(app)/channels/ChannelsView';import TruncTip from '@/components/TruncTip';
    const root=createRoot(document.getElementById('root'));
    const 长主=${JSON.stringify(长主)},长子=${JSON.stringify(长子)};
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true}];
    const 壳=(x)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'me',name:'小王'}}><TruncTip/>{x}</我Provider></BusinessProvider></App></ConfigProvider>);
    window.__customers=()=>壳(<CustomersView rows={[{id:'c1',name:'张三',phone:'13800000001',school:null,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',salesOwnerId:'me',salesOwnerName:'小王',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:null,signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:'ch1',channelName:长主+'|'+长子,expectedSignAt:null,remark:null}]} total={1} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{}} 能导入导出 客户数={1} 企业版/>);
    const 统=(n)=>({关联线索:n,有效线索:n,关联商机:1,关联订单:0,关联项目:n,累计成交:[],当前投入:[],产出比:null,产出比说明:'还没录投入',累计运营天数:3,线索转商机:{分子:1,分母:n,比例:1/n},商机转订单:{分子:0,分母:0,比例:null}});
    const 行=(id,name,platform,mainId,active,n)=>({id,name,phone:null,remark:null,active,attr:'公域引流',platform,mainId,strategies:[],endDate:null,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',createdByName:'QA',channelOwnerId:'me',channelOwnerName:'小王',统计:统(n)});
    const 主们=[{id:'m1',name:长主,allowSub:true,selfDev:false,category:'三方平台',active:true,sort:1},{id:'m2',name:'旧平台'+长主,allowSub:true,selfDev:false,category:'历史渠道',active:true,sort:2},{id:'m3',name:'停了的主渠道',allowSub:true,selfDev:false,category:null,active:false,sort:3}];
    const rows=[行('a',长主+'|'+长子,长主,'m1',true,2),行('b',长主+'|另一个账号',长主,'m1',true,3),行('c','旧平台'+长主+'|某账号','旧平台'+长主,'m2',true,1),行('d','停了的主渠道','停了的主渠道','m3',true,1)];
    window.__channels=()=>壳(<ChannelsView rows={rows} users={users} 属性选项={['公域引流']} 能管 主渠道们={主们} 两层/>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(what: "__customers" | "__channels", width: number) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://src.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://src.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate((w) => (window as unknown as Record<string, () => void>)[w](), what);
  await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor();
  return { page, errors };
}
const 页不横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
/** 元素中心点上最顶层的是不是它自己（或它里面的东西） */
const 点得中 = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((el) => {
  const r = el.getBoundingClientRect();
  const 中 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!中 && (el === 中 || el.contains(中));
}));

for (const width of [1024, 1280, 1366]) {
  it(`客户来源只显示主渠道、不带竖线，悬停看全称；一行省略不撑出页面（${width} 宽）`, async () => {
    const { page, errors } = await open("__customers", width);
    try {
      await page.getByRole("button", { name: "选择要显示的列" }).click();
      await page.locator(".ant-dropdown").getByText("客户来源", { exact: true }).click();
      await page.keyboard.press("Escape");
      const 格 = page.locator(`.ant-table-tbody span[title="${长主}|${长子}"]`);
      await expect.poll(() => 格.count()).toBe(1);
      const 量 = await 格.evaluate((el) => ({ 字: el.textContent, 一行: el.getBoundingClientRect().height < 30, 省略: el.scrollWidth > el.clientWidth }));
      expect(量).toEqual({ 字: 长主, 一行: true, 省略: true });
      expect(量.字).not.toMatch(/[|｜]/);
      await 格.scrollIntoViewIfNeeded();
      expect(await 点得中(page, `.ant-table-tbody span[title="${长主}|${长子}"]`)).toEqual([true]);
      expect(await 页不横滚(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it(`渠道页切「按主渠道」：一行一个主渠道、带子渠道数和历史 / 停用标签，点得中、不撑出页面；点名字回到按子渠道（${width} 宽）`, async () => {
    const { page, errors } = await open("__channels", width);
    try {
      const 口径 = page.getByRole("radiogroup", { name: "统计口径" }).or(page.locator("[aria-label='统计口径']")).first();
      expect(await 点得中(page, "[aria-label='统计口径'] .ant-segmented-item")).toEqual([true, true]);
      await 口径.getByText("按主渠道").click();
      await expect.poll(() => page.locator(".chan-list .ant-table-thead th").allInnerTexts()).toContain("子渠道数");
      const 行们 = page.locator(".chan-list .ant-table-tbody tr.ant-table-row");
      expect(await 行们.count()).toBe(3);
      const 首行 = await 行们.first().locator("td").allInnerTexts();
      expect(首行.some((t) => t.includes("2") && t.trim() === "2")).toBe(true);
      // 历史渠道、已停用两个标签都在格里、一行、点得中
      const 标签 = page.locator(".chan-list .ant-table-tbody .chan-tags .ant-tag");
      expect(await 标签.allInnerTexts()).toEqual(["历史渠道", "已停用"]);
      const 标签量 = await 标签.evaluateAll((els) => els.map((el) => {
        const r = el.getBoundingClientRect(); const td = el.closest("td")!.getBoundingClientRect();
        return r.left >= td.left - 0.5 && r.right <= td.right + 0.5 && r.height < 30;
      }));
      expect(标签量).toEqual([true, true]);
      expect(await 点得中(page, ".chan-list .ant-table-tbody .chan-tags .ant-tag")).toEqual([true, true]);
      // 名字一行，超长的省略
      const 名 = await page.locator(".chan-list .ant-table-tbody .chan-name").evaluateAll((els) => els.map((el) => ({ 一行: el.getBoundingClientRect().height < 30, 在格里: el.getBoundingClientRect().right <= el.closest("td")!.getBoundingClientRect().right + 0.5 })));
      expect(名.every((x) => x.一行 && x.在格里)).toBe(true);
      expect(await 页不横滚(page)).toBe(true);
      // 点主渠道名 → 回到按子渠道，只看这个主渠道下的
      await page.locator(".chan-list .ant-table-tbody .chan-name").first().click();
      await expect.poll(() => page.locator(".chan-list .ant-table-thead th").allInnerTexts()).not.toContain("子渠道数");
      await expect.poll(() => 行们.count()).toBe(2);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}
