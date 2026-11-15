import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "../src/generated/prisma";
import { ENT_DB, 账号, 读种子, type 种子 } from "./global-setup";

/**
 * 有项目时在客户档案里记沟通（11-15 PR11b）。
 *
 * 「沟通记录」主页 /follow-ups 删了：企业版原来从那页带着客户（?customer=…&new=1）记一笔，主套里 smoke 第 5 条、
 * remediation-followup、double-save、window-sizes 的企业版分支都走那条路，现在 test.skip(企业版)。
 * 这里补回这块覆盖：客户有在推的项目时，客户详情沟通记录卡头「新建沟通」开「记一条沟通」框，
 * 关联项目默认选上，记完不跳页，这条出现在沟通记录里、刷新还在，库里挂在这个项目上。
 * 人用种子里的销售甲；客户、项目在这份里现造（和别的两份共库、串行，互不依赖）。
 */
test.describe.configure({ mode: "serial", retries: 0 });

let 种: 种子;
let db: PrismaClient;
const 后缀 = Date.now().toString(36);
let 客户: string;
let 项目: string;

test.beforeAll(async () => {
  种 = 读种子();
  db = new PrismaClient({ datasources: { db: { url: `file:${ENT_DB}` } } });
  const 销售甲 = await db.user.findFirstOrThrow({ where: { email: 账号.销售1 } });
  客户 = (await db.customer.create({ data: { name: `记沟通客户${后缀}`, phone: `136${String(Date.now() % 100000000).padStart(8, "0")}`, salesOwnerId: 销售甲.id } })).id;
  项目 = (await db.project.create({ data: { name: `记沟通项目${后缀}`, customerId: 客户, ownerId: 销售甲.id, creatorId: 销售甲.id, bizLine: "内贸", phase: "商机" } })).id;
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

test("有项目时在客户档案记沟通：「新建沟通」开框、关联项目默认选上，记完留在原页，沟通记录里有这条、刷新还在、挂在项目上", async ({ page }) => {
  const 内容 = `客户档案里记的沟通${后缀}`;
  await 登录(page, "销售1");
  await page.goto(`/customers/${客户}`);
  const 正文 = page.getByRole("main");
  await expect(正文.getByText(`记沟通客户${后缀}`).first()).toBeVisible();

  // 有在推的项目：卡头按钮叫「新建沟通」，不是「给他开项目」
  await expect(正文.getByRole("button", { name: /给他开项目/ })).toHaveCount(0);
  // 11-15 起客户档案里在推的项目整块摆出来（region「项目：X」），「新建沟通」在这个项目的沟通记录卡头：从哪个项目点开就记在哪个项目上，框里不再另挑「关联项目」
  const 项目块 = 正文.getByRole("region", { name: `项目：记沟通项目${后缀}` });
  await expect(项目块).toBeVisible();
  await 项目块.getByRole("button", { name: /新建沟通/ }).first().click();
  const 框 = page.getByRole("dialog", { name: "记一条沟通" });
  await expect(框).toBeVisible();

  // 发起主体字典里有「我方发起」时自动带上；没带上就挑第一项
  // 11-15 起记沟通框是项目那张（F-跟进-06），不是 antd Form.Item：按读屏名认这一格
  const 主体 = 框.getByRole("combobox", { name: "发起主体" });
  if (!(await 框.getByText("我方发起", { exact: true }).count())) {
    await 主体.click();
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().click();
  }
  await 框.getByLabel("沟通内容").fill(内容);
  await 框.getByLabel("下一步计划").fill(`下一步：发报价${后缀}`);
  await 框.getByRole("button", { name: "3 天后" }).click();
  // 项目那张记沟通框的提交键叫「记下」（11-15，原型 F-跟进-06），不叫「保存」
  await 框.getByRole("button", { name: "记下", exact: true }).click();
  await expect(框).toBeHidden();

  // 不跳页，这条出现在沟通记录卡里
  await expect(page).toHaveURL(new RegExp(`/customers/${客户}`));
  await expect(正文.getByText(内容).first()).toBeVisible();
  // 刷新后还在：真的落库了，不只是界面上挂了一条
  await page.reload();
  await expect(page.getByRole("main").getByText(内容).first()).toBeVisible();

  // 库里：一条，记在这位客户名下，挂在这个项目上
  const 记的 = await db.followUp.findMany({ where: { customerId: 客户, content: 内容 }, include: { projectNode: { select: { projectId: true } } } });
  expect(记的).toHaveLength(1);
  expect(记的[0].projectNode?.projectId).toBe(项目);
});
