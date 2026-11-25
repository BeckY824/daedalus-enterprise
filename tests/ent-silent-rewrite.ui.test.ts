/**
 * 11-17 复盘第 4 类「输入被悄悄改写」+ 沟通方式没填显示「—」，界面这一头：
 *
 *   AI 卡金额框（签约卡 ProposalCard、回款卡 ProjectProposalFields → components/AmountTextInput）：
 *     「1万」认成 10000（原来删掉非数字存成 1）；「-500」框下就地说认不出、确认灰着（原来存成 500）
 *   沟通方式没填（type = OTHER、method 空）：列表格 FollowTypeCell 显示「—」、项目名单那行小字省掉，都不显示「其他记录」；
 *     编辑下拉 FollowMethodSelect 留空（占位「—」），不自动选上「其他方式」
 *   1024 / 1280 / 1366：金额框带着那句错话不横向撑出
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "silent-rewrite", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>'/projects/p1';");
  stub(/^next\/link$/, "export default function L({children,...p}){return <a {...p}>{children}</a>}");
  stub(/^next\/dynamic$/, "export default ()=>()=>null;");
  stub(/dashboard\/apply$/, "export const applyProposal=async p=>{window.__交=p;return{ok:true}};export const undoProposal=async()=>({ok:true});");
  stub(/card-scan\/originals$/, "export const 取走名片原图=()=>null,记下刚建的=()=>{},忘掉刚建的=()=>{};");
  stub(/attachment-upload$/, "export const 传附件=async()=>({ok:true});");
  stub(/customers\/RescueKey$/, "export default function R(){return null}");
  stub(/customers\/RepeatInquiryKey$/, "export default function R(){return null}");
  stub(/customers\/DedupeClaimKey$/, "export default function D(){return null}");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>window.__方式们;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  // AI 记沟通卡（ProposalCard）问客户能挂哪些项目（沟通必须挂项目，11-17）：回 null = 不查项目，卡片照旧
  stub(/customers\/\[id\]\/actions$/, 补全动作桩("src/app/(app)/customers/[id]/actions.ts", "export const 沟通可选项目=async()=>({ok:true,项目们:null,能建项目:true});"));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React, {useState} from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import ProposalCard from '@/components/ProposalCard';
    import ProjectProposalFields from '@/components/ProjectProposalFields';
    import FollowMethodSelect from '@/components/FollowMethodSelect';
    import ProjectRoster from '@/components/ProjectRoster';
    import {FollowTypeCell} from '@/components/ui';
    const root=createRoot(document.getElementById('root'));
    const 包=(x)=><ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>{x}</BusinessProvider></App></ConfigProvider>;
    window.__签约=()=>root.render(包(<div className="cli-col"><ProposalCard proposal={{id:'p2',kind:'add_contract',customerId:'c1',customerName:'甲公司',reason:'x',amount:0,signedAt:'2026-11-17T00:00:00.000Z',remark:''}}/></div>));
    function 回款({币='CNY'}){const [d,setD]=useState({kind:'payment_add',targetId:'p1',targetName:'项目一',paidAt:'2026-11-17',currency:币,amount:0});window.__稿=d;return <div className="prop"><ProjectProposalFields draft={d} setDraft={setD}/></div>;}
    window.__回款=()=>root.render(包(<回款/>));
    window.__美元回款=()=>root.render(包(<回款 币='USD'/>));
    function 卡点卡(){const [d,setD]=useState({kind:'project_followup',targetId:'p1',targetName:'项目一',type:'PHONE',content:'聊了',下一步:'再聊',下一步时间:'',要卡点:true,卡点类型:'中度卡点',影响等级:'',阻碍原因:[],原因可选们:['价格预算分歧','需求变更']});window.__稿=d;return <div className="prop"><ProjectProposalFields draft={d} setDraft={setD}/></div>;}
    window.__卡点卡=()=>root.render(包(<卡点卡/>));
    window.__方式=()=>root.render(包(<div>
      <div data-testid="cells"><FollowTypeCell type="OTHER" method={null}/><FollowTypeCell type="OTHER" method="Telegram"/><FollowTypeCell type="PHONE" method={null}/></div>
      <div data-testid="sel-other"><FollowMethodSelect aria-label="沟通方式甲" type="OTHER" method={null} 类型们={[]} onChange={v=>{window.__改=v}}/></div>
      <div data-testid="sel-phone"><FollowMethodSelect aria-label="沟通方式乙" type="PHONE" method={null} 类型们={[]} onChange={()=>{}}/></div>
    </div>));
    const 行=(id,name,x)=>({id,name,阶段:'线索',进程:'初次接触',结局:null,pooled:false,customerName:'甲公司',lastType:'OTHER',lastMethod:null,lastAt:'2026-11-16T00:00:00.000Z',lastNote:'聊了',nextAt:null,...x});
    window.__名单=()=>root.render(包(<ProjectRoster data={{取到上限:false,rows:[行('p1','甲项目'),行('p2','乙项目',{pooled:true}),行('p3','丙项目',{lastMethod:'Telegram'})]}}/>));
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(画: string, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://rewrite.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://rewrite.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: "window.__方式们=['手机通话','微信沟通','Telegram','其他方式'];" });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((f) => (window as unknown as Record<string, () => void>)[f](), 画);
  return { page, errors };
}
const 金额框 = (page: Page) => page.getByRole("textbox", { name: "金额" });

it("签约卡金额：「1万」认成 10000 交上去；「-500」框下说认不出、确认灰着；1024 / 1280 / 1366 不横撑", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await open("__签约", w);
    try {
      await 金额框(page).fill("-500");
      await expect.poll(() => page.getByRole("alert").filter({ hasText: "认不出「-500」" }).count()).toBe(1);
      expect(await page.locator(".prop-ok").isDisabled()).toBe(true);
      expect(await 金额框(page).inputValue()).toBe("-500");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await 金额框(page).fill("1万");
      await expect.poll(() => page.getByRole("alert").filter({ hasText: "认不出" }).count()).toBe(0);
      expect(await 金额框(page).inputValue()).toBe("1万");
      expect(await page.locator(".prop-ok").isDisabled()).toBe(false);
      await page.locator(".prop-ok").click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __交?: { amount: number } }).__交?.amount)).toBe(10000);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("回款卡金额：「-500」框下说认不出、交上去的是 NaN（缺项拦确认）；「2.5万」认成 25000；清空 = 0", async () => {
  const { page, errors } = await open("__回款");
  try {
    const 稿 = () => page.evaluate(() => (window as unknown as { __稿: { amount: number } }).__稿.amount);
    await 金额框(page).fill("-500");
    await expect.poll(() => page.getByRole("alert").filter({ hasText: "认不出「-500」" }).count()).toBe(1);
    expect(Number.isNaN(await page.evaluate(() => (window as unknown as { __稿: { amount: number } }).__稿.amount))).toBe(true);
    await 金额框(page).fill("2.5万");
    await expect.poll(稿).toBe(25000);
    expect(await page.getByRole("alert").count()).toBe(0);
    // 11-20：带单位的框下写换算后的数；「3w」也认
    expect((await page.locator(".amount-text-conv").innerText()).trim()).toBe("= 25,000");
    await 金额框(page).fill("3w");
    await expect.poll(稿).toBe(30000);
    expect((await page.locator(".amount-text-conv").innerText()).trim()).toBe("= 30,000");
    await 金额框(page).fill("");
    await expect.poll(稿).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("AI 回款卡（美元）金额框：敲「5000元」「¥5万」框下说写的是人民币、币种是美元，交 NaN（拦确认）；「US$800」「$800」「800」认成 800（审查 11-20 第二轮）", async () => {
  const { page, errors } = await open("__美元回款");
  try {
    const 稿 = () => page.evaluate(() => { const a = (window as unknown as { __稿: { amount: number } }).__稿.amount; return Number.isNaN(a) ? "NaN" : a; });
    for (const 原 of ["5000元", "¥5万"]) {
      await 金额框(page).fill(原);
      await expect.poll(() => page.getByRole("alert").filter({ hasText: "写的是人民币，币种选的是美元" }).count()).toBe(1);
      expect(await 稿(), 原).toBe("NaN");
      // 对不上就只说对不上，不说「可带 ¥」那句
      expect(await page.getByRole("alert").innerText(), 原).not.toContain("可带");
      expect(await 金额框(page).inputValue(), 原).toBe(原);
    }
    for (const 原 of ["US$800", "$800", "800"]) {
      await 金额框(page).fill(原);
      await expect.poll(稿).toBe(800);
      expect(await page.getByRole("alert").count(), 原).toBe(0);
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([375, 1024, 1366])("AI 记沟通带卡点的卡（11-19）%ipx：没有卡点描述，阻碍原因能选、能直接打字新增（纯空格不算），不横撑", async (w) => {
  const { page, errors } = await open("__卡点卡", w);
  try {
    const 原因 = page.getByRole("combobox", { name: "阻碍原因" });
    await 原因.waitFor();
    expect(await page.getByText("卡点描述").count()).toBe(0);
    await 原因.click();
    await page.locator(".ant-select-item-option").filter({ hasText: "需求变更" }).click();
    await page.keyboard.type("   ");
    await page.keyboard.press("Enter");
    await page.keyboard.type("AI 卡上自填");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => (Reflect.get(window, "__稿") as { 阻碍原因: string[] }).阻碍原因)).toEqual(["需求变更", "AI 卡上自填"]);
    // 不在设置字典里的标「新增·待审核」，字典里的不标
    const 标签 = await page.locator(".prop .ant-tag").allInnerTexts();
    expect(标签.map((t) => t.trim())).toEqual(["需求变更", "AI 卡上自填（新增·待审核）"]);
    // 零宽字符清掉、只剩零宽字符的不算
    await 原因.click();
    await page.keyboard.type("\u200b");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => (Reflect.get(window, "__稿") as { 阻碍原因: string[] }).阻碍原因)).toEqual(["需求变更", "AI 卡上自填"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("沟通方式没填：列表格显示「—」不显示「其他记录」；编辑下拉留空（占位「—」），不自动选「其他方式」", async () => {
  const { page, errors } = await open("__方式");
  try {
    expect(await page.getByTestId("cells").locator(".ftype").allInnerTexts()).toEqual(["—", "Telegram", "电话沟通"]);
    const 甲 = page.getByTestId("sel-other");
    await expect.poll(() => 甲.locator(".ant-select-placeholder").innerText()).toBe("—");
    expect(await 甲.getByText("其他方式").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __改?: unknown }).__改)).toBeUndefined();
    await expect.poll(() => page.getByTestId("sel-phone").locator(".ant-select-content").innerText()).toBe("手机通话");
    expect(await page.getByText("其他记录").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("项目名单那行小字：没填方式的省掉（不写「其他记录」也不写「—」），公海照写，填了方式写方式", async () => {
  // 项目详情页的名单宽屏才摊开成一栏（lib/middle-pane 太窄 门槛），窄了收进抽屉
  const { page, errors } = await open("__名单", 1600);
  try {
    await page.locator(".roster-row").first().waitFor();
    const 小字 = async (名: string) => (await page.locator(".roster-row").filter({ hasText: 名 }).locator(".roster-src").innerText()).trim();
    expect(await 小字("甲项目")).toBe("");
    expect(await 小字("乙项目")).toBe("公海");
    expect(await 小字("丙项目")).toBe("Telegram");
    expect(await page.getByText("其他记录").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
