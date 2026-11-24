/**
 * 企业版首页驾驶舱，问过之后（10-31 改版 R1）：
 *   还没问（.cli-empty）：对话 2/3、右边四张卡照摆；
 *   问过之后：卡收起，对话铺满这一格，你的话贴着右边（右侧不再空一大片）；10-31 起对话套外框（.cli-frame），贴的是框里的右边；
 *   窄格（手机）问过之后卡也收起。
 *   HC-5（11-23，P-界面-60，用户选 C）：这一格（.cli-ck）宽 ≥1340 时问过之后卡不收，和问之前同一个 2:1；1339 及以下照旧收起。
 * 只钉样式（globals.css），结构照 HomeChat 现有的 class 摆。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); }, 120_000);
afterAll(async () => { await browser?.close(); });

const 页 = (空: boolean) => `<meta charset='utf-8'><main style="padding:24px">
  <div class="cli${空 ? " cli-empty" : ""}"><div class="cli-ck"><div class="cli-ck-g">
    <div class="cli-col cli-frame"><div class="cli-log">${空 ? "" : `<div class="cli-turn"><div class="cli-user"><div class="cli-bubble">本月新增几个项目</div></div><div class="cli-a">回答</div></div>`}</div>
      <div class="cli-composer"><div class="cli-input">输入</div></div></div>
    <div class="home-cards"><a class="home-card">卡</a><a class="home-card">卡</a><a class="home-card">卡</a><a class="home-card">卡</a></div>
  </div></div></div></main>`;

async function 打开(空: boolean, width: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: "reduce" }); page.setDefaultTimeout(5000);
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: 页(空) }));
  await page.goto("http://ent.test/dashboard");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  return page;
}
const 框 = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width }; });

it("还没问：对话 2/3，四张卡在右边", async () => {
  const page = await 打开(true, 1280);
  expect(await page.locator(".home-cards").isVisible()).toBe(true);
  const 格 = await 框(page, ".cli-ck-g"), 列 = await 框(page, ".cli-col"), 卡 = await 框(page, ".home-cards");
  expect(列.w).toBeLessThan(格.w * 0.7);
  expect(卡.l).toBeGreaterThan(列.r);
  await page.close();
});

it("问过之后（格宽 <1340）：卡收起，对话铺满，你的话贴右边", async () => {
  const page = await 打开(false, 1280);
  expect(await page.locator(".home-cards").isVisible()).toBe(false);
  // 全套并发跑时排版偶尔慢一拍（10-31 pre-push 量到差 8px）：等到量得稳再判
  await expect.poll(async () => Math.abs((await 框(page, ".cli-col")).w - (await 框(page, ".cli-ck-g")).w), { timeout: 3000 }).toBeLessThan(1);
  await expect.poll(async () => Math.abs((await 框(page, ".cli-bubble")).r - (await 框(page, ".cli-log")).r), { timeout: 3000 }).toBeLessThan(1);
  await page.close();
});

it("窄格（手机）问过之后卡也收起", async () => {
  const page = await 打开(false, 375);
  expect(await page.locator(".home-cards").isVisible()).toBe(false);
  await page.close();
  const 空页 = await 打开(true, 375);
  expect(await 空页.locator(".home-cards").isVisible()).toBe(true);
  await 空页.close();
});

// main 左右内边距各 24：格宽 = 视口 − 48
for (const 宽 of [1920, 2560, 1388]) {
  it(`HC-5（视口 ${宽}，格宽 ${宽 - 48}）问过之后：卡不收，和问之前同一个 2:1、同一个位置`, async () => {
    const 空页 = await 打开(true, 宽);
    const 前 = { 列: await 框(空页, ".cli-col"), 卡: await 框(空页, ".home-cards") };
    await 空页.close();
    const page = await 打开(false, 宽);
    expect(await page.locator(".home-cards").isVisible()).toBe(true);
    const 格 = await 框(page, ".cli-ck-g"), 列 = await 框(page, ".cli-col"), 卡 = await 框(page, ".home-cards");
    expect(Math.abs(列.w - (格.w - 24) * 2 / 3)).toBeLessThanOrEqual(1);
    expect(Math.abs(卡.l - 列.r - 24)).toBeLessThanOrEqual(1);
    for (const k of ["l", "r", "w"] as const) {
      expect(Math.abs(列[k] - 前.列[k])).toBeLessThanOrEqual(1);
      expect(Math.abs(卡[k] - 前.卡[k])).toBeLessThanOrEqual(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.close();
  });
}

it("HC-5 门槛：格宽 1339（视口 1387）问过之后卡照旧收起", async () => {
  const page = await 打开(false, 1387);
  expect(await page.locator(".home-cards").isVisible()).toBe(false);
  await expect.poll(async () => Math.abs((await 框(page, ".cli-col")).w - (await 框(page, ".cli-ck-g")).w), { timeout: 3000 }).toBeLessThan(1);
  await page.close();
});
