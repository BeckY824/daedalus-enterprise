/**
 * 客户页顶上那条交接横幅（HandoverPending）：系统作废的申请移交（挂满 7 天没人处理，11-10）显示成「已作废（超 7 天未处理）」，
 * 不再是「移交申请中…等确认」，也没有「改接手人 / 撤回申请」可点；还待确认的照旧。
 * Windows 1024 / 1280 / 1366：超长客户名、超长人名不横向撑出，待确认那条的按钮整个在屏内、点得中。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-handover-expired", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){}});");
  // 组件引的 server action 一律 stub
  stub(/handover-actions$/, `
    const 记=(n)=>async(...a)=>{(window.__调||=[]).push([n,...a]);return {ok:true,客户:0}};
    export const 确认交接=记('确认交接'),撤回交接=记('撤回交接'),拒收交接=记('拒收交接'),改接手人=记('改接手人');
  `);
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

const 长客户 = "Verylongcompanynamewithoutanyspaces-InternationalTradingAndManufacturingHoldingsCorporationLimited（华东区总代理）";
const 长人名 = "AlexandriaBartholomewConstantinopolous-Montgomery";
const 行 = (id: string, 状态: string) => ({
  id, kind: "转让", 从: 长人名, 给: 长人名, 发起人: 长人名, 自己的: true, way: null, reason: "区域调整",
  个数: {}, 确认说明: "", 客户: [长客户, 长客户, 长客户], 客户总数: 12, createdAt: "2026-11-01T00:00:00.000Z",
  我能确认: false, 我能撤回: 状态 === "待确认", 我能改接手人: 状态 === "待确认", 接手人id: "u2", 状态,
});

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import HandoverPending from '@/app/(app)/customers/HandoverPending';
    window.__画=(发起的)=>createRoot(document.getElementById('root')).render(<App><HandoverPending 等我确认={[]} 我发起的={发起的} 候选={[]} 我="u1"/></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

it("作废的显示「已作废（超 7 天未处理）」、没有可点的；待确认的照旧；1024 / 1280 / 1366 不横向撑出、按钮点得中", async () => {
  for (const w of [1024, 1280, 1366]) {
    const page = await browser.newPage({ viewport: { width: w, height: 800 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    // 客户页正文区：左边 220 的导航栏、两边各 24 的留白
    await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><body style='margin:0'><div style='margin-left:220px;padding:0 24px'><div id='root'></div></div></body>" }));
    await page.goto("http://ent.test/customers");
    await page.addScriptTag({ content: bundle });
    await page.evaluate((发起的) => (window as unknown as { __画: (x: unknown) => void }).__画(发起的), [行("h1", "已作废（超 7 天未处理）"), 行("h2", "待确认")]);
    const 条们 = page.locator(".ant-alert");
    await expect.poll(() => 条们.count()).toBe(2);
    const [作废, 等着] = [条们.nth(0), 条们.nth(1)];
    const 作废字 = (await 作废.textContent()) ?? "";
    expect(作废字).toContain("移交申请已作废（超 7 天未处理）");
    expect(作废字).toContain("重新申请");
    expect(作废字).not.toContain("等「");
    expect(await 作废.locator("button").count()).toBe(0);
    const 等着字 = (await 等着.textContent()) ?? "";
    expect(等着字).toContain("移交申请中");
    expect(等着字).not.toContain("已作废");
    expect(await 等着.locator("button").allTextContents()).toEqual(["改接手人", "撤回申请"]);

    const 量 = await page.evaluate(() => {
      const 屏 = window.innerWidth;
      const 条 = [...document.querySelectorAll<HTMLElement>(".ant-alert")].map((el) => {
        const b = el.getBoundingClientRect();
        return { 在屏内: b.left >= 0 && b.right <= 屏 + 1, 不撑出: el.scrollWidth <= el.clientWidth + 1 };
      });
      const 钮 = [...document.querySelectorAll<HTMLElement>(".ant-alert button")].map((el) => {
        const b = el.getBoundingClientRect();
        return { 在屏内: b.left >= 0 && b.right <= 屏 + 1, 点得中: el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)), 一行: b.height < 40 };
      });
      return { 页: document.documentElement.scrollWidth <= 屏, 条, 钮 };
    });
    expect(量.页, `${w} 宽整页横滚`).toBe(true);
    expect(量.条, `${w} 宽`).toEqual([{ 在屏内: true, 不撑出: true }, { 在屏内: true, 不撑出: true }]);
    expect(量.钮, `${w} 宽`).toEqual([{ 在屏内: true, 点得中: true, 一行: true }, { 在屏内: true, 点得中: true, 一行: true }]);
    expect(errors).toEqual([]);
    await page.close();
  }
}, 120_000);
