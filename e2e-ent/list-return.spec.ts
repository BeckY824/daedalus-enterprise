import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "../src/generated/prisma";
import { ENT_DB, 账号, 读种子, type 种子 } from "./global-setup";

/**
 * 列表记住位置 + 详情页「回到列表」（员工反馈 1A，components/ListReturn.tsx、lib/list-return.ts）。
 * 员工从客户列表 / 公海 / 项目看板点进详情再回来，筛选、排序、页码、滚动位置都没了：
 *   - 详情页页头上面一行「← 回到客户列表（第 N 页）」，回的是进来前的原地址，滚回原来的位置
 *   - 浏览器后退一样滚回去；从详情页点左栏「客户」「公海」也回记住的那一屏；在列表上点左栏照旧回第 1 页
 *   - Windows 常见的 1024 / 1280 / 1366 宽，超长公司名：那一行不撑横滚、点得到它自己
 * 人用老板（看得到全部）；客户、公海客户、项目在这份里现造（和别的几份共库、串行，名字带后缀互不干扰）。
 */
test.describe.configure({ mode: "serial", retries: 0 });

let 种: 种子;
let db: PrismaClient;
const 后缀 = Date.now().toString(36);
const 客户前缀 = `回列表客户${后缀}`;
const 公海前缀 = `回列表公海${后缀}`;
const 长名 = `${客户前缀}华东超长名字展览展示器材制造与进出口贸易集团股份有限公司上海分公司第二事业部国际业务中心`;
let 长名客户 = "";

test.beforeAll(async () => {
  种 = 读种子();
  db = new PrismaClient({ datasources: { db: { url: `file:${ENT_DB}` } } });
  const 销售甲 = await db.user.findFirstOrThrow({ where: { email: 账号.销售1 } });
  const 号 = (i: number, 段: number) => `13${段}${String((Date.now() + i) % 100000000).padStart(8, "0")}`.slice(0, 11);
  for (let i = 1; i <= 45; i++) {
    const c = await db.customer.create({ data: { name: `${客户前缀}-${String(i).padStart(2, "0")}`, phone: 号(i, 5), salesOwnerId: 销售甲.id } });
    // 前三位带项目：看板上有卡
    if (i <= 3) await db.project.create({ data: { name: `回列表项目${后缀}-${i}`, customerId: c.id, ownerId: 销售甲.id, creatorId: 销售甲.id, bizLine: "内贸" } });
  }
  长名客户 = (await db.customer.create({ data: { name: 长名, phone: 号(99, 5), salesOwnerId: 销售甲.id } })).id;
  for (let i = 1; i <= 25; i++) {
    const c = await db.customer.create({ data: { name: `${公海前缀}-${String(i).padStart(2, "0")}`, phone: 号(100 + i, 7), salesOwnerId: 销售甲.id } });
    await db.customerPool.create({ data: { customerId: c.id, userId: 销售甲.id } });
  }
});
test.afterAll(async () => {
  await db?.$disconnect();
});

async function 登录(page: Page, 谁: keyof typeof 账号) {
  await page.goto("/login");
  await page.getByPlaceholder("用户名").fill(账号[谁]);
  await page.getByPlaceholder("登录密码").fill(种.密码);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await page.waitForURL(/\/dashboard/);
}

const 当前地址 = (page: Page) => page.evaluate(() => location.pathname + location.search);
const 滚到 = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

/** 滚到 y，挑一条整行都在屏幕里、靠下的详情链接（点它不会再把页面滚动），返回它的名字和这时的位置 */
async function 滚下去挑一行(page: Page, y: number, 前缀: string) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(400); // 记滚动是隔 150ms 写一次
  const 名 = await page.evaluate((前缀) => {
    const 行 = [...document.querySelectorAll<HTMLAnchorElement>('main a[href^="/customers/"]')].filter((a) => (a.textContent ?? "").startsWith(前缀));
    const 看得见 = 行.filter((a) => {
      const r = a.getBoundingClientRect();
      return r.top > 160 && r.bottom < window.innerHeight - 80 && r.width > 0;
    });
    return (看得见[Math.floor(看得见.length / 2)] ?? 看得见[0])?.textContent ?? null;
  }, 前缀);
  expect(名, "滚下去之后屏幕里要有一行").toBeTruthy();
  return { 名: 名!, y: await 滚到(page) };
}

async function 筛选框里有(page: Page, 词: string) {
  await expect.poll(() => page.evaluate((词) => [...document.querySelectorAll("main input")].some((i) => (i as HTMLInputElement).value === 词), 词)).toBe(true);
}

test("客户列表：筛选 + 排序 + 第 2 页，滚下去点进详情 →「回到客户列表（第 2 页）」回原地址、滚回原位；后退、左栏同样回来", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await 登录(page, "老板");
  const 列表 = `/customers?${new URLSearchParams({ pageSize: "20", keyword: 客户前缀, sort: "created-asc", page: "2" })}`;
  await page.goto(列表);
  await expect(page.getByRole("main").getByRole("link", { name: `${客户前缀}-21`, exact: true })).toBeVisible();
  const 原地址 = await 当前地址(page);
  expect(原地址).toContain("page=2");

  // 1. 页头「回到列表」
  const 挑 = await 滚下去挑一行(page, 420, 客户前缀);
  expect(挑.y).toBeGreaterThan(200);
  await page.getByRole("main").getByRole("link", { name: 挑.名, exact: true }).click();
  await page.waitForURL(/\/customers\/[^/?]+/);
  const 回 = page.getByTestId("back-to-list");
  await expect(回).toHaveText("回到客户列表（第 2 页）");
  expect(await 回.getAttribute("href")).toBe(原地址);
  await 回.click();
  await page.waitForURL((u) => u.pathname + u.search === 原地址);
  await 筛选框里有(page, 客户前缀);
  await expect(page.locator("main .ant-pagination-item-active")).toHaveText("2");
  await expect.poll(() => 滚到(page), { timeout: 5000 }).toBeGreaterThan(挑.y - 30);
  expect(Math.abs((await 滚到(page)) - 挑.y)).toBeLessThanOrEqual(30);

  // 2. 浏览器后退
  const 再挑 = await 滚下去挑一行(page, 300, 客户前缀);
  await page.getByRole("main").getByRole("link", { name: 再挑.名, exact: true }).click();
  await page.waitForURL(/\/customers\/[^/?]+/);
  await page.goBack();
  await page.waitForURL((u) => u.pathname + u.search === 原地址);
  await expect(page.locator("main .ant-pagination-item-active")).toHaveText("2");
  await expect.poll(() => 滚到(page), { timeout: 5000 }).toBeGreaterThan(再挑.y - 30);

  // 3. 从详情页点左栏「客户」：回记住的那一屏
  await page.getByRole("main").getByRole("link", { name: 再挑.名, exact: true }).click();
  await page.waitForURL(/\/customers\/[^/?]+/);
  const 左栏客户 = page.locator("a.rail-item", { hasText: "客户" }).first();
  await expect(左栏客户).toHaveAttribute("href", 原地址);
  await 左栏客户.click();
  await page.waitForURL((u) => u.pathname + u.search === 原地址);
  await 筛选框里有(page, 客户前缀);

  // 4. 已经在列表上点左栏「客户」：照旧回第 1 页、清筛选
  await expect(左栏客户).toHaveAttribute("href", "/customers");
});

test("公海：筛选 + 第 2 页点进客户 →「回到公海（第 2 页）」回原地址；没记过的详情页回客户列表第 1 页", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await 登录(page, "老板");
  // 没记过（新标签页直接打开详情）：回客户列表第 1 页
  await page.goto(`/customers/${长名客户}`);
  await expect(page.getByTestId("back-to-list")).toHaveText("回到客户列表");
  expect(await page.getByTestId("back-to-list").getAttribute("href")).toBe("/customers");

  const 列表 = `/pool?${new URLSearchParams({ pageSize: "10", keyword: 公海前缀, page: "2" })}`;
  await page.goto(列表);
  const 行 = page.getByRole("main").getByRole("link", { name: `${公海前缀}-`, exact: false }).first();
  await expect(行).toBeVisible();
  const 原地址 = await 当前地址(page);
  const 名 = (await 行.textContent())!;
  await 行.click();
  await page.waitForURL(/\/customers\/[^/?]+/);
  const 回 = page.getByTestId("back-to-list");
  await expect(回).toHaveText("回到公海（第 2 页）");
  // 左栏「公海」也回这一屏
  await expect(page.locator("a.rail-item", { hasText: "公海" }).first()).toHaveAttribute("href", 原地址);
  await 回.click();
  await page.waitForURL((u) => u.pathname + u.search === 原地址);
  await 筛选框里有(page, 公海前缀);
  await expect(page.locator("main .ant-pagination-item-active")).toHaveText("2");
  await expect(page.getByRole("main").getByRole("link", { name: 名, exact: true })).toBeVisible();
});

test("项目看板：筛着点开一张卡 →「回到客户列表」回看板、筛选还在", async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await 登录(page, "老板");
  await context.addCookies([{ name: "customers-view", value: "board", url: page.url() }]);
  const 列表 = `/customers?${new URLSearchParams({ keyword: 客户前缀 })}`;
  await page.goto(列表);
  const 卡 = page.getByRole("link", { name: new RegExp(`回列表项目${后缀}-1`) }).first();
  await expect(卡).toBeVisible();
  const 原地址 = await 当前地址(page);
  await 卡.click();
  await page.waitForURL(/\/customers\/[^/?]+/);
  const 回 = page.getByTestId("back-to-list");
  await expect(回).toHaveText("回到客户列表");
  await 回.click();
  await page.waitForURL((u) => u.pathname + u.search === 原地址);
  await 筛选框里有(page, 客户前缀);
  await expect(page.getByRole("link", { name: new RegExp(`回列表项目${后缀}-1`) }).first()).toBeVisible();
});

for (const 宽 of [1024, 1280, 1366]) {
  test(`排版 ${宽}：超长公司名的详情页，「回到列表」不撑横滚、点得到它自己；列表页也不横滚`, async ({ page }) => {
    await page.setViewportSize({ width: 宽, height: 768 });
    await 登录(page, "老板");
    await page.goto(`/customers?${new URLSearchParams({ keyword: 长名, page: "1" })}`);
    await expect(page.getByRole("main").getByRole("link", { name: 长名 }).first()).toBeVisible();
    const 列表横滚 = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
    expect(列表横滚, "列表页不横滚").toBeLessThanOrEqual(0);
    await page.getByRole("main").getByRole("link", { name: 长名 }).first().click();
    await page.waitForURL(/\/customers\/[^/?]+/);
    const 回 = page.getByTestId("back-to-list");
    await expect(回).toBeVisible();
    const 量 = await page.evaluate(() => {
      const a = document.querySelector<HTMLElement>('[data-testid="back-to-list"]')!;
      const r = a.getBoundingClientRect();
      const 中 = document.elementFromPoint(r.left + Math.min(r.width / 2, 40), r.top + r.height / 2);
      const 名 = document.querySelector<HTMLElement>(".rec-head-name")!;
      const 名框 = 名.getBoundingClientRect();
      const 中名 = document.elementFromPoint(名框.left + 10, 名框.top + 名框.height / 2);
      return {
        页横滚: document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
        链接在屏内: r.left >= 0 && r.right <= window.innerWidth && r.height > 0,
        点得到: !!中 && a.contains(中),
        链接溢出: a.scrollWidth - a.clientWidth,
        名点得到: !!中名 && 名.contains(中名),
        名右边: Math.round(名框.right),
        main右边: Math.round(document.querySelector("main")!.getBoundingClientRect().right),
        行高: Math.round(r.height),
      };
    });
    console.log(`[排版 ${宽}]`, JSON.stringify(量));
    expect(量.页横滚, "详情页不横滚").toBeLessThanOrEqual(0);
    expect(量.链接在屏内).toBe(true);
    expect(量.点得到, "「回到列表」点得到它自己").toBe(true);
    expect(量.链接溢出, "「回到列表」自己不溢出").toBeLessThanOrEqual(0);
    expect(量.名点得到, "超长名字那一格点得到它自己").toBe(true);
    expect(量.名右边).toBeLessThanOrEqual(量.main右边);
    await page.screenshot({ path: `test-results/list-return-${宽}.png` });
  });
}
