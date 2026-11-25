/**
 * 左栏空闲预热（components/AppShell.tsx，lib/nav-prewarm.ts，11-15 可配）：
 * 整页预取发的是不带 next-router-prefetch 头的 RSC 请求（视口自动预取带这个头），按这个分开数。
 * 只在生产构建里有预取，所以同 row-prefetch 只在 E2E_PROD=1 下跑。
 * 服务按 CRM_NAV_PREWARM 起：不设 / all → 照旧预热；none 或列表全无效 → 一个都不发；列表 → 只发列出的。手机宽度一律不发。
 */
import { test, expect, type Page } from "@playwright/test";
import { 读预热设置, 可预热页 } from "../src/lib/nav-prewarm";
import { 连库 } from "./mock-data";

test.skip(process.env.E2E_PROD !== "1", "next dev 不预取，只在生产构建里看得出来");

// 和服务端同一套解析（all / none / 列表规整、全无效 = 不预热）
const 设置 = 读预热设置(process.env.CRM_NAV_PREWARM, () => {});
const 列表 = 设置 === "全部" ? null : 设置.filter((k) => 可预热页.has(k));
const 不预热 = 列表 !== null && 列表.length === 0;

async function 登录(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("用户名").fill("zhangsan");
  await page.getByPlaceholder("登录密码").fill("admin123");
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await page.waitForURL(/\/dashboard/);
}

/** 打开一页、鼠标放页角（不算悬停），等空闲预热跑完，回整页预取过的路径 */
async function 数预热(page: Page, 去: string) {
  const 取过 = new Set<string>();
  const 听 = (r: import("@playwright/test").Request) => {
    const h = r.headers();
    if (h["rsc"] === "1" && !h["next-router-prefetch"]) 取过.add(new URL(r.url()).pathname);
  };
  await page.mouse.move(1, 1);
  page.on("request", 听);
  await page.goto(去);
  // requestIdleCallback 的 timeout 是 3 秒
  await page.waitForTimeout(5000);
  page.off("request", 听);
  return [...取过];
}

test("宽屏：按 CRM_NAV_PREWARM 预热左栏", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await 登录(page);
  const 取过 = await 数预热(page, "/follow-ups/plans");
  if (不预热) expect(取过, "设了 none 还在预热").toEqual([]);
  else if (列表) {
    expect(取过.length).toBeGreaterThan(0);
    expect(取过.filter((p) => !列表.includes(p)), "预热了名单外的页").toEqual([]);
  } else expect(取过.length, "默认应照旧预热左栏主组").toBeGreaterThanOrEqual(3);
});

test("手机宽度：不预热", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await 登录(page);
  expect(await 数预热(page, "/follow-ups/plans")).toEqual([]);
});

/** 不带 next-router-prefetch 的 GET RSC（整页预取、真点击都长这样）：按路径记第一次的时刻 */
function 记整页(page: Page) {
  const 首次 = new Map<string, number>();
  page.on("request", (r) => {
    const h = r.headers();
    if (r.method() !== "GET" || h["rsc"] !== "1" || h["next-router-prefetch"]) return;
    const p = new URL(r.url()).pathname;
    if (!首次.has(p)) 首次.set(p, Date.now());
  });
  return 首次;
}

test("宽屏：保存后停 2 秒再一页一页重热左栏（跳转优化 PR-B）", async ({ page }) => {
  test.skip(不预热, "设了 none 不预热");
  await page.setViewportSize({ width: 1440, height: 900 });
  await 登录(page);
  // 自己造一位：CI 按文件分片，这个文件落在哪一片、前面有没有用例造过客户都说不准
  const 名 = "预热重热·收藏用";
  const db = 连库();
  let id: string;
  try {
    await db.customer.deleteMany({ where: { name: 名 } });
    const 我 = await db.user.findUniqueOrThrow({ where: { email: "zhangsan" } });
    id = (await db.customer.create({ data: { name: 名, phone: "8613800007654", salesOwnerId: 我.id } })).id;
  } finally {
    await db.$disconnect();
  }
  await page.mouse.move(1, 1);
  await page.goto(`/customers/${id}`);
  // 等空闲预热跑完（requestIdleCallback 3 秒 + 每页隔 600ms）
  await page.waitForTimeout(7000);
  // 点之前先等水合：中栏真名单换上（骨架同 class、带 aria-busy，见 e2e/middle-pane.spec.ts）
  await expect(page.locator('aside.pane-roster:not([aria-busy="true"])')).toBeVisible();
  const 星 = page.locator(".rec-star").first();
  const 原 = await 星.getAttribute("aria-pressed");
  const 首次 = 记整页(page);
  const t0 = Date.now();
  await 星.click();
  await expect(星).toHaveAttribute("aria-pressed", 原 === "true" ? "false" : "true");
  await page.waitForTimeout(8000);
  const 重热 = [...首次].filter(([p]) => 可预热页.has(p) && (!列表 || 列表.includes(p))).sort((a, b) => a[1] - b[1]);
  // 收藏一下就是一次会刷新的保存：Next 清掉整个预取缓存，停 2 秒后重热
  expect(重热.length, "保存后没重热左栏").toBeGreaterThan(0);
  expect(重热[0][1] - t0, "保存后没停 2 秒就重热了").toBeGreaterThanOrEqual(1800);
  // 一页一页地发：相邻两页至少隔约 600ms（留 150ms 余量）
  for (let i = 1; i < 重热.length; i++) expect(重热[i][1] - 重热[i - 1][1], `${重热[i - 1][0]} → ${重热[i][0]} 挤在一起发了`).toBeGreaterThanOrEqual(450);
  // 收藏点回去、人删掉，不留给别的用例
  await 星.click();
  await expect(星).toHaveAttribute("aria-pressed", 原 ?? "false");
  const 收 = 连库();
  try {
    await 收.customer.deleteMany({ where: { name: 名 } });
  } finally {
    await 收.$disconnect();
  }
});

test("手机宽度：菜单一打开就取菜单里的页（跳转优化 PR-B）", async ({ page }) => {
  test.skip(不预热, "设了 none 不预热");
  await page.setViewportSize({ width: 390, height: 844 });
  await 登录(page);
  await page.mouse.move(1, 1);
  await page.goto("/follow-ups/plans");
  await page.waitForTimeout(4000);
  // 点之前先等水合：流式首屏的骨架全部离开（同 e2e/shell-pane.spec.ts）
  await expect(page.locator('aside.pane[aria-busy="true"]')).toHaveCount(0);
  const 首次 = 记整页(page);
  await page.getByRole("button", { name: "打开导航菜单" }).click();
  await page.waitForTimeout(3000);
  const 取过 = [...首次.keys()].filter((p) => 可预热页.has(p));
  expect(取过.length, "菜单打开了没取").toBeGreaterThan(0);
  if (列表) expect(取过.filter((p) => !列表.includes(p)), "取了名单外的页").toEqual([]);
});
