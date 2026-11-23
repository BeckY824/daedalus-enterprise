/**
 * 「挂靠申请」页「重复咨询待补建」一栏（projects/attach/UnbuiltCard.tsx，P-公海-15 后半），真 Chromium，1280 宽和手机 390 宽：
 *   - 管的人：一行 + 省略号（超长渠道 / 对接人 / 沟通悬停看全文）、页面不横滚；带锚点 id（通知点进来落在这一栏）
 *   - 补建：就地确认才调；服务端回「要手选」= 弹框列这条线能接的销售，选一位再点，带着选的人再调一次；成了顶上一句结果、不弹顶部提示
 *   - 不补建：弹框原因必填（空着确认键点不了），写了才调、带原因
 *   - 被挡（已被处理）：原因就地写在那一行
 *   - 市场同事：只看「我交的」，只有客户编号 / 时间 / 状态 / 结果，没有任何键；销售（两份都空）：整栏不出现
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser;
const 包: Record<string, string> = {};
const 长 = "特别特别长的一段文字".repeat(6);
const 桩 = `
  const 记=(名,成)=>async(...x)=>{(window.__调=window.__调||[]).push([名,...x]);const 挡=(window.__挡||{})[名];if(挡)return {ok:false,error:挡};return typeof 成==='function'?成(...x):成};
  export const 补建待补建=记('补建待补建',(键,指定)=>指定?{ok:true,提示:'已补建，交给 小王 跟进'}:(window.__要手选?{ok:false,要手选:{为什么:'规则「线索分配」没开，没有自动分配',候选:[{id:'s1',名:'小王'},{id:'s2',名:${JSON.stringify(长)}}]}}:{ok:true,提示:'已补建，建在客户负责人 老李 名下'}));
  export const 不补建待补建=记('不补建待补建',{ok:true,提示:'已关闭，已告诉交的同事'});`;
const plugin: Plugin = { name: "unbuilt", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){(window.__刷=(window.__刷||0)+1)},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/unbuilt-actions$/, 补全动作桩("src/app/(app)/projects/attach/unbuilt-actions.ts", 桩));
  stub(/^\.\/actions$/, "export const 批准挂靠=async()=>({ok:true}),拒绝挂靠=async()=>({ok:true}),打开挂靠只读卡=async()=>({ok:false,error:'x'});");
  stub(/readonly-card-actions$/, 补全动作桩("src/app/(app)/projects/[id]/readonly-card-actions.ts", "export const 打开客户只读卡Action=async()=>({ok:false,error:'x'});"));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
const 打包 = async (body: string) => (await build({
  stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import AttachView from '@/app/(app)/projects/attach/AttachView';
    ${body}
    window.__go=()=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><Test/></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic",
  alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent",
})).outputFiles[0].text;

const 行 = (键: string, 状态: string, 补: object = {}) => ({
  键, 状态, 类: "没人接", 客户编号: "NO.000123", 渠道: `小红书|${长}`, 对接人: `王经理${长}（号码撞上的联系人）`, 沟通方式: "电话",
  沟通时间: "2026-11-20T02:00:00.000Z", 沟通内容: `老客户来电问新一期报价${长}`, 没建原因: "能接的销售本月都已满额", 通知了: `销售管理：${长}`,
  交的人: `渠运${长}`, 交的时间: "2026-11-23T03:00:00.000Z", 结果: null, ...补,
});

beforeAll(async () => {
  const 管 = [行("h1:0", "待补建"), 行("h2:0", "已补建", { 结果: { 话: "补成线索「重复咨询-NO.000123」，交给 小王 跟进", 谁: "销管某", 时间: "2026-11-23T05:00:00.000Z" } })];
  包.管 = await 打包(`function Test(){return <AttachView 待批={[]} 我的={[]} 待补建={{管:${JSON.stringify(管)},我交的:[]}}/>}`);
  const 我交的 = [{ 键: "h1:0", 客户编号: "NO.000123", 交的时间: "2026-11-23T03:00:00.000Z", 状态: "已关闭", 结果: { 话: "不补建：客户只是问问价", 谁: "销管某", 时间: "2026-11-23T05:00:00.000Z" } }];
  包.市场 = await 打包(`function Test(){return <AttachView 待批={[]} 我的={[]} 待补建={{管:null,我交的:${JSON.stringify(我交的)}}}/>}`);
  包.销售 = await 打包("function Test(){return <AttachView 待批={[]} 我的={[]} 待补建={{管:null,我交的:[]}}/>}");
  browser = await chromium.launch();
}, 180_000);
afterAll(async () => { await browser?.close(); });

async function 开(bundle: string, width: number): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://src.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://src.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as Record<string, () => void>).__go());
  return { page, errors };
}
const 调了 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? []);
const 不横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const 无顶部提示 = async (page: Page) => expect(await page.locator(".ant-message-notice").count()).toBe(0);
const 栏 = (page: Page) => page.locator("#repeat-unbuilt");
/** antd 两个汉字的键会自动插空格（「补 建」）；「不补建」三个字不插，免得被当成「补建」 */
const 补建键 = /^补\s?建$/;

for (const 宽 of [1280, 390]) {
  it(`${宽} 宽：一行 + 省略号、悬停看全文、页面不横滚；补建就地确认才调，成了顶上一句结果`, async () => {
    const { page, errors } = await 开(包.管, 宽);
    try {
      await 栏(page).waitFor();
      expect(await 栏(page).locator(".ant-card-head-title").innerText()).toBe("重复咨询待补建");
      // 超长的格子：一行、省略号、title 是全文
      const 格 = 栏(page).locator(".ls-ub-one", { hasText: "老客户来电问新一期报价" }).first();
      const 量 = await 格.evaluate((e) => ({ 一行: getComputedStyle(e).whiteSpace === "nowrap", 截了: e.scrollWidth > e.clientWidth, 高: e.getBoundingClientRect().height }));
      expect(量.一行).toBe(true);
      expect(量.截了).toBe(true);
      expect(量.高).toBeLessThan(30);
      expect(await 格.getAttribute("title")).toContain(长);
      expect(await 不横滚(page)).toBe(true);
      // 已补建那一行没有键，处理结果写着
      const 已 = 栏(page).locator(".ant-table-tbody tr").filter({ hasText: "已补建" });
      expect(await 已.getByRole("button").count()).toBe(0);
      expect(await 已.locator(".ls-ub-one[title*='补成线索']").count()).toBe(1);
      // 补建：先就地确认
      await 栏(page).getByRole("button", { name: 补建键 }).first().click();
      const 问 = page.locator(".inlc-ask").first();
      await 问.waitFor();
      expect(await 调了(page)).toEqual([]);
      await 问.getByRole("button", { name: 补建键 }).click();
      await page.getByRole("alert").filter({ hasText: "已补建，建在客户负责人 老李 名下" }).waitFor();
      expect(await 调了(page)).toEqual([["补建待补建", "h1:0", null]]);
      await 无顶部提示(page);
      expect(await 不横滚(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);

  it(`${宽} 宽：挑不到人弹框手选，选了才点得了、带着选的人再调；不补建原因必填`, async () => {
    const { page, errors } = await 开(包.管, 宽);
    try {
      await page.evaluate(() => { (window as unknown as { __要手选: boolean }).__要手选 = true; });
      await 栏(page).getByRole("button", { name: 补建键 }).first().click();
      await page.locator(".inlc-ask").first().getByRole("button", { name: 补建键 }).click();
      const 框 = page.getByRole("dialog").filter({ hasText: "选一位接手的销售" });
      await 框.waitFor();
      expect(await 框.innerText()).toContain("规则「线索分配」没开");
      const 交钮 = 框.getByRole("button", { name: "补建给他" });
      expect(await 交钮.isDisabled()).toBe(true);
      await 框.locator(".ant-select").click();
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "小王" }).click();
      await 交钮.click();
      await expect.poll(() => 调了(page)).toEqual([["补建待补建", "h1:0", null], ["补建待补建", "h1:0", "s1"]]);
      await page.getByRole("alert").filter({ hasText: "已补建，交给 小王 跟进" }).waitFor();
      await 框.waitFor({ state: "hidden" });
      // 不补建：原因空着点不了
      await 栏(page).getByRole("button", { name: "不补建" }).first().click();
      const 关框 = page.getByRole("dialog").filter({ hasText: "原因必填" });
      await 关框.waitFor();
      const 关钮 = 关框.getByRole("button", { name: "不补建" });
      expect(await 关钮.isDisabled()).toBe(true);
      await 关框.locator("input").fill("   ");
      expect(await 关钮.isDisabled()).toBe(true);
      await 关框.locator("input").fill("客户只是问问价");
      await 关钮.click();
      await expect.poll(async () => (await 调了(page)).at(-1)).toEqual(["不补建待补建", "h1:0", "客户只是问问价"]);
      await page.getByRole("alert").filter({ hasText: "已关闭，已告诉交的同事" }).waitFor();
      await 无顶部提示(page);
      expect(await 不横滚(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);

  it(`${宽} 宽：被挡（已被处理）原因就地写在那一行；市场同事只看我交的、没有键；销售整栏不出现`, async () => {
    const { page, errors } = await 开(包.管, 宽);
    try {
      await page.evaluate(() => { (window as unknown as { __挡: Record<string, string> }).__挡 = { 补建待补建: "这条已经补建了（销管某 处理），不用再处理" }; });
      await 栏(page).getByRole("button", { name: 补建键 }).first().click();
      await page.locator(".inlc-ask").first().getByRole("button", { name: 补建键 }).click();
      await 栏(page).locator(".ls-row-err").filter({ hasText: "这条已经补建了" }).waitFor();
      await 无顶部提示(page);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
    const 市 = await 开(包.市场, 宽);
    try {
      await 栏(市.page).waitFor();
      expect(await 栏(市.page).locator(".ant-card-head-title").innerText()).toBe("我交的重复咨询");
      expect(await 市.page.locator(".ant-card-head-title", { hasText: "重复咨询待补建" }).count()).toBe(0);
      expect(await 栏(市.page).getByRole("button").count()).toBe(0);
      const 字 = await 栏(市.page).innerText();
      expect(字).toContain("NO.000123");
      expect(字).toContain("已关闭");
      expect(字).not.toContain("小红书");
      expect(await 不横滚(市.page)).toBe(true);
      expect(市.errors).toEqual([]);
    } finally { await 市.page.close(); }
    const 销 = await 开(包.销售, 宽);
    try {
      await 销.page.locator(".ant-card-head-title", { hasText: "我的申请" }).waitFor();
      expect(await 栏(销.page).count()).toBe(0);
      expect(await 销.page.getByText("重复咨询").count()).toBe(0);
      expect(销.errors).toEqual([]);
    } finally { await 销.page.close(); }
  }, 60_000);
}
