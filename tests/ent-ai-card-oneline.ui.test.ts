/**
 * 首页 AI 写入卡的排版（11-20，11-04 全站「一行 + 省略号 + 悬停看全文、只有备注折行」补到 AI 卡）：
 *   - 卡头（在「长项目名」上记一条沟通）一行，放不下「…」，不折成几行、不顶出卡
 *   - 项目卡「选哪一个」：下拉占满这一行，选中的长名字在框里「…」，框上 title 是全文；不再定 260 最小宽（375 把卡撑宽）
 *   - 下一步计划等定宽输入框窄屏跟着缩，不顶出卡
 *   - 记沟通卡「关联项目」只一个时：一行「…」（原来折行）
 *   - 确认后顺带按必填推了一格：落印下面一行说推到哪（回执句子，折行看全）
 *   1366 / 375 两个宽度都量：页面不横滚、每一格的右边不出卡
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ai-card-oneline", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  stub(/^next\/link$/, "export default function L({children,prefetch,...p}){return <a {...p}>{children}</a>}");
  // 项目卡那几格是 dynamic 进来的：照样渲染（lazy + Suspense），不像别的用例那样空掉
  stub(/^next\/dynamic$/, "import React from 'react';export default (f)=>{const C=React.lazy(()=>f().then(m=>({default:m.default??m})));return (p)=><React.Suspense fallback={null}><C {...p}/></React.Suspense>;};");
  stub(/customers\/\[id\]\/actions$/, 补全动作桩("src/app/(app)/customers/[id]/actions.ts", "export const 沟通可选项目=async()=>(window.__可选??{ok:true,项目们:[],能建项目:true});"));
  stub(/dashboard\/apply$/, "export const applyProposal=async p=>{window.__交=p;return window.__回??{ok:true}};export const undoProposal=async()=>({ok:true});");
  stub(/card-scan\/originals$/, "export const 取走名片原图=()=>null,记下刚建的=()=>{},忘掉刚建的=()=>{};");
  stub(/attachment-upload$/, "export const 传附件=async()=>({ok:true});");
  stub(/customers\/RescueKey$/, "export default function R(){return null}");
  stub(/customers\/DedupeClaimKey$/, "export default function D(){return null}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import ProposalCard from '@/components/ProposalCard';
    const root=createRoot(document.getElementById('root'));
    window.__render=(卡)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <div className="cli-col"><ProposalCard proposal={卡}/></div>
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 长名 = "某某超长智能装备制造有限公司华东区二期扩产改造项目".repeat(3);
const 候 = (id: string, 名: string) => ({ id, 名, 说明: `某某超长贸易进出口有限公司 · 线索·潜客培育`, 补: { customerId: "c1", customerName: "某某超长贸易进出口有限公司", projectId: id, 组员记: false } });
const 记沟通卡 = (补: Record<string, unknown> = {}) => ({
  id: "p1", kind: "project_followup", customerId: "", customerName: "", reason: "人说的", targetId: "", targetName: "",
  候选: [候("x1", 长名), 候("x2", `${长名}（2）`)], type: "PHONE", content: "电话聊了排期", 下一步: "下周再报价", 下一步时间: "", 要卡点: false, 卡点类型: "", 影响等级: "", 阻碍原因: [], ...补,
});

async function open(width: number, 卡: unknown, 可选?: unknown) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://oneline.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://oneline.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(([卡, 可选]) => { if (可选) Reflect.set(window, "__可选", 可选); (window as unknown as { __render: (a: unknown) => void }).__render(卡); }, [卡, 可选] as const);
  await page.locator(".prop-ok").waitFor();
  return { page, errors };
}

/** 页面不横滚；卡里每一格（.prop-f）、卡头的右边都不出卡 */
const 不出卡 = (page: import("playwright").Page) => page.evaluate(() => {
  const 卡 = document.querySelector(".prop")!.getBoundingClientRect();
  const 出 = [...document.querySelectorAll(".prop .prop-f, .prop .prop-h, .prop .prop-f > *")].filter((e) => e.getBoundingClientRect().right > 卡.right + 1).map((e) => e.className);
  return { 页: document.documentElement.scrollWidth <= window.innerWidth, 出 };
});

it.each([1366, 375])("项目记沟通卡 %ipx：卡头一行「…」；选中的长项目名在框里「…」、title 是全文；输入框不顶出卡", async (w) => {
  const { page, errors } = await open(w, 记沟通卡({ targetId: "x2", targetName: `${长名}（2）`, customerId: "c1", customerName: "某某超长贸易进出口有限公司", projectId: "x2" }));
  try {
    await page.locator(".prop-pick").waitFor();
    const 头 = await page.locator(".prop-t").evaluate((e) => {
      const s = getComputedStyle(e);
      return { 一行: s.whiteSpace === "nowrap" && s.textOverflow === "ellipsis", 截了: e.scrollWidth > e.clientWidth, 高: e.getBoundingClientRect().height, 行高: parseFloat(s.lineHeight) || 22 };
    });
    expect(头.一行).toBe(true);
    expect(头.截了).toBe(true);
    expect(头.高).toBeLessThan(头.行高 * 1.6);
    // antd 6：选中的值在 .ant-select-content 上（带 title）
    const 选中 = page.locator(".prop-pick .ant-select-content");
    expect(await 选中.getAttribute("title")).toBe(`${长名}（2）（某某超长贸易进出口有限公司 · 线索·潜客培育）`);
    expect(await 选中.evaluate((e) => { const s = getComputedStyle(e); return { 省略: s.textOverflow, 一行: s.whiteSpace, 截了: e.scrollWidth > e.clientWidth }; })).toEqual({ 省略: "ellipsis", 一行: "nowrap", 截了: true });
    expect(await 不出卡(page)).toEqual({ 页: true, 出: [] });
    // 下拉里的每一项也是一行带 title
    await page.locator(".prop-pick").click();
    const 项 = page.locator(".ant-select-item-option").first();
    await 项.waitFor();
    expect(await 项.getAttribute("title")).toContain(长名);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1366, 375])("首页 AI 记沟通卡 %ipx：关联项目只一个时一行「…」，不折行、不出卡", async (w) => {
  const { page, errors } = await open(w, { id: "p1", kind: "add_followup", customerId: "c1", customerName: "某某超长贸易进出口有限公司", reason: "x", type: "PHONE", title: "", content: "电话聊了报价", occurredAt: "2026-11-17T09:00:00.000Z" }, { ok: true, 项目们: [{ id: "x1", name: 长名 }], 能建项目: true });
  try {
    const 一 = page.locator(".prop-proj-one");
    await 一.waitFor();
    expect(await 一.evaluate((e) => getComputedStyle(e).whiteSpace === "nowrap" && e.scrollWidth > e.clientWidth)).toBe(true);
    expect(await 不出卡(page)).toEqual({ 页: true, 出: [] });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1366, 375])("确认后顺带按必填推了一格 %ipx：落印下面一行说推到哪，看得全、不出卡；没推不摆", async (w) => {
  const 话 = `项目「${长名}」必填齐了，自动推进到 方案敲定（这张卡不能撤销，要退回去到项目页改进程）`;
  const { page, errors } = await open(w, 记沟通卡({ 候选: undefined, targetId: "x1", targetName: 长名, customerId: "c1", customerName: "某某超长贸易进出口有限公司", projectId: "x1" }));
  try {
    await page.evaluate((x) => Reflect.set(window, "__回", { ok: true, message: "已记", 推进: x }), 话);
    await page.locator(".prop-ok").click();
    const 推 = page.getByTestId("prop-done-push");
    await 推.waitFor();
    expect(await 推.innerText()).toBe(话);
    expect(await 推.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => {
      const 卡 = document.querySelector(".prop-done")!.getBoundingClientRect();
      const n = document.querySelector("[data-testid=prop-done-push]")!.getBoundingClientRect();
      return document.documentElement.scrollWidth <= window.innerWidth && n.right <= 卡.right + 1;
    })).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  // 没推：不摆那一行
  const 二 = await open(w, 记沟通卡({ 候选: undefined, targetId: "x1", targetName: "短名", customerId: "c1", customerName: "客户", projectId: "x1" }));
  try {
    await 二.page.locator(".prop-ok").click();
    await 二.page.locator(".prop-done").waitFor();
    expect(await 二.page.getByTestId("prop-done-push").count()).toBe(0);
  } finally { await 二.page.close(); }
});

it.each([1366, 375])("删回款卡 %ipx：「删除」那格折行，日期、金额整句看得全（删了不能恢复，不能截）", async (w) => {
  const 名 = `2026-10-20 CNY 128000 · ${长名}`;
  const { page, errors } = await open(w, { id: "p1", kind: "payment_delete", customerId: "c1", customerName: "某某超长贸易进出口有限公司", reason: "人说记错了", targetId: "pay1", targetName: 名, projectId: "x1" });
  try {
    const 格 = page.locator(".prop-f-wrap");
    await 格.waitFor();
    expect(await 格.innerText()).toBe(名);
    expect(await 格.evaluate((e) => { const s = getComputedStyle(e); return { 折: s.whiteSpace, 全: e.scrollWidth <= e.clientWidth + 1 }; })).toEqual({ 折: "normal", 全: true });
    expect(await 不出卡(page)).toEqual({ 页: true, 出: [] });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
