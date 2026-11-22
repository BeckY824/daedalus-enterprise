/**
 * 设计语言 HC-1（11-22，首页对话：骨架、头部、列宽、待办、滚动、390 对话栏；依据 现在-首页对话-20261122.md，
 * 用户 11-22 选 C0-A / C1-A / C2-A / C3-A / C5-A / C12-A / C13-A，C5 补「问候、快捷问题、输入框这一组在卡里上下居中」）：
 *   C0 一张纸：页面不滚，框四边一律 24（1024 / 1366 / 1920，中栏开 / 收起）；对话在框里滚
 *   C2 对话列 760：问句气泡、回答、输入框同宽同边，在框里左右居中
 *   C1 框头：标题点了就地改名（回车存、Esc 不改）；列表不在时出「显示对话列表」「新建对话」；⋯ 菜单
 *   C3 顶部待办收成「待办 N」，点开浮层、Esc 收
 *   C12 往上翻出「↓」，下面长新字带蓝点，点了回到最新；刚发那一轮留一框高的空（问句能顶到框顶）
 *   C13 390：对话栏 52 高、钮 44；框铺满、输入框贴视口底；不横滚
 *   C5 还没问：「晚上好」上方的空 = 输入框下方的空（±2，1366 / 1024 / 390；有没有顶部待办都量）
 * 换皮主题（账簿）照旧：没有框头、整页滚、框不钉高。
 *
 * 外面的结构照 AppShell + HomeChat 驾驶舱那一支摆（HomeChat 连着对话流、路由、背调，单拎出来画不了；同 ent-design-ha-layout.ui.test.ts），
 * 框头、回到最新、问候、输入框底栏、指标卡用真组件
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ent-hc1", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷新=(window.__刷新||0)+1},push(u){window.__去=u},prefetch(){}});export const usePathname=()=>'/dashboard';export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/\/threads$/, 补全动作桩("src/app/(app)/dashboard/threads.ts", "export const 重命名对话=async(id,t)=>{window.__改名=[id,t];if(window.__改名抛)throw new TypeError('Failed to fetch');return window.__改名失败?{ok:false,error:'x'}:{ok:true}};"));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ChatHead from '@/app/(app)/dashboard/ChatHead';
    import ToLatest from '@/app/(app)/dashboard/ToLatest';
    import Welcome from '@/app/(app)/dashboard/Welcome';
    import { ComposerFoot, SendKey } from '@/app/(app)/dashboard/ComposerParts';
    import HomeCards from '@/app/(app)/dashboard/HomeCards';
    import AwaitAssignTodo from '@/app/(app)/leads/AwaitAssignTodo';
    import ReplyDueTodo from '@/app/(app)/dashboard/ReplyDueTodo';
    import AssignEtaLine from '@/app/(app)/dashboard/AssignEtaLine';
    import { useIsNowSkin } from '@/lib/use-skin';
    import { configureBrowserBusinessTimeZone } from '@/lib/business-clock';
    configureBrowserBusinessTimeZone('Asia/Shanghai');
    const 长 = '某某超长贸易进出口有限公司'.repeat(4);
    const 卡数 = { "month-new": 591, key: 123, "no-follow": 4802, "due-soon": 0 };
    const 示例们 = [
      { label: "今天该跟谁", question: "今天该跟谁", kind: "fill" },
      { label: "帮我记一条：…", question: "帮我记一条：", kind: "fill" },
      { label: "哪些项目 3 天内回公海", question: "我手上哪些项目 3 天内回公海", kind: "fill" },
    ];
    const 待办们 = (n) => n ? <>
      <AwaitAssignTodo 数据={{ 条数: 128, 最早: '11-22 09:30', 最早At: new Date().toISOString() }} />
      <ReplyDueTodo 数据={{ 条数: window.__长时段 ? 1 : 8, 超时: window.__长时段 ? 0 : 3, 最早: { projectId: 'p2', name: 长, 时: '11-22 21:00 – 22:00', 始: window.__长时段 ? new Date(Date.now() - 3 * 864e5).toISOString() : new Date().toISOString(), 终: window.__长时段 ? new Date(Date.now() + 3 * 864e5).toISOString() : new Date().toISOString(), 超时: true } }} />
      {n > 2 && <AssignEtaLine 轮到={{ 数: 12, 待补: 0, 放弃待补: 0 }} />}
      {null}
    </> : null;
    const 输入框 = (空) => (
      <div className={'cli-composer' + (空 ? '' : ' cli-composer-sticky')}>
        <div className="cli-input cli-input-rich">
          <textarea rows={1} defaultValue="" aria-label="问一句" />
          <div className="cli-bar2"><div className="cli-bar2-l" /><div className="cli-bar2-r"><SendKey 在跑={false} onStop={() => {}} canSend={false} on发={() => {}} /></div></div>
        </div>
        <ComposerFoot 摆建议={空} 示例槽={空 ? window.__槽 : undefined} suggestions={示例们} suggIdx={-1} 空={空} 在跑={false} 背调模式={false} 背调价={null} AI已用完={false} on问={() => {}} />
      </div>
    );
    function 问过({ 轮数, 待办, 新 }) {
      const 现状 = useIsNowSkin();
      const 轮们 = Array.from({ length: 轮数 }, (_, i) => i);
      return (
        <div className={'cli' + (现状 ? ' cli-paper' : '')}><div className="cli-ck"><div className="cli-ck-g">
          <div className="cli-col cli-frame">
            {现状 ? <ChatHead 标题="今天该跟谁" 对话id="c1" 能改 待办={待办们(待办)} /> : 待办们(待办)}
            <div className="cli-log">
              {轮们.map((i) => (
                <div key={i} className={'cli-turn' + (新 && i === 轮数 - 1 ? ' cli-turn-new' : '')} data-i={i}>
                  <div className="cli-user"><div className="cli-bubble">{'问题 ' + i + (i % 2 ? '：' + 长 : '')}</div></div>
                  <div className="cli-a">{('回答第 ' + i + ' 轮。' + 长 + '。').repeat(i % 3 + 1)}</div>
                </div>
              ))}
              <div />
            </div>
            {现状 && <ToLatest 刚发={!!新} />}
            {输入框(false)}
          </div>
          <HomeCards 数={卡数} />
        </div></div></div>
      );
    }
    function 没问({ 待办 }) {
      const [槽, set槽] = React.useState(null);
      window.__槽 = 槽;
      return (
        <div className="cli cli-empty"><div className="cli-ck"><div className="cli-ck-g">
          <div className="cli-col cli-frame">
            {待办们(待办)}
            <Welcome userName="测试员" context="" 欢迎="欢迎使用 测试产品" 示例槽={set槽} />
            {输入框(true)}
          </div>
          <HomeCards 数={卡数} />
        </div></div></div>
      );
    }
    let root;
    window.__画 = (el, 样, o) => { root = createRoot(el); root.render(<ConfigProvider locale={zhCN}><App component={false}>{样 === '问过' ? <问过 {...o} /> : <没问 {...o} />}</App></ConfigProvider>); };
    window.__重画 = (样, o) => root.render(<ConfigProvider locale={zhCN}><App component={false}>{样 === '问过' ? <问过 {...o} /> : <没问 {...o} />}</App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, plugins: [plugin], logLevel: "silent" });
  bundle = "window.process = { env: {} };\n" + r.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 开参 = { 宽: number; 高?: number; 样?: "问过" | "没问"; 轮数?: number; 待办?: number; 新?: boolean; 收列表?: boolean; skin?: "now" | "ledger"; 长时段?: boolean };
async function 开(o: 开参): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: o.宽, height: o.高 ?? 900 }, reducedMotion: "reduce", timezoneId: "Europe/London" });
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const skin = o.skin ?? "now";
  const 手机 = o.宽 < 768;
  // 照 AppShell：电脑 = 左栏 220 + 中栏 232（开着、够宽时）+ main（内边距 22 / 26，里面一层换页 div）；手机 = 顶栏 48 + Content（.cli 直接挂在里面）
  const 中栏 = !手机 && !o.收列表 && o.宽 >= 220 + 232 + 640;
  const 壳 = 手机
    ? `<section class='ant-layout' style='min-height:100vh;display:flex;flex-direction:column'><header style='height:48px;flex:none;border-bottom:1px solid #eee'></header><main class='app-content' id='root' style='padding:22px 26px'></main></section>`
    : `<div class='shell'><nav style='width:220px;flex:none'></nav>${中栏 ? "<aside class='pane' style='width:232px'></aside>" : ""}<main class='main app-content' style='padding:22px 26px'><div id='root' style='max-width:1720px;margin:0 auto'></div></main></div>`;
  await page.route("http://hc1.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html${skin === "now" ? "" : ` data-skin="${skin}" data-paper="tone" data-mode="light"`}><meta charset='utf-8'><body style='margin:0'>${壳}</body></html>` }));
  await page.goto("http://hc1.test/dashboard");
  if (o.收列表) await page.evaluate(() => localStorage.setItem("pane.chat.collapsed", "true"));
  for (const f of ["globals.css", ...(skin === "now" ? [] : ["skins/shared.css", `skins/${skin}.css`])]) await page.addStyleTag({ path: path.resolve("src/app", f) });
  await page.addScriptTag({ content: bundle });
  if (o.长时段) await page.evaluate(() => { (window as unknown as { __长时段: boolean }).__长时段 = true; });
  await page.evaluate(([样, opt]) => (window as unknown as { __画: (el: Element, s: string, o: unknown) => void }).__画(document.getElementById("root")!, 样 as string, opt), [o.样 ?? "问过", { 轮数: o.轮数 ?? 12, 待办: o.待办 ?? 2, 新: o.新 ?? false }] as const);
  await page.locator(".cli-frame .cli-input").waitFor();
  await page.waitForTimeout(50);
  if (errors.length) throw new Error(errors.join("\n"));
  return { page, errors };
}
const 盒 = (page: Page, sel: string, 末 = false) => (末 ? page.locator(sel).last() : page.locator(sel).first()).evaluate((e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height }; });
const 不横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const 不整页滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1);

for (const [宽, 收] of [[1366, false], [1366, true], [1024, false], [1920, false], [1280, false]] as const) {
  it(`C0 / C2（${宽}${收 ? "，中栏收起" : ""}，长对话）：页面不滚、框四边 24、对话在框里滚；对话列 ≤760 居中，气泡 / 回答 / 输入框同边`, async () => {
    const { page, errors } = await 开({ 宽, 收列表: 收, 轮数: 14 });
    try {
      expect(await 不横滚(page)).toBe(true);
      expect(await 不整页滚(page)).toBe(true);
      const 框 = await 盒(page, ".cli-frame");
      const 主 = await 盒(page, ".main");
      // 四边一律 24（main 的内容盒到框）
      expect(Math.abs(框.t - 主.t - 24)).toBeLessThanOrEqual(1);
      expect(Math.abs(主.b - 框.b - 24)).toBeLessThanOrEqual(1);
      expect(Math.abs(框.l - 主.l - 24)).toBeLessThanOrEqual(1);
      expect(Math.abs(主.r - 框.r - 24)).toBeLessThanOrEqual(1);
      // 框头 48，框外没有那颗飘着的列表开关
      expect((await 盒(page, ".cli-head")).h).toBe(48);
      // 对话在框里滚
      const log = await page.locator(".cli-log").evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight, oy: getComputedStyle(e).overflowY }));
      expect(log.oy).toBe("auto");
      expect(log.sh).toBeGreaterThan(log.ch);
      // 一打开落在最底下
      expect(await page.locator(".cli-log").evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight)).toBeLessThan(2);
      // 输入框贴框底（框底留 24）
      const 输 = await 盒(page, ".cli-frame .cli-input");
      expect(输.b).toBeLessThan(框.b);
      // 对话列：宽 ≤760、在框里左右居中；问句气泡右边 = 回答列右边 = 输入框右边；回答左边 = 输入框左边
      const 列 = await 盒(page, ".cli-log > .cli-turn", true);
      expect(列.w).toBeLessThanOrEqual(760);
      if (框.w - 48 > 760) expect(列.w).toBe(760);
      expect(Math.abs((列.l - 框.l) - (框.r - 列.r))).toBeLessThanOrEqual(1);
      const 泡 = await 盒(page, ".cli-log > .cli-turn .cli-bubble", true);
      expect(Math.abs(泡.r - 列.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(输.r - 列.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(输.l - 列.l)).toBeLessThanOrEqual(1);
      // 中栏不在（收起 / 太窄成抽屉）才出「显示对话列表」「新建对话」
      const 列表不在 = 收 || 宽 < 220 + 232 + 640;
      expect(await page.getByRole("button", { name: "显示对话列表" }).count()).toBe(列表不在 ? 1 : 0);
      expect(await page.getByRole("button", { name: "新建对话" }).count()).toBe(列表不在 ? 1 : 0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("C1：标题点了就地改名（回车存、Esc 不改）；⋯ 菜单有重命名 / 删除这段对话；新建对话回到 /dashboard", async () => {
  const { page, errors } = await 开({ 宽: 1366, 收列表: true });
  try {
    const 题 = page.locator(".cli-head-t");
    expect(await 题.textContent()).toBe("今天该跟谁");
    await 题.click();
    const 框 = page.locator(".cli-head-in");
    expect(await 框.evaluate((e) => document.activeElement === e)).toBe(true);
    await 框.fill("华东展具回电");
    await 框.press("Enter");
    await page.waitForFunction(() => (window as unknown as { __改名?: unknown }).__改名 != null);
    expect(await page.evaluate(() => (window as unknown as { __改名: unknown }).__改名)).toEqual(["c1", "华东展具回电"]);
    expect(await 题.textContent()).toBe("华东展具回电");
    // Esc 不改
    await 题.click();
    await page.locator(".cli-head-in").fill("不要这个");
    await page.locator(".cli-head-in").press("Escape");
    expect(await page.locator(".cli-head-t").textContent()).toBe("华东展具回电");
    // 改名框和标题同一行、不撑高框头
    expect((await 盒(page, ".cli-head")).h).toBe(48);
    // ⋯ 菜单
    await page.getByRole("button", { name: "这段对话的操作" }).click();
    await page.getByRole("menuitem", { name: /重命名/ }).waitFor();
    expect(await page.getByRole("menuitem", { name: /删除这段对话/ }).count()).toBe(1);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "新建对话" }).click();
    expect(await page.evaluate(() => (window as unknown as { __去: string }).__去)).toBe("/dashboard");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("C1（改名失败）：「改不了这条对话」不一直挂着——鼠标移开就收，不动也 3 秒后自己收", async () => {
  const { page, errors } = await 开({ 宽: 1366, 收列表: true });
  try {
    await page.evaluate(() => { (window as unknown as { __改名失败: boolean }).__改名失败 = true; });
    const 提示 = page.locator(".ant-tooltip:not(.ant-tooltip-hidden)", { hasText: "改不了这条对话" });
    // 用 element.click() 进改名：鼠标不挪到标题上，免得「移开」那一下抢先把提示收了
    const 改一下 = async (名: string) => {
      await page.mouse.move(5, 600);
      await page.locator(".cli-head-t").evaluate((e) => (e as HTMLElement).click());
      await page.locator(".cli-head-in").fill(名);
      await page.locator(".cli-head-in").press("Enter");
      await 提示.waitFor();
      expect(await page.locator(".cli-head-t").textContent()).toBe("今天该跟谁");
    };
    // 鼠标移开就收（远早于 3 秒）
    await 改一下("改名一");
    await page.locator(".cli-head-t").hover();
    await page.mouse.move(5, 600);
    await expect.poll(() => 提示.count(), { timeout: 1500 }).toBe(0);
    // 不动：3 秒后自己收
    await 改一下("改名二");
    await page.waitForTimeout(2000);
    expect(await 提示.count()).toBe(1);
    await expect.poll(() => 提示.count(), { timeout: 2500 }).toBe(0);
    // 断网（重命名对话 直接抛错、不是回 ok:false）：同样回退到原名、出提示（3703 补点）
    await page.evaluate(() => { const w = window as unknown as { __改名失败: boolean; __改名抛: boolean }; w.__改名失败 = false; w.__改名抛 = true; });
    await 改一下("断网时改的名");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("C3：顶部待办收成「待办 N」（N = 真画出来的行），点开浮层每行原样，Esc / 点外面收；没有待办不出钮", async () => {
  const { page, errors } = await 开({ 宽: 1366, 待办: 3 });
  try {
    // 待办行不再挂在对话上面
    expect(await page.locator(".cli-log .home-cth-todo").count()).toBe(0);
    const 钮 = page.locator(".cli-head-chip");
    expect(await 钮.textContent()).toBe("待办 3");
    expect(await page.locator(".cli-head-pop").isVisible()).toBe(false);
    await 钮.click();
    expect(await page.locator(".cli-head-pop").isVisible()).toBe(true);
    expect(await page.locator(".cli-head-pop .home-cth-todo").count()).toBe(3);
    // 浮层在框里、不出视口右边
    const 层 = await 盒(page, ".cli-head-pop");
    expect(层.r).toBeLessThanOrEqual(1366);
    await page.keyboard.press("Escape");
    expect(await page.locator(".cli-head-pop").isVisible()).toBe(false);
    await 钮.click();
    await page.locator(".cli-log").click({ position: { x: 10, y: 10 } });
    expect(await page.locator(".cli-head-pop").isVisible()).toBe(false);
    // 没有待办：钮不出
    await page.evaluate(() => (window as unknown as { __重画: (s: string, o: unknown) => void }).__重画("问过", { 轮数: 12, 待办: 0 }));
    await page.waitForTimeout(50);
    expect(await page.locator(".cli-head-chip").isVisible()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("C3（390）：点「待办 N」，浮层对着整条对话栏、左右各留 16，不出屏", async () => {
  const { page, errors } = await 开({ 宽: 390, 高: 844, 待办: 2 });
  try {
    await page.locator(".cli-head-chip").click();
    const 层 = await 盒(page, ".cli-head-pop");
    expect(层.l, JSON.stringify(层)).toBeGreaterThanOrEqual(0);
    expect(层.r, JSON.stringify(层)).toBeLessThanOrEqual(390);
    expect(Math.abs(层.l - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs(390 - 层.r - 16)).toBeLessThanOrEqual(1);
    expect(await page.locator(".cli-head-pop .home-cth-todo").count()).toBe(2);
    expect(await 不横滚(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("C3（390，标题短 + 跨天的指定回复时段）：浮层里不折行的时间串整段摆得下，浮层不横滚、每格不出行右边（3703 补点）", async () => {
  const { page, errors } = await 开({ 宽: 390, 高: 844, 待办: 2, 长时段: true });
  try {
    await page.locator(".cli-head-chip").click();
    const 时 = await page.locator(".cli-head-pop .home-cth-todo-time", { hasText: "指定回复" }).evaluate((e) => ({ t: e.textContent, w: e.getBoundingClientRect().width }));
    expect(时.t).toMatch(/^指定回复 .+ – .+/);
    expect(时.w, "时间串要够长才测得出（3703 上是 249 宽）").toBeGreaterThan(200);
    const 层 = await page.locator(".cli-head-pop").evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
    expect(层.sw, JSON.stringify(层)).toBeLessThanOrEqual(层.cw);
    const 越界 = await page.locator(".cli-head-pop .home-cth-todo").evaluateAll((rows) => rows.flatMap((row) => {
      const R = row.getBoundingClientRect();
      return [...row.querySelectorAll<HTMLElement>(".home-cth-todo-s, .home-cth-todo-time, .home-cth-todo-a")]
        .map((x) => ({ c: x.className, r: Math.round(x.getBoundingClientRect().right), 行右: Math.round(R.right) }))
        .filter((x) => x.r > x.行右 + 1);
    }));
    expect(越界).toEqual([]);
    expect(await 不横滚(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("C12：往上翻出「↓」，下面长新字带蓝点，点了回到最新；框头滚过顶才出下沿线；刚发那一轮留一框高的空", async () => {
  const { page, errors } = await 开({ 宽: 1366, 轮数: 14 });
  try {
    const 钮 = page.locator(".cli-latest-b");
    expect(await 钮.isVisible()).toBe(false);
    expect(await page.locator(".cli-frame").getAttribute("data-scrolled")).toBe("");
    await page.locator(".cli-log").evaluate((e) => { e.scrollTop = 0; e.dispatchEvent(new Event("scroll")); });
    await page.waitForTimeout(50);
    expect(await 钮.isVisible()).toBe(true);
    expect(await page.locator(".cli-frame").getAttribute("data-scrolled")).toBeNull();
    // 钮在输入框上方、框里左右居中
    const b = await 盒(page, ".cli-latest-b"), 输 = await 盒(page, ".cli-frame .cli-input"), 框 = await 盒(page, ".cli-frame");
    expect(b.b).toBeLessThanOrEqual(输.t);
    expect(Math.abs((b.l + b.r) / 2 - (框.l + 框.r) / 2)).toBeLessThanOrEqual(1);
    expect(await 钮.evaluate((e) => e.classList.contains("has-new"))).toBe(false);
    // 步骤条上的秒数、回答时间那行在变不算新内容（#410：还在查数据、正文没出字蓝点就亮了）
    await page.locator(".cli-log .cli-turn").last().evaluate((t) => {
      const 条 = document.createElement("div"); 条.className = "ais"; 条.innerHTML = "<span class='ais-t'>查数据 · 1 秒</span>";
      const 时 = document.createElement("span"); 时.className = "cli-bar-t"; 时.textContent = "刚刚";
      t.append(条, 时);
    });
    await page.waitForTimeout(50);
    // 上面插进去那一下本身算新结构：先回到底再翻上去，清掉
    await page.locator(".cli-log").evaluate((e) => { e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event("scroll")); });
    await page.waitForTimeout(50);
    await page.locator(".cli-log").evaluate((e) => { e.scrollTop = 0; e.dispatchEvent(new Event("scroll")); });
    await page.waitForTimeout(50);
    expect(await 钮.evaluate((e) => e.classList.contains("has-new"))).toBe(false);
    for (const n of [2, 3, 4]) {
      await page.locator(".cli-log .ais .ais-t").evaluate((e, n) => { e.firstChild!.textContent = "查数据 · " + n + " 秒"; }, n);
      await page.locator(".cli-log .cli-bar-t").evaluate((e, n) => { e.textContent = n + " 秒前"; }, n);
      await page.waitForTimeout(30);
    }
    expect(await 钮.evaluate((e) => e.classList.contains("has-new"))).toBe(false);
    await page.locator(".cli-log .cli-a").last().evaluate((e) => { e.append(" 又出了几个字"); });
    await page.waitForTimeout(50);
    expect(await 钮.evaluate((e) => e.classList.contains("has-new"))).toBe(true);
    await 钮.click();
    await page.waitForFunction(() => { const e = document.querySelector(".cli-log")!; return e.scrollHeight - e.scrollTop - e.clientHeight < 2; });
    await page.waitForTimeout(50);
    expect(await 钮.isVisible()).toBe(false);
    // 刚发那一轮：至少一框高（减底边留白），问句能顶到框顶
    await page.evaluate(() => (window as unknown as { __重画: (s: string, o: unknown) => void }).__重画("问过", { 轮数: 3, 待办: 2, 新: true }));
    await page.waitForTimeout(50);
    const [新轮, 框高] = await page.locator(".cli-log").evaluate((e) => [(e.querySelector(".cli-turn-new") as HTMLElement).offsetHeight, e.clientHeight]);
    expect(新轮 + 16).toBeGreaterThanOrEqual(框高 - 1);
    await page.locator(".cli-log").evaluate((e) => { const t = e.querySelector(".cli-turn-new") as HTMLElement; e.scrollTop = t.offsetTop; });
    const 顶差 = await page.locator(".cli-log").evaluate((e) => (e.querySelector(".cli-turn-new") as HTMLElement).getBoundingClientRect().top - e.getBoundingClientRect().top);
    expect(Math.abs(顶差)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("C13（390）：全站顶栏下一条对话栏 52 高、钮 44；框铺满、在框里滚，输入框贴视口底；不横滚、不整页滚", async () => {
  const { page, errors } = await 开({ 宽: 390, 高: 844, 轮数: 10 });
  try {
    expect(await 不横滚(page)).toBe(true);
    expect(await 不整页滚(page)).toBe(true);
    const 头 = await 盒(page, ".cli-head");
    expect(头.h).toBe(52);
    expect(头.t).toBeGreaterThanOrEqual(48);
    expect(Math.abs(头.l)).toBeLessThanOrEqual(1);
    expect(Math.abs(头.r - 390)).toBeLessThanOrEqual(1);
    // 列表 · 标题 · 待办 · 新建 · ⋯：钮都 44
    for (const 名 of ["显示对话列表", "新建对话", "这段对话的操作"]) {
      const r = await page.getByRole("button", { name: 名 }).evaluate((e) => e.getBoundingClientRect());
      expect(r.width, 名).toBeGreaterThanOrEqual(44);
      expect(r.height, 名).toBeGreaterThanOrEqual(44);
    }
    expect(await page.locator(".cli-head-chip").textContent()).toBe("待办 2");
    // 标题不把右边的钮挤出去
    const 末 = await 盒(page, ".cli-head > :last-child");
    expect(末.r).toBeLessThanOrEqual(390);
    // 框铺满、输入框贴视口底
    const 框 = await 盒(page, ".cli-frame");
    expect(Math.abs(框.b - 844)).toBeLessThanOrEqual(1);
    const 输 = await 盒(page, ".cli-frame .cli-input");
    expect(输.b).toBeLessThanOrEqual(844);
    expect(844 - 输.b).toBeLessThan(80);
    expect(await page.locator(".cli-log").evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const [宽, 待办] of [[1366, 0], [1366, 2], [1024, 0], [390, 0], [390, 2]] as const) {
  it(`C5（${宽}${待办 ? "，顶部 2 行待办" : ""}）：还没问时问候、快捷问题、输入框这一组在卡里上下居中——「晚上好」上方的空 = 输入框下方的空（±2）`, async () => {
    const { page, errors } = await 开({ 宽, 样: "没问", 待办 });
    try {
      await page.locator(".cli-frame-q .cli-q").first().waitFor();
      // 问候淡入（motion y 6 → 0、cli-greet-in）走完再量
      await page.waitForTimeout(700);
      const 框 = await 盒(page, ".cli-frame");
      const 框内 = await page.locator(".cli-frame").evaluate((e) => { const s = getComputedStyle(e); return { pt: parseFloat(s.paddingTop), pb: parseFloat(s.paddingBottom), bt: parseFloat(s.borderTopWidth), bb: parseFloat(s.borderBottomWidth) }; });
      const 起 = 待办 ? (await 盒(page, ".cli-frame > .home-cth-todo", true)).b : 框.t + 框内.bt + 框内.pt;
      const 问候 = await 盒(page, ".cli-frame > .cli-welcome");
      const 输 = await 盒(page, ".cli-frame > .cli-composer");
      const 上 = 问候.t - 起 - (待办 ? 16 : 0);
      const 下 = 框.b - 框内.bb - 框内.pb - 输.b;
      expect(Math.abs(上 - 下), JSON.stringify({ 上, 下 })).toBeLessThanOrEqual(2);
      // 三条示例和输入框不叠：示例最后一条在输入框上沿之上，中间至少留输入框的上留白
      const 末条 = await 盒(page, ".cli-frame-q .cli-q", true), 框入 = await 盒(page, ".cli-frame .cli-input");
      expect(框入.t - 末条.b, JSON.stringify({ 末条, 框入 })).toBeGreaterThanOrEqual(16);
      // 「帮我记一条：…」去掉省略号
      expect(await page.locator(".cli-frame-q .cli-q").nth(1).textContent()).toBe("帮我记一条");
      expect(await 不横滚(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("换皮主题（账簿）照旧：没有框头和「待办 N」，整页滚，框不钉高；示例照原文", async () => {
  const { page, errors } = await 开({ 宽: 1366, skin: "ledger", 轮数: 14 });
  try {
    expect(await page.locator(".cli-head").count()).toBe(0);
    expect(await page.locator(".cli-paper").count()).toBe(0);
    expect(await page.locator(".cli-log").evaluate((e) => getComputedStyle(e).overflowY)).toBe("visible");
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);
    expect(await page.locator(".cli-log .home-cth-todo").count() + await page.locator(".cli-frame > .home-cth-todo").count()).toBe(2);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
