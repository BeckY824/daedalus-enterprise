/**
 * 离职交接要接手人确认（客户 11-13）的界面：
 *   - 离职交接看板：在等确认的客户 / 项目行不再给「交」，显示「等 X 确认」（满 7 天带「已等 N 天」），后面「改人」「撤回」；
 *     「全部交给」在等时整张卡顶上写「已全部交给 · 等 X 确认」；有单条在等时「全部交给」点不了并说明
 *   - 客户页顶上横幅：离职交接说清交的是什么（1 个项目：X），确认框标题同
 * 1024 / 1280 / 1366 三个宽度：超长人名、客户名一行放不下省略号 + 悬停看全，页面不横滚，按钮整个在格子里、点得中
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, 看板: string, 横幅: string;
const 长人 = "名字特别特别长的一位同事".repeat(4);
const 长客户 = "某某超长公司名".repeat(8);
const plugin: Plugin = { name: "offboard-confirm", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/settings\/actions$/, "export const deactivateUser=async()=>({ok:true});");
  const 记 = `const 记=(名)=>async(...x)=>{(window.__调=window.__调||[]).push([名,...x]);return{ok:true,message:'好了',客户:0}};`;
  stub(/^\.\/actions$/, `${记}export const 交接客户=记('交接客户'),交接项目=记('交接项目'),交接全部=记('交接全部');`);
  stub(/handover-actions$/, `${记}export const 确认交接=记('确认交接'),撤回交接=记('撤回交接'),拒收交接=记('拒收交接'),改接手人=记('改接手人');`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
const 打包 = async (contents: string) => (await build({
  stdin: { contents, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic",
  alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent",
})).outputFiles[0].text;

beforeAll(async () => {
  const 等 = (id: string, 天: number, 我能撤回 = true) => ({ id, 起日: "2026-11-05", 接手人: 长人, 接手人id: "t", 挂起天数: 天, 挂起工作日: 天, 超期: false, 我能撤回 });
  看板 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import HandoverView from '@/app/(app)/projects/handover/HandoverView';
    const 长人=${JSON.stringify(长人)}, 长客户=${JSON.stringify(长客户)};
    const 人们=[
      {id:'a',name:长人,上级:长人,交接中:false,单条等确认:2,
        客户:[{id:'c1',name:长客户,项目数:3,交接中:${JSON.stringify(等("h1", 8))}},{id:'c2',name:'还没交的客户',项目数:0}],
        项目:[{id:'p1',name:'项目'+长客户,客户:长客户,交接中:${JSON.stringify(等("h2", 1, false))}}],
        其余:{线索:3,渠道:0,主渠道:0,待办:0}},
      {id:'b',name:'全部交了的人',上级:null,交接中:true,单条等确认:0,整包:${JSON.stringify(等("h3", 9))},
        客户:[{id:'c3',name:长客户,项目数:1,交接中:${JSON.stringify(等("h3", 9))}}],项目:[],其余:{线索:0,渠道:0,主渠道:0,待办:0}},
    ];
    window.__go=()=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>
      <HandoverView 人们={人们} 候选={[{id:'t',name:长人},{id:'u',name:'接手人'}]} 项目模式 系统管理员 下属={[]}/></BusinessProvider></App></ConfigProvider>);
  `);
  const 离职行 = {
    id: "h9", kind: "离职", 从: 长人, 给: 长人, 发起人: 长人, 自己的: false, way: "项目", reason: null, 个数: { 项目: 1 },
    确认说明: "确认后这个项目的负责人改成你，卡点认领跟着转；客户负责人不变。", 客户: [], 客户总数: 0, 离职说: `1 个项目：${长客户}`,
    createdAt: "2026-11-01T00:00:00.000Z", 我能确认: true, 我能撤回: false, 我能改接手人: false, 接手人id: "u1", 状态: "待确认",
  };
  横幅 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import HandoverPending from '@/app/(app)/customers/HandoverPending';
    window.__go=()=>createRoot(document.getElementById('root')).render(<App><HandoverPending 等我确认={[${JSON.stringify(离职行)}]} 我发起的={[]} 候选={[]} 我="u1"/></App>);
  `);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(width: number, bundle: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://src.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://src.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as Record<string, () => void>).__go());
  return { page, errors };
}
const 不横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const width of [1024, 1280, 1366]) {
  it(`${width} 宽看板：等确认的行写「等 X 确认」（满 7 天带已等天数），省略号悬停看全，改人 / 撤回在格子里点得中`, async () => {
    const { page, errors } = await 开(width, 看板);
    try {
      const 卡们 = page.locator(".ant-card");
      await expect.poll(() => 卡们.count()).toBe(2);
      expect(await 不横滚(page)).toBe(true);
      // 等确认那一格：一行、省略号、悬停 title 带发起日和天数
      const 格 = await page.evaluate(() => [...document.querySelectorAll(".ant-card .ant-table-tbody .ant-typography[title]")]
        .filter((x) => x.textContent?.startsWith("等 "))
        .map((x) => {
          const el = x as HTMLElement; const 行 = el.closest("td")!.getBoundingClientRect(); const r = el.getBoundingClientRect();
          return { 字: el.textContent, title: el.title, 省略: getComputedStyle(el).textOverflow === "ellipsis" && getComputedStyle(el).whiteSpace === "nowrap", 在格内: r.left >= 行.left - 0.5 && r.right <= 行.right + 0.5, 一行: r.height < 30 };
        }));
      expect(格).toHaveLength(3);
      for (const g of 格) expect(g).toMatchObject({ 省略: true, 在格内: true, 一行: true });
      expect(格[0].title).toContain("2026-11-05 交给");
      expect(格[0].title).toContain("已等 8 天");
      // 满 7 天的带「已等 N 天」，没满的不带（文字可能被省略，按 title 和原文判）
      expect(格[0].字).toContain("已等 8 天");
      expect(格[1].字).not.toContain("已等");
      // 我能撤回的有改人 / 撤回，按钮整个在格子里、点得中；不能撤回的那行没有
      const 钮 = await page.evaluate(() => [...document.querySelectorAll(".ant-card .ant-table-tbody button")]
        .filter((b) => ["改人", "撤回"].includes(b.textContent?.replace(/\s/g, "") ?? ""))
        .map((b) => { const r = b.getBoundingClientRect(); const td = b.closest("td")!.getBoundingClientRect(); return { 字: b.textContent?.replace(/\s/g, ""), 在内: r.left >= td.left && r.right <= td.right + 0.5, 点中: b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }; }));
      expect(钮).toEqual([
        { 字: "改人", 在内: true, 点中: true }, { 字: "撤回", 在内: true, 点中: true },
        { 字: "改人", 在内: true, 点中: true }, { 字: "撤回", 在内: true, 点中: true },
      ]);
      // 还没交的那行照旧能选人交；有单条在等，「全部交给」点不了并说明
      const 甲 = 卡们.nth(0);
      expect(await 甲.innerText()).toContain("还有 2 笔在等接手人确认，确认或撤回后才能全部交给");
      expect(await 甲.getByRole("button", { name: /全部交给/ }).isDisabled()).toBe(true);
      expect(await 甲.getByRole("button", { name: /^交$/ }).count()).toBe(1);
      // 全部交了的人：卡顶写已全部交给 · 等确认，没有「全部交给」按钮
      const 乙 = 卡们.nth(1);
      expect(await 乙.innerText()).toContain("已全部交给");
      expect(await 乙.getByRole("button", { name: /全部交给/ }).count()).toBe(0);
      const 顶 = await 乙.evaluate((卡) => { const k = 卡.getBoundingClientRect(); return [...卡.querySelectorAll("button")].every((b) => { const r = b.getBoundingClientRect(); return r.left >= k.left && r.right <= k.right; }); });
      expect(顶).toBe(true);
      // 撤回 → 确认框 → 调 撤回交接(h1)
      await 甲.locator(".ant-table-tbody button", { hasText: "撤回" }).first().click();
      const 框 = page.locator(".ant-modal-confirm");
      await 框.waitFor();
      expect(await 框.innerText()).toContain("不用再确认");
      await 框.getByRole("button", { name: /撤\s*回/ }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? [])).toEqual([["撤回交接", "h1"]]);
      // 改人 → 选新接手人 → 调 改接手人(h1, u)
      await 甲.locator(".ant-table-tbody button", { hasText: "改人" }).first().click();
      const 改框 = page.locator(".ant-modal:not(.ant-modal-confirm)").filter({ hasText: "改接手人" });
      await 改框.waitFor();
      await 改框.locator(".ant-select").click();
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: /^接手人$/ }).click();
      await 改框.getByRole("button", { name: /^改$/ }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? [])).toEqual([["撤回交接", "h1"], ["改接手人", "h1", "u"]]);
      expect(await 不横滚(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);

  it(`${width} 宽客户页横幅：离职交接写清交的是哪个项目，不横滚，确认框标题同`, async () => {
    const { page, errors } = await 开(width, 横幅);
    try {
      const 条 = page.locator(".ant-alert");
      await 条.waitFor();
      expect(await 条.innerText()).toContain("名下的 1 个项目：");
      expect(await 不横滚(page)).toBe(true);
      const 钮在屏内 = await page.evaluate(() => [...document.querySelectorAll(".ant-alert button")].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= document.documentElement.clientWidth; }));
      expect(钮在屏内).toBe(true);
      await 条.getByRole("button", { name: /确认接手/ }).click();
      const 框 = page.locator(".ant-modal-confirm");
      await 框.waitFor();
      expect(await 框.innerText()).toContain("名下的 1 个项目：");
      expect(await 框.innerText()).toContain("客户负责人不变");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);
}
