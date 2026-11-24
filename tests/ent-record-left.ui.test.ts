import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* 10-27 会议：企业版客户页左栏——联系人一人一卡、电话 / 邮箱 / 微信完整显示（11-09 起电话、邮箱不是链接，右边一个复制键），空字段收起，推荐 / 报价 / 签约不摆（纪要：客户页仅保留基础信息、联系人、关联项目三类）。
   开关关闭（不传 项目们）时左栏保持原样 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "record-left-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)tri-state-actions$/, "export const 三态继续持有=async()=>({ok:false,error:\"\"}),三态暂缓回收=三态继续持有,三态让同事结束项目=三态继续持有;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>window.__习惯??null;", "async()=>null"));
  // 全称那格用真的 InlineField（员工反馈：负责人要能就地改全称），别的格照旧用假的。路径带 .tsx，不撞上面这条 filter
  stub(/(^|\/)InlineField$/, "import Real from '@/app/(app)/customers/[id]/InlineField.tsx';export default function Inline(p){return p.field==='name'?<Real {...p}/>:<div className='rec-field' data-field={p.field}>{p.label}: {p.显示&&p.value?p.显示(p.value):p.value}</div>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>\"/customers/x\";");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(^|\/)ContactForm$/, "export default function F(p){return p.open?<div role='dialog' aria-label={p.record?'编辑联系人':'新增联系人'}>联系人表单</div>:null}");
  stub(/(^|\/)(TaskForm|PlanForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|LinkedCustomers|NewProjectEntry)$/, "export default function Empty(){return null}");
  // 联系人组头和行经 ContactLinks 摆（D3 · 方案 A 的「⋯」在它里面）：桩照样把头和行摆出来，只是不给菜单
  stub(/(^|\/)ContactLinks$/, "export default function L(p){return <>{p.头?.(null)}{p.children}</>}");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({});export const ContactRemoveInline=()=>null;");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海,退回原因选项=async()=>[];");
  stub(/^\.\.\/actions$/, "export const saveCustomerNumbers=async()=>({ok:true});export const 转走项目预览of=async()=>(window.__预览??{项目数:0,项目:[]});export const patchCustomer=async(...a)=>{(window.__改??=[]).push(a);return{ok:true}};export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=async()=>({ok:true});");
  // 历史变更入口（11-24）：真 HistoryChanges 挂在标签行末尾，动作只在点开时才调，这里空跑
  stub(/^\.\/history-actions$/, 补全动作桩("src/app/(app)/customers/[id]/history-actions.ts", "", "async()=>({ok:false,error:''})"));
  stub(/^\.\/useCustomerResearch$/, "export function CustomerResearchCard(){return null} export function CustomerResearchTag(){return null}");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  stub(/projects\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "export const 项目沟通须知=async()=>(window.__须知??{ok:true,能记:false}),记项目沟通Action=async(id,x)=>{window.__项目存={id,...x};return{ok:true,followUpId:'f1',自动推到:window.__推到}};"));
  stub(/^\.\/actions$/, `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,沟通可选项目=async()=>({ok:true,项目们:null,能建项目:true}),saveFollowUp=toggleTask,deleteFollowUp=toggleTask;
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
  
    export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'p1'});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Record from '@/app/(app)/customers/[id]/RecordView';import HistoryChanges from '@/app/(app)/customers/[id]/HistoryChanges';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
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
    window.__render=(企业,项目模式,加)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><Record customer={{id:'a',extra:null,name:'客户A',phone:'13800138000',school:'某某学校',grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z',...(加?.客户改??{})}} contacts={contacts} contracts={contracts} opportunities={[]} tasks={[]} plan={null} users={[]} channels={[]} aiEnabled={false} followUps={[]} followUpsHasMore={false} {...(企业?{项目们:[],旺旺们:['ww_buyer']}:{})} {...(项目模式?p14:{})} {...(加??{})} 历史变更={加?.历史?<HistoryChanges customerId='a' 摘要={加.历史} 当前项目={null} 客户名='客户A'/>:null}/></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(企业: boolean, width = 1366, 项目模式 = false, 加?: Record<string, unknown>) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  await page.route("http://left.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  // 沟通附件缩略图（F-047）：给一张 1×1 的 PNG，别让图片请求落到上面那页 HTML
  await page.route("http://left.test/api/attachments/**", r => r.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") }));
  await page.goto("http://left.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ path: path.resolve("src/app/(app)/customers/[id]/history-changes.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(([e, p, a]) => (window as unknown as { __render: (x: boolean, y: boolean, z?: unknown) => void }).__render(e, p, a), [企业, 项目模式, 加] as const);
  await page.getByText("联系人", { exact: false }).first().waitFor();
  return page;
}
it("企业版：联系人一人一卡，电话 / 邮箱 / 微信都在；电话、邮箱是文字 + 复制键，不是链接；打码号不给复制键；没留的写明", async () => {
  const page = await open(true);
  try {
    // D3 起左栏先摊开前 3 位、其余收在「展开其余 N 位」后面：先全摊开再量
    if (await page.locator('.rec-contact-rest-btn[aria-expanded="false"]').count()) await page.locator('.rec-contact-rest-btn[aria-expanded="false"]').click();
    const cards = page.locator(".rec-contact");
    expect(await cards.count()).toBe(3);
    const first = cards.nth(0);
    expect(await first.innerText()).toContain("采购总监兼华东大区负责人");
    expect(await first.innerText()).toContain("+86 138-0013-8000");
    expect(await first.innerText()).toContain("very.long.mailbox");
    expect(await first.locator("a[href^='tel:'], a[href^='mailto:']").count()).toBe(0);
    expect(await first.getByRole("button", { name: "复制电话" }).count()).toBe(1);
    expect(await first.getByRole("button", { name: "复制邮箱" }).count()).toBe(1);
    expect(await first.innerText()).toContain("wx_buyer_2026");
    expect(await cards.nth(1).innerText()).toContain("138****8001");
    expect(await cards.nth(1).getByRole("link").count()).toBe(0);
    expect(await cards.nth(1).getByRole("button", { name: /^复制/ }).count()).toBe(0);
    // 11-01 会议：未填一律写 —，悬停说没留联系方式
    expect(await cards.nth(2).innerText()).toMatch(/联系方式\s*—/);
    expect(await cards.nth(2).getByTitle("没留联系方式").count()).toBe(1);
    // 客户电话也是文字 + 复制键；联系方式子表里的旺旺号摆出来，10-29 起叫「阿里国际站ID」
    const 客户电话 = page.locator("[data-field='phone']");
    expect(await 客户电话.innerText()).toContain("13800138000");
    expect(await 客户电话.locator("a").count()).toBe(0);
    expect(await 客户电话.getByRole("button", { name: "复制电话" }).count()).toBe(1);
    expect(await page.getByText("ww_buyer").count()).toBe(1);
    expect(await page.getByText("阿里国际站ID", { exact: true }).count()).toBe(1);
    expect(await page.getByText("旺旺 ID").count()).toBe(0);
  } finally { await page.close(); }
});
it("企业版：空字段收起、「展开没填的 N 项」能展开；没有签约、推荐关系；1024 宽不横滚", async () => {
  const page = await open(true, 1024);
  try {
    expect(await page.locator("[data-field='remark']").count()).toBe(0);
    // 资料卡（11-17 客户抬头 PR-1b）：第一行全称、第二行简称（没填也摆）；「公司」格不摆了，填了也不摆
    expect(await page.locator("[data-field='school']").count()).toBe(0);
    expect(await page.locator("aside .rec-field").evaluateAll((els) => els.slice(0, 2).map((e) => (e as HTMLElement).dataset.field))).toEqual(["name", "shortName"]);
    expect(await page.locator("[data-field='name']").innerText()).toMatch(/全称\s*客户A/);
    // 全称点着就地改（员工反馈：负责人改不了全称）：点格 → 输入框 → 回车交 patchCustomer(id, "name", 新名)，格里马上显示新名
    await page.getByRole("button", { name: "编辑全称" }).click();
    const 名框 = page.locator("[data-field='name'] input");
    await 名框.fill("  客户A新名  ");
    await 名框.press("Enter");
    await page.waitForFunction(() => (window as unknown as { __改?: unknown[] }).__改?.length === 1);
    expect(await page.evaluate(() => (window as unknown as { __改: unknown[] }).__改)).toEqual([["a", "name", "客户A新名"]]);
    expect(await page.locator("[data-field='name']").innerText()).toMatch(/全称\s*客户A新名/);
    const more = page.getByRole("button", { name: /展开没填的 \d+ 项/ });
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
    expect(await page.getByRole("button", { name: /展开没填的/ }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /^更多：/ }).count()).toBe(0);
    expect(await page.getByText("登记签约").count()).toBe(1);
    expect(await page.getByRole("link", { name: "13800138000" }).count()).toBe(0);
    expect(await page.getByText("ww_buyer").count()).toBe(0);
  } finally { await page.close(); }
});
it("企业版项目模式（P14 → U-客户-03）：没有记录输入、沟通记录标题上是「新建沟通」（11-01 §5 直接开弹窗、不跳页）；沟通记录只读、每条标项目；待办里有计划和项目下一步；1024 宽不横滚", async () => {
  const page = await open(true, 1024, true);
  try {
    // 11-01 起沟通记录是一张能收起的卡（照项目详情）：「新建沟通」在卡头右边
    const 沟通卡头 = page.locator('.proj-fold:has(.split-caret[aria-label="收起沟通记录"]) > .rec-mod > .ant-card-head');
    const 新建沟通 = 沟通卡头.locator(".ant-card-extra").getByRole("button", { name: /新建沟通$/ });
    expect(await 新建沟通.count()).toBe(1);
    // 11-12 第 1 批：「新建沟通」是卡头的主按钮（蓝底）；11-12 第 2 批起是连体按钮左半，大小照「完成节点」（默认号）
    expect(await 新建沟通.evaluate((el) => [el.classList.contains("ant-btn-primary"), !!el.closest(".split-btn.split-brand")])).toEqual([true, true]);
    expect(await page.locator(".rec-head-acts").getByRole("button", { name: /沟通/ }).count()).toBe(0);
    expect(await page.getByText("记录跟进").count()).toBe(0);
    expect(await page.locator("textarea").count()).toBe(0);
    expect(await 沟通卡头.locator(".ant-card-head-title").textContent()).toMatch(/^沟通记录（\d+\+?）$/);
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
    // 11-01 会议 §5：点「新建沟通」直接开「记一条沟通」弹窗（不再先挑项目、不跳去项目页）；
    // 弹窗里「关联项目」默认第一个没结束的项目，已结束的不给选；长名字不把框撑出屏
    await 新建沟通.click();
    const 框 = page.getByRole("dialog");
    await 框.getByText("新建沟通").waitFor();
    expect(await 框.getByText("记到哪个项目").count()).toBe(0);
    const 项目格 = 框.locator(".ant-form-item").filter({ has: page.locator("label", { hasText: "关联项目" }) });
    expect(await 项目格.count()).toBe(1);
    await expect.poll(() => 项目格.locator(".ant-select-content").innerText()).toContain("超长项目名称");
    await 项目格.locator(".ant-select").click();
    expect(await page.locator(".ant-select-item-option").filter({ hasText: "关联进来的项目" }).count()).toBe(0);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => location.pathname)).toBe("/");
    expect(await 框.evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(1024);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  } finally { await page.close(); }
});
/*
  F-047：市场成员看分出去的客户，只剩汇总时间线——沟通上的截图、录音也摆在这条时间线里（照项目详情的 FollowAttachments），
  只看、看大图、下载，没有「加截图 / 录音」、没有删除；1280 / 390 不横滚；暗黑下颜色走 token（没有写死的白底）
*/
const 带附件的沟通 = (n: number) => ({
  followUps: [
    { id: "f9", type: "PHONE", title: "潜客培育", content: "首次沟通，客户发来了需求截图", status: "已完成", duration: null, occurredAt: "2026-11-20T02:00:00.000Z", dueAt: null, participants: null, sourceText: null, ownerName: "渠运", contactName: null, contactPosition: null, contactId: null, opportunityId: null, updatedAt: "2026-11-20T02:00:00.000Z", 项目: { id: "p1", 名: "渠运建的项目" },
      附件: [
        ...Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `需求截图${i}-${"很长的文件名".repeat(6)}.png`, mime: "image/png", size: 2048, width: 1, height: 1, createdAt: "2026-11-20T02:00:00.000Z", 有文件: true })),
        { id: "au", name: `通话录音-${"很长的文件名".repeat(8)}.m4a`, mime: "audio/mp4", size: 40960, width: null, height: null, createdAt: "2026-11-20T02:00:00.000Z", 有文件: true },
      ] },
    { id: "f8", type: "EMAIL", title: "没附件的", content: "老记录", status: "已完成", duration: null, occurredAt: "2026-11-01T02:00:00.000Z", dueAt: null, participants: null, sourceText: null, ownerName: "QA", contactName: null, contactPosition: null, contactId: null, opportunityId: null, updatedAt: "2026-11-01T02:00:00.000Z", 项目: null },
  ],
});
it("汇总时间线带沟通附件（F-047）：缩略图 + 点开大图 + 录音下载；没有上传、删除；没附件的那条不摆；1280 / 390 不横滚", async () => {
  for (const 宽 of [1280, 390]) {
    const page = await open(true, 宽, true, { ...带附件的沟通(6), 只读: true });
    try {
      const 条 = page.locator("#fu-f9");
      const 块 = 条.locator("[data-testid='follow-attachments']");
      expect(await 块.count()).toBe(1);
      expect(await page.locator("#fu-f8 [data-testid='follow-attachments']").count()).toBe(0);
      expect(await 块.locator(".follow-att-pic img").count()).toBe(6);
      expect(await 块.locator(".follow-att-pic img").first().getAttribute("src")).toBe("/api/attachments/a0");
      // 录音就地播放、旁边给下载
      expect(await 块.locator("audio").count()).toBe(1);
      expect(await 块.locator("a[download]").getAttribute("href")).toBe("/api/attachments/au?download");
      // 只读：没有加截图 / 录音、没有删除，也不接粘贴
      expect(await 块.getByRole("button", { name: /加截图|删掉/ }).count()).toBe(0);
      expect(await 块.getByText("也可以直接粘贴截图").count()).toBe(0);
      expect(await 块.evaluate((el) => el.hasAttribute("data-paste-scope"))).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${宽} 宽不横滚`).toBe(true);
      expect(await 条.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${宽} 宽这一条不撑出`).toBe(true);
      // 点缩略图看大图
      await 块.locator(".follow-att-pic img").first().click();
      await page.locator(".ant-image-preview").first().waitFor();
      expect(await page.locator(".ant-image-preview img").first().getAttribute("src")).toBe("/api/attachments/a0");
    } finally { await page.close(); }
  }
});
it("汇总时间线的沟通附件：暗黑下颜色都走 token（文件名是暗黑的字色，块里没有写死的白底）", async () => {
  const page = await open(true, 1280, true, { ...带附件的沟通(2), 只读: true });
  try {
    await page.addStyleTag({ path: path.resolve("src/app/dark.css") });
    await page.evaluate(() => document.documentElement.setAttribute("data-mode", "dark"));
    const r = await page.locator("#fu-f9 [data-testid='follow-attachments']").evaluate((el) => {
      const 量 = (v: string) => { const s = document.createElement("span"); s.style.color = v; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; };
      const 白底 = [el, ...el.querySelectorAll("*")].filter((x) => ["rgb(255, 255, 255)", "rgba(255, 255, 255, 1)"].includes(getComputedStyle(x).backgroundColor)).length;
      return { 字: getComputedStyle(el.querySelector(".follow-att-name")!).color, ink: 量("var(--ink)"), 浅色ink: "rgb(29, 29, 31)", 白底 };
    });
    expect(r.字).toBe(r.ink);
    expect(r.字).not.toBe(r.浅色ink);
    expect(r.白底).toBe(0);
  } finally { await page.close(); }
});
/* 10-31 改版 R6：企业版客户页头的具名按钮（照项目详情）。原来收在「跟进」旁边的下拉里 */
const 全开 = {
  users: [{ id: "qa", name: "QA", email: "qa@x.test" }, { id: "u2", name: "同事乙", email: "b@x.test" }],
  能放公海: true,
  新建项目: { 选项: {} },
  关联们: [],
};
const 头按钮 = (page: import("playwright").Page) => page.locator(".rec-head-acts button").evaluateAll((bs: HTMLElement[]) => bs.map(b => b.innerText.replace(/\s+/g, "")));
/** 11-12 用户「右上角只保存三个按钮」：客户转让 / 客户退回公海收进「客户操作 ▾」；11-21 教练点评改版 PR1 和项目操作合成「更多操作 ▾」，先点开再点项 */
const 客户操作菜单 = async (page: import("playwright").Page) => {
  await page.locator(".rec-head-acts").getByRole("button", { name: /更多操作/ }).click();
  const 菜单 = page.locator(".rec-head-menu").last();
  await 菜单.waitFor();
  return 菜单;
};
const 点客户转让 = async (page: import("playwright").Page) => (await 客户操作菜单(page)).getByRole("menuitem", { name: /^客户转让/ }).click();
it("企业版项目模式页头（U-客户-03 → 11-12 用户「右上角只保存三个按钮」）：没有项目区时右端只有「更多操作 ▾」（11-21 PR1 前叫「客户操作 ▾」），里面只有客户一组：客户转让（副字）、客户退回公海；没有主按钮、删除、AI", async () => {
  const page = await open(true, 1366, true, 全开);
  try {
    // 编辑资料、添加 / 管理联系人、删除客户、AI 都去掉；新建沟通在沟通记录卡头、新建待办在沟通记录下方的待办卡头（11-01）
    expect(await 头按钮(page)).toEqual(["更多操作"]);
    expect(await page.locator(".rec-head-acts .ant-btn-primary").count()).toBe(0);
    expect(await page.locator(".rec-head-acts .ant-btn-dangerous").count()).toBe(0);
    // 名字下面那一排没有了；页头只有「更多操作」这一个下拉
    expect(await page.locator(".rec-acts").count()).toBe(0);
    expect(await page.locator(".rec-head .ant-dropdown-trigger").count()).toBe(1);
    const 菜单 = await 客户操作菜单(page);
    expect(await 菜单.locator(".ant-dropdown-menu-item-group-title").allInnerTexts()).toEqual(["客户"]);
    expect((await 菜单.getByRole("menuitem").allInnerTexts()).map(t => t.replace(/\s+/g, " ").trim())).toEqual(["客户转让 客户换负责人，名下项目一起走", "客户退回公海"]);
    await page.keyboard.press("Escape");
    // 页面上别处也不给去掉的入口；新建待办在沟通栏的待办上
    const 卡上钮 = await page.locator("button").evaluateAll((bs: HTMLElement[]) => bs.filter(b => !b.closest(".rec-head")).map(b => (b.getAttribute("aria-label") ?? "") + b.innerText.replace(/\s+/g, "")));
    // 11-12 起联系人卡头有一颗「＋」（aria-label 新增联系人），不算这里去掉的入口
    expect(卡上钮.filter(t => /编辑全部|添加联系人|管理联系人|删除客户|新开项目/.test(t))).toEqual([]);
    expect(await page.locator('.rec > .rec-col > .proj-fold:has(.split-caret[aria-label="收起所有待办"]) > .rec-mod > .ant-card-head .ant-card-extra').getByRole("button", { name: /新建待办/ }).count()).toBe(1);
    // 按钮和客户名同一行、靠右（定稿 UI：客户名一行 + 右端两颗）
    const [头, 名, 排] = await Promise.all([page.locator(".rec-head").boundingBox(), page.locator(".rec-head-id").boundingBox(), page.locator(".rec-head-acts").boundingBox()]);
    expect(排!.y).toBeLessThan(名!.y + 名!.height);
    expect(排!.y + 排!.height).toBeGreaterThan(名!.y);
    expect(Math.abs(头!.x + 头!.width - (排!.x + 排!.width))).toBeLessThanOrEqual(2);
  } finally { await page.close(); }
});
it("「客户转让」一个框（dt.transfer）：没挑人「转让」点不了；挑了能点；取消关框", async () => {
  const page = await open(true, 1366, true, 全开);
  try {
    await 点客户转让(page);
    const 框 = page.getByRole("dialog");
    await 框.getByText("客户转让 · 客户A").waitFor();
    // 不是负责人本人发起（不用对方确认）：不写「接手人确认后生效」
    expect(await 框.innerText()).not.toContain("接手人确认后生效");
    const 转 = 框.getByRole("button", { name: /^转\s*让$/ });
    expect(await 转.isDisabled()).toBe(true);
    // 候选里没有现负责人自己
    await 框.getByRole("combobox", { name: "转给谁" }).click();
    expect(await page.locator(".ant-select-item-option").allInnerTexts()).toEqual(["同事乙"]);
    await page.locator(".ant-select-item-option").first().click();
    expect(await 转.isDisabled()).toBe(false);
    await 框.getByRole("button", { name: /取\s*消/ }).click();
    await 框.waitFor({ state: "hidden" });
    // 再开一次，上次挑的人清掉
    await 点客户转让(page);
    expect(await page.getByRole("dialog").getByRole("button", { name: /^转\s*让$/ }).isDisabled()).toBe(true);
  } finally { await page.close(); }
});
it("负责人本人发起（转让要申请）：框标题照样叫「客户转让」，同一个框里写明接手人确认后生效、7 天不确认作废；原因点选；按钮「发起转让」（dt.transfer）", async () => {
  const page = await open(true, 1366, true, { ...全开, 转让要申请: true, 转让原因: { 选项: ["客户要求"], 自己: "qa" } });
  try {
    expect(await 头按钮(page)).toEqual(["更多操作"]);
    await 点客户转让(page);
    const 框 = page.getByRole("dialog");
    await 框.getByText("客户转让 · 客户A").waitFor();
    expect(await 框.getByText("申请移交").count()).toBe(0);
    expect(await 框.innerText()).toMatch(/接手人确认后生效.*7 天不确认自动作废/);
    await 框.getByRole("combobox", { name: "转给谁" }).click();
    await page.locator(".ant-select-item-option").filter({ hasText: "同事乙" }).click();
    expect(await 框.getByRole("radio", { name: "客户要求" }).count()).toBe(1);
    expect(await 框.getByRole("button", { name: /^发起转让$/ }).isDisabled()).toBe(false);
    // 不再接力第二个框
    expect(await page.locator(".ant-modal-confirm").count()).toBe(0);
    // 11-15 PR7a 那版「下一步 → 第二个框（TransferDialog）」的检查：详情页已改成一个框（dt.transfer），同样的话在上面一个框里核过；TransferDialog 在客户列表的用例照留
  } finally { await page.close(); }
});
it("项目模式联系人（U-客户-03 去掉管理联系人）：卡上只有编辑、没有删除", async () => {
  const page = await open(true, 1366, true, 全开);
  try {
    expect(await page.getByRole("button", { name: /^编辑联系人 / }).count()).toBeGreaterThan(0);
    expect(await page.getByRole("button", { name: /^删除联系人 / }).count()).toBe(0);
  } finally { await page.close(); }
});
it("虚线下属的客户（全只读）：页头一排按钮都不摆", async () => {
  const page = await open(true, 1366, true, { ...全开, 只读: "全" });
  try {
    expect(await page.locator(".rec-head-acts, .rec-acts").count()).toBe(0);
  } finally { await page.close(); }
});
it("窄宽：700 / 800 / 1024 两颗按钮在客户名那一行右端、不折行不出屏；都不横滚", async () => {
  for (const w of [700, 800, 1024]) {
    const page = await open(true, w, true, 全开);
    try {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const 排 = page.locator(".rec-head-acts");
      expect(await 排.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const [头, 名, 框] = await Promise.all([page.locator(".rec-head").boundingBox(), page.locator(".rec-head-id").boundingBox(), 排.boundingBox()]);
      // 每颗按钮都在屏内、一行
      const 钮 = await 排.locator("button").evaluateAll((bs: HTMLElement[]) => bs.map(b => { const r = b.getBoundingClientRect(); return { 右: r.right, 高: r.height }; }));
      expect(Math.max(...钮.map(b => b.右))).toBeLessThanOrEqual(w);
      expect(钮.every(b => b.高 <= 40)).toBe(true);
      expect(框!.y).toBeLessThan(名!.y + 名!.height);
      expect(Math.abs(头!.x + 头!.width - (框!.x + 框!.width))).toBeLessThanOrEqual(2);
    } finally { await page.close(); }
  }
});
/* 10-31：企业版联系人卡上的「号码保护」小标签——只展示，不能点；判定见 tests/ent-contact-guard.test.ts。
   11-24 起单独一行：字段名「号码保护」，值那一列放标签、标签里只写状态；紧跟号码那几行 */
const 保护 = (page: import("playwright").Page) => page.locator(".rec-contact .rec-contact-guard").evaluateAll((ts: HTMLElement[]) => ts.map(t => {
  const 行 = t.closest(".rec-contact-line"), 前 = 行?.previousElementSibling;
  return [t.innerText, t.getAttribute("title"), t.tagName, t.querySelector("button, a, input") ? "可点" : "",
    行?.querySelector(":scope > .rec-contact-k")?.textContent ?? "", t.parentElement === 行?.querySelector(":scope > .rec-contact-v") ? "在值列" : "",
    前?.classList.contains("rec-contact-num") ? "跟在号码后" : ""];
}));
it("号码保护：每张卡一枚；有电话 + 客户有负责人 → 已开启，没电话 → 已关闭；公海 / 没负责人都关；不能点；开关关闭不摆", async () => {
  const page = await open(true);
  try {
    expect(await 保护(page)).toEqual([
      ["已开启", "有电话、客户有负责人", "SPAN", "", "号码保护", "在值列", "跟在号码后"],
      ["已开启", "有电话、客户有负责人", "SPAN", "", "号码保护", "在值列", "跟在号码后"],
      ["已关闭", "这位联系人没留电话", "SPAN", "", "号码保护", "在值列", "跟在号码后"],
    ]);
    expect(await page.locator(".rec-contact-guard").evaluateAll((ts: HTMLElement[]) => ts.map(t => getComputedStyle(t).cursor))).not.toContain("pointer");
  } finally { await page.close(); }
  const 公海 = await open(true, 1366, false, { 客户改: { pool: { reason: "手动" } } });
  try {
    expect((await 保护(公海)).map(x => x[0] + "|" + x[1])).toEqual(Array(2).fill("已关闭|客户在公海里").concat("已关闭|这位联系人没留电话"));
  } finally { await 公海.close(); }
  const 没负责人 = await open(true, 1366, false, { 客户改: { salesOwnerId: null, salesOwnerName: null } });
  try {
    expect((await 保护(没负责人)).slice(0, 2).map(x => x[1])).toEqual(["客户还没有负责人", "客户还没有负责人"]);
  } finally { await 没负责人.close(); }
  const 关 = await open(false);
  try {
    expect(await 关.locator(".rec-contact-guard").count()).toBe(0);
  } finally { await 关.close(); }
});
/* 11-09：联系人卡片里的电话、邮箱是真 RecordView + 真 CopyValue + globals.css；老三格和改版后的「号码们」都量 */
it("超长号码、超长邮箱：1024 / 1280 / 1366 不打省略号（D3 · M3-a）；一个号码一整串不拆，比整格还宽才在里面断；复制键 28 跟在后面、放不下挪下一行，在格内能点到；打码号没有键", async () => {
  const 长号 = "+86 138-0013-8000 转 1234567890 分机 0987654321 备用 13800138001";
  const 长邮箱 = "very.long.mailbox.name.for.purchasing.department.and.more@example-supplier-company-with-long-name.com";
  const 联系人 = (id: string, 加: Record<string, unknown>) => ({ id, name: "赵六", position: null, phone: null, email: null, wechat: null, isPrimary: false, remark: null, updatedAt: "2026-01-01T00:00:00.000Z", ...加 });
  const contacts = [
    联系人("c1", { phone: 长号, email: 长邮箱 }),
    联系人("c2", { 号码们: [{ kind: "phone", value: 长号 }, { kind: "landline", value: 长号 }, { kind: "email", value: 长邮箱 }, { kind: "phone", value: "138****8001" }] }),
    联系人("c3", { 号码们: [{ kind: "phone", value: "+86 138-0013-8000" }] }),
  ];
  const 号码种类 = [{ kind: "phone", 名: "手机" }, { kind: "landline", 名: "座机" }, { kind: "email", 名: "邮箱" }];
  for (const w of [1024, 1280, 1366]) {
    const page = await open(true, w, false, { contacts, 号码种类 });
    try {
      // D3 起左栏先摊开前 3 位、其余收在「展开其余 N 位」后面：先全摊开再量
      if (await page.locator('.rec-contact-rest-btn[aria-expanded="false"]').count()) await page.locator('.rec-contact-rest-btn[aria-expanded="false"]').click();
      const 量 = await page.locator(".rec-contact .copy-val").evaluateAll((vs: HTMLElement[]) => vs.map(v => {
        const 字 = v.querySelector<HTMLElement>(".copy-val-t")!, 键 = v.querySelector<HTMLElement>("button");
        const 格 = v.closest<HTMLElement>(".rec-contact-v")!;
        const 量字 = document.createElement("span"); 量字.textContent = 字.textContent; 量字.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap"; 字.parentElement!.append(量字);
        const 整宽 = 量字.getBoundingClientRect().width; 量字.remove();
        const 行数 = Math.round(字.getBoundingClientRect().height / parseFloat(getComputedStyle(字).lineHeight));
        if (!键) return { 文字: 字.textContent, 无键: true };
        键.scrollIntoView({ block: "center" });
        const r = 键.getBoundingClientRect(), 字框 = 字.getBoundingClientRect(), 格框 = 格.getBoundingClientRect(), 卡 = v.closest<HTMLElement>(".rec-contact")!.getBoundingClientRect();
        const 点到 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const 同行 = r.top < 字框.bottom - 4;
        return {
          文字: 字.textContent, 无键: false, 被截: 字.scrollWidth > 字.clientWidth + 1, 行数, title: 字.title,
          折得对: 行数 === 1 || 整宽 > 格框.width - 1,
          键能点到: !!点到 && 键.contains(点到), 键宽: r.width,
          不重叠: 同行 ? 字框.right <= r.left + 0.5 : r.top >= 字框.bottom - 4, 紧贴: 同行 ? r.left - 字框.right <= 3 : r.left - 格框.left <= 3,
          在格内: r.right <= 格框.right + 0.5 && r.right <= 卡.right + 0.5,
          格不出界: 格.scrollWidth <= 格.clientWidth + 1,
        };
      }));
      expect(量.length).toBe(7);
      for (const x of 量.filter(y => !y.无键)) {
        expect(x, `宽 ${w}：${x.文字}`).toMatchObject({ 键能点到: true, 键宽: 28, 不重叠: true, 紧贴: true, 在格内: true, 格不出界: true, 被截: false, 折得对: true, title: x.文字 });
      }
      expect(量.filter(x => x.无键).map(x => x.文字)).toEqual(["138****8001"]);
      // 放得下的「+86 138-0013-8000」一行，不在连字符处断开；超长的那几串比整格宽，才在里面断
      expect(量.find(x => x.文字 === "+86 138-0013-8000")!.行数, `宽 ${w}`).toBe(1);
      expect(量.filter(y => !y.无键 && (y.行数 ?? 0) > 1).length).toBeGreaterThan(0);
      // 号码保护一枚一行，不出卡、不被省略（11-24 起单独一行，标签只写状态）
      const 保 = await page.locator(".rec-contact-guard").evaluateAll((ts: HTMLElement[]) => ts.map(t => {
        const r = t.getBoundingClientRect(), 卡 = t.closest<HTMLElement>(".rec-contact")!, 卡框 = 卡.getBoundingClientRect(), 格 = t.parentElement!;
        return { 高: Math.round(r.height), 出卡: r.right > 卡框.right - parseFloat(getComputedStyle(卡).paddingRight) + 0.5, 截: t.scrollWidth > t.clientWidth || 格.scrollWidth > 格.clientWidth };
      }));
      expect(保.length, `宽 ${w}`).toBe(3);
      for (const g of 保) expect(g, `宽 ${w}`).toEqual({ 高: expect.any(Number), 出卡: false, 截: false });
      expect(Math.max(...保.map(g => g.高)), `宽 ${w} 号码保护一行`).toBeLessThanOrEqual(22);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } finally { await page.close(); }
  }
});

/* 11-12 页头按钮（第 2 批起只剩 客户转让 / 客户退回公海，和客户名同一行）：1024、375 宽 + 超长公司名，按钮不折行不出界，名字一行不撑出（口径同 e2e 的 量：scrollWidth > clientWidth + 1 且 overflow-x visible 算文字溢出） */
it.each([1024, 375])("客户页头 %ipx：超长公司名 + 两颗按钮，不出界、不折行、名字不撑出", async (w) => {
  const page = await open(true, w, true, { ...全开, 客户改: { name: "超长公司名有限责任公司".repeat(8) } });
  try {
    expect(await 头按钮(page)).toEqual(["更多操作"]);
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const 钮 = [...document.querySelectorAll(".rec-head-acts button")].map((b) => b.getBoundingClientRect());
      const 溢出 = [...document.querySelectorAll(".rec-head *")].filter((el) => {
        const cs = getComputedStyle(el);
        return el.getBoundingClientRect().width >= 1 && el.scrollWidth > el.clientWidth + 1 && cs.overflowX === "visible" && cs.display !== "inline";
      }).map((el) => `${el.tagName}.${el.className}`);
      return { 横滚: document.documentElement.scrollWidth > vw, 出界: 钮.filter((b) => b.right > vw + 1 || b.left < -1).length, 折行: 钮.filter((b) => b.height > 40).length, 溢出 };
    });
    expect(r).toEqual({ 横滚: false, 出界: 0, 折行: 0, 溢出: [] });
  } finally { await page.close(); }
});

/* 历史变更（11-24）：原来项目区右栏「项目进程变更」卡、没项目时左栏的客户状态留痕都挪进标题下那一行末尾的「历史变更」小方框。
   量真 RecordView 的标签行（状态胶囊 · 客户来源 · 公海标）：1280 / 1366 同一行；390 放不下就整颗换到下一行，不撑破、不横滚；左栏不再摆留痕 */
const 历史摘要 = { 客户: 37, 项目: 152, 项目数: 3, 最近: new Date(Date.now() - 2 * 3600_000).toISOString(), 状态: true };
it.each([1280, 1366, 390])("历史变更入口 %ipx：在标签行末尾，和前面的标签同一行或整颗换行，不撑破、不横滚；左栏没有状态留痕", async (w) => {
  const page = await open(true, w, true, { 历史: 历史摘要, 客户改: { channelName: "超长的客户来源渠道名称".repeat(3) } });
  try {
    const 钮 = page.getByTestId("history-entry");
    await 钮.waitFor();
    const r = await 钮.evaluate((b) => {
      const 行 = b.closest(".rec-tags")!;
      const 框 = b.getBoundingClientRect(), 行框 = 行.getBoundingClientRect();
      const 前 = [...行.children].filter((x) => x !== b && x.getBoundingClientRect().width > 0).map((x) => x.getBoundingClientRect());
      const 末 = 前[前.length - 1];
      return {
        在行里: b.parentElement === 行 && 行.lastElementChild === b,
        高: Math.round(框.height),
        同行: !!末 && Math.abs((末.top + 末.bottom) / 2 - (框.top + 框.bottom) / 2) <= 2,
        右边不出行: 框.right <= 行框.right + 1,
        字放得下: b.scrollWidth <= b.clientWidth + 1,
        横滚: document.documentElement.scrollWidth > innerWidth,
        文字: (b.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    });
    expect(r.在行里).toBe(true);
    expect(r.右边不出行).toBe(true);
    expect(r.字放得下).toBe(true);
    expect(r.横滚).toBe(false);
    expect(r.文字).toMatch(/^历史变更\s*189\s*· /);
    // 电脑同一行；手机这一行本来就放不下（超长来源一行省略）时整颗落到下一行，不和前面挤成半截
    if (w >= 1280) expect(r.同行, `宽 ${w}`).toBe(true);
    expect(r.高).toBe(w < 768 ? 32 : 26);
    expect(await page.locator("[data-testid=tri-log-left], .tri-log").count()).toBe(0);
    // 留图给人看（HIST_SHOT_DIR 指个目录才存）
    if (process.env.HIST_SHOT_DIR) {
      const 框 = (await page.locator(".rec-tags").boundingBox())!;
      await page.screenshot({ path: path.join(process.env.HIST_SHOT_DIR, `历史变更-入口-${w}.png`), clip: { x: 0, y: Math.max(0, 框.y - 80), width: w, height: 框.height + 110 } });
    }
  } finally { await page.close(); }
}, 60_000);

/* 11-12 用户：左栏联系人卡头去掉「全部 ›」，换「＋」新增联系人。D3（方案 A，用户 11-21 选）：每人一组行列表，先摊开前 3 位，其余收在「展开其余 N 位」后面；
   卡头「＋ 新增」图标 + 字；编辑和「⋯」常显 */
it("左栏联系人：卡头「＋ 新增」、没有「全部 ›」；前 3 位摊开、多的收进「展开其余 N 位」；不限高不块内滚", async () => {
  const 人 = (i: number, 加: Record<string, unknown> = {}) => ({ id: `c${i}`, name: `联系人${i}`, position: null, phone: `1380013800${i}`, email: null, wechat: null, isPrimary: i === 1, remark: null, updatedAt: "2026-01-01T00:00:00.000Z", ...加 });
  const 八位 = Array.from({ length: 8 }, (_, i) => 人(i + 1));
  const page = await open(true, 1366, false, { contacts: 八位 });
  try {
    // 联系人那一节里没有任何链接（原来的「全部 ›」去 /contacts?keyword=客户名）
    const 联系人节链 = () => page.locator(".rec-contact").first().evaluate(c => c.closest(".rec-sec, .proj-fold")!.querySelectorAll(":scope a:not(.rec-contact a)").length);
    expect(await 联系人节链()).toBe(0);
    expect(await page.locator('a[href^="/contacts"]').count()).toBe(0);
    const 加 = page.getByRole("button", { name: "新增联系人" });
    expect(await 加.count()).toBe(1);
    expect((await 加.innerText()).trim()).toBe("新增");
    // 前 3 位整组摆着（号码都在），其余不在页面上
    const 组 = page.locator(".rec-cg");
    expect(await 组.count()).toBe(3);
    expect(await 组.nth(2).innerText()).toContain("13800138003");
    expect(await page.getByText("13800138004").count()).toBe(0);
    expect(await page.locator(".rec-contact-tog").count()).toBe(0);
    const 钮 = page.getByRole("button", { name: "展开其余 5 位" });
    expect(await 钮.getAttribute("aria-expanded")).toBe("false");
    await 钮.click();
    expect(await 组.count()).toBe(8);
    expect(await page.getByTestId("contact-rest").evaluate(el => getComputedStyle(el).overflowY)).toBe("visible");
    const 收 = page.getByRole("button", { name: "收起其余 5 位" });
    expect(await 收.getAttribute("aria-expanded")).toBe("true");
    await 收.click();
    expect(await 组.count()).toBe(3);
    // 「＋」打开的还是原来那个新增联系人框
    await 加.click();
    await page.getByRole("dialog", { name: "新增联系人" }).waitFor();
  } finally { await page.close(); }
});

it("只有一位联系人：整组摊开，不摆「展开其余」；只读（管理员只读）时卡头没有「＋」", async () => {
  const 一位 = [{ id: "c1", name: "赵六", position: "采购", phone: "13900001111", email: null, wechat: null, isPrimary: true, remark: null, updatedAt: "2026-01-01T00:00:00.000Z" }];
  let page = await open(true, 1366, false, { contacts: 一位 });
  try {
    expect(await page.locator(".rec-contact").count()).toBe(1);
    expect(await page.getByRole("button", { name: /展开其余/ }).count()).toBe(0);
    expect(await page.locator(".rec-contact").innerText()).toContain("13900001111");
  } finally { await page.close(); }
  page = await open(true, 1366, false, { 管理员只读: true });
  try {
    expect(await page.getByRole("button", { name: "新增联系人" }).count()).toBe(0);
    expect(await page.locator('a[href^="/contacts"]').count()).toBe(0);
  } finally { await page.close(); }
});

/* D3 · M3-b（设计语言 11-21）：能改的格整行浅底 + 行尾一支笔，悬停 / 焦点才出；只读没有笔 */
it("能改的格：行尾一支笔，平时不显、悬停出、整行 --row-hover；只读不摆笔", async () => {
  const page = await open(true);
  try {
    const 格 = page.locator("[data-field='name']");
    const 笔 = 格.locator(".rec-field-pen");
    expect(await 笔.count()).toBe(1);
    expect(await 笔.evaluate(e => getComputedStyle(e).opacity)).toBe("0");
    await 格.hover();
    await expect.poll(() => 笔.evaluate(e => getComputedStyle(e).opacity)).toBe("1");
    const 浅 = await page.evaluate(() => { const s = document.createElement("span"); s.style.background = "var(--row-hover)"; document.body.append(s); const c = getComputedStyle(s).backgroundColor; s.remove(); return c; });
    await expect.poll(() => 格.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(浅);
    // 笔在行尾、不压字
    const [行, 笔框] = await Promise.all([格.boundingBox(), 笔.boundingBox()]);
    expect(行!.x + 行!.width - (笔框!.x + 笔框!.width)).toBeLessThanOrEqual(10);
    expect(await 格.locator(".rec-field-v").evaluate((v, 笔右) => v.getBoundingClientRect().right <= 笔右, 笔框!.x + 1)).toBe(true);
  } finally { await page.close(); }
  const 只读 = await open(true, 1366, false, { 管理员只读: true });
  try {
    expect(await 只读.locator("[data-field='name'] .rec-field-pen").count()).toBe(0);
  } finally { await 只读.close(); }
});
