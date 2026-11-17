/**
 * 客户详情 PR7b（前端改版 dt.*）：
 *   dt.pool：企业版「客户退回公海」一个后果框——后果分条、原因点选（P-界面-42），不选原因确认键点不了；
 *     取消 = 不生效（不调服务端）；服务端挡了 = 原因写在框里、不跳走、不出撤销条（被挡不提示成功）；
 *     成了回客户列表，底部撤销条跟着（showUndo 挂在 body 上，换页还在）
 *   沟通必须挂项目（11-17，取代 P-界面-35）：没有能记的在推项目也打开「记一条沟通」，弹框写明先建项目、给「新建项目」；
 *     保存拦下不发请求、写好的内容留着；点「新建项目」叠开新建项目表，记沟通的框和内容还在
 *   X-143：「关联项目」下拉只列能记的（跟进去处.能记 = false 的不列）
 *   首页 AI 记沟通卡「去建项目」（?建项目=1）：进客户页直接开新建项目
 *   组员能记（11-17 客户定）：只能看的客户（只因进了项目组）上有我已进组的在推项目，「新建沟通」照样打开、只列这几个项目、
 *     不给待办 / 提醒；一个能记的都没有就照旧说只能看
 *   Windows 1024 / 1280 / 1366 + 超长客户名：后果框不撑出页面、确认键点得到
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, 包: string;
const 桩: Plugin = { name: "pr7b-detail", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)tri-state-actions$/, "export const 三态继续持有=async()=>({ok:false,error:\"\"}),三态暂缓回收=三态继续持有,三态让同事结束项目=三态继续持有;");
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>window.__习惯??null;");
  stub(/(^|\/)InlineField$/, "export default function Inline(p){return <div className='rec-field' data-field={p.field}>{p.label}: {p.value}</div>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__push=u},replace(){}});export const usePathname=()=>\"/customers/x\";export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^next\/link$/, "export default function L({prefetch,scroll,replace,...p}){return <a {...p}/>}");
  stub(/(^|\/)(TaskForm|PlanForm|ContactForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|ContactLinks|ResearchRun|ResearchPerson)$/, "export default function Empty(){return null}");
  stub(/(^|\/)NewProjectEntry$/, "export default function N({open}){return open?<div data-testid='new-project-modal'/>:null}");
  stub(/research\/ResearchEntry$/, "export const useResearchEntry=()=>false;");
  stub(/research\/actions$/, "export const 最近背调=async()=>null,背调价目=async()=>({可用:false,原因:'桩'});");
  stub(/^\.\/pick$/, "export const 搜客户=async()=>[];");
  stub(/^\.\/link-actions$/, "export const 关联客户=async()=>({ok:true}),改关联说明=关联客户,取消关联=关联客户;");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({});export const ContactRemoveInline=()=>null;");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async(ids,原因)=>{(window.__放??=[]).push({ids,原因});return window.__放回??{ok:true,updated:1,unchanged:0}},领取=async()=>({ok:false}),撤销公海=async()=>{window.__撤=true;return{ok:true,updated:1}},退回原因选项=async()=>['客户无意向','联系不上','其他'];");
  stub(/^\.\.\/actions$/, "export const saveCustomerNumbers=async()=>({ok:true});export const 转走项目预览of=async()=>(window.__预览??{项目数:0,项目:[]});export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async(ids,to,因)=>{window.__转={ids,to,因};return window.__转回??{ok:false,error:'桩'}},撤销改负责人=async()=>{window.__撤转=true;return{ok:true,updated:1}},patchCustomerRegion=async()=>({ok:true});");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  stub(/projects\/actions$/, "export const 项目沟通须知=async()=>({ok:true,能记:false}),记项目沟通Action=async()=>({ok:true,followUpId:'f1'});");
  stub(/^\.\/actions$/, `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,沟通可选项目=async()=>({ok:true,项目们:null,能建项目:true}),deleteFollowUp=toggleTask;
    export const saveFollowUp=async x=>{window.__存=x;return{ok:true,id:'f1'}};
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
    export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'p1'});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  包 = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Record from '@/app/(app)/customers/[id]/RecordView';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    window.__长=长;
    const users=[{id:'qa',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'小张',email:'s2',role:'SALES',active:true}];
    window.__render=({去处,申请,只读})=>{
      const 项目们=去处.map(p=>({id:p.id,name:p.名,phase:'商机',node:'报价',result:null,pooledAt:null,amount:0,currency:'CNY'}));
      root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><div className='shell'><nav className='rail' aria-label='主导航'/><main className='main app-content' style={{padding:'22px 26px'}}><div>
      <Record customer={{id:'a',extra:null,name:长,phone:'13800138000',school:长,grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'小王',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z'}} contacts={[]} contracts={[]} opportunities={[]} tasks={[]} plan={null} users={users} channels={[]} aiEnabled={false} followUpsHasMore={false} 项目们={项目们} 参与项目们={[]} 关联们={[]} 旺旺们={[]} 企业版 能放公海 能转让客户 转让要申请={!!申请} 只读={只读?'全':false} 只读话={只读||undefined} 转让原因={{选项:['客户迁移','岗位调整','其他'],自己:'qa'}}
        跟进去处={去处} 待办计划={[]} followUps={[]} 新建项目={{节点们:['线索验证'],要下一步:false}}/>
    </div></main></div></BusinessProvider></App></ConfigProvider>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 去处 = { id: string; 名: string; 主: boolean; 结束: boolean; 说明: null; 下一步: null; 下一步文字: null; 能记?: boolean };
const 项 = (id: string, 名: string, 能记 = true): 去处 => ({ id, 名, 主: true, 结束: false, 说明: null, 下一步: null, 下一步文字: null, 能记 });

async function 开(去处: 去处[], width = 1280, 放回?: unknown, 额外: { 申请?: boolean; 转回?: unknown; 预览?: unknown; 只读?: string; 网址?: string } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 860 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://pr7b.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto(`http://pr7b.test/${额外.网址 ?? ""}`); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 包 });
  await page.evaluate(x => {
    if (x.放回) Reflect.set(window, "__放回", x.放回);
    if (x.额外.转回) Reflect.set(window, "__转回", x.额外.转回);
    if (x.额外.预览) Reflect.set(window, "__预览", x.额外.预览);
    (window as unknown as { __render: (x: object) => void }).__render({ 去处: x.去处, 申请: x.额外.申请, 只读: x.额外.只读 });
  }, { 去处, 放回, 额外 });
  await page.locator(".rec-head").first().waitFor();
  return { page, errors };
}
const 取 = (page: Page, k: string) => page.evaluate((k) => Reflect.get(window, k) ?? null, k);
async function 点退回(page: Page) {
  await page.locator(".rec-head-acts button").filter({ hasText: /客户操作/ }).click();
  await page.locator(".rec-head-menu").last().getByRole("menuitem", { name: /^客户退回公海$/ }).click();
  const 框 = page.getByRole("dialog").filter({ hasText: "退回公海" });
  await 框.waitFor();
  return 框;
}

it("dt.pool：后果分条 + 原因点选；不选原因确认键点不了；取消 = 不生效", async () => {
  const { page, errors } = await 开([项("p1", "项目一")]);
  try {
    const 框 = await 点退回(page);
    expect(await 框.innerText()).toContain("名下联系人、项目一起进公海");
    expect(await 框.innerText()).toContain("你不能再领回来，也看不到它了");
    expect(await 框.getByRole("radio").count()).toBe(3);
    const 确认 = 框.getByRole("button", { name: /^退回公海$/ });
    expect(await 确认.isDisabled()).toBe(true);
    await 框.getByRole("button", { name: /^取\s*消$/ }).click();
    await 框.waitFor({ state: "hidden" });
    expect(await 取(page, "__放")).toBeNull();
    expect(await 取(page, "__push")).toBeNull();
    expect(await page.locator("#undo-host").innerText().catch(() => "")).not.toContain("退回公海");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("dt.pool：选「其他」必须写一句；确认后带原因交服务端，回客户列表，撤销条跟着、能撤", async () => {
  const { page, errors } = await 开([项("p1", "项目一")]);
  try {
    const 框 = await 点退回(page);
    const 确认 = 框.getByRole("button", { name: /^退回公海$/ });
    await 框.getByRole("radio", { name: "其他" }).click();
    expect(await 确认.isDisabled()).toBe(true);
    await 框.getByRole("textbox").fill("换了供应商");
    await 确认.click();
    await expect.poll(() => 取(page, "__push")).toBe("/customers");
    const 放 = await 取(page, "__放") as { ids: string[]; 原因: string }[];
    expect(放).toHaveLength(1);
    expect(放[0].ids).toEqual(["a"]);
    expect(放[0].原因).toContain("换了供应商");
    const 条 = page.locator("#undo-host");
    await expect.poll(() => 条.innerText()).toContain("退回公海");
    await 条.getByRole("button", { name: /撤销/ }).click();
    await expect.poll(() => 取(page, "__撤")).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("dt.pool：服务端挡了——原因写在框里、框不关、不跳走、不出撤销条（不报成功）", async () => {
  const { page, errors } = await 开([项("p1", "项目一")], 1280, { ok: false, error: "这位客户正在交接中，先撤回交接" });
  try {
    const 框 = await 点退回(page);
    await 框.getByRole("radio", { name: "客户无意向" }).click();
    await 框.getByRole("button", { name: /^退回公海$/ }).click();
    await expect.poll(() => 框.getByRole("alert").innerText()).toContain("正在交接中");
    expect(await 框.isVisible()).toBe(true);
    expect(await 取(page, "__push")).toBeNull();
    expect(await page.locator("#undo-host").count()).toBe(0);
    expect(await page.locator(".ant-message").innerText().catch(() => "")).not.toMatch(/已退回|退回公海/);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("dt.pool：1024 / 1280 / 1366 + 超长客户名，后果框不撑出、标题不横溢、确认键点得到", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 开([项("p1", "项目一")], w);
    try {
      const 框 = await 点退回(page);
      await 框.getByRole("radio", { name: "客户无意向" }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `宽 ${w}`).toBe(true);
      const 量 = await 框.evaluate((el) => {
        const 盒 = el.closest(".ant-modal") as HTMLElement;
        const 题 = 盒.querySelector(".ant-modal-title") as HTMLElement;
        const 钮 = [...盒.querySelectorAll("button")].find((b) => /^退回公海$/.test(b.textContent?.replace(/\s/g, "") ?? ""))!;
        const r = 钮.getBoundingClientRect();
        const 顶 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { 题溢: 题.scrollWidth > 盒.clientWidth + 1, 盒右: 盒.getBoundingClientRect().right, 点得到: 钮 === 顶 || 钮.contains(顶) };
      });
      expect(量.题溢, `宽 ${w}`).toBe(false);
      expect(量.盒右, `宽 ${w}`).toBeLessThanOrEqual(w);
      expect(量.点得到, `宽 ${w}`).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("沟通必须挂项目（11-17）：没有在推项目，「新建沟通」打开后写明先建项目；保存拦下、内容留着；「新建项目」叠开新建表", async () => {
  const { page, errors } = await 开([]);
  try {
    await page.getByRole("button", { name: /新建沟通/ }).first().click();
    const 说明 = page.getByRole("note").filter({ hasText: "这位客户还没有项目，先建一个项目再记沟通" });
    await 说明.waitFor();
    expect(await page.getByTestId("new-project-modal").count()).toBe(0);
    await page.locator("#content").fill("电话聊了下");
    await page.getByRole("dialog").getByRole("button", { name: /保\s*存|记\s*下/ }).last().click();
    await expect.poll(() => page.getByText("这位客户还没有项目，先建一个项目再记沟通").count()).toBeGreaterThan(1);
    expect(await 取(page, "__存")).toBeNull();
    expect(await page.locator("#content").inputValue()).toBe("电话聊了下");
    await 说明.getByRole("button", { name: "新建项目" }).click();
    // 桩是个空 div（没有尺寸）：等它挂上即可
    await page.getByTestId("new-project-modal").waitFor({ state: "attached" });
    // 记沟通的框没关，写好的还在
    expect(await page.locator("#content").inputValue()).toBe("电话聊了下");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("X-143：记不了的项目（能记 = false）不进「关联项目」下拉；只剩它时说找负责人拉进组或新建项目", async () => {
  const { page, errors } = await 开([项("p1", "我的项目"), 项("p2", "同事的项目", false)]);
  try {
    await page.getByRole("button", { name: /新建沟通/ }).first().click();
    const 格 = page.locator(".ant-form-item").filter({ has: page.locator('label:text-is("关联项目")') });
    await 格.locator(".ant-select").click();
    await page.locator(".ant-select-item-option").first().waitFor();
    const 选项 = await page.locator(".ant-select-item-option").allInnerTexts();
    expect(选项).toEqual(["我的项目"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  const 二 = await 开([项("p2", "同事的项目", false)]);
  try {
    await 二.page.getByRole("button", { name: /新建沟通/ }).first().click();
    await 二.page.getByRole("note").filter({ hasText: "你都不是负责人或组员" }).waitFor();
    expect(二.errors).toEqual([]);
  } finally { await 二.page.close(); }
});

it("组员能记（11-17）：只能看的客户上有我进组的在推项目——「新建沟通」照样打开，只列能记的项目、不给待办 / 提醒；一个都没有照旧说只能看", async () => {
  const 组员话 = "这是你加入的项目挂着的客户：只能看，不能改；沟通只能记在你已加入的在推项目上；被指定为负责人才能改";
  const { page, errors } = await 开([项("p1", "我进组的项目"), 项("p2", "没进组的项目", false)], 1280, undefined, { 只读: 组员话 });
  try {
    await page.getByRole("button", { name: /新建沟通/ }).first().click();
    const 框 = page.getByRole("dialog");
    const 格 = 框.locator(".ant-form-item").filter({ has: page.locator('label:text-is("关联项目")') });
    await 格.waitFor();
    // 只有一个能记的：默认选它
    expect(await 格.innerText()).toContain("我进组的项目");
    await 格.locator(".ant-select").click();
    await page.locator(".ant-select-item-option").first().waitFor();
    expect(await page.locator(".ant-select-item-option").allInnerTexts()).toEqual(["我进组的项目"]);
    await page.keyboard.press("Escape");
    expect(await 框.innerText()).not.toMatch(/待办|提醒/);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  const 二 = await 开([项("p2", "没进组的项目", false)], 1280, undefined, { 只读: 组员话 });
  try {
    const 前 = await 二.page.getByText(组员话).count();
    await 二.page.getByRole("button", { name: /新建沟通/ }).first().click();
    await expect.poll(() => 二.page.getByText(组员话).count()).toBeGreaterThan(前);
    expect(await 二.page.getByRole("dialog").count()).toBe(0);
    expect(二.errors).toEqual([]);
  } finally { await 二.page.close(); }
});

it("首页 AI 记沟通卡「去建项目」带 ?建项目=1 进来：直接打开新建项目，参数用完去掉；只读的不开", async () => {
  const { page, errors } = await 开([], 1280, undefined, { 网址: "customers/a?建项目=1" });
  try {
    await page.getByTestId("new-project-modal").waitFor({ state: "attached" });
    expect(new URL(page.url()).search).toBe("");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  const 二 = await 开([], 1280, undefined, { 网址: "customers/a?建项目=1", 只读: "这是虚线下属的客户：只能看，不能改、不能转" });
  try {
    await 二.page.waitForTimeout(300);
    expect(await 二.page.getByTestId("new-project-modal").count()).toBe(0);
    expect(二.errors).toEqual([]);
  } finally { await 二.page.close(); }
});

async function 点转让(page: Page) {
  await page.locator(".rec-head-acts button").filter({ hasText: /客户操作/ }).click();
  await page.locator(".rec-head-menu").last().getByRole("menuitem", { name: /^客户转让$/ }).click();
  const 框 = page.getByRole("dialog").filter({ hasText: "客户转让" });
  await 框.waitFor();
  return 框;
}
async function 选人(page: Page, 框: import("playwright").Locator, 名: string) {
  await 框.getByRole("combobox", { name: "转给谁" }).click();
  await page.locator(".ant-select-item-option").filter({ hasText: 名 }).click();
}

it("dt.transfer：选人、一起转走的项目、原因在同一个框；没选人发不了；取消 = 不生效", async () => {
  const { page, errors } = await 开([项("p1", "项目一")], 1280, undefined, { 申请: true, 预览: { 项目数: 1, 项目: [{ name: "项目一", 客户: "甲" }] } });
  try {
    const 框 = await 点转让(page);
    const 发 = 框.getByRole("button", { name: /^发起转让$/ });
    expect(await 发.isDisabled()).toBe(true);
    expect(await 框.innerText()).toContain("接手人确认后生效");
    await 选人(page, 框, "小张");
    await expect.poll(() => 框.getByTestId("transfer-carry").innerText()).toContain("项目一");
    expect(await 框.getByRole("radiogroup", { name: /转让原因/ }).getByRole("radio").count()).toBe(3);
    expect(await 发.isDisabled()).toBe(false);
    await 框.getByRole("radio", { name: "其他" }).click();
    expect(await 发.isDisabled()).toBe(true);
    await 框.getByRole("button", { name: /^取\s*消$/ }).click();
    await 框.waitFor({ state: "hidden" });
    expect(await 取(page, "__转")).toBeNull();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("dt.transfer：负责人本人发起 = 申请移交，发出后框里原地说等对方确认，没有撤销条", async () => {
  const { page, errors } = await 开([项("p1", "项目一")], 1280, undefined, { 申请: true, 转回: { ok: true, updated: 0, 交接中: true, 申请移交: true } });
  try {
    const 框 = await 点转让(page);
    await 选人(page, 框, "小张");
    await 框.getByRole("radio", { name: "客户迁移" }).click();
    await 框.getByRole("button", { name: /^发起转让$/ }).click();
    await expect.poll(() => 框.getByRole("status").innerText()).toContain("等「小张」确认后生效");
    expect(await 取(page, "__转")).toEqual({ ids: ["a"], to: "u2", 因: "客户迁移" });
    expect(await page.locator("#undo-host").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("dt.transfer：服务端挡了——原因写在框里、框不关、不报成功", async () => {
  const { page, errors } = await 开([项("p1", "项目一")], 1280, undefined, { 转回: { ok: false, error: "这位客户已在移交中" } });
  try {
    const 框 = await 点转让(page);
    await 选人(page, 框, "小张");
    await 框.getByRole("button", { name: /^转\s*让$/ }).click();
    await expect.poll(() => 框.getByRole("alert").innerText()).toContain("已在移交中");
    expect(await 框.isVisible()).toBe(true);
    expect(await page.locator("#undo-host").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("dt.transfer：直接转成了关框、底部撤销条能撤；1024 / 1366 + 超长名字框不撑出", async () => {
  for (const w of [1024, 1366]) {
    const { page, errors } = await 开([项("p1", "项目一")], w, undefined, { 转回: { ok: true, updated: 1, 原值: [{ id: "a", 值: "qa" }] }, 预览: { 项目数: 1, 项目: [{ name: "某某超长项目名".repeat(12), 客户: "甲" }] } });
    try {
      const 框 = await 点转让(page);
      await 选人(page, 框, "小张");
      await expect.poll(() => 框.getByTestId("transfer-carry").innerText()).toContain("某某超长项目名");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `宽 ${w}`).toBe(true);
      expect(await 框.evaluate((el) => { const m = el.closest(".ant-modal") as HTMLElement; const l = m.querySelector(".cd-transfer-list") as HTMLElement; return l.scrollWidth <= l.clientWidth + 1 && m.getBoundingClientRect().right <= window.innerWidth; }), `宽 ${w}`).toBe(true);
      await 框.getByRole("button", { name: /^转\s*让$/ }).click();
      await 框.waitFor({ state: "hidden" });
      const 条 = page.locator("#undo-host");
      await expect.poll(() => 条.innerText()).toContain("已转给 小张");
      await 条.getByRole("button", { name: /撤销/ }).click();
      await expect.poll(() => 取(page, "__撤转")).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
