/**
 * 公海轻量（2026-10-03，0.46.15 第 6 块）：张三把自己的客户放进公海 → 李四在「公海」里看到「公海（原 张三）」→
 * 领取，负责人变成李四 → 撤销，又回到公海 → 记录页上也有那枚标签和「领取」。
 * 2026-10-13 起公海和客户分两页签：默认「客户」页签不含公海，「公海」页签（?pool=1）只有公海；负责人下拉里不再有「公海」。
 * 2026-10-29（P7 统一公海）：企业版项目模式下公海挪去 /pool 一页看，客户页不再摆页签，?pool=1 转去 /pool；
 * 公海页上没有撤销，原负责人领不回。
 * 种子库本来就有三个人（多人），公海的入口才出现。造的客户结束时删掉。
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { 连库 } from "./mock-data";

const 张三 = { 用户名: "zhangsan", 密码: "admin123" };
const 李四 = { 用户名: "lisi", 密码: "admin123" };
const 客户名 = "公海测试客户";
/** multiuser 的 E 组会停用李四且不恢复（duplicate.spec 里也记着）：这里先启用，结束时还原成原样，不改别人的前提 */
let 原在职: { email: string; active: boolean }[] = [];

async function 登录(page: Page, who: { 用户名: string; 密码: string }) {
  for (let i = 0; i < 3; i++) {
    await page.goto("/login");
    await page.getByPlaceholder("用户名").fill(who.用户名);
    await page.getByPlaceholder("登录密码").fill(who.密码);
    await page.getByRole("button", { name: /登\s*录/ }).click();
    try {
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
      return;
    } catch {
      /* dev 模式下第一次点击可能落空，再试 */
    }
  }
  throw new Error("登录失败");
}

async function 一个人(browser: Browser, who: { 用户名: string; 密码: string }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await 登录(page, who);
  return { ctx, page };
}

test.beforeAll(async () => {
  const db = 连库();
  try {
    await db.customer.deleteMany({ where: { name: 客户名 } });
    原在职 = await db.user.findMany({ where: { email: { in: ["zhangsan", "lisi"] } }, select: { email: true, active: true } });
    await db.user.updateMany({ where: { email: { in: ["zhangsan", "lisi"] } }, data: { active: true } });
    const 张 = await db.user.findUniqueOrThrow({ where: { email: "zhangsan" } });
    await db.customer.create({ data: { name: 客户名, phone: "13755550061", salesOwnerId: 张.id } });
  } finally {
    await db.$disconnect();
  }
});

test.afterAll(async () => {
  const db = 连库();
  await db.customer.deleteMany({ where: { name: 客户名 } });
  for (const u of 原在职) await db.user.update({ where: { email: u.email }, data: { active: u.active } });
  await db.$disconnect();
});

test("放进公海 → 别人在 /pool 里领走；原负责人领不回；记录页有标签和领取", async ({ browser }) => {
  const 张 = await 一个人(browser, 张三);
  // 张三：搜到这一位，勾上，批量「放进公海」
  await 张.page.goto(`/customers?keyword=${encodeURIComponent(客户名)}`);
  const 行 = 张.page.getByRole("row", { name: new RegExp(客户名) });
  await expect(行).toBeVisible();
  await 行.getByRole("checkbox").check();
  await 张.page.getByRole("button", { name: "放回公海" }).click();
  // 放回前确认一次（交互规则 B）
  await 张.page.getByRole("dialog").getByRole("button", { name: "放回公海" }).click();
  await expect(张.page.getByText("已放回公海 1 位")).toBeVisible();
  // 客户页不含公海：放进去就从这一页走了；搜不到时指一条去公海的路，关键词带上
  await expect(行).toHaveCount(0);
  await expect(张.page.locator(".page-head .ant-segmented")).toHaveCount(0);
  await 张.page.getByRole("button", { name: /公海里有 1 位匹配/ }).click();
  await expect(张.page).toHaveURL(/\/pool\?keyword=/);
  const 张的公海行 = 张.page.getByRole("row", { name: new RegExp(客户名) });
  await expect(张的公海行.getByText("公海客户")).toBeVisible();
  // 原负责人领不回
  await expect(张的公海行.getByRole("button", { name: `领取 ${客户名}` })).toBeDisabled();
  // 老链接 ?pool=1 转去 /pool
  await 张.page.goto(`/customers?pool=1&keyword=${encodeURIComponent(客户名)}`);
  await expect(张.page).toHaveURL(/\/pool\?keyword=/);
  await 张.ctx.close();

  const 李 = await 一个人(browser, 李四);
  const page = 李.page;
  // 李四：客户页里没有它，公海页里有
  await page.goto(`/customers?keyword=${encodeURIComponent(客户名)}`);
  await page.waitForSelector(".list");
  await expect(page.getByRole("row", { name: new RegExp(客户名) })).toHaveCount(0);
  await page.goto(`/pool?keyword=${encodeURIComponent(客户名)}`);
  const 公海行 = page.getByRole("row", { name: new RegExp(客户名) });
  await 公海行.getByRole("button", { name: `领取 ${客户名}` }).click();
  await expect(page.getByText(`已领取「${客户名}」`)).toBeVisible();
  // 领走了：公海里没有它了
  await expect(page.getByRole("row", { name: new RegExp(客户名) })).toHaveCount(0);
  const db = 连库();
  try {
    const c = await db.customer.findFirstOrThrow({ where: { name: 客户名 }, include: { salesOwner: true, pool: true } });
    expect(c.salesOwner.name).toBe("李四");
    expect(c.pool).toBeNull();

    // 记录页：再放回公海（原负责人张三），标签 + 领取
    const 张号 = await db.user.findUniqueOrThrow({ where: { email: "zhangsan" } });
    await db.customer.update({ where: { id: c.id }, data: { salesOwnerId: 张号.id } });
    await db.customerPool.create({ data: { customerId: c.id, reason: "手动" } });
    await page.goto(`/customers/${c.id}`);
    await expect(page.locator(".rec-pool:visible").getByText("公海（原 张三）")).toBeVisible();
    await page.locator(".rec-pool:visible").getByRole("button", { name: /领取/ }).click();
    await expect(page.getByText("已领取，负责人改成你")).toBeVisible();
    await expect(page.locator(".rec-pool:visible")).toHaveCount(0);
  } finally {
    await db.$disconnect();
    await 李.ctx.close();
  }
});

/*
  T-046：公海里的长名字不许压到隔壁列。2026-10-29 起公海在 /pool：客户名太长时那一格省略，
  全名留在 title 里，右边不超出「客户名称」那一格（1024 宽，Windows 最窄的那档）
*/
test("客户名很长：/pool 里客户名那一格省略，不压到「项目名称」上", async ({ browser }) => {
  const db = 连库();
  const 名 = "公海长名客户欧阳长长长长长长长长长长长长长长长长长长长长长长长长长长名字";
  await db.customer.deleteMany({ where: { name: 名 } });
  await db.user.deleteMany({ where: { email: "pool-long-name" } });
  const 同事 = await db.user.create({ data: { email: "pool-long-name", name: "欧阳长长长长长长长长长长名字的同事", password: "x", role: "SALES", title: "销售", active: false } });
  const c = await db.customer.create({ data: { name: 名, phone: "13755550062", salesOwnerId: 同事.id } });
  await db.customerPool.create({ data: { customerId: c.id, reason: "手动" } });
  const 张 = await 一个人(browser, 张三);
  try {
    await 张.page.setViewportSize({ width: 1024, height: 768 });
    await 张.page.goto(`/pool?keyword=${encodeURIComponent(名)}`);
    const 行 = 张.page.getByRole("row", { name: new RegExp(名) });
    const 链 = 行.getByRole("link", { name: 名 });
    await expect(链).toBeVisible();
    await expect(链).toHaveAttribute("title", 名);
    const 格 = 链.locator("xpath=ancestor::td[1]");
    const 下一格 = 格.locator("xpath=following-sibling::td[1]");
    const [t, g, n] = await Promise.all([链.boundingBox(), 格.boundingBox(), 下一格.boundingBox()]);
    expect(t && g && n, "拿不到位置").toBeTruthy();
    expect(t!.x + t!.width, `客户名右边 ${t!.x + t!.width} 超出了那一格（右边 ${g!.x + g!.width}）`).toBeLessThanOrEqual(g!.x + g!.width + 0.5);
    expect(t!.x + t!.width, "客户名压到了下一列").toBeLessThanOrEqual(n!.x + 0.5);
  } finally {
    await 张.ctx.close();
    await db.customer.deleteMany({ where: { name: 名 } });
    await db.user.deleteMany({ where: { email: "pool-long-name" } });
    await db.$disconnect();
  }
});
