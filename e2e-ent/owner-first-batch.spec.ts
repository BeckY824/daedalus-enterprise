import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma";
import { ENT_DB, 账号, 读种子, type 种子 } from "./global-setup";

/**
 * 客户负责人第一批的真实页面：只负责项目的人进受限客户详情（11-12 起，原来是项目详情里的只读卡）、指向客户详情的链接、市场分配后待办留下能勾、分配弹窗、批量随客户、项目单领。
 * 人和数据都在这份里现造（global-setup 没有普通市场成员，也没有「只负责项目的人」），和主流程那份共库、串行，互不依赖。
 * 排版数字用 console.log 打出来（量排版 开头），超了直接红。
 */
test.describe.configure({ retries: 0 });

let 种: 种子;
let db: PrismaClient;

const 后缀 = Date.now().toString(36);
const 长公司 = "华东某某超长名称国际供应链管理与智能制造装备系统集成工程技术服务有限责任公司第二分公司长三角大区运营总部采购中心";
const 长姓名 = "欧阳纳兰司马上官诸葛慕容东方皇甫尉迟公羊澹台公冶宗政濮阳淳于单于太叔申屠公孙仲孙轩辕令狐";
const 长号 = `verylongcontactaddressforlayoutmeasure${后缀}@averyveryverylongdomainnameforlayoutmeasure.example.com`;

type 造的人 = { id: string; email: string; name: string };
let 丙: 造的人; // 只负责项目
let 丁: 造的人; // 客户负责人
let 戊: 造的人; // 同部门同事，和客户A、项目A都不沾
let 市场乙: 造的人; // 普通市场成员
let 市场管: 造的人;
let 客户A: string;
let 项目A: string;
let 结束客户: string;

let 号序 = 0;
const 新号 = () => `137${String(Date.now() % 100000).padStart(5, "0")}${String(++号序).padStart(3, "0")}`;

async function 造客户(名: string, ownerId: string, 公司: string | null = null) {
  return (await db.customer.create({ data: { name: 名, school: 公司, phone: 新号(), salesOwnerId: ownerId } })).id;
}
async function 造项目(名: string, customerId: string, ownerId: string, extra: Record<string, unknown> = {}) {
  return (await db.project.create({ data: { name: 名, customerId, ownerId, creatorId: ownerId, bizLine: "内贸", ...extra } })).id;
}
async function 造活(customerId: string, ownerId: string, 名: string) {
  const 明天 = new Date(Date.now() + 86400_000);
  return {
    待办: (await db.task.create({ data: { title: `${名}待办`, customerId, ownerId, dueAt: 明天 } })).id,
    计划: (await db.followPlan.create({ data: { subject: `${名}计划`, customerId, ownerId, plannedAt: 明天 } })).id,
  };
}

test.beforeAll(async () => {
  种 = 读种子();
  db = new PrismaClient({ datasources: { db: { url: `file:${ENT_DB}` } } });
  const hash = await bcrypt.hash(种.密码, 10);
  const 经理 = await db.user.findFirstOrThrow({ where: { email: 账号.经理 } });
  const 销售部 = (await db.entMember.findUniqueOrThrow({ where: { userId: 经理.id } })).deptId;
  const 市场部 = await db.entDept.create({ data: { name: `市场部${后缀}` } });
  const 建 = async (key: string, name: string, bizRole: string, extra: Record<string, unknown>) => {
    const email = `own-${key}-${后缀}`;
    const u = await db.user.create({ data: { email, name, title: "", role: "SALES", password: hash } });
    await db.entMember.create({ data: { userId: u.id, bizRole, ...extra } });
    return { id: u.id, email, name };
  };
  丙 = await 建("c", `项目丙${后缀}`, "sales", { deptId: 销售部, line: "内贸", managerId: 经理.id });
  丁 = await 建("d", `客户丁${后缀}`, "sales", { deptId: 销售部, line: "内贸", managerId: 经理.id });
  戊 = await 建("e", `同事戊${后缀}`, "sales", { deptId: 销售部, line: "内贸", managerId: 经理.id });
  市场管 = await 建("mm", `市场管${后缀}`, "marketing_mgr", { deptId: 市场部.id });
  市场乙 = await 建("m", `市场乙${后缀}`, "channel_ops", { deptId: 市场部.id, managerId: 市场管.id });

  // 丁负责客户，丙只负责其中一个项目；一位联系人在丙的项目上，一位不在
  客户A = await 造客户(`${长公司}${后缀}`, 丁.id, 长公司);
  项目A = await 造项目(`丙的项目${后缀}`, 客户A, 丙.id, { phase: "商机" });
  const 在项目上 = await db.contact.create({ data: { name: 长姓名, position: "采购总监", phone: 新号(), email: 长号, customerId: 客户A } });
  await db.contact.create({ data: { name: `不在项目上的人${后缀}`, position: "财务", phone: 新号(), customerId: 客户A } });
  await db.projectContact.create({ data: { projectId: 项目A, contactId: 在项目上.id } });
  await db.followUp.create({ data: { type: "PHONE", title: "沟通", content: `丙记的沟通${后缀}`, customerId: 客户A, ownerId: 丙.id, projectNode: { create: { projectId: 项目A, node: "沟通" } } } });
  await 造活(客户A, 丙.id, `丙有项目${后缀}`);

  // 丙的项目已结束，手上还留着这位客户的待办（待办不挂项目）
  结束客户 = await 造客户(`结束客户${后缀}`, 丁.id);
  await 造项目(`丙已结束的项目${后缀}`, 结束客户, 丙.id, { result: "丢单" });
  await 造活(结束客户, 丙.id, `丙无项目${后缀}`);
});
test.afterAll(async () => {
  await db?.$disconnect();
});

async function 登录(page: Page, 名: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByPlaceholder("用户名").fill(名);
  await page.getByPlaceholder("登录密码").fill(种.密码);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await page.waitForURL(/\/dashboard/);
}

/** 在 根 里量：页面横向滚动、根内元素超出根、文字被撑出自身。超了返回具体哪些 */
async function 量(page: Page, 根: string, 标签: string) {
  // 根里还在转圈就先等它转完：量到的是加载态，不是要量的内容（main CI 红过一次：项目详情 375 宽「文字溢出」10 条全是 .ant-spin-spinning 本身）
  await expect(page.locator(`${根} .ant-spin-spinning`), `${标签} 还在加载`).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(450); // 弹窗开场动画缩放时量出来的宽度不准
  const r = await page.evaluate((根选择器) => {
    const 根元素 = document.querySelector(根选择器);
    const 视口 = document.documentElement.clientWidth;
    const 结果 = {
      视口,
      页面scrollWidth: document.documentElement.scrollWidth,
      根宽: 0, 根左: 0, 根右: 0, 根scrollWidth: 0, 根clientWidth: 0,
      超出根: [] as string[],
      自身溢出: [] as string[],
    };
    if (!根元素) return 结果;
    const 框 = 根元素.getBoundingClientRect();
    Object.assign(结果, { 根宽: Math.round(框.width), 根左: Math.round(框.left), 根右: Math.round(框.right), 根scrollWidth: 根元素.scrollWidth, 根clientWidth: 根元素.clientWidth });
    for (const el of Array.from(根元素.querySelectorAll<HTMLElement>("*"))) {
      const b = el.getBoundingClientRect();
      if (!b.width) continue;
      const 名 = `${el.tagName}.${el.className || ""}:${(el.textContent ?? "").slice(0, 16)}`;
      // 自己带横向滚动条的容器（项目阶段条）里的元素超出去是滚动，不算溢出
      let 祖先 = el.parentElement;
      let 在横滚里 = false;
      while (祖先 && 祖先 !== 根元素) {
        if (["auto", "scroll"].includes(getComputedStyle(祖先).overflowX)) { 在横滚里 = true; break; }
        祖先 = 祖先.parentElement;
      }
      if (在横滚里) continue;
      if (b.right > 框.right + 1 || b.left < 框.left - 1) 结果.超出根.push(名);
      const 样式 = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && 样式.overflowX === "visible" && 样式.display !== "inline") 结果.自身溢出.push(名);
    }
    return 结果;
  }, 根);
  console.log(`量排版 ${标签} ${JSON.stringify(r)}`);
  expect(r.根宽, `${标签} 根没找到`).toBeGreaterThan(0);
  expect(r.页面scrollWidth, `${标签} 页面横向滚动`).toBeLessThanOrEqual(r.视口);
  expect(r.根右, `${标签} 根超出视口`).toBeLessThanOrEqual(r.视口);
  expect(r.根左, `${标签} 根超出视口`).toBeGreaterThanOrEqual(0);
  expect(r.超出根, `${标签} 元素超出容器`).toEqual([]);
  expect(r.自身溢出, `${标签} 文字溢出`).toEqual([]);
}

async function 能点(page: Page, loc: ReturnType<Page["locator"]>, 标签: string) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  const 视口 = page.viewportSize()!;
  console.log(`量排版 ${标签} 按钮 ${JSON.stringify(b)} 视口 ${视口.width}x${视口.height}`);
  expect(b).not.toBeNull();
  expect(b!.x).toBeGreaterThanOrEqual(0);
  expect(b!.x + b!.width).toBeLessThanOrEqual(视口.width);
  await loc.click({ trial: true, timeout: 5_000 });
}

/** 每页上指向客户详情的链接：页、href、文字 */
async function 客户链接(page: Page, 路径: string) {
  await page.goto(路径);
  await page.waitForLoadState("networkidle").catch(() => {});
  return (await page.locator('main a[href^="/customers/c"]').evaluateAll((们) =>
    们.map((a) => ({ href: a.getAttribute("href") ?? "", 字: (a.textContent ?? "").slice(0, 24) })))).map((x) => ({ 页: 路径, ...x }));
}

/** 只负责项目的人（11-12 起）：进 /projects/<id> 跳到客户详情 ?project=<id>，是受限客户详情 */
async function 停在受限详情(page: Page, 客户: string, 项目: string) {
  await page.waitForURL(new RegExp(`/customers/${客户}\\?project=${项目}`));
  await expect(page.getByTestId("restricted-customer-detail")).toBeVisible();
}

test("A1 只负责项目的人：从项目进客户详情是受限详情（仅项目、只有自己的项目、只读客户资料、没有客户操作）；不沾边的同事开客户详情还是 404", async ({ page }) => {
  await 登录(page, 丙.email);
  await page.goto(`/projects/${项目A}`);
  await 停在受限详情(page, 客户A, 项目A);
  const 正文 = page.getByRole("main");
  const 头 = 正文.locator(".rec-head");
  await expect(头.getByText("仅项目", { exact: true })).toBeVisible();
  // 页头只有「项目操作 ▾」：没有客户操作、AI、星标
  await expect(头.getByRole("button", { name: /客户操作/ })).toHaveCount(0);
  await expect(头.getByRole("button", { name: /^AI$/ })).toHaveCount(0);
  // 项目区只有丙自己的项目（只有一个：卡头直接写项目名，没有胶囊），没有带锁的同事项目
  await expect(正文.locator(".cd-pj-one .cd-pj-nm, .cd-pj-pill .cd-pj-nm")).toHaveCount(1);
  await expect(正文.locator(".cd-pj-one .cd-pj-nm, .cd-pj-pill .cd-pj-nm").first()).toContainText(`丙的项目${后缀}`);
  // 左栏客户资料只读：字段和联系方式符合规格
  const 卡 = page.getByTestId("customer-readonly-card");
  await expect(卡).toBeVisible();
  await expect(卡).toContainText(长公司);
  await expect(卡).toContainText(长姓名);
  await expect(卡).toContainText("采购总监");
  await expect(卡).toContainText(长号);
  await expect(卡).toContainText(`不在项目上的人${后缀}`);
  await expect(卡).toContainText("不在你的项目上，联系方式不显示");
  // 不显示客户负责人、级别、状态
  const 左栏 = 正文.locator("aside.rec-rail");
  await expect(左栏).not.toContainText(丁.name);
  await expect(左栏).not.toContainText("负责人");
  await expect(左栏.getByText(/^级别$|^状态$|^客户状态$/)).toHaveCount(0);
  // 沟通只看本项目：没有「这位客户全部」
  await expect(正文.locator(".cd-comm").getByRole("button", { name: "这位客户全部" })).toHaveCount(0);

  // 不沾边的同事：还是 404
  await 登录(page, 戊.email);
  await page.goto(`/customers/${客户A}`);
  await expect(正文.getByText("没有找到这条记录")).toBeVisible();
  await expect(正文.getByText(长公司.slice(0, 8))).toHaveCount(0);
});

test("A2 只负责项目的人：各入口没有点了就 404 的客户链接", async ({ page }) => {
  await 登录(page, 丙.email);
  const 正文 = page.getByRole("main");
  const 全部 = [];
  for (const 路径 of ["/dashboard", "/overview", "/follow-ups", "/follow-ups/plans", "/follow-ups/watchlist", "/contacts", "/customers", "/projects", `/projects/${项目A}`, "/reports", "/leads", "/pool"]) {
    全部.push(...await 客户链接(page, 路径));
  }
  const 坏 = [];
  for (const href of new Set(全部.map((x) => x.href))) {
    await page.goto(href);
    await page.waitForLoadState("networkidle").catch(() => {});
    if (await 正文.getByText("没有找到这条记录").isVisible()) 坏.push(...全部.filter((x) => x.href === href));
  }
  console.log(`客户链接 共 ${全部.length} 条：${JSON.stringify(全部)}`);
  console.log(`点了 404 的客户链接：${JSON.stringify(坏)}`);
  expect(坏).toEqual([]);
});

test("A2 全局搜索：搜得到自己的项目，点进去能开；搜客户名不给客户、联系人结果", async ({ page }) => {
  await 登录(page, 丙.email);
  await page.goto("/projects");
  const 框 = page.locator(".cmdk input");
  // 页面刚进来时搜索框的监听可能还没挂上，事件发早了没人接：没开就再发一次
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event("cmdbar:open")));
    await expect(框).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await 框.fill(长公司.slice(0, 10));
  await expect(page.locator(".cmdk-list").getByText(`丙的项目${后缀}`)).toBeVisible();
  const 字 = await page.locator(".cmdk-list").innerText();
  console.log(`全局搜索（客户名）：${字.replace(/\n/g, " | ").slice(0, 300)}`);
  await 框.fill(`不在项目上的人${后缀}`);
  await expect(page.locator(".cmdk-list").getByRole("status")).toContainText("没找到");
  // 项目上那位也不进全局搜（P-看-13）
  await 框.fill(长姓名.slice(0, 10));
  await expect(page.locator(".cmdk-list").getByRole("status")).toContainText("没找到");
  await 框.fill(`丙的项目${后缀}`);
  await page.locator(".cmdk-list").getByText(`丙的项目${后缀}`).click();
  // 11-12 起：只负责项目的人点项目进受限客户详情的项目页签
  await 停在受限详情(page, 客户A, 项目A);
  await expect(page.getByRole("main").getByText("没有找到这条记录")).toHaveCount(0);
  await expect(page.getByRole("main").getByText(`丙的项目${后缀}`).first()).toBeVisible();
});

test("A2 只负责项目的人在计划页：名下事项能完成、不弹记沟通小框；还负责项目的客户能改计划", async ({ page }) => {
  await 登录(page, 丙.email);
  await page.goto("/follow-ups/plans");
  const 正文 = page.getByRole("main");
  const 行 = 正文.locator(".plan-row", { hasText: `丙有项目${后缀}计划` });
  await expect(行).toBeVisible();
  await expect(行.locator(".plan-row-act")).toHaveCount(1);
  await expect(行.locator(`a[href="/customers/${客户A}"]`)).toHaveCount(0);
  const 计划 = await db.followPlan.findFirstOrThrow({ where: { subject: `丙无项目${后缀}计划` } });
  await 正文.getByRole("button", { name: `完成 丙无项目${后缀}计划` }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await db.followPlan.findUniqueOrThrow({ where: { id: 计划.id } })).done).toBe(true);
});

test("C 客户负责人打不开同事负责的项目（P-看-12）", async ({ page }) => {
  await 登录(page, 丁.email);
  await page.goto(`/projects/${项目A}`);
  await expect(page.getByRole("main").getByText("没有找到这条记录")).toBeVisible();
  await page.goto(`/customers/${客户A}`);
  await expect(page.getByRole("main").getByText("没有找到这条记录")).toHaveCount(0);
  await expect(page.getByRole("main").getByText(长公司.slice(0, 8)).first()).toBeVisible();
});

test("A3 A4 市场成员的客户分给销售：弹窗没有带待办的勾，待办留在原负责人，他能从入口勾、不能改删；销售能看到能勾；通知写 N、M", async ({ page }) => {
  const 名 = `市场线索${后缀}`;
  const 客户 = await 造客户(`${长公司}市场${后缀}`, 市场乙.id, 长公司);
  const 线索 = await 造项目(名, 客户, 市场乙.id);
  const 活1 = await 造活(客户, 市场乙.id, `市场一${后缀}`);
  const 活2 = await 造活(客户, 市场乙.id, `市场二${后缀}`);
  const 正文 = page.getByRole("main");

  await 登录(page, 市场管.email);
  await page.goto("/leads");
  await 正文.getByRole("button", { name: `分配 ${名}`, exact: true }).click();
  const 弹窗 = page.getByRole("dialog", { name: `分配「${名}」` });
  const 接手人 = 弹窗.getByRole("combobox", { name: /接手人/ });
  const 那项 = page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: 丁.name });
  // 弹窗开场动画走完才取人并重置表单，先等取完（业务线显示出来），不然刚打的字和下拉被重置掉
  await expect(弹窗.getByTestId("assign-line-readonly")).toHaveText("内贸");
  // 接手人下拉是虚拟列表：人多时要打字筛
  await 接手人.click();
  await 接手人.pressSequentially(丁.name);
  await expect(那项).toBeVisible();
  await 那项.click();
  await expect(弹窗.getByText("原负责人没做完的待办一起转给新负责人")).toHaveCount(0);
  await 弹窗.getByRole("button", { name: /分\s*配/ }).click();
  await expect(page.locator(".ant-message-notice", { hasText: `「${名}」已分给 ${丁.name}` })).toBeVisible();
  expect((await db.customer.findUniqueOrThrow({ where: { id: 客户 } })).salesOwnerId).toBe(丁.id);
  expect((await db.project.findUniqueOrThrow({ where: { id: 线索 } })).ownerId).toBe(丁.id);
  expect((await db.task.findUniqueOrThrow({ where: { id: 活1.待办 } })).ownerId).toBe(市场乙.id);

  // 市场成员：待办看板勾待办
  await 登录(page, 市场乙.email);
  await page.goto("/overview");
  const 勾 = 正文.getByRole("checkbox", { name: `完成「市场一${后缀}待办」` });
  await expect(勾).toBeVisible();
  await 勾.click();
  await expect.poll(async () => (await db.task.findUniqueOrThrow({ where: { id: 活1.待办 } })).done).toBe(true);

  // 计划页：进不了客户，记不了沟通，直接勾完，不弹记沟通的小框
  await page.goto("/follow-ups/plans");
  const 勾计划 = 正文.getByRole("button", { name: `完成 市场一${后缀}计划` });
  await expect(勾计划).toBeVisible();
  await 勾计划.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await db.followPlan.findUniqueOrThrow({ where: { id: 活1.计划 } })).done).toBe(true);
  const 市场链接 = [...await 客户链接(page, "/overview"), ...await 客户链接(page, "/follow-ups/plans"), ...await 客户链接(page, "/follow-ups"), ...await 客户链接(page, "/leads"), ...await 客户链接(page, "/projects")];
  console.log(`市场成员的客户链接：${JSON.stringify(市场链接)}`);
  expect(市场链接.filter((x) => x.href.includes(客户))).toEqual([]);
  // 列表上没有改、删的入口
  await page.goto("/follow-ups/plans");
  const 行 = 正文.locator(".plan-row", { hasText: `市场二${后缀}计划` });
  await expect(行).toBeVisible();
  console.log(`市场成员计划行按钮：${JSON.stringify(await 行.getByRole("button").evaluateAll((们) => 们.map((b) => b.getAttribute("aria-label") ?? b.textContent)))}`);
  await expect(行.getByRole("button", { name: /删除|编辑|改|排下一次/ })).toHaveCount(0);
  await expect(行.locator(".plan-row-act")).toHaveCount(0);
  await expect(行.locator(`a[href="/customers/${客户}"]`)).toHaveCount(0);
  // 客户详情进不去（P-看-06）
  await page.goto(`/customers/${客户}`);
  await expect(正文.getByText("没有找到这条记录")).toBeVisible();

  // 销售：通知写 N、M，客户上看得到留下的活并能勾
  // 通知是分配动作里 await 着写进库的（「已分给」的提示出来时已落库）。先在库里确认有这条：再红时分得清是没写上、还是页面没拿到
  await expect.poll(async () => db.entNotice.count({ where: { userId: 丁.id, title: { contains: 名 } } }), { message: "分配通知没写进库" }).toBeGreaterThan(0);
  await 登录(page, 丁.email);
  await page.goto("/projects");
  for (const 宽 of [1024, 375]) {
    await page.setViewportSize({ width: 宽, height: 800 });
    await page.goto("/projects");
    const 铃 = page.locator("button.notice-bell, button[aria-label*='通知']").first();
    const 条 = page.locator(".notice-item", { hasText: 名 }).first();
    // 抽屉只在点开时现拉一次列表（NoticeBell 打开 → 读我的通知），开着不轮询：
    // 刚 goto 完就点可能赶在水合之前（点了没反应、抽屉不开），拉列表失败则显示空列表、不会再拉。
    // 所以没看到这条就重进页面、重新点开再拉一次，而不是把超时调大干等
    let 第几次 = 0;
    await expect(async () => {
      if (第几次++) await page.goto("/projects");
      await 铃.click({ timeout: 5_000 });
      await expect(条).toBeVisible({ timeout: 5_000 });
    }, `通知 ${宽} 铃铛里没有这条`).toPass({ timeout: 30_000 });
    await expect(条).toContainText("客户上还有原负责人 2 条未完成待办、2 条未完成计划");
    await 量(page, ".notice-list", `通知 ${宽}`);
    await 能点(page, 条, `通知 ${宽}`);
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/customers/${客户}`);
  await expect(正文.getByText(`市场二${后缀}待办`).first()).toBeVisible();
  await expect(正文.getByText(`市场二${后缀}计划`).first()).toBeVisible();
  // 客户负责人勾别人留下的待办、计划（M：不搬不关，新负责人能勾）
  await page.getByRole("main").getByRole("checkbox", { name: `完成 市场二${后缀}待办` }).click();
  await expect.poll(async () => (await db.task.findUniqueOrThrow({ where: { id: 活2.待办 } })).done).toBe(true);
  expect((await db.task.findUniqueOrThrow({ where: { id: 活2.待办 } })).ownerId).toBe(市场乙.id);
  // 客户页上的计划行写「到跟进计划里办」：计划页切全部成员，能找到别人留下的这条并勾掉
  await page.goto("/follow-ups/plans");
  await 正文.getByText("全部成员", { exact: true }).click();
  await 正文.getByRole("button", { name: `完成 市场二${后缀}计划` }).click();
  const 小框 = page.getByRole("dialog");
  await expect(小框).toBeVisible();
  await 小框.getByRole("button", { name: /跳过/ }).click();
  await expect.poll(async () => (await db.followPlan.findUniqueOrThrow({ where: { id: 活2.计划 } })).done).toBe(true);
});

test("A4 销售路径：弹窗还有带待办的勾", async ({ page }) => {
  const 名 = `销售线索${后缀}`;
  const 客户 = await 造客户(`销售客户${后缀}`, 丁.id);
  await 造项目(名, 客户, 丁.id);
  await 登录(page, 市场管.email);
  await page.goto("/leads");
  const 按钮 = page.getByRole("main").getByRole("button", { name: `分配 ${名}`, exact: true });
  if (!(await 按钮.count())) {
    await 登录(page, 账号.老板);
    await page.goto("/leads");
  }
  await 按钮.click();
  const 弹窗 = page.getByRole("dialog", { name: `分配「${名}」` });
  await expect(弹窗.getByText("原负责人没做完的待办一起转给新负责人")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("A5 批量自动分配同客户多线索：结果行写已随客户，归属一人、额度一份；窄屏不溢出", async ({ page }) => {
  for (const 宽 of [1024, 375]) {
    const 客户 = await 造客户(`${长公司}批量${宽}${后缀}`, 市场管.id, 长公司);
    const 另一位 = await 造客户(`另一位${宽}${后缀}`, 市场管.id);
    const 名们 = [1, 2, 3].map((i) => `${长公司}线索${i}批${宽}${后缀}`);
    const ids = [];
    for (const n of 名们) ids.push(await 造项目(n, 客户, 市场管.id));
    const 另一条 = await 造项目(`另一条批${宽}${后缀}`, 另一位, 市场管.id);

    await 登录(page, 市场管.email);
    // 就在这个宽度下勾、点批量：窄屏也要走得通
    await page.setViewportSize({ width: 宽, height: 800 });
    await page.goto("/leads");
    const 正文 = page.getByRole("main");
    for (const n of [...名们, `另一条批${宽}${后缀}`]) {
      await 正文.getByRole("checkbox", { name: `选中 ${n}`, exact: true }).check();
    }
    await expect(正文.getByText("已选 4 条")).toBeVisible();
    await 正文.locator("button:not([aria-label])", { hasText: "自动分配" }).click();
    const 结果 = page.getByTestId("lead-auto-assign-result");
    await expect(结果).toBeVisible();
    const 行们 = 结果.locator("li");
    await expect(行们).toHaveCount(4);
    const 字 = await 行们.allInnerTexts();
    console.log(`批量结果行 ${宽}：${JSON.stringify(字.map((x) => x.slice(-40)))}`);
    expect(字.filter((x) => x.includes("已随客户给"))).toHaveLength(2);
    await 量(page, '[data-testid="lead-auto-assign-result"]', `结果行 ${宽}`);
    await 量(page, ".ant-modal-container", `结果弹窗 ${宽}`);
    await 能点(page, page.getByRole("button", { name: "知道了" }), `结果弹窗 ${宽}`);
    await page.getByRole("button", { name: "知道了" }).click();

    const 项目们 = await db.project.findMany({ where: { id: { in: ids } }, select: { ownerId: true } });
    const 主人 = new Set(项目们.map((p) => p.ownerId));
    expect(主人.size).toBe(1);
    const A = [...主人][0];
    expect((await db.customer.findUniqueOrThrow({ where: { id: 客户 } })).salesOwnerId).toBe(A);
    expect(await db.entLeadAssign.count({ where: { projectId: { in: ids } } })).toBe(1);
    expect(await db.entLeadAssign.count({ where: { projectId: 另一条 } })).toBe(1);
    await page.setViewportSize({ width: 1280, height: 800 });
  }
});

test("A6 项目单领后进受限客户详情：领完客户负责人不变，客户详情是受限详情、看得到客户的联系人名字", async ({ page }) => {
  const 客户 = await 造客户(`${长公司}单领${后缀}`, 丁.id, 长公司);
  const 名 = `单领项目${后缀}`;
  const 项目 = await 造项目(名, 客户, 丁.id, { pooledAt: new Date() });
  await db.contact.create({ data: { name: `单领联系人${后缀}`, phone: 新号(), customerId: 客户 } });
  await 登录(page, 丙.email);
  await page.goto(`/pool?keyword=${encodeURIComponent(名)}`);
  const 正文 = page.getByRole("main");
  await 正文.getByRole("button", { name: `领取 ${名}` }).click();
  await expect(page.locator(".ant-message-notice", { hasText: "已领取" })).toBeVisible();
  const p = await db.project.findUniqueOrThrow({ where: { id: 项目 } });
  expect(p.ownerId).toBe(丙.id);
  expect(p.pooledAt).toBeNull();
  expect((await db.customer.findUniqueOrThrow({ where: { id: 客户 } })).salesOwnerId).toBe(丁.id);
  await page.goto(`/projects/${项目}`);
  await 停在受限详情(page, 客户, 项目);
  await expect(page.getByTestId("customer-readonly-card")).toContainText(`单领联系人${后缀}`);
  await page.goto(`/customers/${客户}`);
  await expect(page.getByTestId("restricted-customer-detail")).toBeVisible();
  await expect(正文.getByText("没有找到这条记录")).toHaveCount(0);
});

test("B 受限客户详情排版：1024、375 宽，超长公司名、超长联系人", async ({ page }) => {
  await 登录(page, 丙.email);
  for (const 宽 of [1024, 375]) {
    await page.setViewportSize({ width: 宽, height: 800 });
    await page.goto(`/projects/${项目A}`);
    await 停在受限详情(page, 客户A, 项目A);
    await expect(page.getByTestId("customer-readonly-card")).toBeVisible();
    await 量(page, "main", `受限客户详情 ${宽}`);
    await 量(page, '[data-testid="customer-readonly-card"]', `受限详情左栏 ${宽}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
});
