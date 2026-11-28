import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* 跨负责人项目合并 阶段 4 单 2 · /objections（ObjectionsView）认「项目合并」类：标签写「合并异议」、文案不写「转让」、裁定按钮「撤回合并」、
   因撤回终止的状态显示、类别筛选只在有合并类行时才摆、手工退回行提示先撤合并；390 / 1280 不横滚，一行省略。数据全是编的 */
let browser: Browser, bundle: string;
const 动作 = `
  export const 提异议=async(id,理由)=>{(window.__调??=[]).push(['提异议',id,理由]);return {ok:true}};
  export const 裁定异议=async(id,决定,说明)=>{(window.__调??=[]).push(['裁定异议',id,决定,说明]);return {ok:true}};
  export const 已手工退回=async(id,说明)=>{(window.__调??=[]).push(['已手工退回',id,说明]);return {ok:true}};`;
const plugin: Plugin = { name: "objections", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^\.\/actions$/, 补全动作桩("src/app/(app)/objections/actions.ts", 动作));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷新=(window.__刷新||0)+1},push(){},replace(){},prefetch(){}});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import V from '@/app/(app)/objections/ObjectionsView';
    window.__render=(p)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><V {...p}/></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, banner: { js: "var process=globalThis.process??{env:{}};" }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 长名 = "超长的被并项目名称用来看会不会撑破".repeat(6);
const 异议 = (改: object = {}) => ({ id: "o1", 类别: "项目合并", 对象: "被并的线索", 状态: "可提", 操作人: "测试确认人", 新负责人: "测试销售乙", 转让于: "2026-11-20T06:00:00.000Z", 截止: "2026-12-20T06:00:00.000Z", 剩几天: 22, 过期: false, ...改 });
const 转让 = (改: object = {}) => 异议({ id: "o9", 类别: "客户", 对象: "编造客户甲", 操作人: "测试销售管理", 新负责人: "测试销售丙", ...改 });
const 待裁 = (改: object = {}) => ({ id: "j1", 类别: "项目合并", 对象: 长名, 客户名: "编造客户甲", 异议人: "测试销售甲", 理由: "这条线索我跟了三个月", 转让原因: "把「被并的线索」并入「留下的线索」", 发起人: "测试销售乙", 接手人: "测试销售乙", 转让于: "2026-11-20T06:00:00.000Z", 提于: "2026-11-21T06:00:00.000Z", 状态: "待裁定", 能自动退: true, 退回说明: "", 现裁定人: "测试条线总管理", 能裁: true, ...改 });
const 基 = { 能提: [], 已提: [], 打开: null, 天数: 30, 上限: 200, 待裁: [], 全部: [], 待手工: [], 台账: [], 月: "2026-11", 月是默认: true, 管理员: false, 台账已查: false, 裁定上限: 200, 首个页签: "mine", 打开裁定: null };

async function open(width: number, props: object) {
  const page = await browser.newPage({ viewport: { width, height: width < 768 ? 844 : 900 } }); page.setDefaultTimeout(5000);
  const 错: string[] = [];
  page.on("pageerror", e => 错.push(String(e)));
  page.on("console", m => { if (m.type() === "error") 错.push(m.text()); });
  await page.route("http://obj.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://obj.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((p) => (window as unknown as { __render: (x: unknown) => void }).__render(p), { ...基, ...props });
  return { page, 错 };
}
const 调 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? []);
const 横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

for (const 宽 of [1280, 390]) {
  it(`${宽}：我的异议 —— 合并类标「合并异议」、写「把它并入」不写转让；提异议框写合并；类别筛选只看合并 / 转让；因撤回终止写明合并已撤回`, async () => {
    const { page, 错 } = await open(宽, { 能提: [异议(), 转让()], 已提: [异议({ id: "o2", 状态: "因撤回终止", 理由: "我的线索", 裁定说明: "因撤回终止" }), 异议({ id: "o3", 状态: "待裁定", 理由: "我的线索", 裁定人: "测试条线总管理", 裁定角色: "条线总管理" })] });
    try {
      const 开 = page.getByTestId("obj-open");
      await 开.waitFor();
      expect(await page.locator(".ant-segmented").count()).toBe(1);
      expect(await 开.innerText()).toContain("合并异议");
      expect(await 开.innerText()).toContain("测试确认人 把它并入 测试销售乙 的项目");
      expect(await 开.innerText()).toContain("测试销售管理 转给 测试销售丙");
      const 已 = await page.getByTestId("obj-sent").innerText();
      expect(已).toContain("这次合并已撤回，这条异议不用再裁");
      expect(已).not.toContain("因撤回终止：因撤回终止");
      expect(已).toContain("等 测试条线总管理（条线总管理）裁定");
      // 只看合并：转让那行没了
      await page.locator(".ant-segmented").getByText("合并异议", { exact: true }).click();
      expect(await 开.innerText()).not.toContain("编造客户甲");
      await page.locator(".ant-segmented").getByText("转让", { exact: true }).click();
      expect(await 开.innerText()).not.toContain("被并的线索");
      await page.locator(".ant-segmented").getByText("全部", { exact: true }).click();
      await page.getByRole("button", { name: /提异议/ }).first().click();
      const 框 = page.locator(".ant-modal");
      expect(await 框.innerText()).toContain("对合并提异议");
      expect(await 框.innerText()).toContain("把它并入 测试销售乙 的项目；裁定前合并照常有效");
      expect(await 框.innerText()).not.toContain("转给");
      await page.getByLabel("异议理由").fill("线索是我开的");
      await 框.getByRole("button", { name: /提\s*交/ }).click();
      await page.waitForFunction(() => ((window as unknown as { __调?: unknown[][] }).__调 ?? []).length > 0);
      expect(await 调(page)).toEqual([["提异议", "o1", "线索是我开的"]]);
      expect(await 横滚(page)).toBe(false);
      expect(错).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);

  it(`${宽}：待我裁定 —— 合并类行写合并原因、客户名；一行省略；按钮「维持 / 撤回合并」；裁定框写合并口径；裁定 → 裁定异议(id, 撤回, 说明)`, async () => {
    const { page, 错 } = await open(宽, { 待裁: [待裁()], 管理员: true, 首个页签: "judge" });
    try {
      const 行 = page.getByTestId("obj-judge-row");
      await 行.waitFor();
      const 文 = await 行.innerText();
      expect(文).toContain("合并异议");
      expect(文).toContain("合并原因：把「被并的线索」并入「留下的线索」");
      expect(文).toContain("测试销售乙 发起，留下 测试销售乙 名下");
      expect(文).not.toContain("转让原因");
      const 名 = 行.locator(".obj-ell").first();
      expect(await 名.getAttribute("title")).toContain(`${长名}（编造客户甲）`);
      expect(await 名.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      expect((await 名.boundingBox())!.height).toBeLessThan(30);
      expect(await 行.getByRole("button", { name: /维\s*持/ }).count()).toBe(1);
      const 撤 = 行.getByRole("button", { name: "撤回合并" });
      if (宽 < 768) expect((await 撤.boundingBox())!.height).toBeGreaterThanOrEqual(32);
      await 撤.click();
      const 框 = page.locator(".ant-modal");
      expect(await 框.innerText()).toContain("撤回这次合并，「" + 长名 + "」回到 测试销售甲 名下");
      await page.getByLabel("裁定说明").fill("按规则撤回");
      await 框.getByRole("button", { name: /^撤\s*回$/ }).click();
      await page.waitForFunction(() => ((window as unknown as { __调?: unknown[][] }).__调 ?? []).length > 0);
      expect(await 调(page)).toEqual([["裁定异议", "j1", "撤回", "按规则撤回"]]);
      expect(await 横滚(page)).toBe(false);
      expect(错).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);
}

 
for (const 宽 of [1280, 390]) {
  it(`${宽}：待手工退回 —— 合并类行带原因和「先到被并项目详情里撤回这次合并」，已手工退回 → 已手工退回(id, 说明)`, async () => {
    const { page, 错 } = await open(宽, { 待手工: [待裁({ id: "h1", 状态: "待手工退回", 能自动退: false, 退回说明: "留下的线索又被并走了", 裁定人: "测试条线总管理", 裁定说明: "维持不了" })], 管理员: true, 首个页签: "hand" });
    try {
      const 手 = page.getByTestId("obj-hand-row");
      await 手.waitFor();
      expect(await 手.innerText()).toContain("留下的线索又被并走了");
      expect(await 手.getByTestId("obj-hand-merge-note").innerText()).toContain("先到被并项目详情里撤回这次合并");
      await 手.getByRole("button", { name: "已手工退回" }).click();
      await page.getByLabel("裁定说明").fill("已撤回合并");
      await page.locator(".ant-modal").getByRole("button", { name: "确认已退回" }).click();
      await page.waitForFunction(() => ((window as unknown as { __调?: unknown[][] }).__调 ?? []).length > 0);
      expect(await 调(page)).toEqual([["已手工退回", "h1", "已撤回合并"]]);
      expect(await 横滚(page)).toBe(false);
      expect(错).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);
}

it("没有合并类行：标题仍是「转让异议」、不摆类别筛选（老界面不变）", async () => {
  const { page, 错 } = await open(1280, { 能提: [转让()] });
  try {
    await page.getByTestId("obj-open").waitFor();
    expect(await page.getByText("转让异议", { exact: true }).count()).toBe(1);
    expect(await page.locator(".ant-segmented").count()).toBe(0);
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 30_000);
