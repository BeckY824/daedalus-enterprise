import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
/* D3 · 设计语言 11-21：客户页左栏的结构改动（联系人每人一组、号码保护灰底加锁、附件「— ＋ 添加」、卡头「＋ 新增」、「展开没填的」、
   背调「无」不挂标签、新建联系人标题和规矩行），资料格的号码、改不了 / 公海时的入口 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "d3-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)tri-state-actions$/, "export const 三态继续持有=async()=>({ok:false,error:\"\"}),三态暂缓回收=三态继续持有,三态让同事结束项目=三态继续持有;");
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null,发起主体选项=async()=>null,我常用的沟通方式=async()=>null;");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>\"/customers/x\";");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(^|\/)ContactForm$/, "export default function F(){return null}");
  stub(/(^|\/)(TaskForm|PlanForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|LinkedCustomers|NewProjectEntry)$/, "export default function Empty(){return null}");
  // 联系人每人一组经 ContactLinks 摆组头和行
  stub(/(^|\/)ContactLinks$/, "export default function L(p){return <>{p.头?.(null)}{p.children}</>}");
  stub(/(^|\/)AttachmentsPanel$/, "export default function P(p){return <div data-testid='att-panel' data-readonly={p.只读?'1':'0'} data-can-del={p.能删?'1':'0'}/>}");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({});export const ContactRemoveInline=({c,只删})=><span data-testid='contact-remove' data-only-delete={只删?'1':'0'} hidden>{c.id}</span>;");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海,退回原因选项=async()=>[];");
  stub(/^\.\.\/actions$/, "export const 转走项目预览of=async()=>({项目数:0,项目:[]}),patchCustomer=async()=>({ok:true}),deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=async()=>({ok:true});");
  stub(/^\.\/useCustomerResearch$/, "export function CustomerResearchCard(){return null} export function CustomerResearchTag(){return null}");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  stub(/projects\/actions$/, "export const 项目沟通须知=async()=>({ok:true,能记:false}),记项目沟通Action=async()=>({ok:true});");
  stub(/^\.\/actions$/, "export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false}),toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,沟通可选项目=async()=>({ok:true,项目们:null,能建项目:true}),saveFollowUp=toggleTask,deleteFollowUp=toggleTask,转走项目预览of=async()=>({项目数:0,项目:[]}),saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'p1'});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Record from '@/app/(app)/customers/[id]/RecordView';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const c=(id,name,position,phone)=>({id,name,position,phone,email:null,wechat:null,isPrimary:id==='c1',remark:null,updatedAt:'2026-01-01T00:00:00.000Z'});
    const contacts=[c('c1','张三','采购总监','13800138000'),c('c2','李四',null,'13800138001'),c('c3','王五','前台',null),c('c4','赵六',null,null)];
    const p14={跟进去处:[{id:'p1',名:'项目一',主:true,结束:false,说明:null,下一步:null}],待办计划:[],followUps:[],项目区:()=><div>项目区</div>};
    window.__render=(加,项目模式)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><Record customer={{id:'a',extra:null,name:'客户A',phone:'13800138000',school:null,grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z',...(加?.客户改??{})}} contacts={contacts} contracts={[]} opportunities={[]} tasks={[]} plan={null} users={[]} channels={[]} aiEnabled={false} followUps={[]} followUpsHasMore={false} 项目们={[]} 联系人分类附件数={{}} {...(项目模式?p14:{})} {...(加??{})}/></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(opt: { width?: number; 项目模式?: boolean; 加?: Record<string, unknown>; 暗?: boolean } = {}) {
  const page = await browser.newPage({ viewport: { width: opt.width ?? 1366, height: 900 } }); page.setDefaultTimeout(5000);
  await page.route("http://d3.test/**", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html data-mode='${opt.暗 ? "dark" : "light"}'><meta charset='utf-8'><div id='root'></div></html>` }));
  await page.goto("http://d3.test");
  for (const f of ["globals.css", "antd-dark.css", "dark.css"]) await page.addStyleTag({ path: path.resolve("src/app", f) });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([加, 项目模式]) => (window as unknown as { __render: (a: unknown, b: boolean) => void }).__render(加, 项目模式), [opt.加, !!opt.项目模式] as const);
  await page.locator(".rec-contact").first().waitFor();
  return page;
}
/** 号码保护标签的字色：绿（g 明显大于 r、b）还是灰（三通道差不多） */
async function 保护色(page: Page) {
  return page.locator(".rec-contact-guard").first().evaluate((el) => {
    const [r, g, b] = getComputedStyle(el).color.match(/[\d.]+/g)!.map(Number);
    return { 绿: g > r + 20 && g > b + 20, 灰: Math.max(r, g, b) - Math.min(r, g, b) < 12, 类: el.className.includes("ant-tag-green") };
  });
}
/** 号码保护标签字和底的对比度（WCAG 相对亮度）：浅色原来 --text-muted 压 --tag-bg 只有 4.30，要 ≥ 4.5（AA） */
async function 保护对比(page: Page) {
  return page.locator(".rec-contact-guard").first().evaluate((el) => {
    const 亮 = (s: string) => {
      const [r, g, b] = s.match(/[\d.]+/g)!.slice(0, 3).map((x) => Number(x) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const cs = getComputedStyle(el);
    const [a, b] = [亮(cs.color), 亮(cs.backgroundColor)].sort((x, y) => y - x);
    return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
  });
}
it("号码保护标签字底对比浅深都 ≥ 4.5（AA）", async () => {
  for (const 暗 of [false, true]) {
    const page = await open({ 暗 });
    try {
      expect(await 保护对比(page), 暗 ? "深色" : "浅色").toBeGreaterThanOrEqual(4.5);
      // 不是绿（绿只给「完成」）；深色的 --ink-soft 略偏冷，不按「三通道差 < 12」判灰
      expect((await 保护色(page)).绿).toBe(false);
    } finally { await page.close(); }
  }
}, 60_000);
it("每人一组、先露 3 位，号码保护灰底加锁，附件「— ＋ 添加」，卡头「＋ 新增」", async () => {
  const page = await open();
  try {
    expect(await page.locator(".rec-cg").count()).toBe(3);
    expect(await page.getByTestId("contact-more").count()).toBe(0);
    expect(await page.locator(".rec-contact-rest-btn").innerText()).toBe("展开其余 1 位");
    expect(await 保护色(page)).toEqual({ 绿: false, 灰: true, 类: true });
    expect(await page.locator(".rec-contact-guard .anticon-lock").count()).toBe(2);
    // 11-24 起号码保护单独一行：字段名「号码保护」，标签里只写状态
    expect(await page.locator(".rec-contact-line", { has: page.locator(".rec-contact-guard") }).locator(".rec-contact-k").allInnerTexts()).toEqual(Array(3).fill("号码保护"));
    expect((await page.locator(".rec-contact-guard").allInnerTexts()).every(t => t === "已开启" || t === "已关闭")).toBe(true);
    expect((await page.getByRole("button", { name: "新增联系人" }).innerText()).trim()).toBe("新增");
    expect(await page.locator(".att-empty").count()).toBeGreaterThan(0);
    expect(await page.getByRole("button", { name: /^展开没填的 \d+ 项$/ }).count()).toBe(1);
  } finally { await page.close(); }
}, 60_000);

// E-260（11-24 客户「客户没有电话这一说法」）：资料卡不摆「电话」格，客户电话那格还有老值也不摆，号码都在联系人卡上
for (const width of [1366, 1024])
  it(`${width} 宽：资料卡没有「电话」格（客户电话有老值也不摆）`, async () => {
    const page = await open({ width, 项目模式: true, 加: { 客户改: { phone: "13800138000" } } });
    try {
      expect(await page.locator("aside [data-field='phone']").count()).toBe(0);
      expect(await page.locator("aside .rec-field-k").filter({ hasText: /^电话$/ }).count()).toBe(0);
    } finally { await page.close(); }
  }, 60_000);

it("改不了资料（总管理看别人的客户）：资料格不是 role=button、没有笔，悬停说为什么", async () => {
  const 话 = "只有负责人或系统管理员能改客户资料（上级、条线总管理只能看、转让）";
  const 能改 = await open({ 项目模式: true });
  try { expect(await 能改.locator("aside .rec-field[role='button']").count()).toBeGreaterThan(0); } finally { await 能改.close(); }
  const page = await open({ 项目模式: true, 加: { 资料改挡: { 话, 公海: false } } });
  try {
    expect(await page.locator("aside .rec-field[role='button']").count()).toBe(0);
    expect(await page.locator(".rec-field-pen").count()).toBe(0);
    expect(await page.locator("[data-field='name']").getAttribute("title")).toBe(话);
    expect(await page.getByTestId("pool-edit-note").count()).toBe(0);
  } finally { await page.close(); }
}, 60_000);

it("公海客户：资料格不是 role=button、没有笔，「先领取或分配，再改」写在资料卡里", async () => {
  const 话 = "公海里的客户先领取或分配，再改";
  const page = await open({ 项目模式: true, 加: { 资料改挡: { 话, 公海: true } } });
  try {
    expect(await page.locator("aside .rec-field[role='button']").count()).toBe(0);
    expect(await page.locator(".rec-field-pen").count()).toBe(0);
    expect(await page.getByTestId("pool-edit-note").innerText()).toBe(话);
  } finally { await page.close(); }
}, 60_000);

it("D5 遗留 · 公海客户的联系人：服务端改联系人、挂靠、附件都要先领取——编辑笔、卡头「新增」都不摆；不在公海照旧有", async () => {
  const 话 = "公海里的客户先领取或分配，再改";
  const 自己的 = await open({ 项目模式: true });
  try {
    expect(await 自己的.locator(".rec-contact-edit").count()).toBeGreaterThan(0);
    expect(await 自己的.getByRole("button", { name: "新增联系人" }).count()).toBe(1);
  } finally { await 自己的.close(); }
  const 公海 = await open({ 项目模式: true, 加: { 资料改挡: { 话, 公海: true } } });
  try {
    expect(await 公海.locator(".rec-contact-edit").count()).toBe(0);
    expect(await 公海.getByRole("button", { name: /编辑联系人/ }).count()).toBe(0);
    expect(await 公海.getByRole("button", { name: "新增联系人" }).count()).toBe(0);
  } finally { await 公海.close(); }
}, 60_000);

it("#403 审查 · 公海客户：改的入口不摆，删按删除挡另判——系统管理员照常有「删除」（不给「移出」）和联系人附件的删；删不了的人两样都没有", async () => {
  const 话 = "公海里的客户先领取或分配，再改";
  for (const 能删 of [true, false]) {
    // 跟进去处 null = 没开项目模式（项目模式下客户页本来就不给删联系人，U-客户-03；联系人附件的删两种模式都有）
    const page = await open({ 加: { 资料改挡: { 话, 公海: true, 公海删: { 联系人: 能删, 附件: 能删 } }, 联系人分类附件数: { c1: { 名片: 1 } }, 跟进去处: null } });
    try {
      const 标 = `能删=${能删}`;
      expect(await page.locator(".rec-contact-edit").count(), 标).toBe(0);
      // 「移出 / 删除」那一块（这里打桩成一个占位）：能删的人每位都有、而且只给「删除」（只删）；删不了的人没有
      const 删块 = page.locator('[data-testid="contact-remove"]');
      expect(await 删块.filter({ hasText: "c1" }).count(), 标).toBe(能删 ? 1 : 0);
      if (!能删) expect(await 删块.count(), 标).toBe(0);
      expect(new Set(await 删块.evaluateAll(es => es.map(e => e.getAttribute("data-only-delete")))), 标).toEqual(new Set(能删 ? ["1"] : []));
      // 联系人附件：只看（附件区 只读 = 不传），能删的人给 能删（附件区里每张的删按 可删 = !只读 || 能删 摆；附件区这里打桩，看传进去的参数）
      await page.locator(".rec-contact").first().getByRole("button", { name: "张三 的附件" }).first().click();
      const 区 = page.locator(".ant-modal").filter({ hasText: "名片 · 张三" }).getByTestId("att-panel");
      await 区.waitFor({ state: "attached" });
      expect([await 区.getAttribute("data-readonly"), await 区.getAttribute("data-can-del")], 标).toEqual(["1", 能删 ? "1" : "0"]);
    } finally { await page.close(); }
  }
}, 60_000);

it.each([390, 1366])("%ipx · 3704 实操：联系人的长微信号（wxid_ 一整串）在卡内断行，不出卡片右边", async (width) => {
  const 长 = "wxid_" + "a1b2c3d4e5f6g7h8".repeat(4);
  const 人 = { id: "c1", name: "张三", position: "采购总监", phone: "13800138000", email: null, wechat: 长, isPrimary: true, remark: null, updatedAt: "2026-01-01T00:00:00.000Z" };
  const page = await open({ width, 加: { contacts: [人] } });
  try {
    const 组 = page.locator(".rec-contact").first();
    const 值 = 组.locator(".rec-contact-v").filter({ hasText: 长 });
    await 值.waitFor();
    const [组盒, 值盒] = await Promise.all([组.boundingBox(), 值.boundingBox()]);
    expect(值盒!.x + 值盒!.width).toBeLessThanOrEqual(组盒!.x + 组盒!.width + 0.5);
    // 断成了多行（行数按盒子判断，不看字体高）：值的盒子比一行的号码高
    const 一行 = (await 组.locator(".rec-contact-num .rec-contact-v").first().boundingBox())!.height;
    expect(值盒!.height).toBeGreaterThan(一行 * 1.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await page.close(); }
});

it("D4 · 待办空态：「还没有待办」", async () => {
  const page = await open();
  try { expect(await page.getByText("还没有待办", { exact: true }).count()).toBe(1); } finally { await page.close(); }
}, 60_000);
