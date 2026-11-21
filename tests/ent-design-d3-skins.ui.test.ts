import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
/* D3 · 设计语言 11-21：客户页左栏的结构改动（联系人每人一组、号码保护灰底加锁、附件「— ＋ 添加」、卡头「＋ 新增」、「展开没填的」、
   背调「无」不挂标签、新建联系人标题和规矩行）只在现状主题出；换皮主题保持原样（用户 11-21「主题不动」，PR #401 审查必修 2）。
   这里拿账本、科技两套主题量结构和颜色：联系人仍是第一位摊开 + 其余手风琴，号码保护仍是绿标签；
   现状主题对照一遍新结构，再在页面上换主题，看不刷新也跟着换（lib/use-skin.ts） */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "d3-skins-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)tri-state-actions$/, "export const 三态继续持有=async()=>({ok:false,error:\"\"}),三态暂缓回收=三态继续持有,三态让同事结束项目=三态继续持有;");
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null,发起主体选项=async()=>null,我常用的沟通方式=async()=>null;");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>\"/customers/x\";");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(^|\/)ContactForm$/, "export default function F(){return null}");
  stub(/(^|\/)(TaskForm|PlanForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|LinkedCustomers|NewProjectEntry)$/, "export default function Empty(){return null}");
  // 新结构经 ContactLinks 摆组头和行；旧结构不给 头，ContactLinks 只摆挂靠那几行（这里没有）
  stub(/(^|\/)ContactLinks$/, "export default function L(p){return <>{p.头?.(null)}{p.children}</>}");
  stub(/(^|\/)AttachmentsPanel$/, "export default function P(){return null}");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({});export const ContactRemoveInline=()=>null;");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海,退回原因选项=async()=>[];");
  stub(/^\.\.\/actions$/, "export const saveCustomerNumbers=async()=>({ok:true}),转走项目预览of=async()=>({项目数:0,项目:[]}),patchCustomer=async()=>({ok:true}),deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=async()=>({ok:true});");
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

async function open(skin: "now" | "ledger" | "tech", opt: { width?: number; 项目模式?: boolean; 加?: Record<string, unknown> } = {}) {
  const page = await browser.newPage({ viewport: { width: opt.width ?? 1366, height: 900 } }); page.setDefaultTimeout(5000);
  await page.route("http://skins.test/**", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html data-skin="${skin}" data-paper="tone" data-mode="light"><meta charset='utf-8'><div id='root'></div></html>` }));
  await page.goto("http://skins.test");
  for (const f of ["globals.css", "skins/shared.css", "skins/ledger.css", "skins/tech.css"]) await page.addStyleTag({ path: path.resolve("src/app", f) });
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
async function 旧结构(page: Page) {
  // 第一位摊开（头里职务 + 号码保护）、其余三位收成手风琴
  expect(await page.locator(".rec-cg").count()).toBe(0);
  expect(await page.getByTestId("contact-more").count()).toBe(1);
  expect(await page.locator(".rec-contact-fold").count()).toBe(3);
  expect(await page.locator(".rec-contact-tog").count()).toBe(3);
  expect(await page.locator(".rec-contact-rest-btn").count()).toBe(0);
  const 首位头 = page.locator(".rec-contact").first().locator(".rec-contact-h");
  expect(await 首位头.locator(".rec-contact-p").innerText()).toBe("采购总监");
  expect(await 首位头.locator(".rec-contact-guard").count()).toBe(1);
  expect(await 首位头.locator(".ant-avatar").evaluate((el) => el.getBoundingClientRect().width)).toBe(26);
  // 号码保护：绿标签、没有锁
  expect(await 保护色(page)).toEqual({ 绿: true, 灰: false, 类: true });
  expect(await page.locator(".rec-contact-guard .anticon").count()).toBe(0);
  // 卡头「＋」只有图标；附件空格照旧一句「添加名片」；资料「展开更多」
  const 加 = page.getByRole("button", { name: "新增联系人" });
  expect((await 加.innerText()).trim()).toBe("");
  expect(await page.locator(".rec-contact").first().getByRole("button", { name: /的附件$/ }).first().innerText()).toBe("添加名片");
  expect(await page.locator(".att-empty").count()).toBe(0);
  expect(await page.getByRole("button", { name: /^展开更多 \d+ 项$/ }).count()).toBe(1);
  // 手风琴点开一位，摊开整张
  await page.locator(".rec-contact-tog").first().click();
  expect(await page.locator(".rec-contact-fold.is-open").count()).toBe(1);
}

for (const skin of ["ledger", "tech"] as const)
  it(`${skin}：联系人仍是第一位摊开 + 其余手风琴，号码保护仍是绿标签，附件、卡头、展开键照旧`, async () => {
    const page = await open(skin);
    try { await 旧结构(page); } finally { await page.close(); }
  }, 60_000);

it("现状主题：每人一组、先露 3 位，号码保护灰底加锁，附件「— ＋ 添加」，卡头「＋ 新增」；页面上换成账本不刷新也回到旧结构", async () => {
  const page = await open("now");
  try {
    expect(await page.locator(".rec-cg").count()).toBe(3);
    expect(await page.getByTestId("contact-more").count()).toBe(0);
    expect(await page.locator(".rec-contact-rest-btn").innerText()).toBe("展开其余 1 位");
    expect(await 保护色(page)).toEqual({ 绿: false, 灰: true, 类: true });
    expect(await page.locator(".rec-contact-guard .anticon-lock").count()).toBe(2);
    expect((await page.getByRole("button", { name: "新增联系人" }).innerText()).trim()).toBe("新增");
    expect(await page.locator(".att-empty").count()).toBeGreaterThan(0);
    expect(await page.getByRole("button", { name: /^展开没填的 \d+ 项$/ }).count()).toBe(1);
    await page.evaluate(() => { document.documentElement.dataset.skin = "ledger"; });
    await page.getByTestId("contact-more").waitFor();
    await 旧结构(page);
  } finally { await page.close(); }
}, 60_000);

/** 资料卡里能点的格：没有笔、行不因为笔变高（换皮主题；PR #401 实操：antd 图标的 display 盖掉了 display:none，笔单占一行） */
async function 无笔不增高(page: Page) {
  expect(await page.locator(".rec-field-pen").count()).toBe(0);
  const 格们 = await page.locator("aside .rec-field[role='button']").evaluateAll((els) => els.map((el) => {
    const cs = getComputedStyle(el); const k = el.querySelector(".rec-field-k")!.getBoundingClientRect(); const v = el.querySelector(".rec-field-v")?.getBoundingClientRect();
    const 内高 = el.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return { 字段: (el as HTMLElement).dataset.field, 多出: Math.round(内高 - Math.max(k.height, v?.height ?? 0)), 右边: cs.paddingRight };
  }));
  expect(格们.length).toBeGreaterThan(0);
  expect(格们.filter((x) => x.多出 > 1 || x.右边 === "24px")).toEqual([]);
}
for (const skin of ["ledger", "tech"] as const)
  it(`${skin}：资料格没有编辑笔、行高不变`, async () => {
    const page = await open(skin, { 项目模式: true });
    try { await 无笔不增高(page); } finally { await page.close(); }
  }, 60_000);

for (const width of [1366, 1024])
  for (const 号 of ["+905079844574", "13800138000"])
    it(`现状主题 ${width} 宽：资料「电话」${号.length} 位号码整串一行，复制键跟在号码后面同一行`, async () => {
      const page = await open("now", { width, 项目模式: true, 加: { 客户改: { phone: 号 } } });
      try {
        const r = await page.locator("[data-field='phone']").evaluate((el) => {
          const t = el.querySelector(".copy-val-t")!.getBoundingClientRect(); const b = el.querySelector(".copy-val-b")!.getBoundingClientRect();
          return { 号高: Math.round(t.height), 同行: Math.abs((b.top + b.bottom) / 2 - (t.top + t.bottom) / 2) < 6, 在后面: b.left >= t.right - 1, 不出格: b.right <= el.getBoundingClientRect().right };
        });
        expect(r).toEqual({ 号高: 22, 同行: true, 在后面: true, 不出格: true });
      } finally { await page.close(); }
    }, 60_000);

it("改不了资料（总管理看别人的客户）：资料格不是 role=button、没有笔，悬停说为什么", async () => {
  const 话 = "只有负责人或系统管理员能改客户资料（上级、条线总管理只能看、转让）";
  const 能改 = await open("now", { 项目模式: true });
  try { expect(await 能改.locator("aside .rec-field[role='button']").count()).toBeGreaterThan(0); } finally { await 能改.close(); }
  const page = await open("now", { 项目模式: true, 加: { 资料改挡: { 话, 公海: false } } });
  try {
    expect(await page.locator("aside .rec-field[role='button']").count()).toBe(0);
    expect(await page.locator(".rec-field-pen").count()).toBe(0);
    expect(await page.locator("[data-field='name']").getAttribute("title")).toBe(话);
    expect(await page.getByTestId("pool-edit-note").count()).toBe(0);
  } finally { await page.close(); }
}, 60_000);

it("公海客户：资料格不是 role=button、没有笔，「先领取或分配，再改」写在资料卡里", async () => {
  const 话 = "公海里的客户先领取或分配，再改";
  const page = await open("now", { 项目模式: true, 加: { 资料改挡: { 话, 公海: true } } });
  try {
    expect(await page.locator("aside .rec-field[role='button']").count()).toBe(0);
    expect(await page.locator(".rec-field-pen").count()).toBe(0);
    expect(await page.getByTestId("pool-edit-note").innerText()).toBe(话);
  } finally { await page.close(); }
}, 60_000);

it("D4 · 待办空态：现状主题「还没有待办」，换皮主题照旧「暂无待办」", async () => {
  for (const [skin, 话] of [["now", "还没有待办"], ["ledger", "暂无待办"], ["tech", "暂无待办"]] as const) {
    const page = await open(skin);
    try { expect(await page.getByText(话, { exact: true }).count(), skin).toBe(1); } finally { await page.close(); }
  }
}, 60_000);
