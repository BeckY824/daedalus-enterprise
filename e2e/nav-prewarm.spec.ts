/**
 * 左栏空闲预热（components/AppShell.tsx，lib/nav-prewarm.ts，11-15 可配）：
 * 整页预取发的是不带 next-router-prefetch 头的 RSC 请求（视口自动预取带这个头），按这个分开数。
 * 只在生产构建里有预取，所以同 row-prefetch 只在 E2E_PROD=1 下跑。
 * 服务按 CRM_NAV_PREWARM 起：不设 → 照旧预热；none → 一个都不发；列表 → 只发列出的。手机宽度一律不发。
 */
import { test, expect, type Page } from "@playwright/test";

test.skip(process.env.E2E_PROD !== "1", "next dev 不预取，只在生产构建里看得出来");

const 设置 = (process.env.CRM_NAV_PREWARM ?? "").trim();
const 不预热 = 设置 === "0" || 设置.toLowerCase() === "none";
const 列表 = 设置 && !不预热 ? 设置.split(",").map((s) => s.trim()).filter(Boolean) : null;

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
