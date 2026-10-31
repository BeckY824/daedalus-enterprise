/**
 * 企业版首页驾驶舱左边的外框（10-31 首页改版，用户原话：「左侧整体加一个外框，右侧四个指标框保持不动」）：
 *   还没问：框在左、四张卡在右；框里左上「下午好，XXX。」→「欢迎使用 {产品名}」→ 三条示例各占一行 → 框底是输入框，宽≈框宽减左右留白；
 *   问过之后：卡收起，框铺满这一格（主内容区），框里上面是对话、底下是输入框；
 *   手机宽：框在上、卡在下，框里顺序不变。
 * 按 Windows 常见宽度 1024 / 1280 / 1366 量，页面不横向溢出。
 *
 * 用真的 Welcome（带示例槽）、ComposerFoot（示例画进槽里）、HomeCards，外面的结构照 HomeChat 驾驶舱那一支摆
 * （HomeChat / Composer 连着对话流、路由、背调，单拎出来画不了，槽怎么接照 HomeChat 写）。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-home-frame", setup(b) {
  b.onResolve({ filter: /^next\/link$/ }, a => ({ path: a.path, namespace: "stub", pluginData: "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React, { useState } from 'react';import {createRoot} from 'react-dom/client';
    import Welcome from '@/app/(app)/dashboard/Welcome';
    import { ComposerFoot } from '@/app/(app)/dashboard/ComposerParts';
    import HomeCards from '@/app/(app)/dashboard/HomeCards';
    const 示例们 = [
      { label: "今天该跟谁", question: "今天该跟谁", kind: "fill" },
      { label: "帮我记一条：…", question: "帮我记一条：", kind: "fill" },
      { label: "哪些项目 3 天内回公海", question: "我手上哪些项目 3 天内回公海", kind: "fill" },
    ];
    const 卡数 = { "month-new": 1, key: 2, "no-follow": 3, "due-soon": 4 };
    function 首页({ 问过 }) {
      const [槽, set槽] = useState(null);
      const [q, setQ] = useState("");
      return (
        <div className={"cli" + (问过 ? "" : " cli-empty")}><div className="cli-ck"><div className="cli-ck-g">
          <div className="cli-col cli-frame">
            {问过
              ? <div className="cli-log"><div className="cli-turn"><div className="cli-user"><div className="cli-bubble">本月新增几个项目</div></div><div className="cli-a">回答</div></div></div>
              : <Welcome userName="测试员" context="" 欢迎="欢迎使用 测试产品" 示例槽={set槽} />}
            <div className={"cli-composer" + (问过 ? " cli-composer-sticky" : "")}>
              <div className="cli-input cli-input-rich"><textarea value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <ComposerFoot 摆建议={!问过} 示例槽={槽} suggestions={示例们} suggIdx={-1} 空={!问过} 在跑={false} 背调模式={false} 背调价={null} AI已用完={false} on问={(x) => setQ(x.question)} />
            </div>
          </div>
          <HomeCards 数={卡数} />
        </div></div></div>
      );
    }
    window.__画 = (问过) => createRoot(document.getElementById('root')).render(<首页 问过={问过} />);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, plugins: [plugin], logLevel: "silent" });
  // 有几个模块读 process.env 的别的键（不是 NODE_ENV）：浏览器里给一个空的
  bundle = "window.process = { env: {} };\n" + r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(问过: boolean, width: number): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: "reduce" }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><main style='padding:24px'><div id='root'></div></main>" }));
  await page.goto("http://ent.test/dashboard");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  if (errors.length) throw new Error(errors.join("\n"));
  await page.evaluate((x) => (window as unknown as { __画: (o: boolean) => void }).__画(x), 问过);
  await page.locator(".cli-frame .cli-input").waitFor();
  if (!问过) await page.locator(".cli-frame-q .cli-q").first().waitFor();
  return { page, errors };
}
type 盒 = { l: number; r: number; t: number; b: number; w: number };
const 框 = (page: Page, sel: string): Promise<盒> => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; });
/** 字本身的位置（看 text-align，不看块的宽） */
const 字 = (page: Page, sel: string): Promise<盒> => page.locator(sel).first().evaluate((e) => { const g = document.createRange(); g.selectNodeContents(e); const r = g.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; });
const 不溢出 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const width of [1024, 1280, 1366]) {
  it(`还没问（${width}）：框在左、卡在右；问候左上，欢迎语、三条示例各一行，输入框在框底、宽≈框宽`, async () => {
    const { page, errors } = await 打开(false, width);
    const 外 = await 框(page, ".cli-frame"), 卡 = await 框(page, ".home-cards");
    expect(await page.locator(".cli-frame").evaluate((e) => parseFloat(getComputedStyle(e).borderTopWidth))).toBeGreaterThanOrEqual(1);
    expect(await page.locator(".home-cards").isVisible()).toBe(true);
    expect(卡.l).toBeGreaterThan(外.r);
    expect(外.w).toBeLessThan((卡.r - 外.l) * 0.75);
    // 等高对齐（U-首页-01）：框和右边四张卡这一列上下边齐
    expect(Math.abs(卡.t - 外.t)).toBeLessThan(2);
    expect(Math.abs(卡.b - 外.b)).toBeLessThan(2);

    // 第一行在左上角
    const 问候 = await 字(page, ".cli-frame .cli-welcome-t");
    expect(await page.locator(".cli-frame .cli-welcome-t").innerText()).toMatch(/^.+，测试员。$/);
    expect(问候.l - 外.l).toBeGreaterThan(8);
    expect(问候.l - 外.l).toBeLessThan(40);
    expect(问候.t - 外.t).toBeLessThan(48);
    // 第二行：欢迎使用 {产品名}，左对齐
    const 欢迎 = await 字(page, ".cli-frame .cli-welcome-brand");
    expect(await page.locator(".cli-frame .cli-welcome-brand").innerText()).toBe("欢迎使用 测试产品");
    expect(欢迎.t).toBeGreaterThanOrEqual(问候.b - 1);
    expect(Math.abs(欢迎.l - 问候.l)).toBeLessThan(4);
    // 三、四、五行：示例各占一行，在欢迎语下面；输入框底下不再摆一排
    const 示例 = page.locator(".cli-frame .cli-welcome .cli-frame-q .cli-q");
    await expect.poll(() => 示例.count()).toBe(3);
    expect(await page.locator(".cli-composer .cli-q").count()).toBe(0);
    const 行 = await 示例.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, b: r.bottom }; }));
    expect(行[0].t).toBeGreaterThanOrEqual(欢迎.b);
    for (let i = 1; i < 3; i++) {
      expect(行[i].t).toBeGreaterThanOrEqual(行[i - 1].b);
      expect(Math.abs(行[i].l - 行[0].l)).toBeLessThan(1);
    }
    expect(Math.abs(行[0].l - 问候.l)).toBeLessThan(4);
    // 输入框在框里、贴框底，宽 = 框宽减左右留白
    const 入 = await 框(page, ".cli-frame .cli-input");
    expect(入.t).toBeGreaterThan(行[2].b);
    expect(入.l).toBeGreaterThan(外.l);
    expect(入.r).toBeLessThan(外.r);
    expect(外.w - 入.w).toBeLessThanOrEqual(64);
    expect(Math.abs((入.l - 外.l) - (外.r - 入.r))).toBeLessThan(1);
    expect(外.b - 入.b).toBeLessThan(90);
    expect(外.b - 入.b).toBeGreaterThan(0);
    expect(await 不溢出(page)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });

  it(`问过之后（${width}）：卡收起，框铺满主内容区，对话在上、输入框在框底`, async () => {
    const { page, errors } = await 打开(true, width);
    expect(await page.locator(".home-cards").isVisible()).toBe(false);
    expect(await page.locator(".cli-frame .cli-welcome").count()).toBe(0);
    const 主 = await page.locator("main").evaluate((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight); });
    await expect.poll(async () => Math.abs((await 框(page, ".cli-frame")).w - 主), { timeout: 3000 }).toBeLessThan(1);
    const 外 = await 框(page, ".cli-frame"), 话 = await 框(page, ".cli-frame .cli-log"), 入 = await 框(page, ".cli-frame .cli-input");
    expect(await page.locator(".cli-frame").evaluate((e) => parseFloat(getComputedStyle(e).borderTopWidth))).toBeGreaterThanOrEqual(1);
    expect(话.b).toBeLessThanOrEqual(入.t);
    expect(入.l).toBeGreaterThan(外.l);
    expect(入.r).toBeLessThan(外.r);
    expect(外.w - 入.w).toBeLessThanOrEqual(64);
    expect(外.b - 入.b).toBeLessThan(90);
    // 你的话贴着框里右边
    expect(Math.abs((await 框(page, ".cli-bubble")).r - 话.r)).toBeLessThan(1);
    expect(await 不溢出(page)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });
}

it("点示例只填进输入框，不发", async () => {
  const { page, errors } = await 打开(false, 1280);
  await page.locator(".cli-frame-q .cli-q").nth(2).click();
  expect(await page.locator(".cli-input textarea").inputValue()).toBe("我手上哪些项目 3 天内回公海");
  // 还在欢迎屏（没发出去，卡也还在）
  expect(await page.locator(".cli-frame .cli-welcome").count()).toBe(1);
  expect(await page.locator(".home-cards").isVisible()).toBe(true);
  expect(errors).toEqual([]);
  await page.close();
});

it("手机宽：框在上、卡在下，框里问候 → 欢迎语 → 示例 → 输入框；问过之后卡收起", async () => {
  const { page, errors } = await 打开(false, 375);
  const 外 = await 框(page, ".cli-frame"), 卡 = await 框(page, ".home-cards");
  expect(await page.locator(".home-cards").isVisible()).toBe(true);
  expect(卡.t).toBeGreaterThan(外.b);
  const 问候 = await 框(page, ".cli-welcome-t"), 欢迎 = await 框(page, ".cli-welcome-brand"), 示例 = await 框(page, ".cli-frame-q"), 入 = await 框(page, ".cli-frame .cli-input");
  expect(问候.b).toBeLessThanOrEqual(欢迎.t + 1);
  expect(欢迎.b).toBeLessThanOrEqual(示例.t + 1);
  expect(示例.b).toBeLessThanOrEqual(入.t);
  expect(入.r).toBeLessThan(外.r);
  expect(await 不溢出(page)).toBe(true);
  expect(errors).toEqual([]);
  await page.close();
  const 问过 = await 打开(true, 375);
  expect(await 问过.page.locator(".home-cards").isVisible()).toBe(false);
  expect(await 不溢出(问过.page)).toBe(true);
  expect(问过.errors).toEqual([]);
  await 问过.page.close();
});
