/**
 * 企业版站内通知的铃铛（components/NoticeBell.tsx，11-01）。
 *
 *   左栏顶上搜索框右边：红数 = 未读条数；aria-label「通知，N 条未读」
 *   点开右侧抽屉「通知」：列最近的通知，没读的加粗 + 蓝点；「全部已读」清掉红数
 *   点一条：标已读、红数减一、关抽屉、跳到那条的链接
 *   空：「还没有通知」
 *   Windows 1024：搜索框 + 铃铛一行不折、页面不横向溢出；抽屉标题和「全部已读」不折行；超长标题截断
 *   暗黑：标题字是暗底的浅色；减弱动态：抽屉不走过渡
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-notice-bell", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/navigation$/, "const 记=(u)=>{(window.__去||(window.__去=[])).push(u)};export const useRouter=()=>({push:记,refresh(){},replace:记});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  // 服务端动作：读 window.__通知，标已读改它，并把调用记在 window.__调
  stub(/notice-actions$/, `
    const 记=(x)=>{(window.__调||(window.__调=[])).push(x)};
    const 未=()=>window.__通知.filter(r=>!r.read).length;
    export const 读我的通知=async()=>{记('读');return {行们:window.__通知.map(r=>({...r})),未读:未()}};
    export const 读未读通知数=async()=>未();
    export const 标已读=async(id)=>{记('标:'+id);window.__通知=window.__通知.map(r=>r.id===id?{...r,read:true}:r);return 未()};
    export const 全部标已读=async()=>{记('全部');window.__通知=window.__通知.map(r=>({...r,read:true}));return 0};
  `);
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import NoticeBell from '@/components/NoticeBell';
    window.__画=(o)=>{
      window.__通知=o.行们;
      const 未读=o.行们.filter(r=>!r.read).length;
      createRoot(document.getElementById('root')).render(<App><div style={{display:'flex'}}>
        <nav className="rail" aria-label="主导航"><div className="rail-top">
          <button type="button" className="rail-search"><span>搜索</span><kbd>⌘K</kbd></button>
          <NoticeBell 初始未读={未读}/>
        </div></nav>
        <main style={{flex:1,minWidth:0,padding:24}}>页面</main>
      </div></App>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 长 = "某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域销售中心";
const 刚才 = (分钟: number) => new Date(Date.now() - 分钟 * 60_000).toISOString();
const 三条 = [
  { id: "n1", kind: "自动分配", title: "自动分配给你一条新线索：" + 长, body: "市场小李 点的自动分配，轮到了你。", link: "/leads", read: false, createdAt: 刚才(0) },
  { id: "n2", kind: "卡点", title: "销售经理 把卡点 KD-0012 指给了你", body: "项目「华东二期」· 技术：" + 长 + 长, link: "/projects/p2", read: false, createdAt: 刚才(90) },
  { id: "n3", kind: "交接", title: "总管 确认接手了 3 位客户", body: "", link: "/customers", read: true, createdAt: 刚才(60 * 24 * 2) },
];

async function 打开(行们: unknown[] = 三条, o: { width?: number; 暗?: boolean; 减弱?: boolean } = {}): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: o.width ?? 1280, height: 800 }, reducedMotion: o.减弱 ? "reduce" : "no-preference" }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html${o.暗 ? ' data-mode="dark"' : ""}><meta charset='utf-8'><body><div id='root'></div></body></html>` }));
  await page.goto("http://ent.test/customers");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ path: path.resolve("src/app/dark.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (o: unknown) => void }).__画({ 行们: x }), 行们);
  await page.locator(".notice-bell").waitFor();
  return { page, errors };
}
const 窗 = <T,>(page: Page, k: string) => page.evaluate((k) => (window as unknown as Record<string, unknown>)[k], k) as Promise<T>;
const 铃 = (page: Page) => page.locator(".notice-bell");

it("红数 = 未读；点开抽屉列通知，没读的标出来；时间说人话", async () => {
  const { page, errors } = await 打开();
  expect(await 铃(page).getAttribute("aria-label")).toBe("通知，2 条未读");
  expect(await page.locator(".ant-badge-count").innerText()).toBe("2");
  await 铃(page).click();
  const 抽屉 = page.locator(".notice-drawer .ant-drawer-section");
  await 抽屉.waitFor();
  expect(await 抽屉.locator(".ant-drawer-title").innerText()).toBe("通知");
  const 项 = page.getByRole("list", { name: "通知列表" }).locator(".notice-item");
  await expect.poll(() => 项.count()).toBe(3);
  expect(await 项.nth(0).getAttribute("aria-label")).toBe("未读，自动分配给你一条新线索：" + 长);
  expect(await 项.nth(2).getAttribute("aria-label")).toBe("总管 确认接手了 3 位客户");
  expect(await page.locator(".notice-item.unread").count()).toBe(2);
  expect(await 项.locator(".notice-meta").allInnerTexts()).toEqual(["自动分配 · 刚刚", "卡点 · 1 小时前", "交接 · 2 天前"]);
  expect(await 窗<string[]>(page, "__调")).toEqual(["读"]);
  expect(errors).toEqual([]); await page.close();
});

it("点一条：标已读、红数减一、关抽屉、跳到链接", async () => {
  const { page } = await 打开();
  await 铃(page).click();
  await page.locator(".notice-item").nth(1).click();
  expect(await 窗<string[]>(page, "__去")).toEqual(["/projects/p2"]);
  await expect.poll(() => 窗<string[]>(page, "__调")).toEqual(["读", "标:n2"]);
  expect(await 铃(page).getAttribute("aria-label")).toBe("通知，1 条未读");
  await expect.poll(() => page.locator(".notice-drawer .ant-drawer-section").isVisible()).toBe(false);
  // 已读的再点：不再标、照样跳
  await 铃(page).click();
  await page.locator(".notice-item").nth(2).click();
  expect(await 窗<string[]>(page, "__去")).toEqual(["/projects/p2", "/customers"]);
  expect((await 窗<string[]>(page, "__调")).filter((x) => x.startsWith("标"))).toEqual(["标:n2"]);
  await page.close();
});

it("全部已读：红数没了、按钮变灰、蓝点没了", async () => {
  const { page } = await 打开();
  await 铃(page).click();
  const 全 = page.getByRole("button", { name: "全部已读" });
  await expect.poll(() => page.locator(".notice-item").count()).toBe(3);
  await 全.click();
  await expect.poll(() => page.locator(".notice-item.unread").count()).toBe(0);
  expect(await 铃(page).getAttribute("aria-label")).toBe("通知");
  // 红数退场有个缩小动画：等它走完
  await expect.poll(() => page.locator(".ant-badge-count:visible").count()).toBe(0);
  expect(await 全.isDisabled()).toBe(true);
  expect(await 窗<string[]>(page, "__调")).toEqual(["读", "全部"]);
  await page.close();
});

it("空：还没有通知，没有红数", async () => {
  const { page } = await 打开([]);
  expect(await 铃(page).getAttribute("aria-label")).toBe("通知");
  await 铃(page).click();
  await expect.poll(() => page.locator(".notice-drawer").innerText()).toContain("还没有通知");
  expect(await page.getByRole("button", { name: "全部已读" }).isDisabled()).toBe(true);
  await page.close();
});

it.each([1024, 1280])("Windows %ipx：搜索框 + 铃铛一行不折，页面不横向溢出；抽屉头不折行，超长标题截断", async (w) => {
  const 多 = Array.from({ length: 12 }, (_, i) => ({ ...三条[i % 3], id: "m" + i }));
  const { page } = await 打开(多, { width: w });
  const 顶 = await page.locator(".rail-top").boundingBox();
  const 搜 = await page.locator(".rail-search").boundingBox();
  const 钟 = await 铃(page).boundingBox();
  expect(顶!.height).toBeLessThanOrEqual(40);
  expect(Math.abs(搜!.y + 搜!.height / 2 - (钟!.y + 钟!.height / 2))).toBeLessThanOrEqual(2);
  expect(钟!.x).toBeGreaterThan(搜!.x + 搜!.width - 1);
  expect(钟!.x + 钟!.width).toBeLessThanOrEqual(顶!.x + 顶!.width + 1);
  expect(await page.locator(".rail-search span").evaluate((e) => e.getBoundingClientRect().height)).toBeLessThan(24);
  await 铃(page).click();
  await expect.poll(() => page.locator(".notice-item").count()).toBe(12);
  await page.waitForTimeout(400);
  const 头 = page.locator(".notice-drawer .ant-drawer-header");
  expect((await 头.boundingBox())!.height).toBeLessThanOrEqual(56);
  const 全 = await page.getByRole("button", { name: "全部已读" }).boundingBox();
  expect(全!.height).toBeLessThanOrEqual(32);
  const 标题 = page.locator(".notice-title").first();
  expect(await 标题.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  expect(await 标题.evaluate((e) => getComputedStyle(e).textOverflow)).toBe("ellipsis");
  const 抽屉 = await page.locator(".notice-drawer .ant-drawer-content-wrapper").boundingBox();
  expect(抽屉!.x + 抽屉!.width).toBeLessThanOrEqual(w + 1);
  expect(抽屉!.width).toBeLessThanOrEqual(380);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.close();
});

it("手机 375：抽屉不超出屏幕", async () => {
  const { page } = await 打开(三条, { width: 375 });
  await 铃(page).click();
  await page.waitForTimeout(400);
  const 抽屉 = await page.locator(".notice-drawer .ant-drawer-content-wrapper").boundingBox();
  expect(抽屉!.x).toBeGreaterThanOrEqual(-1);
  expect(抽屉!.width).toBeLessThanOrEqual(376);
  await page.close();
});

it("暗黑：抽屉是暗底、标题是浅色字", async () => {
  const { page } = await 打开(三条, { 暗: true });
  await 铃(page).click();
  await expect.poll(() => page.locator(".notice-item").count()).toBe(3);
  const 亮度 = (rgb: string) => { const [r, g, b] = rgb.match(/\d+/g)!.map(Number); return (r * 299 + g * 587 + b * 114) / 1000; };
  const 字 = await page.locator(".notice-title").first().evaluate((e) => getComputedStyle(e).color);
  expect(亮度(字)).toBeGreaterThan(180);
  await page.close();
});

it("减弱动态：抽屉打开不走过渡，一点就到位", async () => {
  const { page, errors } = await 打开(三条, { 减弱: true });
  await 铃(page).click();
  // 不等动画：下一帧抽屉就在最终位置
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const 盒 = await page.locator(".notice-drawer .ant-drawer-content-wrapper").boundingBox();
  expect(Math.round(盒!.x + 盒!.width)).toBe(1280);
  const 时长 = await page.locator(".notice-drawer .ant-drawer-content-wrapper").evaluate((e) => getComputedStyle(e).transitionDuration);
  expect(时长.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
  expect(errors).toEqual([]);
  await page.close();
});
