/**
 * 跳转优化 PR-A（11-24）：换客户 / 列表进详情时旧内容留着，中间靠「顶上 2px 等待条 + 点的那一行立刻高亮」给反馈，新内容淡入 180ms。
 * 真 Chromium 里量：
 *   - 等待条：点了 150ms 内看不见（快的跳转不闪），慢了才淡出来；新页提交就撤
 *   - 正文淡入：换页时外框不重挂（正文里的状态还在），只放一段 180ms 的透明度动画，没有位移；第一次挂上不淡
 *   - 名单行：点的那一行立刻是选中的底色，原来选中的那行先让出来
 *   - 减弱动态：等待条不扫，只整条淡入；淡入照旧只淡
 * Next 路由那一侧（[id] 不放 loading、名单在 layout 里）见 tests/nav-smooth-routes.test.ts；真 Next 里的 A→B 见 e2e-ent/nav-smooth.spec.ts
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "nav-smooth", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "stub", pluginData: code }));
  // useLinkStatus：哪条链接的 href 等于 window.__等，哪条就在等
  stub(/^next\/link$/, "import React,{createContext,useContext} from 'react';const C=createContext({pending:false});export default function L({href,prefetch,children,...p}){return <C.Provider value={{pending:window.__等===href}}><a href={href} {...p}>{children}</a></C.Provider>}export const useLinkStatus=()=>useContext(C);");
  // router.push 回一个等测试放行的 promise：transition 一直挂着 = 新页还没到
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(u){window.__去=u;return new Promise(r=>{window.__放=r})},replace(){},refresh(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import NavProgress,{PageFade} from '@/components/NavProgress';
    import {useNavGo} from '@/lib/nav-pending';
    import {RowLink} from '@/components/ui';
    function 按钮(){const 去页=useNavGo();return <button id="go" onClick={()=>去页.push('/customers/b')}>去</button>}
    window.__画=(o={})=>{const root=(window.__root||=createRoot(document.getElementById('root')));
      root.render(<>
        <NavProgress/><按钮/>
        <div className="pane-rows">
          <RowLink href="/customers/a" className="roster-row on">甲</RowLink>
          <RowLink href="/customers/b" className="roster-row">乙</RowLink>
        </div>
        <main><PageFade 页={o.页??'/customers/a'}><input id="草稿" defaultValue=""/><h1>{o.页??'/customers/a'}</h1></PageFade></main>
      </>);};
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(opt: BrowserContextOptions = {}): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opt });
  const page = await ctx.newPage(); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://nav.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://nav.test/customers/a");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as { __画: () => void }).__画());
  await page.locator("#go").waitFor();
  return { page, errors, close: () => ctx.close() };
}
const 画 = (page: Page, o: object = {}) => page.evaluate((o) => (window as unknown as { __画: (o: object) => void }).__画(o), o);
const 条透明度 = (page: Page) => page.evaluate(() => { const e = document.querySelector(".nav-prog"); return e ? Number(getComputedStyle(e).opacity) : null; });

it("router.push 等新页：150ms 内看不见等待条，慢了才淡出来，新页到了就撤", async () => {
  const { page, errors, close } = await 打开();
  expect(await 条透明度(page)).toBeNull();
  await page.click("#go");
  await page.waitForTimeout(60);
  expect(await page.evaluate(() => (window as unknown as { __去: string }).__去)).toBe("/customers/b");
  expect(await 条透明度(page), "快的跳转不该看见条").toBeLessThan(0.05);
  await page.waitForTimeout(450);
  expect(await 条透明度(page)).toBeGreaterThan(0.9);
  const 框 = await page.locator(".nav-prog").boundingBox();
  expect(框).toMatchObject({ x: 0, y: 0, width: 1280, height: 2 });
  await page.evaluate(() => (window as unknown as { __放: () => void }).__放());
  await expect.poll(() => 条透明度(page)).toBeNull();
  expect(errors).toEqual([]);
  await close();
});

it("名单里点的那一行立刻高亮，原来选中的那行先让出来；同时顶上的条在等", async () => {
  const { page, close } = await 打开();
  const 底 = (n: number) => page.evaluate((n) => getComputedStyle(document.querySelectorAll(".roster-row")[n]).backgroundColor, n);
  const 选中底 = await 底(0);
  expect(选中底).not.toBe("rgba(0, 0, 0, 0)");
  await page.evaluate(() => { (window as unknown as { __等: string }).__等 = "/customers/b"; });
  await 画(page);
  await page.waitForTimeout(250); // .roster-row.on 的底色有 --t 的过渡
  expect(await 底(1)).toBe(选中底);
  expect(await 底(0)).toBe("rgba(0, 0, 0, 0)");
  expect(await page.locator(".roster-row").nth(1).locator(".nav-pend").count()).toBe(1);
  expect(await page.locator(".nav-prog").count()).toBe(1);
  await page.evaluate(() => { (window as unknown as { __等: string }).__等 = ""; });
  await 画(page);
  expect(await page.locator(".nav-pend, .nav-prog").count()).toBe(0);
  await close();
});

for (const 减弱 of [false, true]) {
  it(`换页时正文不重挂，只淡入 180ms、不位移${减弱 ? "（减弱动态）" : ""}；第一次挂上不淡`, async () => {
    const { page, close } = await 打开(减弱 ? { reducedMotion: "reduce" } : {});
    const 动画 = () => page.evaluate(() => (document.querySelector(".page-fade") as HTMLElement).getAnimations().map((a) => ({
      时长: (a.effect as KeyframeEffect).getTiming().duration,
      键: (a.effect as KeyframeEffect).getKeyframes().map((k) => Object.keys(k).filter((x) => !["offset", "computedOffset", "easing", "composite"].includes(x))),
    })));
    expect(await 动画(), "第一次挂上（服务端渲染好的页）不淡").toEqual([]);
    await page.fill("#草稿", "还没存的一句");
    await page.evaluate(() => { (document.querySelector(".page-fade") as HTMLElement & { __记: number }).__记 = 1; });
    await 画(page, { 页: "/customers/b" });
    expect(await page.locator("h1").textContent()).toBe("/customers/b");
    expect(await 动画()).toEqual([{ 时长: 180, 键: [["opacity"], ["opacity"]] }]);
    // 外框还是那一个、里面的草稿还在：没有按地址重挂
    expect(await page.evaluate(() => (document.querySelector(".page-fade") as HTMLElement & { __记?: number }).__记)).toBe(1);
    expect(await page.inputValue("#草稿")).toBe("还没存的一句");
    // 同一页重画（改筛选、开设置浮层）不淡
    await page.waitForTimeout(250);
    await 画(page, { 页: "/customers/b" });
    expect(await 动画()).toEqual([]);
    await close();
  });
}

it("减弱动态：等待条不扫，铺满一整条只淡入", async () => {
  const { page, close } = await 打开({ reducedMotion: "reduce" });
  await page.click("#go");
  await page.waitForTimeout(450);
  const r = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector(".nav-prog")!, "::before"); return { 动画: cs.animationName, 宽: cs.width, 移: cs.transform }; });
  expect(r).toEqual({ 动画: "none", 宽: "1280px", 移: "none" });
  expect(await 条透明度(page)).toBeGreaterThan(0.9);
  await close();
});
