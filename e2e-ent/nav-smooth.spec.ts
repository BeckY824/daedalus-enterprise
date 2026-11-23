import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "../src/generated/prisma";
import { ENT_DB, 账号, 读种子, type 种子 } from "./global-setup";

/**
 * 跳转优化 PR-A（11-24）：真 Next 里换一位客户、列表进详情不闪屏。
 * 用户原话：「不要闪屏，目前我在客户详情页从一个客户点到另一个客户，会有刷新。」
 * 修之前（3705 正式库副本实测）：点下去 30ms 旧内容就没了，接着 ~180ms 空白、~120ms 骨架，名单也整栏换成骨架再回来。
 * 现在：旧内容留到新内容提交那一帧，正文、中栏都不出骨架，名单那一栏不重挂；等得久了顶上出 2px 等待条。
 * 每帧（rAF）记一次；服务器回包人为压慢 600ms，让「中间那段」一定看得见。
 */
test.describe.configure({ mode: "serial", retries: 0 });

let 种: 种子;
let db: PrismaClient;
const 前缀 = `换人客户${Date.now().toString(36)}`;
const ids: string[] = [];

test.beforeAll(async () => {
  种 = 读种子();
  db = new PrismaClient({ datasources: { db: { url: `file:${ENT_DB}` } } });
  const 老板 = await db.user.findFirstOrThrow({ where: { email: 账号.老板 } });
  for (let i = 1; i <= 3; i++) {
    const c = await db.customer.create({ data: { name: `${前缀}-${i}`, phone: `139${String(Date.now() + i).slice(-8)}`, salesOwnerId: 老板.id, lastFollowAt: new Date(Date.now() + i * 1000) } });
    ids.push(c.id);
  }
});
test.afterAll(async () => {
  if (db) {
    await db.customer.deleteMany({ where: { name: { startsWith: 前缀 } } });
    await db.$disconnect();
  }
});

async function 登录(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("用户名").fill(账号.老板);
  await page.getByPlaceholder("登录密码").fill(种.密码);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await page.waitForURL(/\/dashboard/);
}

/** 软导航（RSC 请求带 rsc 头）一律晚 600ms 回 */
async function 压慢(page: Page) {
  await page.route("**/*", async (r) => {
    if (r.request().headers()["rsc"]) await new Promise((x) => setTimeout(x, 600));
    await r.continue();
  });
}

/** 开始每帧记：旧内容（打了 data-old 的）在不在、新的 h1 出没出、有没有骨架、等待条、名单那一栏是不是原来那个节点 */
const 开始记 = (page: Page, 旧选择器: string, 新名: string) => page.evaluate(([旧选择器, 新名]) => {
  document.querySelectorAll(旧选择器).forEach((e) => e.setAttribute("data-old", "1"));
  document.querySelector("aside.pane-roster")?.setAttribute("data-mark", "1");
  const w = window as unknown as { __帧: Record<string, boolean>[] };
  w.__帧 = [];
  const 一帧 = () => {
    const h = document.querySelector("main h1.rec-head-name");
    w.__帧.push({
      旧: !!document.querySelector("[data-old]"),
      新: !!h && !h.hasAttribute("data-old") && h.getAttribute("title") === 新名,
      骨架: !!document.querySelector("[data-testid=customer-skeleton], [data-testid=page-skeleton], .roster-skel"),
      条: !!document.querySelector("[data-testid=nav-progress]"),
      名单原样: !!document.querySelector("aside.pane-roster[data-mark]"),
      // 点的那一行立刻是选中的样子（链接里的 .nav-pend）
      行亮: !!document.querySelector(".roster-row:has(> .nav-pend)"),
    });
    if (!w.__帧.some((f) => f.新) || w.__帧.length < 5) requestAnimationFrame(一帧);
  };
  一帧();
}, [旧选择器, 新名] as const);
const 帧们 = (page: Page) => page.evaluate(() => (window as unknown as { __帧: Record<string, boolean>[] }).__帧);

test("换一位客户：旧内容留到新内容就绪，不出骨架，名单不重挂", async ({ page }) => {
  await 登录(page);
  await page.goto(`/customers/${ids[0]}`);
  await expect(page.getByRole("main").locator("h1.rec-head-name")).toHaveAttribute("title", `${前缀}-1`);
  const 行 = page.locator(`aside.pane-roster a.roster-row[href="/customers/${ids[1]}"]`);
  await 行.waitFor();
  await 压慢(page);
  await 开始记(page, "main h1.rec-head-name", `${前缀}-2`);
  await 行.click();
  await expect.poll(async () => (await 帧们(page)).some((f) => f.新), { timeout: 20_000 }).toBe(true);
  const 帧 = await 帧们(page);
  const 新 = 帧.findIndex((f) => f.新);
  expect(帧.slice(0, 新).every((f) => f.旧), "新内容出来之前旧内容一直在").toBe(true);
  expect(帧.filter((f) => f.骨架), "不出骨架（正文、名单都算）").toEqual([]);
  expect(帧.every((f) => f.名单原样), "名单那一栏还是原来那个节点").toBe(true);
  expect(帧.some((f) => f.条), "等了 600ms，顶上该出等待条").toBe(true);
  // 点下去那一帧（记录从点之前就开始，前几帧还没点）起，点的那一行一直亮到新内容出来
  const 亮起 = 帧.findIndex((f) => f.行亮);
  expect(亮起, "点的那一行该立刻高亮").toBeGreaterThan(-1);
  expect(帧.slice(亮起, 新).every((f) => f.行亮)).toBe(true);
  await expect(page.locator("[data-testid=nav-progress]")).toHaveCount(0);
});

test("列表进详情：表格留到详情就绪，不出正文骨架", async ({ page }) => {
  await 登录(page);
  await page.goto(`/customers?keyword=${encodeURIComponent(前缀)}`);
  const 名 = page.getByRole("main").getByRole("link", { name: `${前缀}-3`, exact: true });
  await 名.waitFor();
  await 压慢(page);
  await 开始记(page, "main .ant-table", `${前缀}-3`);
  await 名.click();
  await expect.poll(async () => (await 帧们(page)).some((f) => f.新), { timeout: 20_000 }).toBe(true);
  const 帧 = await 帧们(page);
  const 新 = 帧.findIndex((f) => f.新);
  expect(帧.slice(0, 新).every((f) => f.旧), "详情出来之前表格一直在").toBe(true);
  // 名单是详情提交以后才在中栏里晚到的（自带 Suspense，不挡切页），那时出名单骨架是对的；这里只管提交之前
  expect(帧.slice(0, 新).filter((f) => f.骨架), "提交之前不出骨架").toEqual([]);
});
