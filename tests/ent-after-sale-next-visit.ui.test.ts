import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/*
  E-283 第 1 条：项目页「记售后回访」（RecordFollowModal 售后态）加「下次回访（选填）」——
  能排的人（p.能排下次回访：客户负责人、这位客户下项目的负责人）摆日期格，选了保存带 下次回访: YYYY-MM-DD，回执说排在哪天；
  组员（能记不能排，P-沟通-04）不摆这一格、保存也不带。390（手机）和 1280 都能打开、存得上
*/
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "after-sale-next-visit", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/coach-topic-actions$/, "const f=async()=>({ok:true});export const 发主题动作=f,回复主题动作=f,关闭主题动作=f,删主题动作=f;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\.\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", `export const 记项目沟通Action=async(...a)=>{(window.__记沟通||=[]).push(a);return window.__记沟通回??{ok:true,followUpId:'fx'}};`));
  stub(/^\.\.\/commission-actions$/, `const f=${空跑};export const 存项目底价=f,存提成分配=f,更正实际提成=f;`);
  stub(/(^|\/)schedule-actions$/, 补全动作桩("src/app/(app)/leads/schedule-actions.ts", ""));
  stub(/^\.\.\/payment-actions$/, `const f=${空跑};export const 记回款=f,删回款=f;`);
  stub(/readonly-card-actions$/, 补全动作桩("src/app/(app)/projects/[id]/readonly-card-actions.ts", ""));
  stub(/giveup-actions$/, 补全动作桩("src/app/(app)/projects/[id]/giveup-actions.ts", ""));
  stub(/^\.\/blocker-actions$/, `const f=${空跑};export const 发布卡点Action=f,认领卡点Action=f,完成卡点Action=f,删卡点Action=f,存卡点默认Action=f,存卡点角色开关Action=f,新增原因Action=f,改原因名Action=f,改原因状态Action=f,删原因Action=f,合并原因Action=f;`);
  stub(/customers\/\[id\]\/ai$/, `export const parseFollowUpDraft=async()=>({ok:false,error:"未启用"});`);
  stub(/^\.\.\/relate-actions$/, `const f=${空跑};export const 加关联客户Action=f,改客户身份Action=f,解除关联客户Action=f,加关联联系人Action=f,改联系人角色立场Action=f,解除关联联系人Action=f,搜项目联系人=async()=>[];`);
  stub(/^\.\.\/\.\.\/favorites$/, `export const 切换项目收藏=async()=>({ok:true,收藏了:true});`);
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[];");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ProjectDetail from '@/app/(app)/projects/[id]/ProjectDetail';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 基={id:'p1',name:'交付项目甲',remark:null,amount:100000,currency:'CNY',customer:{id:'c1',name:'客户甲',school:''},contact:null,
      来源线索:null,原因选项:{回收:[],无效:[]},ownerId:'qa',ownerName:'组长甲',creatorName:'组长甲',createdAt:'2026-01-01T00:00:00.000Z',historyOwners:[],
      phase:'订单',node:'交付',result:'交付结清',exceptionReason:null,exceptionCategory:null,pooled:false,能放公海:false,能领取:false,领取不给:null,进公海:null,出口叫法:{},有效沟通差:[],
      nextStepAt:null,回收日:null,expectedDealAt:null,要下一步:false,必填:null,不给推:null,能改节点:false,能转让:false,
      balanceSettled:true,balanceSettledBy:null,balanceSettledAt:null,acceptancePassed:true,acceptancePassedBy:null,acceptancePassedAt:null,
      logs:[],followUps:[],members:[],删前清点:{留痕:0,组员:0,沟通:0},企业版:true,能记沟通:false,能记售后回访:true,组员记沟通:false,aiEnabled:false};
    window.__render=(x)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <ProjectDetail p={{...基,...x}} 能改={false} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={null}/></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number, x: object) {
  const page = await browser.newPage({ viewport: { width, height: 860 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://proj.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://proj.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(v => (window as unknown as { __render: (x: object) => void }).__render(v), x);
  await page.getByTestId("after-sale-visit").waitFor();
  return { page, errors };
}
/** 业务日历的今天往后 n 天（测试机时区和北京差不出一天以外，取 10 天后足够稳） */
const 往后 = (n: number) => { const d = new Date(Date.now() + n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

it.each([390, 1280])("%ipx：能排的人——记售后回访框里有「下次回访（选填）」，选了日期保存带 下次回访，回执说排在哪天", async (w) => {
  const { page, errors } = await open(w, { 能排下次回访: true });
  try {
    const 日 = 往后(10);
    await page.evaluate(d => { (window as unknown as { __记沟通回: object }).__记沟通回 = { ok: true, followUpId: "fx", 下次计划id: "pl1", 下次回访: d }; }, 日);
    await page.getByTestId("after-sale-visit").click();
    const 框 = page.locator(".follow-modal .ant-modal");
    await 框.waitFor();
    expect(await 框.locator(".ant-modal-title").innerText()).toBe("记售后回访");
    const 格 = 框.locator('[data-fk="下次回访"]');
    expect(await 格.innerText()).toContain("下次回访（选填）");
    // 下一步那两格售后态照旧不摆
    expect(await 框.locator('[data-fk="下一步计划"], [data-fk="下一步时间"]').count()).toBe(0);
    // 日期格整格在视口里（390 不横滚）
    const box = await 格.locator(".ant-picker").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(w);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // 今天以前的日子点不了
    await 格.locator("input").click();
    expect(await page.locator(".ant-picker-dropdown .ant-picker-cell-today").first().getAttribute("class")).not.toContain("disabled");
    await 格.locator("input").fill(日);
    await page.keyboard.press("Enter");
    expect(await 格.locator("input").inputValue()).toBe(日);
    await 框.getByLabel("沟通内容").fill("回访了使用情况，客户说设备运行稳定");
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await 框.waitFor({ state: "detached" });
    const 交 = await page.evaluate(() => (window as unknown as { __记沟通: unknown[][] }).__记沟通);
    expect(交).toHaveLength(1);
    expect(交[0][0]).toBe("p1");
    expect(交[0][1]).toMatchObject({ 售后回访: true, 下次回访: 日 });
    expect(交[0][1]).not.toHaveProperty("下一步");
    const [, 月, 天] = 日.split("-").map(Number);
    await page.getByText(`下次回访排在 ${月} 月 ${天} 日`).waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("不选日期照常保存：不带 下次回访；组员（能记不能排）框里没有这一格", async () => {
  const { page, errors } = await open(1280, { 能排下次回访: true });
  try {
    await page.getByTestId("after-sale-visit").click();
    const 框 = page.locator(".follow-modal .ant-modal");
    await 框.getByLabel("沟通内容").fill("回访了使用情况，客户说设备运行稳定");
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await 框.waitFor({ state: "detached" });
    const 交 = await page.evaluate(() => (window as unknown as { __记沟通: unknown[][] }).__记沟通);
    expect(交[0][1]).toMatchObject({ 售后回访: true });
    expect(交[0][1]).not.toHaveProperty("下次回访");
    // 组员
    await page.evaluate(() => (window as unknown as { __render: (x: object) => void }).__render({ 能排下次回访: false }));
    await page.getByTestId("after-sale-visit").click();
    await 框.waitFor();
    expect(await 框.locator('[data-fk="沟通内容"]').count()).toBe(1);
    expect(await 框.locator('[data-fk="下次回访"]').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("服务端说排不了（期间权限变了）：回访照记，回执说下次回访没排上", async () => {
  const { page } = await open(1280, { 能排下次回访: true });
  try {
    await page.evaluate(() => { (window as unknown as { __记沟通回: object }).__记沟通回 = { ok: true, followUpId: "fx", 下次没排: "只有负责人能改这位客户的待办、计划和联系人" }; });
    await page.getByTestId("after-sale-visit").click();
    const 框 = page.locator(".follow-modal .ant-modal");
    await 框.locator('[data-fk="下次回访"] input').click();
    await 框.locator('[data-fk="下次回访"] input').fill(往后(10));
    await page.keyboard.press("Enter");
    await 框.getByLabel("沟通内容").fill("回访了使用情况，客户说设备运行稳定");
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await 框.waitFor({ state: "detached" });
    await page.getByText(/下次回访没排上：只有负责人能改/).waitFor();
  } finally { await page.close(); }
});
