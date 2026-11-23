/**
 * 跳转优化 PR-A（11-24）：换客户 / 列表进详情时旧内容留着，中间靠「顶上 2px 等待条 + 点的那一行立刻高亮」给反馈，新内容淡入 180ms。
 * 真 Chromium 里量：
 *   - 等待条：点了 150ms 内看不见（快的跳转不闪），慢了才淡出来；新页提交就撤
 *   - 正文淡入：换页时外框不重挂（正文里的状态还在），换栏目只放一段 180ms、从 0.6 起的透明度动画，没有位移；
 *     同一种页只换 id（客户 A→B、项目 A→B）不淡；第一次挂上不淡
 *   - 名单行、左栏项：点的那一行 / 那一项立刻是选中的底色，原来选中的先让出来
 *   - 减弱动态：等待条不扫，只整条淡入；淡入照旧只淡
 * Next 路由那一侧（[id] 不放 loading、名单在 layout 里）见 tests/nav-smooth-routes.test.ts；真 Next 里的 A→B 见 e2e-ent/nav-smooth.spec.ts
 *
 * 负载下不偶发红（推送前全套里拿到过「条还在」）：原来 __画 是裸 root.render——React 19 把这次渲染排进调度器，
 * 量过：render 之后同一任务里 .nav-pend、.nav-prog 都还在，第 1 个宏任务后 .nav-pend 撤了、.nav-prog 还在
 * （它要等 LinkPending 的 effect 清理把计数减掉、再重画一遍 NavProgress），第 2 个宏任务后才都没了。
 * 机器忙时测试那边下一句 CDP 查询能插在这几个任务中间，于是读到 1。产品里条没有退场动画、计数归零当场卸掉，不是「条撤得慢」。
 * 改法：__画 用 flushSync 当场提交（effect 跟着同步跑完）；看状态的断言改成 expect.poll 等到成立；
 * 按时长量的（150ms 内看不见、180ms 淡入）在页面里同一个任务 / 按帧量，不靠两次 CDP 之间的间隔
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
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import NavProgress,{PageFade} from '@/components/NavProgress';
    import {useNavGo} from '@/lib/nav-pending';
    import {RowLink} from '@/components/ui';
    import Link from 'next/link';
    import {LinkPending} from '@/components/NavProgress';
    import SlotSkeleton,{槽位} from '@/components/SlotSkeleton';
    function 按钮(){const 去页=useNavGo();return <button id="go" onClick={()=>去页.push('/customers/b')}>去</button>}
    // flushSync：画完当场提交、effect 一并跑完，测试读 DOM 不用赌调度器什么时候轮到（见文件头）
    window.__画=(o={})=>{const root=(window.__root||=createRoot(document.getElementById('root')));
      flushSync(()=>root.render(<>
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
      </>));};
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
/** 等「状态」成立的上限：条件本身是确定的（不是量时长），只给忙机器留余量 */
const 等 = { timeout: 3000, interval: 20 };
/**
 * 在页面里点「去」，从点下那一刻起按帧记等待条的透明度，记到 毫秒 为止，回最亮的那一帧（没挂上算 0）。
 * 「150ms 内看不见」量的是页面里的时间，不是两次 CDP 之间的间隔——机器忙时那个间隔本身就能过 150ms
 */
const 点去后最亮 = (page: Page, 毫秒: number) => page.evaluate(async (毫秒) => {
  const 透 = () => { const e = document.querySelector(".nav-prog"); return e ? Number(getComputedStyle(e).opacity) : 0; };
  (document.getElementById("go") as HTMLButtonElement).click();
  const 起 = performance.now();
  let 最亮 = 透();
  await new Promise<void>((r) => { const 一帧 = () => { if (performance.now() - 起 >= 毫秒) return r(); 最亮 = Math.max(最亮, 透()); requestAnimationFrame(一帧); }; requestAnimationFrame(一帧); });
  return 最亮;
}, 毫秒);

it("router.push 等新页：150ms 内看不见等待条，慢了才淡出来，新页到了就撤", async () => {
  const { page, errors, close } = await 打开();
  expect(await 条透明度(page)).toBeNull();
  // 点下后 140ms 内（页面里的时间）每一帧都看不见条；条已经挂上了（在等），只是还没淡出来
  expect(await 点去后最亮(page, 140), "快的跳转不该看见条").toBeLessThan(0.05);
  expect(await page.evaluate(() => (window as unknown as { __去: string }).__去)).toBe("/customers/b");
  expect(await page.locator(".nav-prog").count(), "点了就在等，只是看不见").toBe(1);
  // 慢了才淡出来（150ms 延迟 + --t 淡入）
  await expect.poll(() => 条透明度(page), 等).toBeGreaterThan(0.9);
  const 框 = await page.locator(".nav-prog").boundingBox();
  expect(框).toMatchObject({ x: 0, y: 0, width: 1280, height: 2 });
  await page.evaluate(() => (window as unknown as { __放: () => void }).__放());
  await expect.poll(() => 条透明度(page), 等).toBeNull();
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
  // 点的那一行挂上 .nav-pend、顶上的条挂上：画完当场就在（flushSync），不用等
  expect(await page.locator(".roster-row").nth(1).locator(".nav-pend").count()).toBe(1);
  expect(await page.locator(".roster-row").nth(0).locator(".nav-pend").count()).toBe(0);
  expect(await page.locator(".nav-prog").count()).toBe(1);
  // 底色有 --t 的过渡：等过渡走完，点的那行是选中底色、原来那行透明
  await expect.poll(() => 底(1), 等).toBe(选中底);
  await expect.poll(() => 底(0), 等).toBe("rgba(0, 0, 0, 0)");
  // 不等了：行上的标记和顶上的条都撤（条没有退场动画，计数归零当场卸掉）
  await page.evaluate(() => { (window as unknown as { __等: string }).__等 = ""; });
  await 画(page);
  await expect.poll(() => page.locator(".nav-pend, .nav-prog").count(), 等).toBe(0);
  await expect.poll(() => 底(0), 等).toBe(选中底);
  await close();
});

const 动画 = (page: Page) => page.evaluate(() => (document.querySelector(".page-fade") as HTMLElement).getAnimations().map((a) => ({
  时长: (a.effect as KeyframeEffect).getTiming().duration,
  键: (a.effect as KeyframeEffect).getKeyframes().map((k) => Object.keys(k).filter((x) => !["offset", "computedOffset", "easing", "composite"].includes(x))),
  起: Number((a.effect as KeyframeEffect).getKeyframes()[0].opacity),
})));
/** 重画、同一个任务里读正文身上的动画（180ms 的动画，两次 CDP 之间忙起来就能错过它） */
const 画后动画 = (page: Page, o: object) => page.evaluate((o) => {
  (window as unknown as { __画: (o: object) => void }).__画(o);
  return (document.querySelector(".page-fade") as HTMLElement).getAnimations().map((a) => ({
    时长: (a.effect as KeyframeEffect).getTiming().duration,
    键: (a.effect as KeyframeEffect).getKeyframes().map((k) => Object.keys(k).filter((x) => !["offset", "computedOffset", "easing", "composite"].includes(x))),
    起: Number((a.effect as KeyframeEffect).getKeyframes()[0].opacity),
  }));
}, o);
/** 上一段淡入放完（按页面里的动画状态等，不按墙上的时间猜） */
const 等淡完 = (page: Page) => expect.poll(() => 动画(page), 等).toEqual([]);
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
    expect(await 画后动画(page, { 页: "/projects" })).toEqual([{ 时长: 180, 键: [["opacity"], ["opacity"]], 起: 0.6 }]);
    expect(await page.locator("h1").textContent()).toBe("/projects");
    // 外框还是那一个、里面的草稿还在：没有按地址重挂
    expect(await page.evaluate(() => (document.querySelector(".page-fade") as HTMLElement & { __记?: number }).__记)).toBe(1);
    expect(await page.inputValue("#草稿")).toBe("还没存的一句");
    // 同一页重画（改筛选、开设置浮层）不淡
    await 等淡完(page);
    expect(await 画后动画(page, { 页: "/projects" })).toEqual([]);
    // 换栏目那一下最暗也只到 0.6，不先暗下去
    await 等淡完(page);
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
    await 等淡完(page);
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
  await expect.poll(() => page.locator(".nav-prog").count(), { ...等, message: "顶上的条也在等" }).toBe(1);
  await close();
});

it("减弱动态：等待条不扫，铺满一整条只淡入", async () => {
  const { page, close } = await 打开({ reducedMotion: "reduce" });
  await page.click("#go");
  // 等它淡出来（150ms 延迟 + 淡入）再量 ::before
  await expect.poll(() => 条透明度(page), 等).toBeGreaterThan(0.9);
  const r = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector(".nav-prog")!, "::before"); return { 动画: cs.animationName, 宽: cs.width, 移: cs.transform }; });
  expect(r).toEqual({ 动画: "none", 宽: "1280px", 移: "none" });
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
