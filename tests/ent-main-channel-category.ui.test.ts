/**
 * 主渠道表露出「分类」列（11-10 P-渠道-04）：独立站→自有阵地、公司资源 / 客户介绍→转介绍以前只在库里，页面上核对不了。
 *
 *   表头多一列「分类」，在「主渠道」和「可设子渠道」之间；格里原样显示中文大类名
 *   没分类的写「—」
 *   分类只显示：改名弹窗里没有分类这一项；改名 / 拨开关时原分类照带回去，不被冲掉
 *   1024 宽：分类长了一行省略、悬停（title）看全，弹窗不横向撑出页面
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 分类文字 } from "@/lib/enterprise/channel-main-core";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "main-channels-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});");
  stub(/^\.\/actions$/, "export const saveMainChannel=async x=>{(window.__存=window.__存||[]).push(x);return{ok:true}},toggleMainChannel=async()=>({ok:true});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

const 长分类 = "某某超长的分类名字用来量溢出".repeat(3);
const 主渠道们 = [
  { id: "m1", name: "独立站", allowSub: false, selfDev: false, category: "自有阵地", active: true, sort: 1 },
  { id: "m2", name: "公司资源", allowSub: false, selfDev: false, category: "转介绍", active: true, sort: 2 },
  { id: "m3", name: "义乌门店", allowSub: false, selfDev: false, category: "门店展厅", active: false, sort: 3 },
  { id: "m4", name: "没分类的主渠道", allowSub: true, selfDev: false, category: null, active: true, sort: 4 },
  { id: "m5", name: "某某超长主渠道名".repeat(4), allowSub: true, selfDev: true, category: 长分类, active: true, sort: 5 },
];

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import MainChannels from '@/app/(app)/channels/MainChannels';
    const root=createRoot(document.getElementById('root'));
    window.__render=(行)=>root.render(<ConfigProvider locale={zhCN}><App><MainChannels 主渠道们={行} 子渠道数={new Map([['m1',1]])} onClose={()=>{}}/></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://src.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://src.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __render: (x: unknown) => void }).__render(x), 主渠道们);
  await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor();
  return { page, errors };
}
const 行格 = (page: Page, 名: string) => page.locator(".ant-table-tbody tr.ant-table-row", { hasText: 名 }).first().locator("td");

it("分类文字：原样显示中文大类名，空的写「—」", () => {
  expect(分类文字("自有阵地")).toBe("自有阵地");
  expect(分类文字(" 转介绍 ")).toBe("转介绍");
  expect(分类文字(null)).toBe("—");
  expect(分类文字("")).toBe("—");
  expect(分类文字(undefined)).toBe("—");
});

it("主渠道表有「分类」列，排在主渠道后面；独立站=自有阵地、公司资源=转介绍、停用的义乌门店=门店展厅，没分类写「—」", async () => {
  const { page, errors } = await open();
  try {
    const 表头 = (await page.locator(".ant-table-thead th").allInnerTexts()).map((t) => t.trim());
    expect(表头.slice(0, 3)).toEqual(["主渠道", "分类", "可设子渠道"]);
    expect(await 行格(page, "独立站").nth(1).innerText()).toBe("自有阵地");
    expect(await 行格(page, "公司资源").nth(1).innerText()).toBe("转介绍");
    expect(await 行格(page, "义乌门店").nth(1).innerText()).toBe("门店展厅");
    expect(await 行格(page, "没分类的主渠道").nth(1).innerText()).toBe("—");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("分类只显示：改名弹窗里没有分类；改名、拨开关存回去时原分类照带", async () => {
  const { page, errors } = await open();
  try {
    await 行格(page, "独立站").last().getByRole("button", { name: "改名" }).click();
    const 弹窗 = page.locator(".ant-modal").filter({ hasText: "改名：独立站" });
    await 弹窗.waitFor();
    expect(await 弹窗.getByText("分类").count()).toBe(0);
    await 弹窗.getByRole("button", { name: /保\s*存/ }).click();
    await page.getByRole("switch", { name: "公司资源 支持自拓" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __存?: unknown[] }).__存?.length ?? 0)).toBe(2);
    const 存 = await page.evaluate(() => (window as unknown as { __存: { id: string; category: string | null }[] }).__存);
    expect(存.map((x) => [x.id, x.category])).toEqual([["m1", "自有阵地"], ["m2", "转介绍"]]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("1024 宽：长分类一行省略、悬停看全，弹窗不横向撑出页面", async () => {
  const { page, errors } = await open(1024);
  try {
    const 格 = page.locator(`.ant-table-tbody span[title="${长分类}"]`);
    expect(await 格.count()).toBe(1);
    const 量 = await 格.evaluate((el) => ({ 一行: el.getBoundingClientRect().height < 30, 省略: el.scrollWidth > el.clientWidth }));
    expect(量).toEqual({ 一行: true, 省略: true });
    const 弹窗 = await page.locator(".ant-modal").first().boundingBox();
    expect(弹窗 && 弹窗.x >= 0 && 弹窗.x + 弹窗.width <= 1024).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // 表格本身也不横向滚
    expect(await page.locator(".ant-table-body").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
