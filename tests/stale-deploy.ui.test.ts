/**
 * 发版后老页面（11-17）在真浏览器里：
 *   1. 顶上横幅（components/UpdateBanner）：打开页面那一下不问；切回窗口问 /api/version，编号一样不出、不一样才出；
 *      1024 / 1280 / 1366 宽都不出屏、「刷新」点得中；点「刷新」先发「刷新前」那一声再重载
 *   2. 记一条沟通（项目详情 RecordFollowModal）：交的时候撞上老版本动作（记项目沟通Action 抛 Next 自己的 UnrecognizedActionError）
 *      → 框里说「系统刚更新了，请刷新页面后再提交」、顶上横幅亮；刷新后再点「新增沟通」，打过的字都带回来，框里一行「已带回…」
 *   3. 项目卡就地改「备注」：存的时候撞上老版本动作，原地说刷新；刷新后再点开，打过的字带回来
 * 服务端动作换成假的（esbuild 打包时替掉），见 tests/ent-project-detail.ui.test.ts 同一套桩
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const 老版本错 = `throw new 老版本类('Server Action "7f00aa11bb22cc33dd44ee55ff6677889900aabbcc" was not found on the server. \\nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action')`;
const plugin: Plugin = { name: "stale-deploy-ui", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/coach-topic-actions$/, "const f=async()=>({ok:true});export const 发主题动作=f,回复主题动作=f,关闭主题动作=f,删主题动作=f;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>window.__习惯??null;", "async()=>null"));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\.\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", `import {UnrecognizedActionError as 老版本类} from 'next/dist/client/components/unrecognized-action-error';const f=${空跑};export const 改项目节点=f,终止项目进程=f,勾项目交付=f,删除项目=f,放回项目公海=f,领取项目=f,记项目沟通Action=async(...a)=>{(window.__记||=[]).push(a);if(window.__老版本){${老版本错}}return{ok:true,followUpId:'f9'}},判MQLAction=f,线索初判Action=f,市场复核Action=f,销售终验Action=f,总管理终判Action=f,销售认领Action=f,撤回验证Action=f,编辑项目=async(...a)=>{(window.__编辑||=[]).push(a);if(window.__老版本){${老版本错}}return{ok:true}},改项目画像Action=f,改项目沟通=f,删项目沟通=f,加项目组员=f,换项目组员角色=f,移出项目组员=f;`));
  stub(/^\.\.\/commission-actions$/, `const f=${空跑};export const 存项目底价=f,存提成分配=f,更正实际提成=f;`);
  stub(/(^|\/)schedule-actions$/, 补全动作桩("src/app/(app)/leads/schedule-actions.ts", `const f=${空跑};export const 改定时分配=f,取消定时分配=f,定时分配现在分=f;`));
  stub(/^\.\.\/payment-actions$/, `const f=${空跑};export const 记回款=f,删回款=f;`);
  stub(/readonly-card-actions$/, 补全动作桩("src/app/(app)/projects/[id]/readonly-card-actions.ts", "export const 打开客户只读卡Action=async()=>({ok:false,error:'打不开'});"));
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
    window.__render=()=>root.render(<ConfigProvider locale={zhCN}><App><我Provider value={{id:'qa',name:'组长甲'}}><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <UpdateBanner 载入时="build-A"/>
      <ProjectDetail p={p} 能改={true} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={{们:[],能发:true,默认:{默认类型:'中度卡点',默认影响:'短期不影响'},原因们:['价格']}}/>
    </BusinessProvider></我Provider></App></ConfigProvider>);
    window.__banner=(id)=>root.render(<UpdateBanner 载入时={id}/>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 窗 = Window & { __render: () => void; __banner: (id: string | null) => void; __老版本?: boolean; __记?: unknown[][]; __编辑?: unknown[][]; __刷新前?: number };

/** 起一页：/api/version 回 现在的版本 里写的那个编号，记下问了几次 */
async function 开(width = 1280, 版本 = { id: "build-A" as string | null }) {
  const page = await browser.newPage({ viewport: { width, height: 860 } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const 问 = { 次: 0 };
  await page.route("http://stale.test/api/version", r => { 问.次++; return r.fulfill({ contentType: "application/json", body: JSON.stringify(版本) }); });
  await page.route("http://stale.test/projects/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://stale.test/projects/p1");
  return { page, errors, 问, 版本 };
}
async function 装(page: Page, 怎么: "全" | "横幅" = "全", id: string | null = "build-A") {
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  if (怎么 === "全") {
    await page.evaluate(() => (window as unknown as 窗).__render());
    await page.getByTestId("follow-card-new").waitFor();
  } else await page.evaluate(x => (window as unknown as 窗).__banner(x), id);
  // 等横幅的 effect 跑完（记下「上次问」的时刻）再往前拨钟：不然拨钟早于 effect，计时起点也跟着拨过去了
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 50))));
}
/** 切走再切回这个窗口：浏览器发 visibilitychange + focus */
const 切回来 = (page: Page) => page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
/** 跳过 30 秒的最短间隔：把页面里的时钟往前拨 */
const 过了一会儿 = (page: Page, 毫秒: number) => page.evaluate(ms => { const 原 = Date.now; Date.now = () => 原() + ms; }, 毫秒);

it("打开那一下不问；30 秒内切回不问；过了再切回、编号一样不出横幅，不一样才出", async () => {
  const { page, errors, 问, 版本 } = await 开();
  try {
    await 装(page, "横幅");
    await page.waitForTimeout(300);
    expect(问.次).toBe(0);
    await 切回来(page);
    await page.waitForTimeout(200);
    expect(问.次).toBe(0);
    await 过了一会儿(page, 31_000);
    await 切回来(page);
    await expect.poll(() => 问.次).toBe(1);
    await page.waitForTimeout(200);
    expect(await page.getByTestId("update-bar").count()).toBe(0);
    版本.id = "build-B";
    await 过了一会儿(page, 31_000);
    await 切回来(page);
    await page.getByTestId("update-bar").waitFor();
    expect(await page.getByTestId("update-bar").innerText()).toContain("系统刚更新了，刷新一下再继续（没提交的内容会先存好）");
    // 认出之后不再问（多进程升级途中别来回闪）
    const 次 = 问.次;
    await 过了一会儿(page, 31_000);
    await 切回来(page);
    await page.waitForTimeout(200);
    expect(问.次).toBe(次);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("回来的不像样（502 错页、空 id）不出；载入时没有编号的整个不问", async () => {
  const { page, 问, 版本 } = await 开();
  try {
    await 装(page, "横幅");
    版本.id = null;
    await 过了一会儿(page, 31_000);
    await 切回来(page);
    await expect.poll(() => 问.次).toBe(1);
    await page.waitForTimeout(200);
    expect(await page.getByTestId("update-bar").count()).toBe(0);
  } finally { await page.close(); }
  const 二 = await 开(1280, { id: "build-B" });
  try {
    await 装(二.page, "横幅", null);
    await 过了一会儿(二.page, 31_000);
    await 切回来(二.page);
    await 二.page.waitForTimeout(300);
    expect(二.问.次).toBe(0);
    expect(await 二.page.getByTestId("update-bar").count()).toBe(0);
  } finally { await 二.page.close(); }
});

it.each([1024, 1280, 1366])("横幅 %ipx：不出屏、不撑横向滚动、「刷新」点得中；点了先发「刷新前」再重载", async (w) => {
  const { page, 版本 } = await 开(w, { id: "build-B" });
  try {
    await 装(page, "横幅");
    void 版本;
    await 过了一会儿(page, 31_000);
    await 切回来(page);
    const 条 = page.getByTestId("update-bar");
    await 条.waitFor();
    const 框 = (await 条.boundingBox())!;
    expect(框.x).toBeGreaterThanOrEqual(0);
    expect(框.x + 框.width).toBeLessThanOrEqual(w);
    expect(框.height).toBeLessThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // 字不省略（一行放得下）
    expect(await page.locator(".update-bar-text").evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    const 钮 = (await page.getByRole("button", { name: "刷新" }).boundingBox())!;
    expect(钮.x + 钮.width).toBeLessThanOrEqual(w);
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent, [钮.x + 钮.width / 2, 钮.y + 钮.height / 2])).toBe("刷新");
    await page.evaluate(() => window.addEventListener("crm:before-reload", () => { sessionStorage.setItem("刷新前", "1"); }));
    await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "刷新" }).click()]);
    expect(await page.evaluate(() => sessionStorage.getItem("刷新前"))).toBe("1");
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("没人接住的动作报错 %ipx（25C 全局兜底）：顶上一条中文、不露英文、带编号，不出屏；认不出的错不管", async (w) => {
  const { page, errors } = await 开(w);
  try {
    await 装(page, "横幅");
    // 生产构建里服务端动作抛错，Next 客户端拿到的就是这句 + digest；没人 catch
    await page.evaluate(() => { void Promise.reject(Object.assign(new Error("An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details."), { digest: "1234567890" })); });
    const 条 = page.getByTestId("action-error-bar");
    await 条.waitFor();
    const 字 = await 条.innerText();
    expect(字).toContain("刚才的操作没成功");
    expect(字).toContain("1234567890");
    expect(字).not.toMatch(/Server Components|error occurred/i);
    const 框 = (await 条.boundingBox())!;
    expect(框.x).toBeGreaterThanOrEqual(0);
    expect(框.x + 框.width).toBeLessThanOrEqual(w);
    expect(框.height).toBeLessThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator("[data-testid=action-error-bar] .update-bar-text").evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    // 断网：换成网络那句
    await page.evaluate(() => { void Promise.reject(new TypeError("Failed to fetch")); });
    await expect.poll(() => 条.innerText()).toContain("网络断了一下");
    await page.getByRole("button", { name: "收起" }).click();
    expect(await 条.count()).toBe(0);
    // 认不出的（代码自己的错）不管：不出条
    await page.evaluate(() => { void Promise.reject(new Error("x is not a function")); });
    await page.waitForTimeout(200);
    expect(await 条.count()).toBe(0);
    expect(errors.filter((e) => !/x is not a function/.test(e))).toEqual([]);
  } finally { await page.close(); }
});

it("记一条沟通：撞上老版本动作 → 框里说刷新、横幅亮；刷新后再点开，打过的字都带回来；记上了草稿清掉", async () => {
  const { page, errors } = await 开(1366);
  try {
    await 装(page);
    await page.evaluate(() => { (window as unknown as 窗).__老版本 = true; });
    await page.getByTestId("follow-card-new").click();
    const 框 = page.getByRole("dialog", { name: "新建沟通" });
    await 框.waitFor();
    // 刚打开：没有草稿，不出「已带回」
    expect(await 框.getByText("已带回上次没提交的内容").count()).toBe(0);
    await 框.getByLabel("沟通内容").fill("客户说下周三前给预算，要先看样品");
    await 框.getByLabel("下一步计划").fill("周五前寄样品");
    await 框.getByRole("button", { name: /^保\s*存$/ }).click();
    await 框.getByRole("alert").filter({ hasText: "系统刚更新了，请刷新页面后再提交" }).waitFor();
    expect(await 框.getByRole("alert").innerText()).toContain("填的内容刷新后还在");
    expect(await 框.getByRole("alert").innerText()).not.toMatch(/Server Action|[A-Za-z]{4,}/);
    expect(await page.getByTestId("update-bar").count()).toBe(1);

    // 刷新：内存没了，草稿在 localStorage
    await page.reload();
    await 装(page);
    await page.getByTestId("follow-card-new").click();
    await 框.waitFor();
    await expect.poll(() => 框.getByLabel("沟通内容").inputValue()).toBe("客户说下周三前给预算，要先看样品");
    expect(await 框.getByLabel("下一步计划").inputValue()).toBe("周五前寄样品");
    await 框.getByRole("status").filter({ hasText: "已带回上次没提交的内容" }).waitFor();
    expect(await 框.getByText("附件没留住").count()).toBe(0);

    // 这回服务端是新的：记上了，草稿清掉
    await page.evaluate(() => { (window as unknown as 窗).__老版本 = false; });
    await 框.getByRole("button", { name: /^保\s*存$/ }).click();
    await expect.poll(() => 框.count()).toBe(0);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("daedalus:草稿:")))).toEqual([]);
    const 记 = await page.evaluate(() => (window as unknown as 窗).__记);
    expect((记![0][1] as { content: string }).content).toBe("客户说下周三前给预算，要先看样品");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("记一条沟通：点「清空」放回空白、草稿删掉；点取消也删", async () => {
  const { page } = await 开(1280);
  try {
    await 装(page);
    await page.getByTestId("follow-card-new").click();
    const 框 = page.getByRole("dialog", { name: "新建沟通" });
    await 框.getByLabel("沟通内容").fill("聊了一半");
    await page.waitForTimeout(100);
    await page.reload();
    await 装(page);
    await page.getByTestId("follow-card-new").click();
    await expect.poll(() => 框.getByLabel("沟通内容").inputValue()).toBe("聊了一半");
    await 框.getByRole("button", { name: "清空" }).click();
    await expect.poll(() => 框.getByLabel("沟通内容").inputValue()).toBe("");
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("daedalus:草稿:")))).toEqual([]);
    await 框.getByLabel("沟通内容").fill("又写了一句");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("daedalus:草稿:")))).toHaveLength(1);
    await 框.getByRole("button", { name: /^取\s*消$/ }).click();
    await expect.poll(() => 框.count()).toBe(0);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("daedalus:草稿:")))).toEqual([]);
  } finally { await page.close(); }
});

it("项目卡就地改备注：撞上老版本动作原地说刷新；刷新后再点开带回打过的字", async () => {
  const { page, errors } = await 开(1366);
  try {
    await 装(page);
    await page.evaluate(() => { (window as unknown as 窗).__老版本 = true; });
    await page.getByRole("button", { name: "改备注" }).click();
    const 格 = page.locator('[data-inline-field="备注"]');
    await 格.getByLabel("备注").fill("下周要回访一次");
    await page.keyboard.press("Control+Enter");
    await 格.getByRole("alert").filter({ hasText: "系统刚更新了，请刷新页面后再提交" }).waitFor();
    await page.reload();
    await 装(page);
    await page.getByRole("button", { name: "改备注" }).click();
    await expect.poll(() => 格.getByLabel("备注").inputValue()).toBe("下周要回访一次");
    await 格.getByText("已带回上次没提交的内容").waitFor();
    // Esc 还原：草稿删掉
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("daedalus:草稿:")))).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
