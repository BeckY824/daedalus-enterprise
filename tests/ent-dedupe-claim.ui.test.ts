/**
 * 建档向导撞号面板：市场成员查重撞上公海客户（员工反馈 F-016；客户 11-19：「可以进行该公海项目/客户的领取，但……1.必须写沟通记录；2.只能自动分配」）。
 *   - 服务端说 市场可领：摆「领取并记沟通」，不摆「去领取」（公海页市场成员领不了）
 *   - 点开是记沟通那几格（沟通方式、时间、内容），没有「指定」「留给自己」；内容空着不能交
 *   - 新建线索项目那条路（用户 11-19「项目来源以每次新建的为主……项目对接人以录入为主」）：这次的渠道必填、不默认带客户来源；
 *     向导 / AI 卡上已选的渠道带进来当默认（仍可改）；向导选的是渠道触点的提示先找销售管理分配
 *     对接人先带出号码撞上的那位（选已有的就挂他，不填名字）；选「新的人」才填名字（必填）、职务
 *   - 框里一行客户名（超长省略号、悬停看全文）；取框数据失败：交的键提示就是失败原因
 *   - 草稿键不带号码；领成了不重查号码（重查是「重复」会记撞号台账、摆挂靠 / 协同），面板只剩「已领取」那句
 *   - 交上去只带号码（类型 + 值）、那条沟通、看到的客户 id、这次的渠道和录的对接人；领成了键收起、就地一行话
 *   - 只领旧项目那条路（框数据说 新建线索项目 = false）：没有渠道、对接人格
 *   - 没有 市场可领（销售等）照旧「去领取」；原负责人是我但服务端说可领（是客户创建人，用户 11-19「仅对创建人豁免」）也摆键、不摆「领不回」
 *   - Windows 1024 / 1280 / 1366：框里不横向溢出，「领取并自动分配」点得中
 * 服务端规则见 ent-dedupe-claim.test.ts
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ent-dedupe-claim", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){}});export const usePathname=()=>'/customers';");
  stub(/^next\/link$/, "export default function L({href,children,prefetch,...p}){return <a href={href} {...p}>{children}</a>}");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/^\.\.\/actions$/, "export const 建档向导=async()=>({ok:true,customerId:'c1',projectId:'p1'});export const 建档只建客户=async()=>({ok:true,customerId:'c2',projectId:null});");
  stub(/customers\/actions$/, "export const checkDuplicate=async()=>null;export const 推荐人候选=async()=>[];");
  // 查号码：撞上公海里的「星河电子」；市场可领 / 原负责人是我 由用例设
  stub(/(^|\/)number-actions$/, 补全动作桩("src/app/(app)/customers/number-actions.ts", "export const 查号码=async(t,v)=>(window.__查次=(window.__查次??0)+1,{ok:true,状态:'公海待捞',提示:'这个号码的客户在公海，本次录入已拦截，可去公海领取',值:v,撞:{id:'c7',name:'星河电子',school:null,salesOwnerName:'无负责人',createdAt:null},归属地:null,...(window.__可领?{市场可领:true}:{}),...(window.__我退的?{原负责人是我:true}:{})});export const 查客户名=async()=>({ok:true,撞:null});"));
  stub(/(^|\/)pool-actions$/, 补全动作桩("src/app/(app)/customers/pool-actions.ts", "export const 查重领取框数据=async()=>window.__框??{ok:true,新建线索项目:true,客户名:'星河电子',渠道们:[{id:'ch1',name:'小红书|笔记',attr:null,platform:'小红书',active:true}],联系人们:[{id:'k1',name:'王经理',position:'采购'},{id:'k2',name:'李工',position:null}],默认对接人:'k1'};export const 查重领取=async(t,v,f,id,n)=>{window.__领=[t,v,f,id,n];return window.__回??{ok:true,提示:'已领取并自动分配给 销售甲某，沟通已记在项目「星河电子-咨询」上',接手人:'销售甲某',项目:'星河电子-咨询',为什么:''}};"));
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[];");
  stub(/customers\/\[id\]\/project-actions$/, 补全动作桩("src/app/(app)/customers/[id]/project-actions.ts", "export const 新项目分配数据=async()=>({分配方式们:[],默认分配方式:0,是销售:false,客户业务线:'内贸',客户区域线:null,客户有地址:false});export const 建项目带走的项目=async()=>({项目数:0,项目:[]});"));
  stub(/same-number-actions$/, "export const 同号协同录入=async()=>({ok:true});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

const 长名 = "某某超长国际贸易进出口集团股份有限公司华东区域分公司".repeat(3);

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {建档弹窗} from '@/app/(app)/projects/new/ProjectWizard';import DedupeClaimKey from '@/app/(app)/customers/DedupeClaimKey';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    const 数据={users:[{id:'u1',name:'渠运某',email:'a'}],要下一步:false,企业:{渠道们:[],节点们:['潜客培育','线索验证','线索推进'],分配方式们:[{i:0,名:'指定分配'},{i:1,名:'自动分配'}],默认分配方式:1,是销售:false,按区域:true,本人线:null,客户只给自己:false}};
    const 单独=window.__单独;
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'u1',name:'渠运某'}}>{单独?<div><DedupeClaimKey 类型="手机号" 值="13905712266" 渠道={单独.渠道} 触点={单独.触点}/></div>:<建档弹窗 open 标题="新建线索" 项目="锁开" 数据={数据} onClose={()=>{}}/>}</我Provider></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"', "process.env.CRM_ENTERPRISE": '"1"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 选渠道(page: Page) {
  const 格 = page.getByRole("combobox", { name: "这次的渠道" });
  // 领取框打开的动画放完再点：动画里弹层对不准位置、点不中
  await expect.poll(() => page.locator(".ant-zoom-appear, .ant-zoom-enter, .ant-zoom-leave").count()).toBe(0);
  await 格.click();
  await 格.fill("笔记");
  const 项 = page.locator(".chan-picker-pop .ant-cascader-menu-item").filter({ hasText: "笔记" }).first();
  await 项.waitFor();
  await 项.click();
}

async function 开(w: number, 设: Record<string, unknown> = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: w, height: typeof 设.__高 === "number" ? 设.__高 : 800 } }); page.setDefaultTimeout(5000);
  await page.route("http://dc.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://dc.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.evaluate((s) => { localStorage.clear(); Object.assign(window, s); }, 设);
  await page.addScriptTag({ content: bundle });
  if (设.__单独) { await page.getByTestId("dedupe-claim").waitFor(); return page; }
  const 框 = page.getByRole("dialog").first();
  await 框.getByLabel("号码", { exact: true }).fill("13905712266");
  await 框.getByLabel("号码", { exact: true }).press("Enter");
  await 框.getByText("星河电子").first().waitFor();
  return page;
}

it("市场可领：摆「领取并记沟通」不摆「去领取」；内容空着交不了；交上去只带号码 + 沟通 + 看到的客户 id，领成了键收起、就地一行话", async () => {
  const page = await 开(1280, { __可领: true });
  try {
    const 向导 = page.getByRole("dialog").first();
    expect(await 向导.getByRole("button", { name: "去领取" }).count()).toBe(0);
    await 向导.getByTestId("dedupe-claim").click();
    const 表 = page.getByTestId("dedupe-claim-form");
    await 表.waitFor();
    expect(await 表.innerText()).toContain("只能自动分配");
    // 没有指定 / 留给自己的选项
    expect(await 表.getByText(/指定|留给自己|负责人/).count()).toBe(0);
    const 交 = 表.getByRole("button", { name: "领取并自动分配" });
    expect(await 交.isDisabled()).toBe(true);
    // 框里一行客户名；对接人先带出号码撞上的王经理（选已有的不用填名字）
    await expect.poll(() => 表.locator(".dc-claim-who").count()).toBe(1);
    expect(await 表.locator(".dc-claim-who").innerText()).toBe("领取：星河电子");
    // 下拉没展开：页面上「王经理（采购）」只有选中显示的那一处
    await expect.poll(() => 表.getByText("王经理（采购）", { exact: true }).count()).toBe(1);
    expect(await 表.getByLabel("对接人名字").count()).toBe(0);
    expect(await 表.getByTestId("dedupe-claim-contact-hint").innerText()).toContain("挂客户原有的这位联系人");
    await 表.getByLabel("沟通内容").fill("客户来电咨询报价");
    // 渠道不默认带客户来源：没选还交不了，键上说缺什么
    expect(await 交.isDisabled()).toBe(true);
    expect(await 交.getAttribute("title")).toBe("请选这次的渠道");
    await 选渠道(page);
    expect(await 交.isDisabled()).toBe(false);
    // 草稿键不带号码
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.includes("查重领取")))).toBe(true);
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.includes("13905712266")))).toBe(false);
    await 交.click();
    await 向导.getByRole("status").filter({ hasText: "已领取并自动分配给 销售甲某" }).first().waitFor();
    const 领 = await page.evaluate(() => (window as unknown as { __领: unknown[] }).__领);
    expect(领[0]).toBe("手机号");
    expect(领[1]).toBe("13905712266");
    expect(领[2]).toMatchObject({ content: "客户来电咨询报价" });
    expect(领[3]).toBe("c7");
    expect(领[4]).toEqual({ 渠道: "ch1", 对接人: { 原id: "k1" } });
    // 不重查号码；面板收成只剩「已领取」那句：没有领取键、去领取、打开它、挂靠 / 协同入口
    expect(await page.evaluate(() => (window as unknown as { __查次: number }).__查次)).toBe(1);
    expect(await 向导.getByTestId("dedupe-claim-done").innerText()).toBe("已领取并自动分配给 销售甲某，沟通已记在项目「星河电子-咨询」上");
    expect(await 向导.getByText("星河电子", { exact: true }).count()).toBe(0);
    for (const 键 of ["打开它", "去领取", "领取并记沟通", "申请挂靠"]) expect(await 向导.getByRole("button", { name: 键 }).count(), 键).toBe(0);
    // 改号码就清掉，按新号码再查
    await 向导.getByLabel("号码", { exact: true }).fill("13905712267");
    await 向导.getByLabel("号码", { exact: true }).press("Enter");
    await 向导.getByTestId("dedupe-claim").waitFor();
    expect(await 向导.getByTestId("dedupe-claim-done").count()).toBe(0);
    // 框关掉（关的动画放完才拆）
    await expect.poll(() => page.getByTestId("dedupe-claim-form").count()).toBe(0);
  } finally { await page.close(); }
});

it("对接人换人：选李工就挂李工（不填名字）；选「新的人」才出名字、职务，名字空着交不了", async () => {
  const page = await 开(1280, { __可领: true });
  try {
    await page.getByTestId("dedupe-claim").click();
    const 表 = page.getByTestId("dedupe-claim-form");
    await 表.locator(".dc-claim-who").waitFor();
    await 选渠道(page);
    await 表.getByLabel("沟通内容").fill("客户来电");
    const 交 = 表.getByRole("button", { name: "领取并自动分配" });
    const 选 = async (名: string) => {
      await 表.getByRole("combobox", { name: "对接人" }).click();
      await page.locator(".ant-select-item-option").filter({ hasText: 名 }).click();
    };
    await 选("李工");
    expect(await 表.getByLabel("对接人名字").count()).toBe(0);
    expect(await 交.isDisabled()).toBe(false);
    await 选("新的人");
    expect(await 表.getByLabel("对接人名字").inputValue()).toBe("");
    expect(await 表.getByTestId("dedupe-claim-contact-hint").innerText()).toContain("新建一位联系人");
    expect(await 交.isDisabled()).toBe(true);
    expect(await 交.getAttribute("title")).toBe("请填写新对接人的名字");
    await 表.getByLabel("对接人名字").fill("赵总");
    await 交.click();
    await page.getByRole("status").filter({ hasText: "已领取" }).first().waitFor();
    const 领 = await page.evaluate(() => (window as unknown as { __领: unknown[] }).__领);
    expect(领[4]).toEqual({ 渠道: "ch1", 对接人: { 原id: null, 名字: "赵总", 职务: null } });
  } finally { await page.close(); }
});

it("AI 卡带进来的渠道名认得出就当默认（仍可改）；向导选的是渠道触点的给一句先找销售管理；取框数据失败交的键说原因", async () => {
  let page = await 开(1280, { __单独: { 渠道: { 名: "小红书|笔记" } } });
  try {
    await page.getByTestId("dedupe-claim").click();
    const 表 = page.getByTestId("dedupe-claim-form");
    await 表.getByLabel("沟通内容").fill("客户来电");
    const 交 = 表.getByRole("button", { name: "领取并自动分配" });
    await expect.poll(() => 交.isDisabled()).toBe(false);
    expect(await 表.getByTestId("dedupe-claim-touchpoint").count()).toBe(0);
    await 交.click();
    await page.getByRole("status").filter({ hasText: "已领取" }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { __领: unknown[] }).__领[4])).toMatchObject({ 渠道: "ch1" });
  } finally { await page.close(); }
  page = await 开(1280, { __单独: { 渠道: { id: null }, 触点: "客户介绍" } });
  try {
    await page.getByTestId("dedupe-claim").click();
    const 表 = page.getByTestId("dedupe-claim-form");
    expect(await 表.getByTestId("dedupe-claim-touchpoint").innerText()).toContain("先找销售管理分配");
  } finally { await page.close(); }
  page = await 开(1280, { __单独: {}, __框: { ok: false, error: "「自动分配」已停用，查重领取只能自动分配；请找系统管理员" } });
  try {
    await page.getByTestId("dedupe-claim").click();
    const 表 = page.getByTestId("dedupe-claim-form");
    await 表.getByLabel("沟通内容").fill("客户来电");
    const 交 = 表.getByRole("button", { name: "领取并自动分配" });
    await expect.poll(() => 交.getAttribute("title")).toBe("「自动分配」已停用，查重领取只能自动分配；请找系统管理员");
    expect(await 交.isDisabled()).toBe(true);
  } finally { await page.close(); }
});

it("只领旧项目那条路（框数据说不新建）：没有渠道、对接人格，写了沟通就能交，不带新项目那几样", async () => {
  const page = await 开(1280, { __可领: true, __框: { ok: true, 新建线索项目: false, 客户名: "星河电子", 渠道们: [], 联系人们: [], 默认对接人: null } });
  try {
    await page.getByTestId("dedupe-claim").click();
    const 表 = page.getByTestId("dedupe-claim-form");
    await 表.getByLabel("沟通内容").fill("客户来电");
    const 交 = 表.getByRole("button", { name: "领取并自动分配" });
    await expect.poll(() => 交.isDisabled()).toBe(false);
    expect(await 表.getByLabel("对接人名字").count()).toBe(0);
    expect(await page.getByRole("combobox", { name: "这次的渠道" }).count()).toBe(0);
    await 交.click();
    await page.getByRole("status").filter({ hasText: "已领取" }).first().waitFor();
    const 领 = await page.evaluate(() => (window as unknown as { __领: unknown[] }).__领);
    expect(领[4]).toBeUndefined();
  } finally { await page.close(); }
});

it("没领成（挑不到人）：框里就地红字说原因，框不关、键还在", async () => {
  const page = await 开(1280, { __可领: true, __回: { ok: false, error: "没有自动分出去：能接的销售都暂停或禁止了自动分配。这次没领，客户还在公海，沟通也没记；请找销售管理处理" } });
  try {
    await page.getByTestId("dedupe-claim").click();
    const 表 = page.getByTestId("dedupe-claim-form");
    await 选渠道(page);
    await 表.getByLabel("沟通内容").fill("客户来电");
    await 表.getByRole("button", { name: "领取并自动分配" }).click();
    await 表.getByRole("alert").filter({ hasText: "这次没领" }).waitFor();
    expect(await page.getByTestId("dedupe-claim").count()).toBe(1);
  } finally { await page.close(); }
});

it("没有 市场可领（销售等）：照旧「去领取」，不摆领取并记沟通", async () => {
  const page = await 开(1280);
  try {
    const 向导 = page.getByRole("dialog").first();
    await 向导.getByRole("button", { name: "去领取" }).waitFor();
    expect(await 向导.getByTestId("dedupe-claim").count()).toBe(0);
  } finally { await page.close(); }
});

it("原负责人是我、服务端说可领（是客户创建人）：摆键，不摆「领不回」那句", async () => {
  const page = await 开(1280, { __可领: true, __我退的: true });
  try {
    const 向导 = page.getByRole("dialog").first();
    await 向导.getByTestId("dedupe-claim").waitFor();
    expect(await 向导.getByText("是你退回公海的").count()).toBe(0);
  } finally { await page.close(); }
});

it("Windows 1024 / 1280 / 1366（768 高）、手机 375：领取框不横向溢出，「领取并自动分配」点得中；电脑上整框一屏放得下", async () => {
  for (const [w, h] of [[1024, 768], [1280, 768], [1366, 768], [375, 812]]) {
    const page = await 开(w, { __可领: true, __高: h, __框: { ok: true, 新建线索项目: true, 客户名: 长名, 渠道们: [{ id: "ch1", name: "小红书|笔记", attr: null, platform: "小红书", active: true }], 联系人们: [{ id: "k1", name: "王经理", position: "采购" }], 默认对接人: null } });
    try {
      await page.getByTestId("dedupe-claim").click();
      const 表 = page.getByTestId("dedupe-claim-form");
      await 选渠道(page);
      await 表.getByLabel("沟通内容").fill(长名);
      // 默认对接人认不出：停在「新的人」，名字、职务两格都在
      await 表.getByLabel("对接人名字").fill(长名.slice(0, 100));
      await 表.getByLabel("对接人职务").fill(长名.slice(0, 100));
      // 客户名一行省略、悬停看全文
      const 名 = await 表.locator(".dc-claim-who").evaluate((e) => ({ 省略: getComputedStyle(e).textOverflow === "ellipsis" && getComputedStyle(e).whiteSpace === "nowrap", 题: e.getAttribute("title"), 高: e.getBoundingClientRect().height < 30 }));
      expect(名, `宽 ${w}`).toEqual({ 省略: true, 题: 长名, 高: true });
      const 量 = await page.evaluate(() => {
        const f = document.querySelector("[data-testid=dedupe-claim-form]") as HTMLElement;
        const 键 = [...f.querySelectorAll("button")].find((b) => b.textContent?.includes("领取并自动分配"))!;
        const 整框 = f.closest(".ant-modal")!.getBoundingClientRect();
        // 手机上框比屏高，弹窗自己能往下卷：卷到键再量点不点得中
        键.scrollIntoView({ block: "center" });
        const r = 键.getBoundingClientRect();
        const 点 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { 页: document.documentElement.scrollWidth <= window.innerWidth, 框: f.scrollWidth <= f.clientWidth + 1, 点得中: !!点 && 键.contains(点), 一屏: 整框.bottom <= window.innerHeight };
      });
      expect(量, `宽 ${w}`).toEqual({ 页: true, 框: true, 点得中: true, 一屏: w < 768 ? 量.一屏 : true });
    } finally { await page.close(); }
  }
});
