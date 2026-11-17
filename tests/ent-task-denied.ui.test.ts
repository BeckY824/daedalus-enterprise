import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* PR10a ①：客户详情「待办」卡勾完成 / 删除被服务端挡了（权限：本人勾完成挡 / 客户事项挡回 ok:false），
   原来不看返回值照样提示「已完成」「待办已删除」、勾选留着。现在：不提示成功、给出被挡的那句、勾选回滚、条目还在。
   服务端动作换成假的（window.__toggle / __delete 决定回什么），打包方式同 ent-record-left.ui.test.ts */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "task-denied-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)tri-state-actions$/, "export const 三态继续持有=async()=>({ok:false,error:\"\"}),三态暂缓回收=三态继续持有,三态让同事结束项目=三态继续持有;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;", "async()=>null"));
  stub(/(^|\/)InlineField$/, "export default function Inline(p){return <div className='rec-field' data-field={p.field}>{p.label}: {p.显示&&p.value?p.显示(p.value):p.value}</div>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__refreshed=(window.__refreshed??0)+1},push(){}});export const usePathname=()=>\"/customers/x\";");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(^|\/)(ContactForm|TaskForm|PlanForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|LinkedCustomers|NewProjectEntry|ContactLinks)$/, "export default function Empty(){return null}");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({});export const ContactRemoveInline=()=>null;");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海,退回原因选项=async()=>[];");
  stub(/^\.\.\/actions$/, "export const 转走项目预览of=async()=>(window.__预览??{项目数:0,项目:[]});export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=async()=>({ok:true});");
  stub(/^\.\/useCustomerResearch$/, "export function CustomerResearchCard(){return null} export function CustomerResearchTag(){return null}");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  stub(/projects\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "export const 项目沟通须知=async()=>({ok:true,能记:false}),记项目沟通Action=async()=>({ok:true});"));
  stub(/^\.\/actions$/, `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async(id,v)=>{(window.__calls??=[]).push(['toggleTask',id,v]);return window.__toggle??{ok:true}};
    export const deleteTask=async(id)=>{(window.__calls??=[]).push(['deleteTask',id]);return window.__delete??{ok:true}};
    export const completePlan=async(id,v)=>{(window.__calls??=[]).push(['completePlan',id,v]);return (v===false?window.__planUndo:window.__planDone)??{ok:true}};
    export const 撤销记一笔=async()=>({ok:true}),saveFollowUp=撤销记一笔,deleteFollowUp=撤销记一笔;
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
    export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'p1'});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Record from '@/app/(app)/customers/[id]/RecordView';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const tasks=[{id:'t1',title:'整理报价单',dueAt:null,done:false},{id:'t2',title:'寄样品',dueAt:null,done:false}];
    root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><Record customer={{id:'a',extra:null,name:'客户A',phone:'13800138000',school:null,grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z'}} contacts={[]} contracts={[]} opportunities={[]} tasks={tasks} plan={window.__plan??null} users={[]} channels={[]} aiEnabled={false} followUps={[]} followUpsHasMore={false} 项目们={window.__plan?null:[]} 旺旺们={[]}/></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 挡话 = "只有客户负责人和上级能改这位客户的待办";
async function open(回: { toggle?: unknown; delete?: unknown; plan?: unknown; planDone?: unknown } = {}, width = 1366): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://task.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://task.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.evaluate((x) => { const w = window as unknown as Record<string, unknown>; w.__toggle = x.toggle; w.__delete = x.delete; w.__plan = x.plan; w.__planDone = x.planDone; }, 回);
  await page.addScriptTag({ content: bundle });
  await page.getByRole("checkbox", { name: "完成 整理报价单" }).waitFor();
  return { page, errors };
}
const 调用们 = (page: Page) => page.evaluate(() => (window as unknown as { __calls?: unknown[][] }).__calls ?? []);
/** 页面上所有提示（顶部提示、底部撤销条）里的字：被挡时都不该出现成功的话（PR7b 起成功走底部撤销条，被挡原因就地写在那一行） */
const 提示 = (page: Page) => page.evaluate(() => [".ant-message", "#undo-host"].map((q) => (document.querySelector(q) as HTMLElement | null)?.innerText ?? "").join("\n"));

it("勾完成被权限挡：不提示「已完成」，提示被挡的那句，勾选回滚、条目还在", async () => {
  const { page, errors } = await open({ toggle: { ok: false, error: 挡话 } });
  try {
    const 勾 = page.getByRole("checkbox", { name: "完成 整理报价单" });
    await 勾.click();
    await page.getByText(挡话).waitFor();
    expect(await 调用们(page)).toEqual([["toggleTask", "t1", true]]);
    expect(await 提示(page)).not.toContain("已完成");
    await expect.poll(() => 勾.isChecked()).toBe(false);
    // 不划线、不收起：过了 5 秒那条留几秒的计时也不该把它收走
    expect(await page.locator(".rec-task.is-done").count()).toBe(0);
    await page.waitForTimeout(5600);
    expect(await page.getByRole("checkbox", { name: "完成 整理报价单" }).count()).toBe(1);
    expect(await 勾.isChecked()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30_000);

it("删除待办被权限挡：不提示「待办已删除」，提示被挡的那句，条目还在", async () => {
  const { page, errors } = await open({ delete: { ok: false, error: 挡话 } });
  try {
    const 行 = page.locator(".rec-task", { hasText: "寄样品" });
    await 行.getByRole("button", { name: "删除待办" }).click();
    await 行.getByText("删除这条？").waitFor();
    await 行.getByRole("button", { name: "删除", exact: true }).click();
    await page.getByText(挡话).waitFor();
    expect(await 调用们(page)).toEqual([["deleteTask", "t2"]]);
    expect(await 提示(page)).not.toContain("待办已删除");
    expect(await page.getByRole("checkbox", { name: "完成 寄样品" }).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("服务端放行：勾完成走底部撤销条「已完成」带撤销；删除就地确认后直接删、不弹提示、行里没有被挡的话", async () => {
  const { page } = await open();
  try {
    await page.getByRole("checkbox", { name: "完成 整理报价单" }).click();
    const 条 = page.locator("#undo-host");
    await expect.poll(() => 条.innerText().catch(() => "")).toContain("「整理报价单」已完成");
    await 条.getByRole("button", { name: /撤\s*销/ }).waitFor();
    const 行 = page.locator(".rec-task", { hasText: "寄样品" });
    await 行.getByRole("button", { name: "删除待办" }).click();
    await 行.getByRole("button", { name: "删除", exact: true }).click();
    await expect.poll(() => 调用们(page)).toContainEqual(["deleteTask", "t2"]);
    expect(await 行.getByRole("alert").count()).toBe(0);
    expect(await page.locator(".ant-message").innerText().catch(() => "")).not.toContain("待办已删除");
  } finally { await page.close(); }
});

it("被挡的原因在 Windows 常见宽度（1024 / 1280 / 1366）就地显示、不溢出、页面不横滚", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page } = await open({ toggle: { ok: false, error: 挡话 } }, w);
    try {
      await page.getByRole("checkbox", { name: "完成 整理报价单" }).click();
      const 字 = page.getByText(挡话);
      await 字.waitFor();
      // 被挡的原因就地写在那一行（role=alert，PR7b 起不弹顶部提示）：整句在视口里、没横向溢出
      const 框 = await 字.evaluate((el) => {
        const x = el.closest("[role=alert]") as HTMLElement | null;
        const r = (x ?? (el as HTMLElement)).getBoundingClientRect();
        return { 左: r.left, 右: r.right, 找到: !!x?.closest(".rec-task") && x.scrollWidth <= x.clientWidth + 1 };
      });
      expect(框.找到).toBe(true);
      expect(框.左).toBeGreaterThanOrEqual(0);
      expect(框.右).toBeLessThanOrEqual(w);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } finally { await page.close(); }
  }
});

/* RecordView 剩下的 message.*（PR7b 第三批）：「下次跟进」完成走底部撤销条 +「排下一次」文字链接；没成原因就地写、不报成功。
   「下次跟进」只在非项目模式摆（客户页摆法），所以给了 __plan 时按非企业版渲染（项目们 = null） */
const 计划 = { id: "pl1", subject: "回访报价", method: "电话沟通", plannedAt: "2026-11-10T02:00:00.000Z" };
async function 跳过完成(page: Page) {
  await page.locator(".rec-plan").getByRole("button", { name: /完\s*成/ }).click();
  await page.getByRole("button", { name: "跳过，直接完成" }).click();
}

it("下次跟进完成：底部撤销条「已完成」能撤；那块就地写一句 + 「排下一次」文字链接，不弹顶部提示", async () => {
  const { page, errors } = await open({ plan: 计划 });
  try {
    await 跳过完成(page);
    const 条 = page.locator("#undo-host");
    await expect.poll(() => 条.innerText().catch(() => "")).toContain("「回访报价」已完成");
    expect(await page.locator(".ant-message").innerText().catch(() => "")).toBe("");
    // 刷新回来前那块先变成「已完成」那句 + 排下一次（不再摆这条计划）
    const 说 = page.locator(".rec-plan-said");
    await 说.getByRole("button", { name: "排下一次" }).waitFor();
    expect(await page.locator(".rec-plan").count()).toBe(0);
    // 撤销 = completePlan(id, false)，计划摆回来
    await 条.getByRole("button", { name: /撤\s*销/ }).click();
    await expect.poll(() => 调用们(page)).toContainEqual(["completePlan", "pl1", false]);
    await page.locator(".rec-plan").waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("下次跟进完成被挡：原因就地写在那块上面、不出撤销条、不说已完成，计划还在", async () => {
  const { page, errors } = await open({ plan: 计划, planDone: { ok: false, error: 挡话 } });
  try {
    await 跳过完成(page);
    await page.getByRole("alert").filter({ hasText: 挡话 }).waitFor();
    expect(await 提示(page)).not.toContain("已完成");
    expect(await page.locator(".rec-plan").count()).toBe(1);
    expect(await page.getByRole("button", { name: "排下一次" }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
