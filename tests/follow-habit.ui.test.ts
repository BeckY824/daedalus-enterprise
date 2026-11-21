/**
 * 「记一条沟通」按个人习惯默认沟通方式（11-17 客户答复「建议记录个人使用习惯」）在真浏览器里：
 *   有习惯（最近 20 条里用得最多的，服务端 我常用的沟通方式 回的）→ 打开就选好它；没有记录 → 照原来默认「微信沟通」；
 *   习惯里的方式字典里停用了 → 照原来默认；带回了草稿（草稿里有方式）→ 以草稿为准；发起主体不跟着变
 * 服务端动作换成假的，桩同 tests/stale-deploy.ui.test.ts
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const 老版本错 = `throw new 老版本类('Server Action "7f00aa11bb22cc33dd44ee55ff6677889900aabbcc" was not found on the server. \\nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action')`;
const plugin: Plugin = { name: "follow-habit-ui", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/coach-topic-actions$/, "const f=async()=>({ok:true});export const 发主题动作=f,回复主题动作=f,关闭主题动作=f,删主题动作=f;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>window.__方式们??null;export const 发起主体选项=async()=>window.__主体们??null;export const 我常用的沟通方式=async()=>window.__习惯??null;", "async()=>null"));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\.\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", `import {UnrecognizedActionError as 老版本类} from 'next/dist/client/components/unrecognized-action-error';const f=${空跑};export const 改项目节点=f,终止项目进程=f,勾项目交付=f,删除项目=f,放回项目公海=f,领取项目=f,记项目沟通Action=async(...a)=>{(window.__记||=[]).push(a);if(window.__老版本){${老版本错}}return{ok:true,followUpId:'f9'}},判MQLAction=f,线索初判Action=f,市场复核Action=f,销售终验Action=f,总管理终判Action=f,销售认领Action=f,撤回验证Action=f,编辑项目=async(...a)=>{(window.__编辑||=[]).push(a);if(window.__老版本){${老版本错}}return{ok:true}},改项目画像Action=f,改项目沟通=f,删项目沟通=f,加项目组员=f,换项目组员角色=f,移出项目组员=f;`));
  stub(/^\.\.\/commission-actions$/, `const f=${空跑};export const 存项目底价=f,存提成分配=f,更正实际提成=f;`);
  stub(/(^|\/)schedule-actions$/, 补全动作桩("src/app/(app)/leads/schedule-actions.ts", `const f=${空跑};export const 改定时分配=f,取消定时分配=f,定时分配现在分=f;`));
  stub(/^\.\.\/payment-actions$/, `const f=${空跑};export const 记回款=f,删回款=f;`);
  stub(/readonly-card-actions$/, 补全动作桩("src/app/(app)/projects/[id]/readonly-card-actions.ts", "export const 打开客户只读卡Action=async()=>({ok:false,error:'打不开'});"));
  stub(/giveup-actions$/, 补全动作桩("src/app/(app)/projects/[id]/giveup-actions.ts", ""));
  stub(/^\.\/blocker-actions$/, `const f=${空跑};export const 发布卡点Action=f,认领卡点Action=f,完成卡点Action=f,删卡点Action=f,存卡点默认Action=f,存卡点角色开关Action=f,新增原因Action=f,改原因名Action=f,改原因状态Action=f,删原因Action=f,合并原因Action=f;`);
  stub(/customers\/\[id\]\/ai$/, `export const parseFollowUpDraft=async()=>window.__解析??({ok:false,error:"未启用"});`);
  stub(/^\.\.\/relate-actions$/, `const f=${空跑};export const 加关联客户Action=f,改客户身份Action=f,解除关联客户Action=f,加关联联系人Action=f,改联系人角色立场Action=f,解除关联联系人Action=f,搜项目联系人=async()=>[];`);
  stub(/^\.\.\/\.\.\/favorites$/, `export const 切换项目收藏=async()=>({ok:true,收藏了:true});`);
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[];");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ProjectDetail from '@/app/(app)/projects/[id]/ProjectDetail';import UpdateBanner from '@/components/UpdateBanner';import {我Provider} from '@/lib/me-client';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 串='X'.repeat(40);
    const p={id:'p1',name:'超长项目名字'.repeat(6),remark:null,amount:100,currency:'CNY',customer:{id:'c1',name:'客户'+串,school:null},contact:null,
      来源线索:null,原因选项:{回收:[],无效:[]},ownerId:'qa',ownerName:'组长甲',creatorName:'组长甲',createdAt:'2026-10-01T00:00:00.000Z',historyOwners:[],
      phase:'商机',node:'方案报价',result:null,exceptionReason:null,exceptionCategory:null,pooled:false,能放公海:false,能领取:false,领取不给:null,进公海:null,出口叫法:{},有效沟通差:[],
      nextStepAt:null,回收日:null,expectedDealAt:null,要下一步:false,必填:null,不给推:null,能改节点:true,能转让:false,
      balanceSettled:false,balanceSettledBy:null,balanceSettledAt:null,acceptancePassed:false,acceptancePassedBy:null,acceptancePassedAt:null,
      logs:[],followUps:[{id:'f1',type:'PHONE',content:'上一次沟通',occurredAt:'2026-10-03T00:00:00.000Z',who:'组长甲',node:'方案报价',code:'FUL0001',提醒:null}],
      members:[],删前清点:{留痕:0,组员:0,沟通:1},企业版:true,能记沟通:true,提成:null,项目来源:null,channelId:null,已立项天数:3,渠道们:[],aiEnabled:false,level:null,所在地:null};
    const root=createRoot(document.getElementById('root'));
    window.__render=()=>(p.aiEnabled=!!window.__解析,root.render(<ConfigProvider locale={zhCN}><App><我Provider value={{id:'qa',name:'组长甲'}}><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <UpdateBanner 载入时="build-A"/>
      <ProjectDetail p={p} 能改={true} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={{们:[],能发:true,默认:{默认类型:'中度卡点',默认影响:'短期不影响'},原因们:['价格']}}/>
    </BusinessProvider></我Provider></App></ConfigProvider>));
    window.__banner=(id)=>root.render(<UpdateBanner 载入时={id}/>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 窗 = Window & { __render: () => void; __方式们?: string[] | null; __习惯?: { type: string; method: string | null } | null; __主体们?: string[] | null; __解析?: unknown };

async function 开(设: { 方式们?: string[] | null; 习惯?: { type: string; method: string | null } | null; 主体们?: string[] | null; 解析?: unknown }, 预存?: Record<string, string>) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("http://habit.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://habit.test/projects/p1");
  if (预存) await page.evaluate(x => { for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v); }, 预存);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(x => { const w = window as unknown as 窗; w.__方式们 = x.方式们 ?? null; w.__习惯 = x.习惯 ?? null; w.__主体们 = x.主体们 ?? null; w.__解析 = x.解析; w.__render(); }, 设);
  await page.getByTestId("follow-card-new").waitFor();
  await page.getByTestId("follow-card-new").click();
  const 框 = page.getByRole("dialog", { name: "新建沟通" });
  await 框.waitFor();
  return { page, errors, 框 };
}
/** 沟通方式那一格现在显示的 */
const 选中的方式 = (page: Page) => page.getByRole("dialog", { name: "新建沟通" }).locator(".follow-pick-row .ant-select").first().locator(".ant-select-content").innerText().catch(() => "");
const 方式们 = ["微信沟通", "手机通话", "WhatsApp", "线下拜访"];

it("有习惯：打开就选好最近用得最多的那种（不是写死的微信，也不是外贸就 WhatsApp）；发起主体照旧默认", async () => {
  const { page, errors } = await 开({ 方式们, 习惯: { type: "PHONE", method: "手机通话" }, 主体们: ["我方发起", "对方发起"] });
  try {
    await expect.poll(() => 选中的方式(page)).toBe("手机通话");
    // 发起主体不跟着习惯走
    expect(await page.getByRole("dialog", { name: "新建沟通" }).getByText("我方发起").count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("没有记录：照原来默认「微信沟通」；习惯里的方式字典里停用了：也照原来默认", async () => {
  for (const 习惯 of [null, { type: "WHATSAPP", method: "Line" }]) {
    const { page } = await 开({ 方式们, 习惯 });
    try {
      await page.waitForTimeout(300);
      await expect.poll(() => 选中的方式(page)).toBe("微信沟通");
    } finally { await page.close(); }
  }
});

it("带回了草稿（草稿里换过方式）：以草稿为准，习惯不盖它", async () => {
  const 稿 = { at: Date.now(), v: { type: "WHATSAPP", method: "WhatsApp", content: "上次没交的" } };
  const { page } = await 开({ 方式们, 习惯: { type: "PHONE", method: "手机通话" } }, { "daedalus:草稿:qa:项目沟通:p1": JSON.stringify(稿) });
  try {
    await expect.poll(() => page.getByRole("dialog", { name: "新建沟通" }).getByLabel("沟通内容").inputValue()).toBe("上次没交的");
    await page.waitForTimeout(300);
    expect(await 选中的方式(page)).toBe("WhatsApp");
  } finally { await page.close(); }
});

/** AI 解析回来的草稿：type 是 AI 认出的；认不出时 sanitizeFollowUpDraft 给 OTHER */
const AI回 = (type: string) => ({ ok: true, draft: { followUp: { type, status: "已完成", title: "", content: "聊了报价，下周再约", occurredAt: null, durationMinutes: null, contactId: null, opportunityId: null }, tasks: [], plan: null, followStatusSuggestion: null, decisionStatusSuggestion: null } });

it("AI 录入：AI 认不出方式（OTHER）→ 留着个人习惯；认出了 → 用 AI 的", async () => {
  for (const [ai类型, 应是] of [["OTHER", "手机通话"], ["WECHAT", "微信沟通"]] as const) {
    const { page, errors } = await 开({ 方式们, 习惯: { type: "PHONE", method: "手机通话" }, 解析: AI回(ai类型) }, { "daedalus.follow.mode": "AI" });
    try {
      const 框 = page.getByRole("dialog", { name: "新建沟通" });
      await expect.poll(() => 选中的方式(page)).toBe("手机通话");
      await 框.getByLabel("沟通原话").fill("今天电话里聊了报价，下周再约");
      await 框.getByRole("button", { name: /AI 解析填表/ }).click();
      await expect.poll(() => 框.getByLabel("沟通内容").inputValue()).toBe("聊了报价，下周再约");
      await expect.poll(() => 选中的方式(page)).toBe(应是);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
