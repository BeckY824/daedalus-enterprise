/**
 * 自动分配「快轮到我」的两处界面（11-18 客户定第 1、2 题 A）：
 *   - 首页一行「自动分配：按现在的数，前面约 N 条轮到你」+ 旁边的估算说明；0 条写「下一条就轮到你」；没记录写「暂无法估算」；不参加（null）不画
 *   - 设置 → 线索分配（销售管理那一栏「线索配额」同一张卡）多一列「前面约几条」：约 N 条 / 下一条就轮到 / 暂无法估算 / 看不到的写「—」；卡上一句估算说明
 *   - Windows 1024 / 1280 / 1366：首页那一行、线索分配表都不横向撑出（表外那层不出横向滚动条），估算说明不被截掉
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 打包, 开页 } from "./settings-ui-kit";

let browser: Browser, 首页包: string, 设置包: string;
const plugin: Plugin = { name: "assign-eta-home", setup(b) {
  b.onResolve({ filter: /^next\/link$/ }, (a) => ({ path: a.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export default function L({prefetch,...p}){return <a {...p}/>}", loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  首页包 = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import AssignEtaLine from '@/app/(app)/dashboard/AssignEtaLine';
    const root=createRoot(document.getElementById('root'));
    window.__render=(x)=>root.render(<App><div style={{maxWidth:'min(760px, calc(100vw - 32px))',margin:'0 auto'}} className="cli-col"><AssignEtaLine 轮到={x}/></div></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  设置包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import V from '@/app/(app)/settings/SettingsView';
    window.__render=(p)=>createRoot(document.getElementById('root')).render(<App><V {...p}/></App>);`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开首页(x: unknown, width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://home.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://home.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: 首页包 });
  await page.evaluate((v) => (window as unknown as { __render: (a: unknown) => void }).__render(v), x);
  return { page, errors };
}
const 没撑出 = (page: Page, sel: string) => page.evaluate((s) => {
  const 坏: string[] = [];
  if (document.documentElement.scrollWidth > window.innerWidth) 坏.push(`页面 ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
  for (const el of document.querySelectorAll<HTMLElement>(s)) if (el.scrollWidth > el.clientWidth + 1) 坏.push(`${el.className || el.tagName} ${el.scrollWidth} > ${el.clientWidth}`);
  return 坏;
}, sel);
/** 这段字整段都看得见：没被 ellipsis 截（scrollWidth 不比 clientWidth 大） */
const 没截 = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => el.scrollWidth <= el.clientWidth + 1);

it("首页：有数写「前面约 N 条」、0 条写「下一条就轮到你」、没记录写「暂无法估算」，都带估算说明；不参加不画", async () => {
  const a = await 开首页({ 数: 7 });
  expect(await a.page.getByTestId("home-assign-eta").textContent()).toBe("自动分配：按现在的数，前面约 7 条轮到你这是估算：指定分配、有人暂停或新同事加入都会让它变");
  expect(a.errors).toEqual([]);
  await a.page.close();
  const b = await 开首页({ 数: 0 });
  expect(await b.page.getByTestId("home-assign-eta").textContent()).toContain("自动分配：按现在的数，下一条就轮到你");
  await b.page.close();
  const c = await 开首页("暂无法估算");
  expect(await c.page.getByTestId("home-assign-eta").textContent()).toContain("自动分配：暂无法估算（还没有分配记录）");
  expect(await c.page.getByTestId("home-assign-eta").textContent()).toContain("这是估算");
  await c.page.close();
  const d = await 开首页(null);
  expect(await d.page.getByTestId("home-assign-eta").count()).toBe(0);
  await d.page.close();
});

const 长名 = "某某超长名字的销售同事" + "长".repeat(30);
const 行 = (userId: string, name: string, 轮到: unknown, 参与状态 = "允许") => ({ userId, name, line: "内贸", 已分: 12, 配额: null, 设的配额: 30, 加额: 0, 持有: 108, 参与: 参与状态 === "允许", 参与状态, 能设配额: true, 能改参与: true, 轮到 });
const 设置props = {
  users: [], me: { id: "u1", name: "张敏", email: "zm", role: "SALES", title: "销售管理" }, isAdmin: false, logs: [],
  llm: { source: null, baseUrl: "", model: "", keyMasked: null, options: [] }, business: { customer: "客户" }, aiUsage: [], 机器: null, 企业版: true, 只个人: true, 身份: "成员",
  线索配额: { 不限额: true, 行: [行("u2", 长名, { 数: 3 }), 行("u3", "李想", { 数: 0 }), 行("u4", "王五", "暂无法估算"), 行("u5", "赵六", null, "暂停"), 行("u6", "钱七", { 数: 128 })] },
};
async function 开线索分配(width: number) {
  const { page, errors } = await 开页(browser, 设置包, 设置props, width);
  await page.getByRole("tab", { name: /线索配额/ }).click();
  await page.getByTestId("org-lead-assign").waitFor();
  return { page, errors };
}

it("设置「线索分配」：多一列「前面约几条」，约 N 条 / 下一条就轮到 / 暂无法估算 / —；卡上一句估算说明", async () => {
  const { page, errors } = await 开线索分配(1366);
  try {
    expect(await page.locator("[data-testid=org-lead-assign] thead th").allTextContents()).toContain("前面约几条");
    const 格 = (id: string) => page.getByTestId(`org-lead-eta-${id}`).textContent();
    expect([await 格("u2"), await 格("u3"), await 格("u4"), await 格("u5"), await 格("u6")]).toEqual(["约 3 条", "下一条就轮到", "暂无法估算", "—", "约 128 条"]);
    expect(await page.getByTestId("org-lead-eta-note").textContent()).toContain("这是估算：指定分配、有人暂停或新同事加入都会让它变");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [1024, 1280, 1366]) {
  it(`Windows ${w}：首页那一行、线索分配表都不横向撑出，估算说明整句看得见`, async () => {
    const a = await 开首页({ 数: 128 }, w);
    expect(await 没撑出(a.page, ".home-cth-todo")).toEqual([]);
    expect(await 没截(a.page, ".home-eta-note")).toBe(true);
    expect(await 没截(a.page, ".home-eta-t")).toBe(true);
    await a.page.close();
    const b = await 开线索分配(w);
    try {
      // 表外那一层（overflowX: auto）不出横向滚动条；卡和整页也不撑出
      expect(await 没撑出(b.page, "[data-testid=org-lead-assign], [data-testid=org-lead-assign] table, .ant-card-body > div")).toEqual([]);
      expect(await b.page.getByTestId("org-lead-eta-u6").isVisible()).toBe(true);
    } finally { await b.page.close(); }
  });
}
