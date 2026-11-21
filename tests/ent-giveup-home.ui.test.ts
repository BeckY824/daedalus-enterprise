/**
 * 首页置顶「新分到你的线索，可以放弃（豁免）」（11-21，dashboard/GiveUpHomeTodo.tsx）：
 *   - 每条一行：线索名 + 离超时还剩多久 +「去跟进」「放弃（豁免）」，按钮 ≥ 40 高；没有的不画
 *   - 手机 390：放在首页最上面（驾驶舱对话框里、问候语前面），首屏看得到两颗按钮，不横滚；1366 两颗按钮和名字一行
 *   - 「放弃（豁免）」原地弹同一个放弃框（projects/[id]/GiveUpDialog），交了这一行消失、顶上说「已放弃「X」，转给 某某」；没成错误写在框里、这行还在
 *   - 「去跟进」去项目页
 * 外面的结构照 HomeChat 驾驶舱那一支摆（同 ent-home-frame.ui.test.ts）
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-giveup-home", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "const 记=(u)=>{(window.__去||(window.__去=[])).push(u)};export const useRouter=()=>({push:记,replace:记,refresh(){window.__刷=(window.__刷||0)+1}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^\.\/giveup-actions$/, 补全动作桩("src/app/(app)/projects/[id]/giveup-actions.ts",
    "export const 放弃线索Action=async(...a)=>{(window.__放弃||(window.__放弃=[])).push(a);return window.__放弃回||{ok:true,接手人:'乙'}};"));
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React, { useState } from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import Welcome from '@/app/(app)/dashboard/Welcome';
    import HomeCards from '@/app/(app)/dashboard/HomeCards';
    import GiveUpHomeTodo from '@/app/(app)/dashboard/GiveUpHomeTodo';
    const 卡数 = { "month-new": 1, key: 2, "no-follow": 3, "due-soon": 4 };
    window.__画 = (们) => createRoot(document.getElementById('root')).render(<App>
      <div className="cli cli-empty"><div className="cli-ck"><div className="cli-ck-g">
        <div className="cli-col cli-frame">
          <GiveUpHomeTodo 们={们} />
          <Welcome userName="测试员" context="" 欢迎="欢迎使用 测试产品" />
          <div className="cli-composer"><div className="cli-input cli-input-rich"><textarea /></div></div>
        </div>
        <HomeCards 数={卡数} />
      </div></div></div>
    </App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, plugins: [plugin], logLevel: "silent" });
  bundle = "window.process = { env: {} };\n" + r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 长名 = "某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域销售中心二期扩建";
const 两条 = [
  { projectId: "p1", name: 长名, 接手于: "2026-11-21T07:00:00.000Z", 时限话: "还剩 50 分钟 超时" },
  { projectId: "p 2", name: "华东二期", 接手于: "2026-11-21T06:00:00.000Z", 时限话: "已超时，还剩 25 分钟 自动转走" },
];

async function 打开(们: unknown[], width: number): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: width < 768 ? 812 : 800 }, reducedMotion: "reduce" }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  // 手机顶栏约 56 高：首页内容从它下面起（AppShell 手机顶栏）
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><main style='padding:${width < 768 ? "72px 16px 16px" : "24px"}'><div id='root'></div></main>` }));
  await page.goto("http://ent.test/dashboard");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (o: unknown) => void }).__画(x), 们);
  await page.locator(".cli-frame .cli-input").waitFor();
  return { page, errors };
}
const 不溢出 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const 窗 = <T,>(page: Page, k: string) => page.evaluate((k) => (window as unknown as Record<string, unknown>)[k], k) as Promise<T>;

for (const width of [1366, 390]) {
  it(`${width}：置顶在问候语前面，每条名字 + 时限 + 两颗 ≥40 高的按钮；首屏看得到、不横滚`, async () => {
    const { page, errors } = await 打开(两条, width);
    try {
      const 行们 = page.getByTestId("home-giveup-row");
      expect(await 行们.count()).toBe(2);
      expect(await 行们.first().innerText()).toContain(长名);
      expect(await page.getByTestId("home-giveup-left").first().innerText()).toContain("还剩 50 分钟 超时");
      const 条 = (await page.getByTestId("home-giveup").boundingBox())!;
      const 问候 = (await page.locator(".cli-frame .cli-welcome").first().boundingBox())!;
      expect(条.y + 条.height).toBeLessThanOrEqual(问候.y + 1);
      for (const id of ["home-giveup-go", "home-giveup-open"]) {
        const 键 = (await page.getByTestId(id).first().boundingBox())!;
        expect(键.height).toBeGreaterThanOrEqual(40);
        expect(键.x).toBeGreaterThanOrEqual(0);
        expect(键.x + 键.width).toBeLessThanOrEqual(width);
        // 首屏：第一条的两颗按钮都在视口里
        expect(键.y + 键.height).toBeLessThanOrEqual(width < 768 ? 812 : 800);
      }
      const 名 = (await page.locator(".home-giveup-t").first().boundingBox())!;
      const 放 = (await page.getByTestId("home-giveup-open").first().boundingBox())!;
      if (width < 768) {
        // 手机：按钮行折到名字下面、两颗各占一半
        expect(放.y).toBeGreaterThanOrEqual(名.y + 名.height - 1);
        const 去 = (await page.getByTestId("home-giveup-go").first().boundingBox())!;
        expect(Math.abs(去.width - 放.width)).toBeLessThanOrEqual(2);
      } else {
        expect(放.y).toBeLessThan(名.y + 名.height);
      }
      expect(await 不溢出(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("390：「放弃（豁免）」原地弹放弃框（能完整操作、不横滚），交了这一行消失、顶上说转给谁，首页重拉一遍", async () => {
  const { page, errors } = await 打开(两条, 390);
  try {
    await page.getByTestId("home-giveup-open").nth(1).click();
    const 框 = page.getByRole("dialog", { name: "放弃这条线索（豁免）" });
    await 框.waitFor();
    await 框.getByText("其他", { exact: true }).click();
    await 框.getByTestId("proj-giveup-note").fill("下午去医院");
    const 盒 = (await 框.boundingBox())!;
    expect(盒.x).toBeGreaterThanOrEqual(0);
    expect(盒.x + 盒.width).toBeLessThanOrEqual(390);
    expect(await 不溢出(page)).toBe(true);
    await 框.getByRole("button", { name: "确认放弃" }).click();
    await page.getByTestId("home-giveup-done").waitFor();
    expect(await page.getByTestId("home-giveup-done").innerText()).toContain("已放弃「华东二期」，转给 乙");
    expect(await page.getByTestId("home-giveup-row").count()).toBe(1);
    expect(await page.getByTestId("home-giveup-row").innerText()).toContain(长名);
    expect(await 窗<unknown[][]>(page, "__放弃")).toEqual([["p 2", "其他", "下午去医院"]]);
    expect(await 窗<number>(page, "__刷")).toBe(1);
    expect(await 窗<string[] | undefined>(page, "__去")).toBeUndefined();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("没成：错误写在框里、这一行还在；「去判无效」去项目页；「去跟进」去项目页", async () => {
  const { page } = await 打开(两条.slice(0, 1), 1366);
  try {
    await page.evaluate(() => { (window as unknown as { __放弃回: unknown }).__放弃回 = { ok: false, error: "每人每月只能放弃 1 次，本月已经用过了，下月 1 日起可再用" }; });
    await page.getByTestId("home-giveup-open").click();
    const 框 = page.getByRole("dialog", { name: "放弃这条线索（豁免）" });
    await 框.getByText("外出", { exact: true }).click();
    await 框.getByRole("button", { name: "确认放弃" }).click();
    await 框.getByTestId("proj-giveup-error").waitFor();
    expect(await page.getByTestId("home-giveup-row").count()).toBe(1);
    await 框.getByTestId("proj-giveup-to-invalid").click();
    expect(await 窗<string[]>(page, "__去")).toEqual(["/projects/p1"]);
    await page.getByTestId("home-giveup-go").click();
    expect(await 窗<string[]>(page, "__去")).toEqual(["/projects/p1", "/projects/p1"]);
  } finally { await page.close(); }
});

it("一条都没有：不画", async () => {
  const { page } = await 打开([], 390);
  try {
    expect(await page.getByTestId("home-giveup").count()).toBe(0);
  } finally { await page.close(); }
});
