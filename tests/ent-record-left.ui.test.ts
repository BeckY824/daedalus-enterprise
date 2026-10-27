import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* 10-27 会议：企业版客户页左栏——联系人一人一卡、电话 / 邮箱 / 微信完整显示可点，空字段收起，推荐 / 报价 / 签约不摆（纪要：客户页仅保留基础信息、联系人、关联项目三类）。
   开关关闭（不传 项目们）时左栏保持原样 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "record-left-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)InlineField$/, "export default function Inline(p){return <div className='rec-field' data-field={p.field}>{p.label}: {p.value}</div>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(^|\/)(TaskForm|PlanForm|ContactForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick)$/, "export default function Empty(){return null}");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({问怎么拿掉(){}});");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海;");
  stub(/^\.\.\/actions$/, "export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]});");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null});");
  stub(/^\.\/actions$/, `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,saveFollowUp=toggleTask,deleteFollowUp=toggleTask,restoreFollowUp=toggleTask;
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
  `);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Record from '@/app/(app)/customers/[id]/RecordView';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 长='超长联系人名字'.repeat(6);
    const contacts=[
      {id:'c1',name:长,position:'采购总监兼华东大区负责人',phone:'+86 138-0013-8000',email:'very.long.mailbox.name.for.purchasing@example-supplier-company.com',wechat:'wx_buyer_2026',isPrimary:true,remark:null,updatedAt:'2026-01-01T00:00:00.000Z'},
      {id:'c2',name:'李四',position:null,phone:'138****8001',email:null,wechat:null,isPrimary:false,remark:null,updatedAt:'2026-01-01T00:00:00.000Z'},
      {id:'c3',name:'王五',position:'前台',phone:null,email:null,wechat:null,isPrimary:false,remark:null,updatedAt:'2026-01-01T00:00:00.000Z'},
    ];
    const contracts=[{id:'k1',amount:12000,currency:'CNY',signedAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z'}];
    window.__render=(企业)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><Record customer={{id:'a',extra:null,name:'客户A',phone:'13800138000',school:'某某学校',grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z'}} contacts={contacts} contracts={contracts} opportunities={[]} tasks={[]} plan={null} users={[]} channels={[]} aiEnabled={false} followUps={[]} followUpsHasMore={false} {...(企业?{项目们:[],旺旺们:['ww_buyer']}:{})}/></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(企业: boolean, width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  await page.route("http://left.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://left.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(e => (window as unknown as { __render: (x: boolean) => void }).__render(e), 企业);
  await page.getByText("联系人", { exact: false }).first().waitFor();
  return page;
}
it("企业版：联系人一人一卡，电话 / 邮箱 / 微信都在、可点；打码号不加链接；没留的写明", async () => {
  const page = await open(true);
  try {
    const cards = page.locator(".rec-contact");
    expect(await cards.count()).toBe(3);
    const first = cards.nth(0);
    expect(await first.innerText()).toContain("采购总监兼华东大区负责人");
    expect(await first.getByRole("link", { name: "+86 138-0013-8000" }).getAttribute("href")).toBe("tel:+8613800138000");
    expect(await first.getByRole("link", { name: /very\.long\.mailbox/ }).getAttribute("href")).toBe("mailto:very.long.mailbox.name.for.purchasing@example-supplier-company.com");
    expect(await first.innerText()).toContain("wx_buyer_2026");
    expect(await cards.nth(1).innerText()).toContain("138****8001");
    expect(await cards.nth(1).getByRole("link").count()).toBe(0);
    expect(await cards.nth(2).innerText()).toContain("没留联系方式");
    // 客户电话也能拨；旺旺 ID 摆出来
    expect(await page.getByRole("link", { name: "13800138000" }).getAttribute("href")).toBe("tel:13800138000");
    expect(await page.getByText("ww_buyer").count()).toBe(1);
  } finally { await page.close(); }
});
it("企业版：空字段收起、「展开更多」能展开；没有签约、推荐关系；1024 宽不横滚", async () => {
  const page = await open(true, 1024);
  try {
    expect(await page.locator("[data-field='remark']").count()).toBe(0);
    expect(await page.locator("[data-field='school']").count()).toBe(1);
    const more = page.getByRole("button", { name: /展开更多 \d+ 项/ });
    await more.click();
    expect(await page.locator("[data-field='remark']").count()).toBe(1);
    await page.getByRole("button", { name: "收起没填的" }).click();
    expect(await page.locator("[data-field='remark']").count()).toBe(0);
    expect(await page.getByText("登记签约").count()).toBe(0);
    expect(await page.getByText("推荐人").count()).toBe(0);
    expect(await page.getByRole("button", { name: /^更多：/ }).count()).toBe(0);
    const aside = page.locator("aside").first();
    expect(await aside.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  } finally { await page.close(); }
});
it("开关关闭：左栏照旧——一行一个联系人、空字段都在、签约直接摆着、没有「更多」", async () => {
  const page = await open(false);
  try {
    expect(await page.locator(".rec-contact").count()).toBe(0);
    expect(await page.locator(".rec-mini").filter({ hasText: "李四" }).count()).toBe(1);
    expect(await page.locator("[data-field='remark']").count()).toBe(1);
    expect(await page.getByRole("button", { name: /展开更多/ }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /^更多：/ }).count()).toBe(0);
    expect(await page.getByText("登记签约").count()).toBe(1);
    expect(await page.getByRole("link", { name: "13800138000" }).count()).toBe(0);
    expect(await page.getByText("ww_buyer").count()).toBe(0);
  } finally { await page.close(); }
});
