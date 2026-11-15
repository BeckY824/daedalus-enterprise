/**
 * 客户页「新增项目」（原型 cr.old，11-15）：和「新增项目」「新建客户」同一张新建表（建档弹窗），客户定死是这一位。
 * 原来是一个单独的两步框（NewProjectModal，前 3 步假完成），删了；这里把它原来约束的几条搬到同一张表上，含义不变：
 *   11-01 §6 + cr.submit：建好不跳项目页，键里转圈 → ✓「已建好」→ 框收起、落到这位客户页上的新项目（?project=…&landed=1），不弹顶部提示
 *   X-18：客户转给销售、我看不到这位客户了：不刷新（会 404）；去向就地写在框里，点「回客户列表」才走
 *   按分配方式进了待分配：去向橙字写在框里，点「知道了」才落到新项目
 *   cr.auto：销售选自动分配——就地黄条、键写「建好并分出去」，不叠确认框
 *   P-转-07：有项目一起转先列出来；取消不建、框还在、就地说为什么没建、可再点；没有要转的不弹；取预览失败不拦着建
 * 另外（cr.old）：客户段收成一行、不能换、不摆号码和联系人那几格；项目名默认带客户简称；负责人默认客户负责人；首条沟通可选联系人（默认主要）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "new-project-preset", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷新=(window.__刷新??0)+1},push(u){(window.__跳=window.__跳??[]).push(u)},replace(u){(window.__跳=window.__跳??[]).push(u)}});export const usePathname=()=>'/customers/a';");
  stub(/^next\/link$/, "export default function L({href,children,prefetch,...p}){return <a href={href} {...p}>{children}</a>}");
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;");
  // 新客户那条路的动作：这里一条都不该走到，走到就记下来
  stub(/^\.\.\/actions$/, "export const 建档向导=async(x)=>{(window.__调||=[]).push(['建档向导',x]);return {ok:true,customerId:'c1',projectId:'p1'}};export const 建档只建客户=async(x)=>{(window.__调||=[]).push(['建档只建客户',x]);return {ok:true,customerId:'c2',projectId:null}};");
  stub(/customers\/actions$/, "export const checkDuplicate=async()=>null;export const 推荐人候选=async()=>[];");
  stub(/(^|\/)number-actions$/, "export const 查号码=async(t,v)=>{(window.__调||=[]).push(['查号码',t,v]);return {ok:true,状态:'首次录入',提示:'首次录入',值:v,归属地:null}};export const 查客户名=async(n)=>{(window.__调||=[]).push(['查客户名',n]);return {ok:true,撞:null}};export const 申请挂靠=async()=>({ok:true});export const 从回收站捞回=async()=>({ok:true});");
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async(w)=>{(window.__调||=[]).push(['搜客户',w]);return []};");
  stub(/customers\/\[id\]\/project-actions$/, "export const 给客户建项目=async(x)=>{window.__建={...x};return window.__回??{ok:true,projectId:'np1'}};export const 新项目分配数据=async()=>({分配方式们:[{i:0,名:'指定分配'},{i:1,名:'自动分配'}],默认分配方式:0,是销售:false,客户业务线:'内贸'});export const 建项目带走的项目=async(...a)=>{(window.__预览=window.__预览??[]).push(a);if(window.__预览失败)throw new Error('断网');return window.__带走??{项目数:0,项目:[]}};");
  stub(/same-number-actions$/, "export const 同号协同录入=async()=>({ok:true});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {建档弹窗} from '@/app/(app)/projects/new/ProjectWizard';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    const 数据=()=>({users:[{id:'u1',name:'我自己',email:'a'},{id:'u2',name:'客户负责人乙',email:'b'}],要下一步:false,企业:{渠道们:[],节点们:['潜客培育','线索验证'],分配方式们:[{i:0,名:'指定分配'},{i:1,名:'自动分配'}],默认分配方式:window.__默认分配??0,是销售:!!window.__销售,客户只给自己:false}});
    function 页(){
      const [开,set开]=React.useState(true);
      return <><div data-testid="还在客户页">客户页</div><建档弹窗 open={开} 标题="新增项目" 数据={数据()} onClose={()=>set开(false)}
        老客户={{id:'a',name:'测试客户甲有限公司',附注:null}}
        预选={{项目名:'测试客户甲',默认负责人:'u2',联系人们:[{id:'k0',name:'王次要',isPrimary:false},{id:'k1',name:'李主要',isPrimary:true}]}}/></>;
    }
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'u1',name:'我自己'}}><页/></我Provider></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"', "process.env.CRM_ENTERPRISE": '"1"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 窗 = { __建?: Record<string, unknown>; __跳?: string[]; __刷新?: number; __预览?: unknown[][]; __调?: unknown[][] };
async function 开(设: Record<string, unknown> = {}, w = 1024): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: w, height: 800 } }); page.setDefaultTimeout(5000);
  await page.route("http://npm.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://npm.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.evaluate((s) => { localStorage.clear(); Object.assign(window, s); }, 设);
  await page.addScriptTag({ content: bundle });
  await page.getByRole("dialog").getByText("首条沟通").first().waitFor();
  return page;
}
const 窗of = (page: Page) => page.evaluate(() => { const w = window as unknown as 窗; return { 建: w.__建 ?? null, 跳: w.__跳 ?? [], 刷新: w.__刷新 ?? 0, 预览: w.__预览 ?? [], 调: w.__调 ?? [] }; });
const 填沟通 = async (page: Page) => { await page.getByRole("dialog").getByLabel("沟通内容").fill("第一次电话，聊了需求"); };
const 建好键 = (page: Page) => page.getByRole("dialog").getByRole("button", { name: /^建\s*好$|^建好并分出去$/ });

it("cr.old：客户段收成这一位、不能换、不摆号码和联系人姓名；项目名默认客户简称，负责人默认客户负责人，联系人默认主要", async () => {
  const page = await 开();
  try {
    const 框 = page.getByRole("dialog");
    const 一行 = 框.getByTestId("wizard-old-customer");
    expect(await 一行.innerText()).toContain("测试客户甲有限公司");
    expect(await 框.getByRole("button", { name: "换" }).count()).toBe(0);
    expect(await 框.getByRole("button", { name: "查重" }).count()).toBe(0);
    expect(await 框.getByLabel("号码", { exact: true }).count()).toBe(0);
    expect(await 框.getByLabel("联系人姓名").count()).toBe(0);
    expect(await 框.getByRole("switch", { name: "有项目" }).isDisabled()).toBe(true);
    expect(await 框.getByLabel("项目名称").inputValue()).toBe("测试客户甲");
    expect(await 框.locator("[data-ge='负责人']").innerText()).toContain("客户负责人乙");
    expect(await 框.locator(".cr-field:has([aria-label='联系人'])").innerText()).toContain("李主要（主要）");
    await expect.poll(() => 框.locator("[data-ge='业务线']").innerText()).toContain("内贸");
    // 1024 宽不横向溢出
    expect(await page.evaluate(() => { const s = document.querySelector(".cr-sheet") as HTMLElement; return s.scrollWidth - s.clientWidth; })).toBe(0);
  } finally { await page.close(); }
});

it("11-01 §6 + cr.submit：填完点建好，键里 ✓「已建好」，框收起后落到客户页上的新项目（landed），不弹顶部提示、不走新客户那条路", async () => {
  const page = await 开();
  try {
    const 框 = page.getByRole("dialog");
    await 填沟通(page);
    expect(await 框.getByText("明确回复了", { exact: true }).count()).toBe(0);
    await 框.getByLabel("下一步计划").fill("发报价单");
    await 建好键(page).click();
    await 框.getByRole("button", { name: "已建好" }).waitFor();
    expect(await page.locator(".ant-message-notice").count()).toBe(0);
    await expect.poll(() => page.getByRole("dialog").count(), { timeout: 5000 }).toBe(0);
    const 记 = await 窗of(page);
    expect(记.建).toMatchObject({ customerId: "a", 联系人Id: "k1", 项目: { name: "测试客户甲", ownerId: "u2", 分配方式: 0, 业务线: "内贸" }, 跟进: { content: "第一次电话，聊了需求", 下一步: "发报价单" } });
    expect(JSON.stringify(记.建)).not.toContain("明确回复");
    expect(记.跳).toEqual(["/customers/a?project=np1&landed=1"]);
    expect(记.调.some((x) => ["建档向导", "建档只建客户", "查号码", "查客户名"].includes(x[0] as string))).toBe(false);
    expect(await page.getByTestId("还在客户页").count()).toBe(1);
  } finally { await page.close(); }
});

it("X-18：客户转给销售后我看不到这位客户了：不刷新、不落到新项目；去向就地写在框里，点「回客户列表」才走", async () => {
  const page = await 开({ __回: { ok: true, projectId: "np2", 提示: "已指派给 销售甲", 转走: true, 看不到客户了: true } });
  try {
    const 框 = page.getByRole("dialog");
    await 填沟通(page);
    await 建好键(page).click();
    const 话 = 框.locator(".pj-wiz-after");
    await 话.waitFor();
    expect(await 话.getAttribute("role")).toBe("status");
    expect(await 话.innerText()).toContain("已指派给 销售甲");
    expect(await page.locator(".ant-message-notice").count()).toBe(0);
    // 读完再走：多等一会儿也还没跳、没刷新（不按时间自己走）
    await page.waitForTimeout(2000);
    expect(await 窗of(page).then((x) => ({ 跳: x.跳, 刷新: x.刷新 }))).toEqual({ 跳: [], 刷新: 0 });
    await 框.getByRole("button", { name: "回客户列表" }).click();
    expect(await 窗of(page).then((x) => ({ 跳: x.跳, 刷新: x.刷新 }))).toEqual({ 跳: ["/customers"], 刷新: 0 });
    await expect.poll(() => page.getByRole("dialog").count(), { timeout: 5000 }).toBe(0);
  } finally { await page.close(); }
});

it("按分配方式进了待分配（没转走）：去向用橙字写在框里，点「知道了」才落到新项目", async () => {
  const page = await 开({ __回: { ok: true, projectId: "np3", 提示: "没有可分的销售，项目在待分配" } });
  try {
    const 框 = page.getByRole("dialog");
    await 填沟通(page);
    await 建好键(page).click();
    const 话 = 框.locator(".pj-wiz-after");
    await 话.waitFor();
    expect(await 话.getAttribute("data-warn")).not.toBeNull();
    expect((await 窗of(page)).跳).toEqual([]);
    await 框.getByRole("button", { name: "知道了" }).click();
    expect((await 窗of(page)).跳).toEqual(["/customers/a?project=np3&landed=1"]);
  } finally { await page.close(); }
});

it("cr.auto：销售选自动分配——就地黄条写后果、键写「建好并分出去」，不再叠一层确认框", async () => {
  const page = await 开({ __销售: true, __默认分配: 1 });
  try {
    const 框 = page.getByRole("dialog");
    expect(await 框.getByTestId("wizard-auto-warn").innerText()).toContain("分出去后你将看不到这个项目");
    await 填沟通(page);
    await 框.getByRole("button", { name: "建好并分出去" }).click();
    await 框.getByRole("button", { name: "已建好" }).waitFor();
    expect(await page.getByRole("dialog").count()).toBe(1);
    expect((await 窗of(page)).建).toMatchObject({ 项目: { 分配方式: 1 } });
  } finally { await page.close(); }
});

const 带走一个 = { 项目数: 2, 项目: [{ name: "市场的老项目", 客户: "测试客户甲" }], 同事: { 项目数: 1 } };
const 确认标题 = "会一起转走的 2 个项目";

it("P-转-07：有项目一起转时先列出来，同事在推的只给个数；取消不建、框还在、就地说为什么没建、可再点；一起转才建", async () => {
  const page = await 开({ __带走: 带走一个 });
  try {
    const 框 = page.getByRole("dialog", { name: "新增项目" });
    await 填沟通(page);
    await 建好键(page).click();
    const 问 = page.getByRole("dialog").filter({ hasText: "会一起转走" });
    await 问.getByText(确认标题).first().waitFor();
    expect(await 问.innerText()).toContain("另外有 1 个同事在推的项目，负责人也一起改成新负责人");
    expect((await 窗of(page)).建).toBeNull();
    await 问.getByRole("button", { name: /^取\s?消$/ }).click();
    await 问.waitFor({ state: "hidden" });
    expect((await 窗of(page)).建).toBeNull();
    // 没建的原因就地写在底栏上面（role=alert），不弹顶部提示；键照样能点
    await 框.getByRole("alert").filter({ hasText: "没建：一起转的项目还没确认" }).waitFor();
    expect(await page.locator(".ant-message-notice").count()).toBe(0);
    expect(await 建好键(page).isEnabled()).toBe(true);
    await 建好键(page).click();
    await 问.getByText(确认标题).first().waitFor();
    await 问.getByRole("button", { name: "一起转" }).click();
    await 框.getByRole("button", { name: "已建好" }).waitFor();
    expect((await 窗of(page)).建).toMatchObject({ 项目: { 分配方式: 0 } });
  } finally { await page.close(); }
});

it("P-转-07：没有要转的不弹，直接建；问的时候带上这次的分配方式、负责人、业务线", async () => {
  const page = await 开();
  try {
    await 填沟通(page);
    await 建好键(page).click();
    await page.getByRole("button", { name: "已建好" }).waitFor();
    expect(await page.getByRole("dialog").filter({ hasText: "会一起转走" }).count()).toBe(0);
    const 预览 = (await 窗of(page)).预览;
    expect(预览).toHaveLength(1);
    expect(预览[0][0]).toBe("a");
    expect(预览[0][1]).toMatchObject({ 分配方式: 0, ownerId: "u2", 业务线: "内贸" });
  } finally { await page.close(); }
});

it("P-转-07：取预览失败不拦着建（断网时服务端照常查）", async () => {
  const page = await 开({ __预览失败: true });
  try {
    await 填沟通(page);
    await 建好键(page).click();
    await page.getByRole("button", { name: "已建好" }).waitFor();
    expect(await page.getByRole("dialog").filter({ hasText: "会一起转走" }).count()).toBe(0);
  } finally { await page.close(); }
});
