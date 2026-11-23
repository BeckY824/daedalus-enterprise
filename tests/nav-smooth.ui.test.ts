/**
 * 跳转优化 PR-A（11-24）：换客户 / 列表进详情时旧内容留着，中间靠「顶上 2px 等待条 + 点的那一行立刻高亮」给反馈，新内容淡入 180ms。
 * 真 Chromium 里量：
 *   - 等待条：点了 150ms 内看不见（快的跳转不闪），慢了才淡出来；新页提交就撤
 *   - 正文淡入：换页时外框不重挂（正文里的状态还在），换栏目只放一段 180ms、从 0.6 起的透明度动画，没有位移；
 *     同一种页只换 id（客户 A→B、项目 A→B）不淡；第一次挂上不淡
 *   - 名单行、左栏项：点的那一行 / 那一项立刻是选中的底色，原来选中的先让出来
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
  // 点一下（不真的跳）也算在等：左栏那条用例点了看 150ms 内的样子
  stub(/^next\/link$/, "import React,{createContext,useContext,useState} from 'react';const C=createContext({pending:false});export default function L({href,prefetch,children,onClick,...p}){const [点了,set点了]=useState(false);return <C.Provider value={{pending:window.__等===href||点了}}><a href={href} {...p} onClick={(e)=>{e.preventDefault();onClick?.(e);set点了(true)}}>{children}</a></C.Provider>}export const useLinkStatus=()=>useContext(C);");
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
    import Link from 'next/link';
    import {LinkPending} from '@/components/NavProgress';
    import SlotSkeleton,{槽位} from '@/components/SlotSkeleton';
    function 按钮(){const 去页=useNavGo();return <button id="go" onClick={()=>去页.push('/customers/b')}>去</button>}
    window.__画=(o={})=>{const root=(window.__root||=createRoot(document.getElementById('root')));
      root.render(<>
        <NavProgress/><按钮/>
        <div className="pane-rows">
          <RowLink href="/customers/a" className="roster-row on">甲</RowLink>
          <RowLink href="/customers/b" className="roster-row">乙</RowLink>
        </div>
        {/* 左栏两项，照 AppShell 一项() 的摆法：选中那项里有滑动的底色层，<LinkPending /> 是链接的直接子元素 */}
        <nav className="rail"><div className="rail-nav">
          <Link href="/customers" className="rail-item on" id="栏客户"><span className="rail-on-bg"/><b>客户</b><LinkPending/></Link>
          <Link href="/overview" className="rail-item" id="栏复盘"><b>复盘</b><LinkPending/></Link>
        </div></nav>
        <div id="中栏"><槽位 名="pane" 有AI={!!o.有AI}>{o.骨 ? <SlotSkeleton/> : null}</槽位></div>
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

const 动画 = (page: Page) => page.evaluate(() => (document.querySelector(".page-fade") as HTMLElement).getAnimations().map((a) => ({
  时长: (a.effect as KeyframeEffect).getTiming().duration,
  键: (a.effect as KeyframeEffect).getKeyframes().map((k) => Object.keys(k).filter((x) => !["offset", "computedOffset", "easing", "composite"].includes(x))),
  起: Number((a.effect as KeyframeEffect).getKeyframes()[0].opacity),
})));
/** 重画之后每帧记正文的透明度，记 300ms，回最低的那一帧 */
const 画后最暗 = (page: Page, o: object) => page.evaluate(async (o) => {
  const w = window as unknown as { __画: (o: object) => void };
  const 记: number[] = [];
  w.__画(o);
  const 起 = performance.now();
  await new Promise<void>((r) => { const 一帧 = () => { 记.push(Number(getComputedStyle(document.querySelector(".page-fade")!).opacity)); if (performance.now() - 起 < 300) requestAnimationFrame(一帧); else r(); }; 一帧(); });
  return Math.min(...记);
}, o);

for (const 减弱 of [false, true]) {
  it(`换栏目时正文不重挂，从 0.6 淡入 180ms、不位移${减弱 ? "（减弱动态）" : ""}；第一次挂上不淡`, async () => {
    const { page, close } = await 打开(减弱 ? { reducedMotion: "reduce" } : {});
    expect(await 动画(page), "第一次挂上（服务端渲染好的页）不淡").toEqual([]);
    await page.fill("#草稿", "还没存的一句");
    await page.evaluate(() => { (document.querySelector(".page-fade") as HTMLElement & { __记: number }).__记 = 1; });
    await 画(page, { 页: "/projects" });
    expect(await page.locator("h1").textContent()).toBe("/projects");
    expect(await 动画(page)).toEqual([{ 时长: 180, 键: [["opacity"], ["opacity"]], 起: 0.6 }]);
    // 外框还是那一个、里面的草稿还在：没有按地址重挂
    expect(await page.evaluate(() => (document.querySelector(".page-fade") as HTMLElement & { __记?: number }).__记)).toBe(1);
    expect(await page.inputValue("#草稿")).toBe("还没存的一句");
    // 同一页重画（改筛选、开设置浮层）不淡
    await page.waitForTimeout(250);
    await 画(page, { 页: "/projects" });
    expect(await 动画(page)).toEqual([]);
    // 换栏目那一下最暗也只到 0.6，不先暗下去
    await page.waitForTimeout(250);
    expect(await 画后最暗(page, { 页: "/customers/a" })).toBeGreaterThanOrEqual(0.6);
    await close();
  });
}

it("同一种页只换 id（客户 A→B、项目 A→B）：正文不淡，透明度一帧都不掉到 0.6 以下", async () => {
  const { page, close } = await 打开();
  for (const 页 of ["/customers/b", "/customers/c", "/projects/x", "/projects/y"]) {
    const 最暗 = await 画后最暗(page, { 页 });
    expect(await page.locator("h1").textContent()).toBe(页);
    // /customers/c → /projects/x 是换栏目：从 0.6 淡；其余同一种只换 id：一帧换上
    if (页 === "/projects/x") expect(最暗, 页).toBeGreaterThanOrEqual(0.6);
    else expect(最暗, 页).toBe(1);
    await page.waitForTimeout(250);
  }
  await close();
});

it("点左栏一项：150ms 内这一项就是选中的底色和字色，原来选中的那项同时退掉", async () => {
  const { page, close } = await 打开();
  const 样 = () => page.evaluate(() => {
    const 取 = (id: string) => { const a = document.getElementById(id)!; const cs = getComputedStyle(a); return { 底: cs.backgroundColor, 字: cs.color }; };
    const 层 = document.querySelector("#栏客户 .rail-on-bg")!;
    return { 客户: 取("栏客户"), 复盘: 取("栏复盘"), 层底: getComputedStyle(层).backgroundColor, 层可见: getComputedStyle(层).visibility, 选中字: getComputedStyle(document.getElementById("栏客户")!).color };
  });
  const 前 = await 样();
  expect(前.层可见).toBe("visible");
  const 选中底 = 前.层底, 选中字 = 前.选中字;
  const 点时 = Date.now();
  await page.click("#栏复盘");
  await page.waitForTimeout(Math.max(0, 150 - (Date.now() - 点时)));
  const 后 = await 样();
  expect(后.复盘, "点的那项 150ms 内是选中样子").toEqual({ 底: 选中底, 字: 选中字 });
  expect(后.层可见, "原来那项的选中底色层先藏起来").toBe("hidden");
  expect(后.客户.字, "原来那项退回平常字色").not.toBe(选中字);
  expect(await page.locator(".nav-prog").count(), "顶上的条也在等").toBe(1);
  await close();
});

it("减弱动态：等待条不扫，铺满一整条只淡入", async () => {
  const { page, close } = await 打开({ reducedMotion: "reduce" });
  await page.click("#go");
  await page.waitForTimeout(450);
  const r = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector(".nav-prog")!, "::before"); return { 动画: cs.animationName, 宽: cs.width, 移: cs.transform }; });
  expect(r).toEqual({ 动画: "none", 宽: "1280px", 移: "none" });
  expect(await 条透明度(page)).toBeGreaterThan(0.9);
  await close();
});

it("冷切到首页（开着 AI）：中栏先摆一栏同宽的空骨架，正文不等对话列表来了再横跳；没开 AI、窄屏不摆", async () => {
  for (const [宽, 有AI, 该有] of [[1280, true, true], [1280, false, false], [390, true, false]] as const) {
    const { page, close } = await 打开({ viewport: { width: 宽, height: 800 } });
    await page.evaluate(() => history.pushState(null, "", "/dashboard"));
    await 画(page, { 骨: true, 有AI });
    const 栏 = page.locator("#中栏 aside.pane.pane-chat");
    expect(await 栏.count(), `${宽} 有AI=${有AI}`).toBe(该有 ? 1 : 0);
    if (该有) {
      expect((await 栏.boundingBox())?.width, "和对话列表同宽（--chat-w 默认 232）").toBe(232);
      expect(await page.locator("#中栏 [data-testid=page-skeleton]").count(), "中栏里不塞正文骨架").toBe(0);
    }
    await close();
  }
});
