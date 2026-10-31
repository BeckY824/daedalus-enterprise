import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* 10-27 会议：企业版客户页左栏——联系人一人一卡、电话 / 邮箱 / 微信完整显示可点，空字段收起，推荐 / 报价 / 签约不摆（纪要：客户页仅保留基础信息、联系人、关联项目三类）。
   开关关闭（不传 项目们）时左栏保持原样 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "record-left-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;");
  stub(/(^|\/)InlineField$/, "export default function Inline(p){return <div className='rec-field' data-field={p.field}>{p.label}: {p.value}</div>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>\"/customers/x\";");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(^|\/)(TaskForm|PlanForm|ContactForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|LinkedCustomers|NewProjectModal|ContactLinks)$/, "export default function Empty(){return null}");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({问怎么拿掉(){}});");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海;");
  stub(/^\.\.\/actions$/, "export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false});");
  stub(/^\.\/useCustomerResearch$/, "export function CustomerResearchCard(){return null}");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  stub(/projects\/actions$/, "export const 项目沟通须知=async()=>(window.__须知??{ok:true,能记:false}),记项目沟通Action=async(id,x)=>{window.__项目存={id,...x};return{ok:true,followUpId:'f1',自动推到:window.__推到}};");
  stub(/^\.\/actions$/, `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,saveFollowUp=toggleTask,deleteFollowUp=toggleTask,restoreFollowUp=toggleTask;
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
  
    export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'p1'});`);
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
    const 长项目='超长项目名称用来看会不会把菜单撑破'.repeat(3);
    const p14={
      跟进去处:[{id:'p1',名:长项目,主:true,结束:false,说明:null,下一步:'2026-10-30T02:00:00.000Z'},{id:'p2',名:'关联进来的项目',主:false,结束:true,说明:'已结束',下一步:null}],
      待办计划:[{id:'fp1',subject:'回访报价',plannedAt:'2026-10-31T02:00:00.000Z',plannedHasTime:false}],
      followUps:[
        {id:'f2',type:'PHONE',title:'项目里的沟通',content:'谈了交期',status:'已完成',duration:null,occurredAt:'2026-10-20T02:00:00.000Z',dueAt:null,participants:null,sourceText:null,ownerName:'QA',contactName:null,contactPosition:null,contactId:null,opportunityId:null,updatedAt:'2026-10-20T02:00:00.000Z',项目:{id:'p1',名:长项目}},
        {id:'f1',type:'EMAIL',title:'客户本身的老跟进',content:'老记录',status:'已完成',duration:null,occurredAt:'2026-10-01T02:00:00.000Z',dueAt:null,participants:null,sourceText:null,ownerName:'QA',contactName:null,contactPosition:null,contactId:null,opportunityId:null,updatedAt:'2026-10-01T02:00:00.000Z',项目:null},
      ],
    };
    window.__render=(企业,项目模式,加)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><Record customer={{id:'a',extra:null,name:'客户A',phone:'13800138000',school:'某某学校',grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z'}} contacts={contacts} contracts={contracts} opportunities={[]} tasks={[]} plan={null} users={[]} channels={[]} aiEnabled={false} followUps={[]} followUpsHasMore={false} {...(企业?{项目们:[],旺旺们:['ww_buyer']}:{})} {...(项目模式?p14:{})} {...(加??{})}/></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(企业: boolean, width = 1366, 项目模式 = false, 加?: Record<string, unknown>) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  await page.route("http://left.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://left.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(([e, p, a]) => (window as unknown as { __render: (x: boolean, y: boolean, z?: unknown) => void }).__render(e, p, a), [企业, 项目模式, 加] as const);
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
    // 客户电话也能拨；联系方式子表里的旺旺号摆出来，10-29 起叫「阿里国际站ID」
    expect(await page.getByRole("link", { name: "13800138000" }).getAttribute("href")).toBe("tel:13800138000");
    expect(await page.getByText("ww_buyer").count()).toBe(1);
    expect(await page.getByText("阿里国际站ID", { exact: true }).count()).toBe(1);
    expect(await page.getByText("旺旺 ID").count()).toBe(0);
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
it("企业版项目模式（P14）：没有记录输入、头上是「记一条沟通…」（两个项目先挑）；沟通记录只读、每条标项目；待办里有计划和项目下一步；1024 宽不横滚", async () => {
  const page = await open(true, 1024, true);
  try {
    expect(await page.getByRole("button", { name: "记一条沟通…" }).count()).toBe(1);
    expect(await page.getByText("记录跟进").count()).toBe(0);
    expect(await page.locator("textarea").count()).toBe(0);
    expect(await page.locator(".rec-tl-cap").innerText()).toBe("沟通记录");
    // 照图 04（10-31）：灰底方式 + 时间一行，下面内容、蓝色「项目：名」
    expect(await page.locator(".rec-sum-item .rec-sum-type").count()).toBeGreaterThan(0);
    const 项目链 = page.locator(".rec-sum-proj");
    expect(await 项目链.count()).toBe(1);
    expect(await 项目链.getAttribute("href")).toBe("/projects/p1#project-follow");
    // 只读：沟通记录上没有编辑、删除
    expect(await page.locator(".rec-tl-item").getByRole("button", { name: /编辑|删除/ }).count()).toBe(0);
    expect(await page.getByText("回访报价").count()).toBe(1);
    expect(await page.locator(".rec-task-k").allInnerTexts()).toEqual(["计划", "项目"]);
    expect(await page.getByText("下次跟进").count()).toBe(0);
    // 两个项目：点「记一条沟通…」开框挑项目（10-31 R6，原来是下拉），长名字不把框撑出屏
    await page.getByRole("button", { name: "记一条沟通…" }).click();
    const 框 = page.getByRole("dialog");
    await 框.getByText("记到哪个项目").waitFor();
    expect(await 框.innerText()).toContain("记一条沟通 · 客户A");
    expect(await 框.getByText("关联进来的项目").count()).toBe(1);
    expect(await 框.getByText("关联 · 已结束").count()).toBe(1);
    expect(await 框.evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(1024);
    expect(await 框.locator(".ant-menu").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  } finally { await page.close(); }
});
/* 10-31 改版 R6：企业版客户页头的具名按钮（照项目详情）。原来收在「跟进」旁边的下拉里 */
const 全开 = {
  users: [{ id: "qa", name: "QA", email: "qa@x.test" }, { id: "u2", name: "同事乙", email: "b@x.test" }],
  能放公海: true,
  新建项目: { 选项: {} },
  关联们: [],
};
const 头按钮 = (page: import("playwright").Page) => page.locator(".rec-acts button").evaluateAll((bs: HTMLElement[]) => bs.map(b => b.innerText.replace(/\s+/g, "")));
it("企业版项目模式页头：能做的事摆成具名按钮，只有一颗主按钮、删除是危险文字按钮；没有下拉", async () => {
  const page = await open(true, 1366, true, 全开);
  try {
    // 按下面三栏分组（10-31 用户）：左组管资料栏、中组管沟通栏（整个客户的事跟在后面）、右组管右栏
    expect(await 头按钮(page)).toEqual(["编辑客户资料", "添加联系人", "管理联系人", "关联客户", "开项目", "记一条沟通…", "转让", "放回公海", "删除客户", "新建任务"]);
    expect(await page.locator(".rec-acts .ant-btn-primary").count()).toBe(1);
    expect(await page.locator(".rec-acts .ant-btn-dangerous").innerText()).toMatch(/删除客户/);
    expect(await page.locator(".rec-head .ant-dropdown-trigger").count()).toBe(0);
    // 卡上和页头同名的入口不再重复摆（10-31）：编辑全部、添加联系人、开项目、新建任务、关联「+」只在页头
    const 卡上钮 = await page.locator("button").evaluateAll((bs: HTMLElement[]) => bs.filter(b => !b.closest(".rec-head, .rec-acts")).map(b => (b.getAttribute("aria-label") ?? "") + b.innerText.replace(/\s+/g, "")));
    expect(卡上钮.filter(t => /编辑全部|添加联系人|开项目|新建任务|关联一位客户/.test(t))).toEqual([]);
    // 按钮一行摆在名字下面，各组对齐下面那一栏的左边
    const [名, 排] = await Promise.all([page.locator(".rec-head-id").boundingBox(), page.locator(".rec-acts").boundingBox()]);
    expect(排!.y).toBeGreaterThanOrEqual(名!.y + 名!.height - 1);
    const 对齐 = await page.evaluate(() => {
      const 栏 = [...document.querySelectorAll(".rec-page > .rec > *")].map(e => Math.round(e.getBoundingClientRect().left));
      const 组 = [...document.querySelectorAll(".rec-acts .acts-g")].map(e => Math.round(e.getBoundingClientRect().left));
      return { 栏, 组 };
    });
    expect(Math.abs(对齐.组[0] - 对齐.栏[0])).toBeLessThanOrEqual(2);
    expect(Math.abs(对齐.组[1] - 对齐.栏[1])).toBeLessThanOrEqual(2);
  } finally { await page.close(); }
});
it("「转让」开框挑人：没挑之前「下一步」点不了；挑了能点；取消关框", async () => {
  const page = await open(true, 1366, true, 全开);
  try {
    await page.locator(".rec-acts").getByRole("button", { name: /^转\s*让$/ }).click();
    const 框 = page.getByRole("dialog");
    await 框.getByText("转让 · 客户A").waitFor();
    const 下一步 = 框.getByRole("button", { name: /下\s*一\s*步/ });
    expect(await 下一步.isDisabled()).toBe(true);
    // 候选里没有现负责人自己
    await 框.getByRole("combobox", { name: "转给谁" }).click();
    expect(await page.locator(".ant-select-item-option").allInnerTexts()).toEqual(["同事乙"]);
    await page.locator(".ant-select-item-option").first().click();
    expect(await 下一步.isDisabled()).toBe(false);
    await 框.getByRole("button", { name: /取\s*消/ }).click();
    await 框.waitFor({ state: "hidden" });
    // 再开一次，上次挑的人清掉
    await page.locator(".rec-acts").getByRole("button", { name: /^转\s*让$/ }).click();
    expect(await page.getByRole("dialog").getByRole("button", { name: /下\s*一\s*步/ }).isDisabled()).toBe(true);
  } finally { await page.close(); }
});
it("「管理联系人」框：一人一行，编辑 / 删除；点编辑先关框", async () => {
  const page = await open(true, 1366, true, 全开);
  try {
    await page.locator(".rec-acts").getByRole("button", { name: "管理联系人" }).click();
    const 框 = page.getByRole("dialog");
    await 框.getByText("管理联系人 · 客户A").waitFor();
    const 行 = 框.locator(".proj-modal-row");
    expect(await 行.count()).toBe(3);
    expect(await 行.nth(0).innerText()).toContain("主要");
    expect(await 行.nth(0).innerText()).toContain("采购总监兼华东大区负责人");
    expect(await 行.nth(1).getByRole("button", { name: /删\s*除/ }).count()).toBe(1);
    expect(await 框.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await 行.nth(1).getByRole("button", { name: /编\s*辑/ }).click();
    await 框.waitFor({ state: "hidden" });
  } finally { await page.close(); }
});
it("虚线下属的客户（全只读）：页头只剩主按钮", async () => {
  const page = await open(true, 1366, true, { ...全开, 只读: "全" });
  try {
    expect(await 头按钮(page)).toEqual(["记一条沟通…"]);
  } finally { await page.close(); }
});
it("窄宽：700 / 800 / 1024 按钮一行在名字下面、从左排起、折行不出屏；都不横滚", async () => {
  for (const w of [700, 800, 1024]) {
    const page = await open(true, w, true, 全开);
    try {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const 排 = page.locator(".rec-acts");
      expect(await 排.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const [头, 名, 框] = await Promise.all([page.locator(".rec-head").boundingBox(), page.locator(".rec-head-id").boundingBox(), 排.boundingBox()]);
      // 每颗按钮都在屏内
      const 右 = await 排.locator("button").evaluateAll((bs: HTMLElement[]) => Math.max(...bs.map(b => b.getBoundingClientRect().right)));
      expect(右).toBeLessThanOrEqual(w);
      expect(框!.y).toBeGreaterThanOrEqual(名!.y + 名!.height - 1);
      expect(Math.abs(框!.x - 头!.x)).toBeLessThan(2);
    } finally { await page.close(); }
  }
});
