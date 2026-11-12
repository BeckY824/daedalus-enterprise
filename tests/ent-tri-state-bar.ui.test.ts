/**
 * 客户详情三态状态条（C10）和冷项目小标（C11）的排版：Windows 1024 / 1280 / 1366，导航 56px，AI 栏开 / 关。
 *   - 状态条一行不换行、不横向撑出；文字放不下省略号（悬停 title 看全）；按钮在屏内、点得中、一行高
 *   - 窄了只留主按钮，其余收进「更多」；宽的时候三颗都在、没有「更多」
 *   - 点按钮开确认框，写理由继续持有不填理由不交；填了交上去调动作
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "tri-state-bar", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷新=(window.__刷新||0)+1},push(){},replace(){}});");
  stub(/tri-state-actions$/, `
    const 记=(n)=>async(...a)=>{(window.__调||=[]).push([n,...a]);return {ok:true,剩次数:2}};
    export const 三态继续持有=记('继续持有'),三态暂缓回收=记('暂缓回收'),三态让同事结束项目=记('让同事结束项目');
  `);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

const 长说明 = "「我还在跟」和「写理由继续持有」共用一个额度：每次顺延 30 天、钟不归零；沉睡待定、即将回收两轮各限一次；累计最多 3 次、合计 90 天；已用 1 次";
const 暂缓条 = {
  状态: "暂缓回收中", 文字: "到期该进公海，但名下有 3 位同事在推的项目，收不了".repeat(3), 悬停: "到期该进公海，但名下有 3 位同事在推的项目，收不了".repeat(3), 旁注: null,
  按钮们: [
    { 动作: "客户转让", 字: "客户转让", 说明: "客户换负责人，名下项目一起走", 要理由: false },
    { 动作: "让同事结束项目", 字: "让同事结束项目", 说明: "通知在推项目的同事去结束项目", 要理由: false },
    { 动作: "继续持有", 字: "写理由继续持有", 说明: 长说明, 要理由: true, 主: true },
  ],
};

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import TriStateBar from '@/app/(app)/customers/[id]/TriStateBar';
    window.__画=(条)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><div className="rec-page ui-v2"><TriStateBar 条={条} customerId="c1" 开客户转让={()=>{window.__转=1}}/></div></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(w: number, AI: boolean, 条: unknown) {
  const page = await browser.newPage({ viewport: { width: w, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  // 导航 56px；正文两边各 24 的留白；AI 栏开着再让出 360
  await page.route("http://tri.test/**", r => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><body style='margin:0;display:flex'><nav style='width:56px;flex:none'></nav><main style='flex:1;min-width:0;padding:0 24px'><div id='root'></div></main>${AI ? "<aside style='width:360px;flex:none'></aside>" : ""}</body>` }));
  await page.goto("http://tri.test/c");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (x: unknown) => void }).__画(x), 条);
  await page.locator("[data-testid=tri-state-bar]").waitFor();
  return { page, errors };
}

it("1024 / 1280 / 1366、AI 栏开关：一行、不撑出、文字省略、按钮点得中；窄了收进「更多」", async () => {
  for (const w of [1024, 1280, 1366]) for (const AI of [false, true]) {
    const { page, errors } = await 开(w, AI, 暂缓条);
    const 量 = await page.evaluate(() => {
      const 屏 = window.innerWidth;
      const 条 = document.querySelector<HTMLElement>("[data-testid=tri-state-bar]")!;
      const 字 = 条.querySelector<HTMLElement>(".tri-tx")!;
      const b = 条.getBoundingClientRect();
      const 钮 = [...条.querySelectorAll<HTMLElement>("button")].filter((el) => el.offsetParent !== null).map((el) => {
        const r = el.getBoundingClientRect();
        return { 字: el.textContent, 在屏内: r.left >= 0 && r.right <= 屏 + 1, 点得中: el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)), 一行: r.height < 34 };
      });
      return { 页: document.documentElement.scrollWidth <= 屏, 条在屏内: b.right <= 屏 + 1, 一行: b.height < 48, 不撑出: 条.scrollWidth <= 条.clientWidth + 1, 省略: 字.scrollWidth > 字.clientWidth, 有title: !!字.title, 宽: b.width, 钮 };
    });
    const 名 = `${w} 宽 AI${AI ? "开" : "关"}`;
    expect(量.页, 名).toBe(true);
    expect(量.条在屏内 && 量.一行 && 量.不撑出 && 量.省略 && 量.有title, 名).toBe(true);
    expect(量.钮.every((x) => x.在屏内 && x.点得中 && x.一行), `${名} ${JSON.stringify(量.钮)}`).toBe(true);
    const 字们 = 量.钮.map((x) => x.字);
    if (量.宽 > 720) expect(字们, 名).toEqual(["客户转让", "让同事结束项目", "写理由继续持有"]);
    else {
      expect(字们, 名).toEqual(["更多", "写理由继续持有"]);
      // 「更多」点开才出菜单（悬停不弹，手机经飞书打开也点得到）
      const 更多 = page.getByRole("button", { name: "更多" });
      await 更多.hover();
      await page.waitForTimeout(300);
      expect(await page.locator(".ant-dropdown:not(.ant-dropdown-hidden)").count(), 名).toBe(0);
      await 更多.click();
      await page.locator(".ant-dropdown:not(.ant-dropdown-hidden)").getByText("让同事结束项目").waitFor();
    }
    expect(errors, 名).toEqual([]);
    await page.close();
  }
}, 120_000);

it("写理由继续持有：确认框写着额度说明，不填理由不交，填了交上去并刷新；客户转让开页头的框", async () => {
  const { page, errors } = await 开(1366, false, 暂缓条);
  await page.getByRole("button", { name: "写理由继续持有" }).click();
  const 框 = page.locator(".ant-modal");
  await expect.poll(() => 框.textContent()).toContain("累计最多 3 次、合计 90 天；已用 1 次");
  await 框.getByRole("button", { name: "写理由继续持有" }).click();
  expect(await page.evaluate(() => (window as unknown as { __调?: unknown[] }).__调 ?? [])).toEqual([]);
  await 框.getByLabel("理由").fill("客户下月招标，还在跟");
  await 框.getByRole("button", { name: "写理由继续持有" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __调?: unknown[] }).__调)).toEqual([["继续持有", "c1", "客户下月招标，还在跟"]]);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __刷新?: number }).__刷新)).toBe(1);
  await page.getByRole("button", { name: "客户转让" }).click();
  expect(await page.evaluate(() => (window as unknown as { __转?: number }).__转)).toBe(1);
  expect(errors).toEqual([]);
  await page.close();
}, 60_000);
