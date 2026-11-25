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

/** 销售甲打开这位客户，从项目块的「新建沟通」开「记一条沟通」框（等水合、落空了再点） */
async function 开记沟通框(page: Page) {
  await 登录(page, "销售1");
  await page.goto(`/customers/${客户}`);
  const 正文 = page.getByRole("main");
  await expect(正文.getByText(`记沟通客户${后缀}`).first()).toBeVisible();

  // 有在推的项目：卡头按钮叫「新建沟通」，不是「给他开项目」
  await expect(正文.getByRole("button", { name: /给他开项目/ })).toHaveCount(0);
  // 11-15 起客户档案里在推的项目整块摆出来（region「项目：X」），「新建沟通」在这个项目的沟通记录卡头：从哪个项目点开就记在哪个项目上，框里不再另挑「关联项目」
  const 项目块 = 正文.getByRole("region", { name: `项目：记沟通项目${后缀}` });
  await expect(项目块).toBeVisible();
  const 新建 = 项目块.getByRole("button", { name: /新建沟通/ }).first();
  // 整页打开是流式首屏：服务端那份先画出来、按钮就在，React 接管（挂上 onClick）之前点下去会落空、框不出来。
  // 11-24 CI 红过：trace 里点击动作进行中才出 RecordView 首次渲染的 antd 警告（TransferBox 一直挂着），焦点落在按钮上但框没开。
  // 等按钮身上有了 React 的属性再点，同 main-flow.spec.ts 的「⋯」、nav-smooth.spec.ts 的 等水合
  await expect
    .poll(() => 新建.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))).catch(() => false), {
      message: "「新建沟通」一直没被 React 接管",
      timeout: 30_000,
    })
    .toBe(true);
  // 接管了也还可能落空（11-24 #451 带着上面这道等待仍红）：点击进行中 RecordView 才首次渲染、挂框的那层重新挂载，开框状态被冲掉。
  // 点了框没出就再点，30 秒内出来算过；框开着时再点会被遮罩挡住，不会把框关掉。只改用例，产品代码不动
  const 框 = page.getByRole("dialog", { name: "新建沟通" });
  await expect(async () => {
    if (!(await 框.isVisible())) await 新建.click({ timeout: 3_000 });
    await expect(框).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });

  return { 框, 正文 };
}

/** 发起主体、内容、下一步填好，点保存，等框关掉 */
async function 填好存下(page: Page, 框: ReturnType<Page["getByRole"]>, 内容: string) {
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
  // 项目那张记沟通框的提交键：11-15 起叫「记下」，D4 · M7-b 起叫「保存」
  await 框.getByRole("button", { name: "保存", exact: true }).click();
  await expect(框).toBeHidden();
}

test("有项目时在客户档案记沟通：「新建沟通」开框、关联项目默认选上，记完留在原页，沟通记录里有这条、刷新还在、挂在项目上", async ({ page }) => {
  const 内容 = `客户档案里记的沟通${后缀}`;
  const { 框, 正文 } = await 开记沟通框(page);
  await 填好存下(page, 框, 内容);

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

/*
  带截图记（PR-B 审查 11-25）：截图在记沟通之后另走 /api/attachments（fetch，不重渲染），新的那条要再刷一次才带上缩略图。
  项目块里「新建沟通」是项目详情那张框（ProjectDetail 的 交，传完自己 refresh）；
  记录页那张框（FollowUpForm 项目模式：?do=followup、AI 面板、背调卡「记一条沟通」）原来靠记录页 onSaved 的 router.refresh，
  PR-B 去掉了那一下，改成 FollowUpForm 传上了截图自己刷一次——两条入口各钉一条
*/
/*
  截图上传压慢 2 秒：记沟通动作 revalidatePath 了，Next 在动作回来后自己对当前页再取一次（server-action-reducer 的 RefreshAll），
  这一次和 /api/attachments 赛跑——1×1 小图常常抢在那次读库之前存好，不压慢的话少了「传完自己刷一次」也看得见缩略图（改前不红）
*/
async function 截图慢点传(page: Page) {
  await page.route(/\/api\/attachments\?/, async (r) => {
    if (r.request().method() === "POST") await new Promise((好) => setTimeout(好, 2_000));
    await r.continue();
  });
}

const 一像素图 = () => Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("带一张截图记沟通：不刷新页面，新的那条就能看到缩略图", async ({ page }) => {
  const 内容 = `带截图的沟通${后缀}`;
  const 图名 = `截图${后缀}.png`;
  const { 框, 正文 } = await 开记沟通框(page);
  await 截图慢点传(page);
  // 1×1 的 PNG：服务端按文件头认类型
  const 图 = 一像素图();
  await 框.locator('input[type="file"]').setInputFiles({ name: 图名, mimeType: "image/png", buffer: 图 });
  await expect(框.getByText(图名)).toBeVisible();
  await 填好存下(page, 框, 内容);
  await expect(正文.getByText(内容).first()).toBeVisible();
  // 不 reload：新的那条下面就有这张图的缩略图
  await expect(正文.getByRole("img", { name: 图名 }).first()).toBeVisible({ timeout: 15_000 });
  const 记的 = await db.followUp.findFirstOrThrow({ where: { customerId: 客户, content: 内容 }, select: { id: true } });
  expect(await db.attachment.count({ where: { followUpId: 记的.id } })).toBe(1);
});

test("记录页的记沟通框（?do=followup，FollowUpForm 项目模式）带一张截图：不刷新页面，新的那条就能看到缩略图", async ({ page }) => {
  const 内容 = `记录页框带截图${后缀}`;
  const 图名 = `记录页截图${后缀}.png`;
  await 登录(page, "销售1");
  // 首页背调卡「记一条沟通」过来就带 ?do=followup：进来就开记录页那张框（不是项目块里项目详情那张）。
  // 只有一个项目时客户层没有「沟通记录」汇总卡，这张框在页面上没有别的常驻按钮，AI 面板、背调卡走的也是这条 点跟进
  await page.goto(`/customers/${客户}?do=followup`);
  const 正文 = page.getByRole("main");
  const 框 = page.getByRole("dialog", { name: "新建沟通" });
  await expect(框).toBeVisible({ timeout: 30_000 });
  // 开完把参数去掉，刷新不再弹
  await expect(page).not.toHaveURL(/do=followup/);
  await 截图慢点传(page);
  // 项目模式：关联项目默认选上这一个
  await expect(框.getByText(`记沟通项目${后缀}`).first()).toBeVisible();
  await 框.locator('input[type="file"]').setInputFiles({ name: 图名, mimeType: "image/png", buffer: 一像素图() });
  await expect(框.getByText(图名)).toBeVisible();
  // 这张是 FollowUpForm（antd 表单）：下一步时间默认就是 3 天后，不另点；存上后有话要说（自动推进、短沟通……）框会停下等「知道了」
  const 主体 = 框.getByRole("combobox", { name: "发起主体" });
  if (!(await 框.getByText("我方发起", { exact: true }).count())) {
    await 主体.click();
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().click();
  }
  await 框.getByLabel("沟通内容").fill(内容);
  await 框.getByLabel("下一步计划").fill(`下一步：发报价${后缀}`);
  await 框.getByRole("button", { name: "保存", exact: true }).click();
  const 知道了 = 框.getByRole("button", { name: "知道了" });
  await expect(async () => {
    if (await 知道了.isVisible()) await 知道了.click();
    await expect(框).toBeHidden({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(正文.getByText(内容).first()).toBeVisible();
  const 记的 = await db.followUp.findFirstOrThrow({ where: { customerId: 客户, content: 内容 }, select: { id: true } });
  await expect.poll(() => db.attachment.count({ where: { followUpId: 记的.id } })).toBe(1);
  // 不 reload：新的那条下面就有这张图的缩略图
  await expect(正文.getByRole("img", { name: 图名 }).first()).toBeVisible({ timeout: 15_000 });
});
