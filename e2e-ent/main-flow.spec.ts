import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "../src/generated/prisma";
import { ENT_DB, 账号, 读种子, type 种子 } from "./global-setup";

/**
 * 企业版主流程：主套在 CRM_ENTERPRISE=1 下重跑的是桌面端 / 团队版的回归，这里补只有企业版才有的。
 * 人和数据见 global-setup.ts；公海那条会改归属，放最后、整套串行。
 * 不重试：串行套重试是从头再跑一遍，数据却不重置（线索甲已经分出去了），只会在别处再红一次，把真正的错盖住。
 */
test.describe.configure({ mode: "serial", retries: 0 });

let 种: 种子;
let db: PrismaClient;

test.beforeAll(() => {
  种 = 读种子();
  db = new PrismaClient({ datasources: { db: { url: `file:${ENT_DB}` } } });
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

test("四类账号都能登录：老板、销售管理、销售、市场", async ({ page }) => {
  for (const 谁 of ["老板", "经理", "销售1", "市场"] as const) {
    await page.context().clearCookies();
    await 登录(page, 谁);
    await expect(page.getByRole("main")).toBeVisible();
  }
});

test("企业版没有注册、条款、手机伴侣：/signup /terms 回登录页，/m 回首页", async ({ page }) => {
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/terms");
  await expect(page).toHaveURL(/\/login$/);
  await 登录(page, "老板");
  await page.goto("/m");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("导入导出：老板列表上有，销售没有；销售直接调上传接口回 403", async ({ page }) => {
  await 登录(page, "老板");
  await page.goto("/customers");
  const 页头 = page.getByRole("main").locator(".page-head");
  await expect(页头.getByRole("button", { name: /导\s*入/ })).toBeVisible();
  await expect(页头.getByRole("button", { name: /导\s*出/ })).toBeVisible();

  await page.context().clearCookies();
  await 登录(page, "销售1");
  await page.goto("/customers");
  await expect(页头).toBeVisible();
  await expect(页头.getByRole("button", { name: /导\s*入/ })).toHaveCount(0);
  await expect(页头.getByRole("button", { name: /导\s*出/ })).toHaveCount(0);

  const r = await page.request.post("/api/enterprise-import/upload", {
    multipart: { file: { name: "客户.csv", mimeType: "text/csv", buffer: Buffer.from("客户姓名\n张三\n") } },
  });
  expect(r.status()).toBe(403);
  expect((await r.json()).error).toContain("只有总管理能做企业版导入");
});

test("设置：老板有企业版导入和组织架构；销售只剩个人几栏（D3-1），看不到组织架构、企业版导入、业务配置、AI 接入", async ({ page }) => {
  await 登录(page, "老板");
  await page.goto("/settings");
  const 目录 = () => page.locator("main .set-nav-i b").allInnerTexts();
  await page.waitForSelector("main .set-nav-i");
  expect(await 目录()).toEqual(expect.arrayContaining(["组织架构", "企业版导入", "业务配置", "AI 接入", "项目模式"]));

  await page.context().clearCookies();
  await 登录(page, "销售1");
  await page.goto("/settings");
  await page.waitForSelector("main .set-nav-i");
  const 销售看到 = await 目录();
  expect(销售看到).toContain("个人资料");
  for (const 不该有 of ["组织架构", "企业版导入", "业务配置", "AI 接入"]) expect(销售看到).not.toContain(不该有);
});

test("设置 → 组织架构：飞书没填凭据时，「立即同步」灰着，「飞书连接」摆着等填", async ({ page }) => {
  await 登录(page, "老板");
  await page.goto("/settings?tab=org");
  const 飞书 = page.getByRole("main").getByTestId("org-sync-feishu");
  await expect(飞书.getByText("凭据没填")).toBeVisible();
  await expect(飞书.getByRole("button", { name: "立即同步" })).toBeDisabled();
  await expect(飞书.getByText("飞书连接", { exact: true })).toBeVisible();
  await expect(飞书.getByTestId("feishu-test")).toBeEnabled();
});

/** 11-12 客户详情合并第 2 批：项目详情住在客户详情的项目区里，/projects/<id> 跳到 /customers/<客户>?project=<id>、停在这个项目的页签上 */
async function 停在项目页签(page: Page, 客户: string, 项目: string, 名: string) {
  await page.waitForURL((u) => u.pathname === `/customers/${客户}` && u.searchParams.get("project") === 项目);
  await expect(page.getByRole("main").locator(`.rec-zone[data-project="${项目}"] .cd-tab[aria-selected="true"]`)).toContainText(名);
}

test("客户详情、项目详情都能打开（项目详情跳到客户详情的项目区）", async ({ page }) => {
  await 登录(page, "老板");
  await page.goto(`/customers/${种.客户}`);
  await expect(page.getByRole("main").getByText("公海客户甲").first()).toBeVisible();
  await page.goto(`/projects/${种.项目2}`);
  await 停在项目页签(page, 种.客户, 种.项目2, "同客户项目二");
});

// 按组织看客户（org_scope）：单测钉的是算范围，这条钉列表页、详情页真的按范围取数。放在会改归属的几条前面
test("可见范围：销售乙看不到销售甲的客户（列表没有、详情找不到），公海照看；经理看得到下属的；老板全看", async ({ page }) => {
  const 正文 = page.getByRole("main");
  await 登录(page, "销售2");
  await page.goto("/customers?pool=1");
  await expect(正文.getByText("公海客户甲").first()).toBeVisible();
  await page.goto("/customers");
  await expect(正文.locator(".page-head")).toBeVisible();
  await expect(正文.getByText("销售甲的客户")).toHaveCount(0);
  await page.goto(`/customers/${种.自己客户}`);
  await expect(正文.getByText("没有找到这条记录")).toBeVisible();
  await expect(正文.getByText("销售甲的客户")).toHaveCount(0);

  for (const 谁 of ["经理", "老板"] as const) {
    await page.context().clearCookies();
    await 登录(page, 谁);
    await page.goto("/customers");
    await expect(正文.getByText("销售甲的客户").first()).toBeVisible();
    if (谁 === "老板") await expect(正文.getByText("市场的客户").first()).toBeVisible();
    await page.goto(`/customers/${种.自己客户}`);
    await expect(正文.getByText("销售甲的客户").first()).toBeVisible();
  }
});

/** 点开 aria-label 是 框名 的下拉，选标题是 项 的那一项（antd 的选项带 title） */
// 下拉还在展开动画里时点中的项可能落不上值（CI 上见过：点了「看不到」，框里还是「能改」，保存一直灰着），
// 所以点完要看框里真显示了这一项，没落上就整段重来；多选框已经选上的不再点，免得又点掉
async function 选(page: Page, 框名: string, 项: string) {
  const 框 = page.getByRole("main").getByRole("combobox", { name: 框名 });
  // has 里的定位是相对 .ant-select 往里找的，不能再从 main 起头
  const 选上了 = page.locator(".ant-select", { has: page.getByRole("combobox", { name: 框名 }) })
    .locator(`[title="${项}"]:not(.ant-select-item)`);
  const 那项 = page.locator(`.ant-select-dropdown:visible .ant-select-item-option[title="${项}"]`);
  // 多选框点完、保存回来之前框里的标签可能一闪没了（CI 上见过：重来时又点了一次，把刚选上的点掉）：下拉里这项已选中就只等不点
  const 那项已选 = page.locator(`.ant-select-dropdown:visible .ant-select-item-option-selected[title="${项}"]`);
  await expect(async () => {
    if (await 选上了.count()) return;
    if (await 那项已选.count()) { await expect(选上了.first()).toBeVisible({ timeout: 5_000 }); return; }
    if (!(await 那项.isVisible())) await 框.click();
    await expect(那项).toBeVisible({ timeout: 2_000 });
    await 那项.click();
    await expect(选上了.first()).toBeVisible({ timeout: 5_000 });
  }).toPass();
}
const 提示 = (page: Page, 字: string | RegExp) => page.locator(".ant-message-notice", { hasText: 字 });

// A7（11-01 权限只认业务角色）：分配线索 = 市场管理、销售管理、总管理
test("线索分配：老板、销售管理、市场管理有「分配」，销售没有；市场把线索甲分给销售乙", async ({ page }) => {
  const 正文 = page.getByRole("main");
  const 分配 = (名: string) => 正文.getByRole("button", { name: `分配 ${名}`, exact: true });
  // 经理只看得到手填了直属上级是他的人的线索（11-03 C10-1），市场建的线索甲他看不到，验他下属销售甲的线索乙
  for (const [谁, 线索] of [["老板", "线索甲"], ["经理", "线索乙"]] as const) {
    await page.context().clearCookies();
    await 登录(page, 谁);
    await page.goto("/leads");
    await expect(分配(线索)).toBeVisible();
  }

  await page.context().clearCookies();
  await 登录(page, "销售1");
  await page.goto("/leads");
  await expect(正文.locator(".page-head")).toBeVisible();
  await expect(正文.getByText("线索乙").first()).toBeVisible();
  await expect(正文.getByRole("button", { name: /^分配 / })).toHaveCount(0);

  await page.context().clearCookies();
  await 登录(page, "市场");
  await page.goto("/leads");
  await 分配("线索甲").click();
  const 弹窗 = page.getByRole("dialog", { name: "分配「线索甲」" });
  // 弹窗开完才重置表单、取候选人，太早点开的下拉会被收回去：没展开就再点
  const 接手人 = 弹窗.getByRole("combobox", { name: /接手人/ });
  const 那项 = page.locator(`.ant-select-dropdown:visible .ant-select-item-option`, { hasText: 种.名字.销售2 });
  await expect(async () => {
    await 接手人.click();
    await expect(那项).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await 那项.click();
  await 弹窗.getByRole("button", { name: /分\s*配/ }).click();
  await expect(提示(page, `「线索甲」已分给 ${种.名字.销售2}`)).toBeVisible();

  const 销售2 = await db.user.findFirstOrThrow({ where: { email: 账号.销售2 } });
  expect((await db.project.findFirstOrThrow({ where: { name: "线索甲" } })).ownerId).toBe(销售2.id);
});

test("多角色：老板给销售甲加上市场管理，他就能分配线索；去掉又没了", async ({ page }) => {
  const 正文 = page.getByRole("main");
  const 销售1 = await db.user.findFirstOrThrow({ where: { email: 账号.销售1 } });
  const 角色 = async () => (await db.entMember.findUniqueOrThrow({ where: { userId: 销售1.id } })).bizRole;
  const 看分配 = async (有: boolean) => {
    await page.context().clearCookies();
    await 登录(page, "销售1");
    await page.goto("/leads");
    await expect(正文.getByText("线索乙").first()).toBeVisible();
    await expect(正文.getByRole("button", { name: "分配 线索乙", exact: true })).toHaveCount(有 ? 1 : 0);
  };

  await 登录(page, "老板");
  await page.goto("/settings?tab=org");
  await 选(page, `${种.名字.销售1} 的角色`, "市场管理");
  await expect.poll(角色).toBe("sales,marketing_mgr");
  await 看分配(true);

  await page.context().clearCookies();
  await 登录(page, "老板");
  await page.goto("/settings?tab=org");
  await 正文.getByTestId(`org-member-${销售1.id}`).locator(".ant-select-selection-item", { hasText: "市场管理" })
    .locator(".ant-select-selection-item-remove").click();
  await expect.poll(角色).toBe("sales");
  await 看分配(false);
});

test("字段权限：销售的备注只能看就改不了；电话看不到就打码，改别的照样能存；老板不受限", async ({ page }) => {
  const 正文 = page.getByRole("main");
  const 存表 = async () => {
    await 正文.getByTestId("org-field-perm-save").click();
    await expect(提示(page, "字段权限已保存").last()).toBeVisible();
  };
  const 编辑 = async () => {
    await page.goto("/customers");
    // 行上的编辑、删除收进「⋯」（交互规则 D，10-30）
    const 更多 = 正文.getByRole("button", { name: "更多操作 销售甲的客户", exact: true });
    // 服务端出的 HTML 里按钮就在；React 接管（挂上 onClick）之前点下去会落空、菜单不出来（PR #273 CI：客户页这一包变大后 dev 下接管变慢）。
    // 等按钮身上有了 React 的属性再点，同 e2e/shell-pane.spec.ts
    await expect.poll(() => 更多.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { message: "「⋯」一直没被 React 接管" }).toBe(true);
    await 更多.click();
    await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
    return page.getByRole("dialog", { name: "编辑客户" });
  };
  const 换人 = async (谁: keyof typeof 账号) => {
    await page.context().clearCookies();
    await 登录(page, 谁);
  };

  await 登录(page, "老板");
  await page.goto("/settings?tab=org");
  await 选(page, "销售成员 对「备注」", "只能看");
  await 存表();

  await 换人("销售1");
  let 框 = await 编辑();
  await 框.getByLabel("备注").fill("销售改的备注");
  await 框.getByRole("button", { name: /保\s*存/ }).click();
  await expect(提示(page, "你的角色不能改「备注」")).toBeVisible();
  expect((await db.customer.findUniqueOrThrow({ where: { id: 种.自己客户 } })).remark).toBe("原备注");

  await 换人("老板");
  await page.goto("/settings?tab=org");
  await 选(page, "销售成员 对「电话 / WhatsApp」", "看不到");
  await 存表();
  await page.goto(`/customers/${种.自己客户}`);
  await expect(正文.getByText("13900000002").first()).toBeVisible();

  await 换人("销售1");
  await page.goto(`/customers/${种.自己客户}`);
  await expect(正文.getByText("139****0002").first()).toBeVisible();
  await expect(正文.getByText("13900000002")).toHaveCount(0);
  // 号码打着码进编辑框，不碰电话、只改姓名也得存得下，号码不能被打码串覆盖
  框 = await 编辑();
  await 框.getByLabel("客户全称").fill("销售甲的客户改名"); // 企业版客户是单位，这格叫「客户全称」
  await 框.getByRole("button", { name: /保\s*存/ }).click();
  await expect(框).toBeHidden();
  const 改后 = await db.customer.findUniqueOrThrow({ where: { id: 种.自己客户 } });
  expect(改后.name).toBe("销售甲的客户改名");
  expect(改后.phone).toBe("13900000002");
});

// 负责人本人转自己的客户 = 申请移交（P-转-16，不看「交接要确认」开关；系统管理员、上级转的直接转）：先挂起，接手人接受了才换人，项目跟着走。放在字段权限后面（那条要销售甲还管着这位客户）
test("申请移交：销售甲把自己的客户转给销售乙，接受前还归销售甲、销售乙看不到；销售乙接受后客户和项目都归他", async ({ page }) => {
  const 正文 = page.getByRole("main");
  const 归谁 = async () => (await db.customer.findUniqueOrThrow({ where: { id: 种.自己客户 } })).salesOwnerId;
  const [销售1, 销售2] = await Promise.all([账号.销售1, 账号.销售2].map((email) => db.user.findFirstOrThrow({ where: { email } })));

  await 登录(page, "销售1");
  await page.goto("/customers");
  await 正文.getByRole("row", { name: /销售甲的客户/ }).getByRole("checkbox").check();
  await 正文.getByRole("button", { name: /批量分配/ }).click();
  // 侧栏也是 menuitem，限定在下拉里
  await page.locator(".ant-dropdown:not(.ant-dropdown-hidden)").getByRole("menuitem", { name: 种.名字.销售2 }).click();
  // 名下有项目（线索乙）先问一起转，再问转让原因（可不选）
  await page.getByRole("dialog").getByRole("button", { name: "一起转" }).click();
  await page.getByRole("dialog").filter({ hasText: `转给「${种.名字.销售2}」` }).getByRole("button", { name: /转\s*让/ }).click();
  // 列表批量入口：框标题照旧「转给「X」」、按钮「转让」；发出后提示 11-12 起统一叫「已发起客户转让」
  await expect(提示(page, `已发起客户转让：1 名等「${种.名字.销售2}」确认后生效`)).toBeVisible();
  expect(await 归谁()).toBe(销售1.id);

  await page.context().clearCookies();
  await 登录(page, "销售2");
  await page.goto("/customers");
  const 待确认 = 正文.locator(".ant-alert", { hasText: "等你确认" });
  // 接手人确认前看得到接的是谁（客户名；前面的用例可能改过名，只认开头）
  await expect(待确认).toContainText(new RegExp(`「${种.名字.销售1}」申请把自己名下的 1 位客户：销售甲的客户\\S*移交给你`));
  await expect(正文.getByRole("row", { name: /销售甲的客户/ })).toHaveCount(0);
  await 待确认.getByRole("button", { name: "接受" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /接\s*受/ }).click();
  await expect(提示(page, "已接手 1 位客户")).toBeVisible();
  await expect(正文.getByRole("row", { name: /销售甲的客户/ })).toBeVisible();
  expect(await 归谁()).toBe(销售2.id);
  expect((await db.project.findFirstOrThrow({ where: { name: "线索乙" } })).ownerId).toBe(销售2.id);
});

test("手机（飞书里打开）：登录回到要去的页，首页有拍名片入口带相机，「+」里能选；认名片接口要登录", async ({ browser, baseURL }) => {
  const 手机 = await browser.newContext({
    baseURL,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Lark/7.20.0 LarkLocale/zh_CN",
  });
  try {
    expect((await 手机.request.get("/api/mobile/scan")).status()).toBe(401);
    const page = await 手机.newPage();
    const 报错: string[] = [];
    page.on("pageerror", (e) => 报错.push(e.message));
    await page.goto("/login?next=/projects");
    await page.getByPlaceholder("用户名").fill(账号.销售1);
    await page.getByPlaceholder("登录密码").fill(种.密码);
    await page.getByRole("button", { name: /登\s*录/ }).click();
    // 看路径，不看整串：登录页自己的网址 /login?next=/projects 也含 /projects
    await page.waitForURL((u) => u.pathname === "/projects");
    await page.goto("/dashboard");
    await expect(page.locator('input[type="file"][capture="environment"]').first()).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "更多入口" }).click();
    for (const 项 of ["拍名片", "查重", "背调"]) await expect(page.getByText(项, { exact: true }).first()).toBeVisible();
    expect((await page.request.get("/api/mobile/scan")).status()).toBe(200);
    expect(报错).toEqual([]);
  } finally {
    await 手机.close();
  }
});

test("项目公海：原负责人看不到公海里的项目；客户在公海里时别的销售不能单领项目（灰着），在公海领客户，项目、客户、同客户的另一个项目一起归他", async ({ page }) => {
  await 登录(page, "销售1");
  // 11-01 C-01：项目进了公海，历史负责人没有任何权限，详情找不到（pool-owner.ts 原负责人回避）
  await page.goto(`/projects/${种.项目1}`);
  const 正文 = page.getByRole("main");
  await expect(正文.getByText("没有找到这条记录")).toBeVisible();
  await expect(正文.getByText("公海项目一")).toHaveCount(0);

  await page.context().clearCookies();
  await 登录(page, "销售2");
  // 11-09 起线索公海的项目能单独领（M-公海-06）；但这位客户本身在客户公海里，项目不能单独领，要先去客户公海领客户（pool-rules.ts 拦客户公海里的项目）
  // 客户在公海、谁都看得到：项目详情跳到客户详情的项目区（11-12 第 2 批），项目的领取按钮在项目区第一行（页头那颗「领取」是领客户的）
  await page.goto(`/projects/${种.项目1}`);
  await 停在项目页签(page, 种.客户, 种.项目1, "公海项目一");
  await expect(正文.getByText("这个项目在线索公海里", { exact: true })).toBeVisible();
  await expect(正文.getByText("这位客户在客户公海里，项目不能单独领、分或转：请先到客户公海领取或分配这位客户", { exact: true })).toBeVisible();
  await expect(正文.getByText(/你是原负责人/)).toHaveCount(0);
  await expect(正文.locator(".rec-zone .cd-zh").getByRole("button", { name: /领\s*取/ })).toBeDisabled();

  // 去公海领客户：客户在公海里，项目不另列一行；领客户即领项目
  await page.goto("/pool");
  await expect(正文.getByRole("button", { name: "领取 公海客户甲" })).toBeEnabled();
  // 客户行的「项目名称」里列着公海项目一，但没有单独的项目行（项目行才链到项目详情）
  await expect(正文.locator(`a[href="/projects/${种.项目1}"]`)).toHaveCount(0);
  await 正文.getByRole("button", { name: "领取 公海客户甲" }).click();
  await expect(page.locator(".ant-message-notice", { hasText: "已领取「公海客户甲」" })).toBeVisible();
  await expect(正文.getByRole("button", { name: "领取 公海客户甲" })).toHaveCount(0);
  await page.goto(`/projects/${种.项目1}`);
  await 停在项目页签(page, 种.客户, 种.项目1, "公海项目一");
  await expect(正文.getByText("这个项目在线索公海里")).toHaveCount(0);

  const 销售2 = await db.user.findFirstOrThrow({ where: { email: 账号.销售2 } });
  const [项目1, 项目2, 客户] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: 种.项目1 } }),
    db.project.findUniqueOrThrow({ where: { id: 种.项目2 } }),
    db.customer.findUniqueOrThrow({ where: { id: 种.客户 } }),
  ]);
  expect(项目1.ownerId).toBe(销售2.id);
  expect(项目1.pooledAt).toBeNull();
  expect(项目2.ownerId).toBe(销售2.id);
  expect(客户.salesOwnerId).toBe(销售2.id);
});
