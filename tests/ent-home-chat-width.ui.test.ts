/**
 * 企业版首页驾驶舱，问过之后（10-31 改版 R1）：
 *   还没问（.cli-empty）：对话 2/3、右边四张卡照摆；
 *   问过之后：卡收起，对话铺满这一格，你的话贴着右边（右侧不再空一大片）；
 *   窄格（手机）问过之后卡也收起。
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
    <div class="cli-col"><div class="cli-log">${空 ? "" : `<div class="cli-turn"><div class="cli-user"><div class="cli-bubble">本月新增几个项目</div></div><div class="cli-a">回答</div></div>`}</div>
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

it("问过之后：卡收起，对话铺满，你的话贴右边", async () => {
  const page = await 打开(false, 1280);
  expect(await page.locator(".home-cards").isVisible()).toBe(false);
  const 格 = await 框(page, ".cli-ck-g"), 列 = await 框(page, ".cli-col"), 泡 = await 框(page, ".cli-bubble");
  expect(Math.abs(列.w - 格.w)).toBeLessThan(1);
  expect(Math.abs(泡.r - 列.r)).toBeLessThan(1);
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
