/**
 * 跳转优化 PR-A 审查补：中栏名单挪进 layout 以后换人不重查，名单会旧——补两种后台换新的时机（lib/roster-refresh.ts）。
 * 真 Chromium 里钉住：
 *   - 60 秒内连着换人：一次都不拉（连着翻不打扰）
 *   - 隔了 60 秒以上又换了一位：后台拉 /api/roster/… 一次，换上新的
 *   - 切回标签页：距上次查名单 ≥30 秒才拉一次；30 秒内来回切不拉
 *   - 拉失败（401）：留着手上那份
 *   - 服务端又给了新的一份（router.refresh）：以服务端那份为准
 * 客户名单、项目名单都接上了它（文件里扫一下）
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {useFreshRoster} from '@/lib/roster-refresh';
    function 名单({给的, 那位}){const d=useFreshRoster(给的,'/api/roster/customers',那位);return <ul id="名单">{d.rows.map(x=><li key={x}>{x}</li>)}</ul>}
    // 给了 rows 才换一份新的「服务端给的」（同一份对象 = layout 没重算），不给就沿用上一份
    window.__画=(o)=>{if(o.rows)window.__给的={rows:o.rows};(window.__root||=createRoot(document.getElementById('root'))).render(<名单 给的={window.__给的} 那位={o.那位}/>)};
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 拨到 = (page: Page, 秒: number) => page.evaluate((ms) => (window as unknown as { __拨: (ms: number) => void }).__拨(ms), 秒 * 1000);
type 画参 = { rows?: string[]; 那位: string };
async function 打开(回: () => { status: number; rows?: string[] }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage(); page.setDefaultTimeout(5000);
  // 只拨 Date.now（page.clock 会连 React 调度用的计时器一起管住，effect 跑不起来）：「过了多久」= 往后加一个偏移
  await page.addInitScript(() => { const 原 = Date.now.bind(Date); let 偏 = 0; Date.now = () => 原() + 偏; (window as unknown as { __拨: (ms: number) => void }).__拨 = (ms) => { 偏 = ms; }; });
  let 拉了 = 0;
  await page.route("http://roster.test/api/roster/customers", (r) => {
    拉了++;
    const x = 回();
    return r.fulfill({ status: x.status, contentType: "application/json", body: JSON.stringify(x.status === 200 ? { rows: x.rows } : { error: "请先登录" }) });
  });
  await page.route("http://roster.test/c/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://roster.test/c/a");
  await page.addScriptTag({ content: bundle });
  // 画完等一拍：useEffect 在绘制之后才挂上监听
  const 画 = async (o: 画参) => { await page.evaluate((o) => (window as unknown as { __画: (o: 画参) => void }).__画(o), o); await page.waitForTimeout(50); };
  await 画({ rows: ["甲", "乙"], 那位: "a" });
  return { page, 画, 拉了: () => 拉了, close: () => ctx.close() };
}
const 名单 = (page: Page) => page.locator("#名单 li").allTextContents();
const 切回 = (page: Page) => page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
});

it("60 秒内连着换人不拉；隔了 60 秒以上再换一位，后台拉一次换上新的", async () => {
  const t = await 打开(() => ({ status: 200, rows: ["甲", "乙", "新分来的丙"] }));
  await t.画({ 那位: "b" });
  await 拨到(t.page, 30);
  await t.画({ 那位: "a" });
  await t.page.waitForTimeout(150);
  expect(t.拉了(), "60 秒内换人不打扰").toBe(0);
  await 拨到(t.page, 61);
  await t.画({ 那位: "b" });
  await expect.poll(() => 名单(t.page)).toEqual(["甲", "乙", "新分来的丙"]);
  expect(t.拉了()).toBe(1);
  // 刚拉过：马上再换一位不再拉
  await t.画({ 那位: "a" });
  await t.page.waitForTimeout(150);
  expect(t.拉了()).toBe(1);
  await t.close();
});

it("切回标签页：距上次查名单不到 30 秒不拉，过了 30 秒拉一次；服务端又给了新的一份就以服务端为准", async () => {
  const t = await 打开(() => ({ status: 200, rows: ["甲", "乙", "丙"] }));
  await 切回(t.page);
  await t.page.waitForTimeout(150);
  expect(t.拉了(), "刚查过名单，切回不拉").toBe(0);
  await 拨到(t.page, 29);
  await 切回(t.page);
  await t.page.waitForTimeout(150);
  expect(t.拉了(), "29 秒还不到 30 秒").toBe(0);
  await 拨到(t.page, 31);
  await 切回(t.page);
  await expect.poll(() => 名单(t.page)).toEqual(["甲", "乙", "丙"]);
  expect(t.拉了()).toBe(1);
  // 刚拉过：马上再切回一次不拉
  await 切回(t.page);
  await t.page.waitForTimeout(150);
  expect(t.拉了()).toBe(1);
  await t.画({ rows: ["保存后刷新的"], 那位: "a" });
  expect(await 名单(t.page)).toEqual(["保存后刷新的"]);
  await t.close();
});

it("拉失败（登出、断网）留着手上那份", async () => {
  const t = await 打开(() => ({ status: 401 }));
  await 拨到(t.page, 31);
  await 切回(t.page);
  await expect.poll(() => t.拉了()).toBe(1);
  await t.page.waitForTimeout(150);
  expect(await 名单(t.page)).toEqual(["甲", "乙"]);
  // 失败的也算拉过一次：马上再切回不连着重试
  await 切回(t.page);
  await t.page.waitForTimeout(150);
  expect(t.拉了()).toBe(1);
  await t.close();
});

it("客户名单、项目名单都接上了后台换新，接口和服务端名单走同一个函数", () => {
  const 读 = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
  expect(读("src/components/CustomerRoster.tsx")).toMatch(/useFreshRoster\(服务端给的, "\/api\/roster\/customers", activeId\)/);
  expect(读("src/components/ProjectRoster.tsx")).toMatch(/useFreshRoster\(服务端给的, "\/api\/roster\/projects", activeId\)/);
  expect(读("src/app/api/roster/customers/route.ts")).toMatch(/客户名单数据\(\)/);
  expect(读("src/app/api/roster/projects/route.ts")).toMatch(/项目名单数据\(\)/);
  expect(读("src/app/(app)/@pane/panes.tsx")).toMatch(/await 客户名单数据\(\)/);
  expect(读("src/app/(app)/@pane/panes.tsx")).toMatch(/await 项目名单数据\(\)/);
  // 不靠整页 router.refresh 换名单（会清掉整个路由缓存）
  expect(读("src/lib/roster-refresh.ts")).not.toMatch(/router\.refresh\(/);
});
