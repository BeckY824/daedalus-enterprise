/**
 * 企业版客户页记跟进默认挂项目（10-27 会议：「默认自动关联当前项目」；服务端规则见 ent-followup-project.test.ts）。
 *
 *   给了在推项目：「关联商机」换成「关联项目」，默认选第一个（页面按最近动过排）；必选，不能清空（10-28 A2）
 *   给了空列表：这一格还在，提示「没挂项目，建议先建项目」，照旧能记，交上去是 null
 *   编辑：不摆这一格，交上去不带 projectId
 *   开关关闭（页面不给 projects）：和原来一样是「关联商机」，交上去不带 projectId
 *   Windows 1024 / 1280 / 1366：超长项目名不横向撑出，「保存」点得中
 *   选了项目且项目能记（2026-10-30 P0-3）：多出「客户明确回复了吗」「下一步」，走项目详情同一个 记项目沟通Action；
 *     选下一步时间时预演回收日（选这天 → 回收日变为 MM-DD）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "followup-project-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  stub(/projects\/actions$/, "export const 项目沟通须知=async()=>(window.__须知??{ok:true,能记:false}),记项目沟通Action=async(id,x,卡点)=>{window.__项目存={id,...x};window.__卡点=卡点;return{ok:true,followUpId:'f1',自动推到:window.__推到}};");
  stub(/^\.\/actions$/, "export const saveFollowUp=async x=>{window.__存=x;return{ok:true,id:'f1'}},completePlan=async()=>({ok:true});export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'n1'});");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no'});");
  stub(/^\.\/CustomerPick$/, "export default function C(){return null}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import FollowUpForm from '@/app/(app)/customers/[id]/FollowUpForm';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司年度框架采购项目'.repeat(5);
    window.__render=({项目,编辑})=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>
      <FollowUpForm open onClose={()=>{}} onSaved={()=>{}} customerId="c1" aiEnabled={false}
        record={编辑?{id:'f9',type:'PHONE',title:'',content:'原来的',status:'已完成',occurredAt:'2026-10-20T10:00:00.000Z',updatedAt:'2026-10-20T10:00:00.000Z'}:null}
        contacts={[]} opportunities={项目==null?[{id:'o1',name:'一个商机'}]:[]}
        projects={项目==='有'?[{id:'p1',name:长},{id:'p2',name:'二号项目'}]:项目==='空'?[]:null}/>
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
type 参数 = { 项目?: "有" | "空" | null; 编辑?: boolean; 须知?: unknown };
async function open(p: 参数, width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://fup.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://fup.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(x => { Reflect.set(window, "__须知", x.须知); (window as unknown as { __render: (x: 参数) => void }).__render(x); }, p);
  await page.getByRole("button", { name: /保\s*存/ }).waitFor();
  return { page, errors };
}
async function 存(page: import("playwright").Page) {
  await page.locator("#content").fill("聊了报价");
  await page.getByRole("button", { name: /保\s*存/ }).click();
  await page.waitForFunction(() => Reflect.get(window, "__存"));
  return page.evaluate(() => Reflect.get(window, "__存") as Record<string, unknown>);
}
const 格 = (page: import("playwright").Page, 名: string) => page.locator(".ant-form-item").filter({ has: page.locator(`label:text-is("${名}")`) });

it("给了在推项目：「关联项目」默认选第一个，交上去带它；没有「关联商机」", async () => {
  const { page, errors } = await open({ 项目: "有" });
  try {
    expect(await 格(page, "关联商机").count()).toBe(0);
    expect(await 格(page, "关联项目").locator(".ant-select-content").innerText()).toContain("年度框架采购项目");
    expect((await 存(page)).projectId).toBe("p1");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("有在推项目时「关联项目」必选：没有清除按钮", async () => {
  const { page } = await open({ 项目: "有" });
  try {
    const 项 = 格(page, "关联项目");
    expect(await 项.locator(".ant-select-content-has-value").count()).toBe(1);
    await 项.locator(".ant-select").hover();
    expect(await 项.locator(".ant-select-clear").count()).toBe(0);
    expect(await 项.locator(".ant-form-item-required").count()).toBe(1);
  } finally { await page.close(); }
});

it("没有在推的项目：这一格提示一句，交上去是 null", async () => {
  const { page, errors } = await open({ 项目: "空" });
  try {
    expect(await 格(page, "关联项目").innerText()).toContain("没挂项目，建议先建项目");
    expect((await 存(page)).projectId).toBeNull();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("编辑：不摆「关联项目」，交上去不带 projectId", async () => {
  const { page, errors } = await open({ 项目: "有", 编辑: true });
  try {
    expect(await 格(page, "关联项目").count()).toBe(0);
    expect(await 格(page, "关联商机").count()).toBe(0);
    await page.getByRole("button", { name: /保\s*存/ }).click();
    await page.waitForFunction(() => Reflect.get(window, "__存"));
    expect(await page.evaluate(() => Reflect.get(window, "__存") as Record<string, unknown>)).not.toHaveProperty("projectId");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("开关关闭（不给 projects）：还是「关联商机」，交上去不带 projectId", async () => {
  const { page, errors } = await open({ 项目: null });
  try {
    expect(await 格(page, "关联商机").count()).toBe(1);
    expect(await 格(page, "关联项目").count()).toBe(0);
    expect(await 存(page)).not.toHaveProperty("projectId");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：超长项目名不横向撑出，「保存」点得中", async (w) => {
  const { page } = await open({ 项目: "有" }, w);
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const 框 = (await page.getByRole("dialog").boundingBox())!;
    const 项 = (await 格(page, "关联项目").boundingBox())!;
    expect(项.x + 项.width).toBeLessThanOrEqual(框.x + 框.width);
    const btn = page.getByRole("button", { name: /保\s*存/ });
    const box = (await btn.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(w);
    const 点中 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box.x + box.width / 2, box.y + box.height / 2]);
    expect(点中).toBe(await btn.textContent());
  } finally { await page.close(); }
});

const 卡点默认 = { 时限天数: 3, 阻碍主体们: ["客户"], 默认类型: "轻度卡点", 默认影响: "短期不影响" };
const 须知 = (底子: { 起点日: string; 天数: number } | null, 能发卡点 = true) => ({ ok: true, 能记: true, phase: "线索", 要下一步: true, 回收预演: 底子, contactId: "k1", 卡点默认: 能发卡点 ? 卡点默认 : null });
const 今天 = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());

it("项目能记：问「客户明确回复了吗」（收在「更多」里），走项目同一个 action，选明天预演回收日", async () => {
  const { page, errors } = await open({ 项目: "有", 须知: 须知({ 起点日: 今天(), 天数: 7 }) });
  try {
    // F-跟进-06：主区只有内容、卡点、下一步、下一步时间；「客户明确回复了吗」在默认折起的「更多」里，旁边提示还没选
    const 更多 = page.getByRole("button", { name: /更多：/ });
    await 更多.waitFor();
    expect(await 更多.getAttribute("aria-expanded")).toBe("false");
    expect(await page.getByText("客户明确回复还没选").count()).toBe(1);
    const 问 = 格(page, "客户明确回复了吗");
    expect(await 问.isVisible()).toBe(false);
    expect(await 格(page, "标题").isVisible()).toBe(false);
    await page.locator("#content").fill("聊了报价");
    // 没选就存：拦在「客户明确回复了吗」，「更多」自己展开
    await page.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(() => 更多.getAttribute("aria-expanded")).toBe("true");
    await expect.poll(() => 问.innerText()).toContain("请选客户明确回复了吗");
    expect(await 问.innerText()).toContain("线索");
    await 问.getByText("客户明确回复了", { exact: true }).click();
    await 格(page, "下一步做什么").locator("input").fill("周五前发报价单");
    const 时 = page.locator(".ant-form-item").filter({ has: page.locator('label:text-is("下一步时间")') });
    expect(await 时.innerText()).not.toContain("回收日变为");
    await 时.getByRole("button", { name: /明\s*天/ }).click();
    const 明 = new Date(Date.parse(今天() + "T00:00:00Z") + 86400_000).toISOString().slice(0, 10);
    const 后 = new Date(Date.parse(今天() + "T00:00:00Z") + 2 * 86400_000).toISOString().slice(5, 10);
    await expect.poll(() => 时.innerText()).toContain(`选这天 → 回收日变为 ${后}`);
    await page.getByRole("button", { name: /保\s*存/ }).click();
    await page.waitForFunction(() => Reflect.get(window, "__项目存"));
    const 交 = await page.evaluate(() => Reflect.get(window, "__项目存") as Record<string, unknown>);
    expect(交).toMatchObject({ id: "p1", 阶段: "线索", 明确回复: true, 下一步: "周五前发报价单", 下一步时间: 明, content: "聊了报价" });
    // 标题、状态等随这一次交（额外），不再补一刀 saveFollowUp（M-权限-09 成员改不了沟通）
    expect(交).toMatchObject({ 额外: { status: "已完成", durationMinutes: null } });
    expect(await page.evaluate(() => Reflect.get(window, "__存"))).toBeUndefined();
    // 卡点没动：类型「暂无卡点」、描述空，照样交给服务端判（不生成）
    expect(await page.evaluate(() => Reflect.get(window, "__卡点"))).toEqual({ type: "暂无卡点", impact: null, description: "" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("项目不能记（比如已结束）、规则关着：照旧走 saveFollowUp；不显示回收日预演", async () => {
  const { page, errors } = await open({ 项目: "有", 须知: { ok: true, 能记: false } });
  try {
    expect(await 格(page, "客户明确回复了吗").count()).toBe(0);
    expect((await 存(page)).projectId).toBe("p1");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  const b = await open({ 项目: "有", 须知: 须知(null) });
  try {
    const 时 = b.page.locator(".ant-form-item").filter({ has: b.page.locator('label:text-is("下一步时间")') });
    await 时.getByRole("button", { name: "3 天后" }).click();
    expect(await 时.innerText()).not.toContain("回收日变为");
  } finally { await b.page.close(); }
});

it("F-跟进-08：卡点在沟通内容和下一步之间，选了类型写了描述就随这一次交；不能发卡点的不摆", async () => {
  const { page, errors } = await open({ 项目: "有", 须知: 须知(null) });
  try {
    const 类型 = page.getByRole("combobox", { name: "卡点类型" });
    await 类型.waitFor();
    // 位置：沟通内容 < 卡点 < 下一步
    const y = async (l: import("playwright").Locator) => (await l.boundingBox())!.y;
    expect(await y(page.locator("#content"))).toBeLessThan(await y(类型));
    expect(await y(类型)).toBeLessThan(await y(格(page, "下一步做什么")));
    await 类型.click();
    await page.locator(".ant-select-item-option").filter({ hasText: "重要卡点" }).click();
    await page.getByRole("textbox", { name: "卡点描述" }).fill("对方法务卡合同");
    await page.locator("#content").fill("聊了报价");
    await 格(page, "下一步做什么").locator("input").fill("周五前发报价单");
    await 格(page, "下一步时间").getByRole("button", { name: "3 天后" }).click();
    await page.getByRole("button", { name: /更多：/ }).click();
    await 格(page, "客户明确回复了吗").getByText("没有明确回复", { exact: true }).click();
    await page.getByRole("button", { name: /保\s*存/ }).click();
    await page.waitForFunction(() => Reflect.get(window, "__项目存"));
    expect(await page.evaluate(() => Reflect.get(window, "__卡点"))).toEqual({ type: "重要卡点", impact: null, description: "对方法务卡合同" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  const b = await open({ 项目: "有", 须知: 须知(null, false) });
  try {
    await b.page.getByRole("button", { name: /更多：/ }).waitFor();
    expect(await b.page.getByRole("combobox", { name: "卡点类型" }).count()).toBe(0);
  } finally { await b.page.close(); }
});
