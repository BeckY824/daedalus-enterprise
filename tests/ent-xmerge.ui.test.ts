import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* 跨负责人项目合并 · 阶段 2 页面（E-380）：真组件 + globals.css + merge.css，只桩掉 merge-actions。钉的是：
   发起框（MergeHost CrossMergeDialog）：打开读候选、选了读预览；申请 = 按钮「发起合并申请」、写等谁确认 / 5 个工作日 / 验证计时暂停；直接并 = 「并过来」；
   拦下的原因原样摆、按钮点不了；发出后写「申请已发出」；
   确认页（merge-requests/ProjectMergeRequests）：等我确认两颗按钮，确认弹框写后果、点了调 处理跨并(id,"确认")，办成留着置灰写「已合并」；
   拒绝原因必填（空点不了）、超 100 字点不了、调 处理跨并(id,"拒绝",原因)；没办成原因写在框里、框不关；我发起的待确认带「撤回申请」，调 撤回跨并申请单；
   只读身份按钮置灰；1280 / 390 不横滚，390 按钮 ≥ 44px */
let browser: Browser, bundle: string;
const 长名 = "超长的测试项目名称用来看会不会撑破".repeat(2) + "出来的项目四";
const 动作 = `
  const 记=(...a)=>(window.__调??=[]).push(a);
  export const 跨并候选们=async(id)=>{记('候选',id);return window.__候选??[]};
  export const 预览跨并=async(a,b)=>{记('预览',a,b);return window.__预览};
  export const 发起跨并=async(a,b)=>{记('发起',a,b);return window.__发起结果??{ok:true,方式:'申请',requestId:'r1',到期:new Date().toISOString()}};
  export const 处理跨并=async(id,结论,原因)=>{记('处理',id,结论,原因);return (window.__处理结果??{})[id]??{ok:true,状态:结论==='拒绝'?'已拒绝':'已合并'}};
  export const 作废跨并申请单=async(id,原因)=>{记('作废',id,原因);return {ok:true}};
  export const 撤回跨并申请单=async(id)=>{记('撤回申请',id);return {ok:true}};
  export const 撤回项目合并单=async(id)=>{记('撤回',id);return {ok:true,没还原:[]}};
  export const 能并同事的=async()=>false;`;
const plugin: Plugin = { name: "xmerge", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)merge-actions$/, 补全动作桩("src/app/(app)/customers/merge-actions.ts", 动作));
  stub(/^next\/link$/, "export default function L({children,prefetch,...p}){return <a {...p}>{children}</a>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷=(window.__刷??0)+1},push(u){window.__去=u},replace(){},prefetch(){}});export const usePathname=()=>'/customers/merge-requests';");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import MergeHost from '@/app/(app)/customers/[id]/MergeHost';import {合并桥} from '@/app/(app)/customers/[id]/merge-bridge';
    import ProjectMergeRequests from '@/app/(app)/customers/merge-requests/ProjectMergeRequests';
    import MergedIntoLine from '@/app/(app)/projects/[id]/MergedIntoLine';
    function 壳({请求}){const [r,setR]=React.useState(请求);
      return <合并桥.Provider value={{请求:r,收:()=>setR(null)}}><MergeHost customerId="a" 客户名=""/></合并桥.Provider>}
    window.__render=(请求)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><壳 请求={{...请求,次:1}}/></App></ConfigProvider>);
    window.__renderLine=(p)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><MergedIntoLine 单={null} 项目名="我的项目" 去={null} {...p}/></App></ConfigProvider>);
    window.__renderList=(p)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><ProjectMergeRequests {...p}/></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 候选 = [{ id: "pb", name: 长名, node: "初步接触", 负责人: "示例同事丙" }, { id: "pc", name: "另一条展会线索", node: "需求确认", 负责人: "示例同事丁" }];
const 预览申请 = { ok: true, 直接: false, 确认人: [{ 名: "示例上级甲", 层级: "实线上级" }, { 名: "示例线总乙", 层级: "条线总管理" }], 留下: { id: "pa", name: "我的项目", 负责人: "我" }, 并掉: { id: "pb", name: 长名, 负责人: "示例同事丙" } };
const 天后 = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const 边 = (id: string, 名: string, 负责人: string, 沟通 = 3) => ({ id, 名, 节点: "初步接触", 负责人, 沟通 });
const 行 = (id: string, 补: object = {}) => ({
  id, 状态: "待确认", 原因: null, 客户: "示例客户甲", 留下: 边("pa", "留下的项目", "示例同事乙"), 并掉: 边("pb", 长名, "示例同事丙", 5),
  发起人: "示例同事乙", 发起人id: "yi", 发起: 天后(-1), 到期: 天后(4), 结束: null, mergeId: null,
  确认人: [{ userId: "me", 名: "我", 层级: "实线上级" }, { userId: "x", 名: "示例线总乙", 层级: "条线总管理" }], ...补,
});

async function open(width: number, 渲染: "dialog" | "list" | "line", 参: object, 设: Record<string, unknown> = {}) {
  const page = await browser.newPage({ viewport: { width, height: width < 768 ? 844 : 900 } }); page.setDefaultTimeout(5000);
  const 错: string[] = [];
  page.on("pageerror", e => 错.push(String(e)));
  page.on("console", m => { if (m.type() === "error") 错.push(m.text()); });
  await page.route("http://xm.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://xm.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ path: path.resolve("src/app/(app)/customers/merge.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => Object.assign(window, x), { __候选: 候选, __预览: 预览申请, ...设 });
  await page.evaluate(([k, p]) => (window as unknown as Record<string, (x: object) => void>)[k === "dialog" ? "__render" : k === "line" ? "__renderLine" : "__renderList"](p as object), [渲染, 参] as const);
  return { page, 错 };
}
const 调 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? []);
const 横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const 请求 = { 种: "跨并项目", projectId: "pa", 名: "我的项目" };
async function 选(page: Page, 词: string) {
  await page.getByLabel("并进来的项目").click();
  await page.keyboard.type(词);
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: 词 }).first().click();
}

it("发起框：选同事的项目 → 预览写等谁确认 / 5 个工作日 / 验证计时暂停，按钮「发起合并申请」；发出后写申请已发出", async () => {
  const { page, 错 } = await open(1280, "dialog", 请求);
  try {
    await page.getByText("把同事的项目并进来").first().waitFor();
    expect(await 调(page)).toEqual([["候选", "pa"]]);
    await 选(page, "超长");
    await page.locator('[data-testid="xmerge-list"]').waitFor();
    const 表 = await page.locator('[data-testid="xmerge-list"]').innerText();
    expect(表).toContain("示例上级甲（实线上级）、示例线总乙（条线总管理）");
    expect(表).toContain("5 个工作日");
    expect(表).toContain("验证计时都暂停");
    expect(表).toContain("不退还已占线索名额");
    expect(await page.locator('[data-testid="xmerge-go"]').innerText()).toBe("发起合并申请");
    await page.locator('[data-testid="xmerge-go"]').click();
    await page.getByRole("button", { name: "发起合并申请" }).last().click();
    await page.locator('[data-testid="xmerge-sent"]').waitFor();
    expect((await 调(page)).some((c) => c[0] === "发起" && c[1] === "pa" && c[2] === "pb")).toBe(true);
    expect(错).toEqual([]);
  } finally { await page.close(); }
});

it("发起框：确认人 / 系统管理员 = 直接并，按钮「并过来」；拦下的原因原样摆、按钮点不了；没候选写明为什么", async () => {
  let o = await open(1280, "dialog", 请求, { __预览: { ...预览申请, 直接: true, 确认人: [{ 名: "我", 层级: "系统管理员" }] } });
  try {
    await 选(o.page, "展会");
    await o.page.locator('[data-testid="xmerge-list"]').waitFor();
    expect(await o.page.locator('[data-testid="xmerge-go"]').innerText()).toBe("并过来");
    expect(await o.page.locator('[data-testid="xmerge-方式"]').innerText()).toContain("直接并");
  } finally { await o.page.close(); }
  o = await open(1280, "dialog", 请求, { __预览: { ok: false, 原因: ["被并走的项目的负责人不能发起，请留下项目的负责人发起"] } });
  try {
    await 选(o.page, "展会");
    await o.page.getByText("被并走的项目的负责人不能发起").waitFor();
    expect(await o.page.locator('[data-testid="xmerge-go"]').isDisabled()).toBe(true);
  } finally { await o.page.close(); }
  o = await open(1280, "dialog", 请求, { __候选: [] });
  try {
    await o.page.locator('[data-testid="xmerge-empty"]').waitFor();
    expect(await o.page.locator('[data-testid="xmerge-go"]').isDisabled()).toBe(true);
  } finally { await o.page.close(); }
});

it("确认页：确认弹框写后果，点了调 处理跨并(id,确认)，这一块留着置灰写「已合并」；没办成原因写在框里、框不关", async () => {
  const { page, 错 } = await open(1280, "list", { 等我: [行("r1"), 行("r2")], 我发起: [] }, { __处理结果: { r2: { ok: false, error: "两个项目的阶段有变，申请已失效，要重新发起" } } });
  try {
    await page.locator('[data-testid="xmerge-wait-item"]').first().waitFor();
    await page.locator('[data-testid="xmerge-confirm"]').first().click();
    expect(await page.locator('[data-testid="xmerge-effect"]').innerText()).toContain("确认后立即合并");
    await page.locator('[data-testid="xmerge-confirm-ok"]').click();
    await page.locator('[data-testid="xmerge-done"]').waitFor();
    expect(await page.locator('[data-testid="xmerge-done"]').innerText()).toContain("已合并");
    expect((await 调(page)).filter((c) => c[0] === "处理")[0]).toEqual(["处理", "r1", "确认", undefined]);
    await page.locator('[data-testid="xmerge-confirm"]').first().click();
    await page.locator('[data-testid="xmerge-confirm-ok"]').click();
    await page.locator('[data-testid="xmerge-err"]').waitFor();
    expect(await page.locator('[data-testid="xmerge-box"]').isVisible()).toBe(true);
    expect(错).toEqual([]);
  } finally { await page.close(); }
});

it("确认页：拒绝原因必填（空点不了）、超 100 字点不了；写了调 处理跨并(id,拒绝,原因)", async () => {
  const { page } = await open(1280, "list", { 等我: [行("r1")], 我发起: [] });
  try {
    await page.locator('[data-testid="xmerge-reject"]').first().click();
    const ok = page.locator('[data-testid="xmerge-reject-ok"]');
    expect(await ok.isDisabled()).toBe(true);
    await page.locator('[data-testid="xmerge-why"]').fill("字".repeat(101));
    expect(await ok.isDisabled()).toBe(true);
    await page.locator('[data-testid="xmerge-why"]').fill("还在跟进，不并");
    expect(await ok.isDisabled()).toBe(false);
    await ok.click();
    await page.locator('[data-testid="xmerge-done"]').waitFor();
    expect((await 调(page)).filter((c) => c[0] === "处理")[0]).toEqual(["处理", "r1", "拒绝", "还在跟进，不并"]);
  } finally { await page.close(); }
});

it("我发起的：待确认带「撤回申请」调 撤回跨并申请单；结束了的不带；只读身份按钮置灰", async () => {
  const { page } = await open(1280, "list", { 等我: [], 我发起: [行("m1"), 行("m2", { 状态: "已拒绝", 原因: "还在跟进", 结束: 天后(-1) })] });
  try {
    expect(await page.locator('[data-testid="xmerge-withdraw"]').count()).toBe(1);
    await page.locator('[data-testid="xmerge-withdraw"]').click();
    await page.getByRole("button", { name: "撤回申请" }).last().click();
    await page.waitForFunction(() => ((window as unknown as { __调?: unknown[][] }).__调 ?? []).some((c) => c[0] === "撤回申请"));
    expect((await 调(page)).filter((c) => c[0] === "撤回申请")).toEqual([["撤回申请", "m1"]]);
  } finally { await page.close(); }
  const o = await open(1280, "list", { 等我: [行("r1")], 我发起: [], 只读原因: "只读管理员不能替人同意或拒绝" });
  try {
    expect(await o.page.locator('[data-testid="xmerge-confirm"]').first().isDisabled()).toBe(true);
    expect(await o.page.locator(".mrq-ro").first().getAttribute("title")).toBe("只读管理员不能替人同意或拒绝");
  } finally { await o.page.close(); }
});

it("390：确认页不横滚、长项目名一行省略、按钮 ≥ 44px；1280 不横滚", async () => {
  for (const w of [390, 1280]) {
    const { page } = await open(w, "list", { 等我: [行("r1")], 我发起: [行("m1")] });
    try {
      await page.locator('[data-testid="xmerge-wait-item"]').waitFor();
      expect(await 横滚(page)).toBe(false);
      if (w === 390) {
        for (const id of ["xmerge-confirm", "xmerge-reject", "xmerge-withdraw"]) {
          const h = await page.locator(`[data-testid="${id}"]`).first().evaluate((e) => Math.round(e.getBoundingClientRect().height));
          expect(h, id).toBeGreaterThanOrEqual(44);
        }
      }
    } finally { await page.close(); }
  }
  const { page } = await open(390, "dialog", 请求);
  try {
    await 选(page, "超长");
    await page.locator('[data-testid="xmerge-list"]').waitFor();
    expect(await 横滚(page)).toBe(false);
    const h = await page.locator('[data-testid="xmerge-go"]').evaluate((e) => Math.round(e.getBoundingClientRect().height));
    expect(h).toBeGreaterThanOrEqual(44);
  } finally { await page.close(); }
});

it("系统管理员：待确认的申请带「作废申请」，原因必填、超 100 字点不了，调 作废跨并申请单(id,原因)", async () => {
  const { page } = await open(1280, "list", { 等我: [], 我发起: [], 可作废: [行("v1")] });
  try {
    await page.locator('[data-testid="xmerge-void"]').click();
    const ok = page.locator('[data-testid="xmerge-void-ok"]');
    expect(await ok.isDisabled()).toBe(true);
    await page.locator('[data-testid="xmerge-why"]').fill("字".repeat(101));
    expect(await ok.isDisabled()).toBe(true);
    await page.locator('[data-testid="xmerge-why"]').fill("确认人已停用");
    await ok.click();
    await page.locator('[data-testid="xmerge-done"]').waitFor();
    expect((await 调(page)).filter((c) => c[0] === "作废")).toEqual([["作废", "v1", "确认人已停用"]]);
  } finally { await page.close(); }
});

it("390：项目页「待确认」那一行点开看全文（等谁、几时失效），不横滚、按钮 ≥ 44px；再点收起", async () => {
  const 待确认 = { requestId: "r1", 角色: "并走", 另一个: 长名, 等: "示例上级甲（实线上级）、示例线总乙（条线总管理）", 到期: 天后(4), 我发起: true, 我确认: true };
  const { page, 错 } = await open(390, "line", { 待确认 });
  try {
    const t = page.locator('[data-testid="project-xmerge-pending-text"]');
    await t.waitFor();
    const 窄 = await t.evaluate((e) => e.scrollWidth > e.clientWidth);
    expect(窄, "一行省略时放不下全文").toBe(true);
    await t.click();
    expect(await t.evaluate((e) => e.classList.contains("is-full"))).toBe(true);
    expect(await t.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(await 横滚(page)).toBe(false);
    for (const id of ["project-xmerge-withdraw"]) {
      expect(await page.locator(`[data-testid="${id}"]`).evaluate((e) => Math.round(e.getBoundingClientRect().height)), id).toBeGreaterThanOrEqual(44);
    }
    await t.click();
    expect(await t.evaluate((e) => e.classList.contains("is-full"))).toBe(false);
    expect(错).toEqual([]);
  } finally { await page.close(); }
});
