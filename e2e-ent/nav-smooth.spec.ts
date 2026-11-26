import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "../src/generated/prisma";
import { ENT_DB, 账号, 读种子, type 种子 } from "./global-setup";

/**
 * 跳转优化 PR-A（11-24）：真 Next 里换一位客户、列表进详情不闪屏。
 * 用户原话：「不要闪屏，目前我在客户详情页从一个客户点到另一个客户，会有刷新。」
 * 修之前（3705 正式库副本实测）：点下去 30ms 旧内容就没了，接着 ~180ms 空白、~120ms 骨架，名单也整栏换成骨架再回来。
 * 现在：旧内容留到新内容提交那一帧，正文、中栏都不出骨架，名单那一栏不重挂；等得久了顶上出 2px 等待条。
 * 每帧（rAF）记一次；服务器回包人为压慢 600ms，让「中间那段」一定看得见。
 * 跨段（3703 实操二轮不过的那批）：起点不在 /customers 下（项目看板、手机菜单换页）时 (app)/loading 是新挂的边界，
 * 旧内容照样 40ms 就没了；撤掉它、首屏骨架改由壳里一直挂着的 <槽位> Suspense 出以后，跨段也是旧内容留到新内容就绪。
 */
test.describe.configure({ mode: "serial", retries: 0 });

let 种: 种子;
let db: PrismaClient;
const 前缀 = `换人客户${Date.now().toString(36)}`;
const ids: string[] = [];
const 项目们: string[] = [];

test.beforeAll(async () => {
  种 = 读种子();
  db = new PrismaClient<import("../src/generated/prisma").Prisma.PrismaClientOptions>({ datasources: { db: { url: `file:${ENT_DB}` } } });
  const 老板 = await db.user.findFirstOrThrow({ where: { email: 账号.老板 } });
  for (let i = 1; i <= 3; i++) {
    const c = await db.customer.create({ data: { name: `${前缀}-${i}`, phone: "", contacts: { create: { name: "", phone: `139${String(Date.now() + i).slice(-8)}`, isPrimary: true } }, salesOwnerId: 老板.id, lastFollowAt: new Date(Date.now() + i * 1000) } });
    ids.push(c.id);
  }
  // 项目 A→B：第一位客户挂两个项目（企业版项目在客户详情里开，胶囊切换）
  for (const i of [1, 2]) {
    const p = await db.project.create({ data: { name: `${前缀}-项目${i}`, customerId: ids[0], ownerId: 老板.id, creatorId: 老板.id } });
    项目们.push(p.id);
  }
});
test.afterAll(async () => {
  if (db) {
    await db.project.deleteMany({ where: { id: { in: 项目们 } } });
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

/**
 * 等 React 接管这块（水合完）：next dev 在 CI 慢机上 goto 回来、服务端那份已经画出来时，水合可能还没跑完。
 * 这时给服务端的 DOM 打 data-old，水合报属性对不上（CI 日志里抓到过 `- data-old="1"`）；
 * 点的也可能是水合前那份——项目胶囊水合时才量宽，第二颗收进「更多」，点在被收走的那颗上什么都不发生
 */
async function 等水合(page: Page, 选择器: string) {
  await expect
    .poll(() => page.locator(选择器).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))).catch(() => false), {
      message: `${选择器} 一直没被 React 接管`,
      timeout: 30_000,
    })
    .toBe(true);
}

/** 开始每帧记：旧内容（打了 data-old 的）在不在、新的 h1 出没出、有没有骨架、等待条、名单那一栏是不是原来那个节点 */
const 开始记 = async (page: Page, 旧选择器: string, 新名: string, 去的路径 = "") => {
  await 等水合(page, 旧选择器);
  await 记(page, 旧选择器, 新名, 去的路径);
};
const 记 = (page: Page, 旧选择器: string, 新名: string, 去的路径: string) => page.evaluate(([旧选择器, 新名, 去的路径]) => {
  document.querySelectorAll(旧选择器).forEach((e) => e.setAttribute("data-old", "1"));
  document.querySelector("aside.pane-roster")?.setAttribute("data-mark", "1");
  const w = window as unknown as { __帧: Record<string, boolean | string | number>[] };
  w.__帧 = [];
  const 骨架选择器 = "[data-testid=customer-skeleton], [data-testid=page-skeleton], .roster-skel";
  const 一帧 = () => {
    const h = document.querySelector("main h1.rec-head-name");
    const 骨架 = !!document.querySelector(骨架选择器);
    w.__帧.push({
      旧: !!document.querySelector("[data-old]"),
      // 换页按地址认：到了要去的那一页、旧的那块不在了、也不是骨架（正文里有东西）
      新: 去的路径
        ? location.pathname === 去的路径 && !document.querySelector("[data-old]") && !骨架 && !!document.querySelector("main .page-fade > *")
        : !!h && !h.hasAttribute("data-old") && h.getAttribute("title") === 新名,
      骨架,
      条: !!document.querySelector("[data-testid=nav-progress]"),
      名单原样: !!document.querySelector("aside.pane-roster[data-mark]"),
      // 点的那一行立刻是选中的样子（链接里的 .nav-pend）
      行亮: !!document.querySelector(".roster-row:has(> .nav-pend)"),
      // 表格点的那一行（DataList 的 .row-going）
      表格行亮: !!document.querySelector("main .ant-table-tbody > tr.row-going"),
      h1在: !!document.querySelector("main h1.rec-head-name"),
      // 正文外框的透明度（PageFade：同一种页只换 id 不淡，换栏目从 0.6 起淡）
      透明: Number(getComputedStyle(document.querySelector("main .page-fade") ?? document.body).opacity),
      // 项目胶囊：选中的是不是要去的那个
      胶囊: [...document.querySelectorAll(".cd-pj-pill.on")].map((e) => e.textContent).join("|"),
    });
    if (!w.__帧.some((f) => f.新) || w.__帧.length < 5) requestAnimationFrame(一帧);
  };
  一帧();
}, [旧选择器, 新名, 去的路径] as const);
type 帧 = { 旧: boolean; 新: boolean; 骨架: boolean; 条: boolean; 名单原样: boolean; 行亮: boolean; 表格行亮: boolean; h1在: boolean; 胶囊: string; 透明: number };
const 帧们 = (page: Page) => page.evaluate(() => (window as unknown as { __帧: 帧[] }).__帧);
/** 新页提交以后等待条要撤（每条用例收尾都查：pending 漏减、组件卸了没减都会让条一直挂着） */
const 条撤了 = (page: Page) => expect(page.locator("[data-testid=nav-progress]")).toHaveCount(0);

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
  // 同一种页只换 id：正文不淡，一帧都不暗下去（审查补：原来从 0 淡，整块先暗一下像刷新）
  await page.waitForTimeout(250);
  expect(Math.min(...(await 帧们(page)).map((f) => f.透明)), "换客户时正文透明度不掉到 0.6 以下").toBeGreaterThanOrEqual(0.6);
  await 条撤了(page);
});

test("连点两条：第一次被第二次顶掉，落到第二条，等待条照样撤、点过的行不留高亮", async ({ page }) => {
  await 登录(page);
  await page.goto(`/customers/${ids[0]}`);
  await expect(page.getByRole("main").locator("h1.rec-head-name")).toHaveAttribute("title", `${前缀}-1`);
  const 行 = (i: number) => page.locator(`aside.pane-roster a.roster-row[href="/customers/${ids[i]}"]`);
  await 行(2).waitFor();
  await 压慢(page);
  await 开始记(page, "main h1.rec-head-name", `${前缀}-3`);
  await 行(1).click();
  await page.waitForTimeout(150);
  await 行(2).click();
  await expect.poll(async () => (await 帧们(page)).some((f) => f.新), { timeout: 20_000 }).toBe(true);
  const 帧 = await 帧们(page);
  const 新 = 帧.findIndex((f) => f.新);
  expect(帧.slice(0, 新).filter((f) => f.骨架), "不出骨架").toEqual([]);
  expect(帧.slice(0, 新).some((f) => f.条), "等了 600ms，顶上该出等待条").toBe(true);
  await expect(page).toHaveURL(new RegExp(`/customers/${ids[2]}$`));
  // 第一次那一趟晚回来也不能把页面换回第二位
  await page.waitForTimeout(800);
  await expect(page.getByRole("main").locator("h1.rec-head-name")).toHaveAttribute("title", `${前缀}-3`);
  await 条撤了(page);
  await expect(page.locator(".nav-pend")).toHaveCount(0);
});

test("后退：回到上一位客户，不出骨架，等待条不留", async ({ page }) => {
  await 登录(page);
  await page.goto(`/customers/${ids[0]}`);
  await expect(page.getByRole("main").locator("h1.rec-head-name")).toHaveAttribute("title", `${前缀}-1`);
  await page.locator(`aside.pane-roster a.roster-row[href="/customers/${ids[1]}"]`).click();
  await expect(page.getByRole("main").locator("h1.rec-head-name")).toHaveAttribute("title", `${前缀}-2`);
  await 条撤了(page);
  await 压慢(page);
  await 开始记(page, "main h1.rec-head-name", `${前缀}-1`);
  await page.goBack();
  await expect.poll(async () => (await 帧们(page)).some((f) => f.新), { timeout: 20_000 }).toBe(true);
  const 帧 = await 帧们(page);
  const 新 = 帧.findIndex((f) => f.新);
  expect(帧.slice(0, 新).every((f) => f.旧), "上一位出来之前当前这位一直在").toBe(true);
  expect(帧.filter((f) => f.骨架), "不出骨架").toEqual([]);
  expect(帧.every((f) => f.名单原样), "名单那一栏还是原来那个节点").toBe(true);
  await expect(page).toHaveURL(new RegExp(`/customers/${ids[0]}$`));
  await 条撤了(page);
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
  await 条撤了(page);
});

test("表格里点一行（不点名字）进详情：那一行立刻高亮、等久了出等待条，表格留到详情就绪", async ({ page }) => {
  await 登录(page);
  await page.goto(`/customers?keyword=${encodeURIComponent(前缀)}`);
  const 行 = page.getByRole("main").locator("tr", { has: page.getByRole("link", { name: `${前缀}-2`, exact: true }) });
  await 行.waitFor();
  // 点一格里没有链接、按钮、勾选框的（DataList onRow 只认这种）
  const 第 = await 行.locator("td").evaluateAll((tds) => tds.findIndex((td) => !td.querySelector("a, button, .ant-checkbox-wrapper, .ant-select, .ant-dropdown-trigger") && td.getBoundingClientRect().width > 20));
  expect(第).toBeGreaterThan(-1);
  await 压慢(page);
  await 开始记(page, "main .ant-table", `${前缀}-2`);
  await 行.locator("td").nth(第).click();
  await expect.poll(async () => (await 帧们(page)).some((f) => f.新), { timeout: 20_000 }).toBe(true);
  const 帧 = await 帧们(page);
  const 新 = 帧.findIndex((f) => f.新);
  expect(帧.slice(0, 新).every((f) => f.旧), "详情出来之前表格一直在").toBe(true);
  expect(帧.slice(0, 新).filter((f) => f.骨架), "提交之前不出骨架").toEqual([]);
  const 亮起 = 帧.findIndex((f) => f.表格行亮);
  expect(亮起, "点的那一行该立刻高亮").toBeGreaterThan(-1);
  expect(帧.slice(亮起, 新).every((f) => f.表格行亮)).toBe(true);
  expect(帧.slice(0, 新).some((f) => f.条), "等了 600ms，顶上该出等待条").toBe(true);
  await 条撤了(page);
});

test("项目 A→B（客户详情里点项目胶囊）：不出骨架，客户页头一直在", async ({ page }) => {
  await 登录(page);
  await page.goto(`/customers/${ids[0]}?project=${项目们[0]}`);
  await expect(page.getByRole("tablist", { name: "这位客户的项目" }).getByRole("tab", { selected: true })).toContainText(`${前缀}-项目1`);
  // 1366 宽时第二个项目收在「更多 1 个」里（ProjectZone 的下拉，走 useNavGo）；摆得下时就是一颗胶囊（Link + LinkPending）
  const 胶囊 = page.locator(`.cd-pj-pill[href*="project=${项目们[1]}"]`);
  const 更多 = page.getByRole("button", { name: /更多 \d+ 个/ });
  // 先等胶囊量过宽（水合后 ProjectSwitch 的 useLayoutEffect 量完才给每颗写 min-width）再看走哪条：
  // 服务端那份是全摆，量完 1280 宽收成「1 颗 + 更多」——量之前去数，数到的是要被收走的那颗（CI 红过的就是这样，本机 CPU 压 20 倍复现）
  await 等水合(page, ".cd-pj-pills");
  await expect(page.locator(".cd-pj-pills > .cd-pj-pill[role=tab][style*='min-width']").first()).toBeAttached();
  await expect(胶囊.or(更多).first()).toBeVisible();
  await 压慢(page);
  await 开始记(page, "main h1.rec-head-name", "（不换人）");
  if (await 胶囊.count()) await 胶囊.click();
  else {
    await 更多.click();
    await page.locator(".cd-pj-menu .cd-pj-mi", { hasText: `${前缀}-项目2` }).click();
  }
  await expect.poll(async () => (await 帧们(page)).at(-1)?.胶囊 ?? "", { timeout: 20_000 }).toContain(`${前缀}-项目2`);
  await page.waitForTimeout(300);
  const 帧 = await 帧们(page);
  expect(帧.filter((f) => f.骨架), "不出骨架").toEqual([]);
  expect(帧.every((f) => f.h1在 && f.名单原样), "客户页头、名单一直在").toBe(true);
  expect(Math.min(...帧.map((f) => f.透明)), "同一页换 ?project= 不是换页，正文不淡").toBeGreaterThanOrEqual(0.6);
  await 条撤了(page);
});

test("390 手机：名单抽屉里换一位，不出骨架，旧内容留到新内容", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await 登录(page);
  await page.goto(`/customers/${ids[0]}`);
  await expect(page.getByRole("main").locator("h1.rec-head-name")).toHaveAttribute("title", `${前缀}-1`);
  await page.getByRole("button", { name: "显示客户名单" }).first().click();
  const 行 = page.locator(`.pane-drawer a.roster-row[href="/customers/${ids[2]}"]`);
  await 行.waitFor();
  await 压慢(page);
  await 开始记(page, "main h1.rec-head-name", `${前缀}-3`);
  await 行.click();
  await expect.poll(async () => (await 帧们(page)).some((f) => f.新), { timeout: 20_000 }).toBe(true);
  const 帧 = await 帧们(page);
  const 新 = 帧.findIndex((f) => f.新);
  expect(帧.slice(0, 新).every((f) => f.旧), "新内容出来之前旧内容一直在").toBe(true);
  expect(帧.filter((f) => f.骨架), "不出骨架").toEqual([]);
  expect(帧.slice(0, 新).some((f) => f.条), "等了 600ms，顶上该出等待条").toBe(true);
  await 条撤了(page);
});

test("跨段：项目看板点卡进客户详情，看板留到详情就绪，正文不出骨架", async ({ page }) => {
  await 登录(page);
  await page.goto("/projects");
  const 卡 = page.locator(`.pipe-card[aria-label*="${前缀}-项目1"]`);
  await 卡.waitFor();
  await 压慢(page);
  await 开始记(page, "main .pipe-card", `${前缀}-1`);
  await 卡.click();
  await expect.poll(async () => (await 帧们(page)).some((f) => f.新), { timeout: 20_000 }).toBe(true);
  const 帧 = await 帧们(page);
  const 新 = 帧.findIndex((f) => f.新);
  // 改前：点下去 ~40ms (app)/loading 新挂、看板被正文骨架顶掉
  expect(帧.slice(0, 新).every((f) => f.旧), "详情出来之前看板一直在").toBe(true);
  expect(帧.slice(0, 新).filter((f) => f.骨架), "提交之前不出骨架").toEqual([]);
  expect(帧.slice(0, 新).some((f) => f.条), "等了 600ms，顶上该出等待条").toBe(true);
  await 条撤了(page);
});

test("390 手机：菜单换页（客户详情 → 公海），旧内容留到新页就绪，不出通用骨架", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await 登录(page);
  await page.goto(`/customers/${ids[0]}`);
  await expect(page.getByRole("main").locator("h1.rec-head-name")).toHaveAttribute("title", `${前缀}-1`);
  await page.getByRole("button", { name: "打开导航菜单" }).click();
  // 企业版菜单：首页 / 复盘 / 渠道 / 公海 / 客户（lib/enterprise/nav.ts）；菜单项的读屏名带图标名，按文字认
  const 项 = page.locator(".ant-dropdown-menu-item").filter({ hasText: /^公海$/ });
  await 项.waitFor();
  await 压慢(page);
  await 开始记(page, "main h1.rec-head-name", "", "/pool");
  await 项.click();
  await expect.poll(async () => (await 帧们(page)).some((f) => f.新), { timeout: 20_000 }).toBe(true);
  const 帧 = await 帧们(page);
  const 新 = 帧.findIndex((f) => f.新);
  expect(帧.slice(0, 新).every((f) => f.旧), "新页出来之前旧内容一直在").toBe(true);
  expect(帧.filter((f) => f.骨架), "不出骨架").toEqual([]);
  expect(帧.slice(0, 新).some((f) => f.条), "等了 600ms，顶上该出等待条").toBe(true);
  await 条撤了(page);
});

/** 旧内容没了、新内容还没好的帧数（正文空白），只数新内容出来之前的 */
const 空帧数 = (帧: 帧[]) => { const 新 = 帧.findIndex((f) => f.新); return 帧.slice(0, 新 < 0 ? 帧.length : 新).filter((f) => !f.旧 && !f.新).length; };

test("复盘看板 → 项目：链接直接是客户页项目地址，不经过 /projects/<id> 的重定向，正文不空", async ({ page }) => {
  await 登录(page);
  await page.goto("/overview?tab=talk");
  // 「还没沟通过的项目」（BoardTalks 缺沟通，最近建的在前）：本文件建的项目都没记过沟通
  const 链 = page.locator("main a.rtalk-miss-a", { hasText: `${前缀}-项目2` });
  await 链.waitFor();
  // 改前 href 是 /projects/<id>：服务端 redirect，Next 的 RedirectBoundary 接住时先渲染 null（正文空到客户页回来）
  const 原href = await 链.getAttribute("href");
  await 压慢(page);
  await 开始记(page, "main .rtalk-miss", `${前缀}-1`);
  await 链.click();
  await expect.poll(async () => (await 帧们(page)).some((f) => f.新), { timeout: 20_000 }).toBe(true);
  const 帧 = await 帧们(page);
  console.log(`[复盘看板→项目] 空帧 ${空帧数(帧)} / 共 ${帧.findIndex((f) => f.新)} 帧`);
  expect(空帧数(帧), "旧内容留到客户页就绪，中间不空").toBe(0);
  expect(帧.slice(0, 帧.findIndex((f) => f.新)).filter((f) => f.骨架), "提交之前不出骨架").toEqual([]);
  expect(原href, "入口直接链到客户页项目地址").toBe(`/customers/${ids[0]}?project=${项目们[1]}`);
  await expect(page).toHaveURL(new RegExp(`/customers/${ids[0]}\\?project=${项目们[1]}`));
  await 条撤了(page);
});

test("通知铃 → 项目：存的 /projects/<id> 链接服务端换成客户页地址，点了正文不空", async ({ page }) => {
  const 老板 = await db.user.findFirstOrThrow({ where: { email: 账号.老板 } });
  const 题 = `${前缀}-通知`;
  await db.entNotice.create({ data: { userId: 老板.id, kind: "项目组", title: 题, body: "", link: `/projects/${项目们[0]}`, dedupeKey: `${前缀}-n1` } });
  try {
    await 登录(page);
    await page.goto(`/customers?keyword=${encodeURIComponent(前缀)}`);
    await page.getByRole("main").getByRole("link", { name: `${前缀}-3`, exact: true }).waitFor();
    await page.getByRole("button", { name: /^通知/ }).first().click();
    const 条 = page.getByRole("button", { name: new RegExp(题) });
    await 条.waitFor();
    await 压慢(page);
    await 开始记(page, "main .ant-table", `${前缀}-1`);
    await 条.click();
    await expect.poll(async () => (await 帧们(page)).some((f) => f.新), { timeout: 20_000 }).toBe(true);
    const 帧 = await 帧们(page);
    console.log(`[通知铃→项目] 空帧 ${空帧数(帧)} / 共 ${帧.findIndex((f) => f.新)} 帧`);
    expect(空帧数(帧), "旧内容留到客户页就绪，中间不空").toBe(0);
    await expect(page).toHaveURL(new RegExp(`/customers/${ids[0]}\\?project=${项目们[0]}`));
    await 条撤了(page);
  } finally {
    await db.entNotice.deleteMany({ where: { dedupeKey: `${前缀}-n1` } });
  }
});

test("名单后台换新的接口：登录了回这个人的名单（和服务端名单同一个函数），没登录 401", async ({ page, playwright }) => {
  await 登录(page);
  const r = await page.request.get("/api/roster/customers");
  expect(r.status()).toBe(200);
  const 名单 = (await r.json()) as { total: number; rows: { name: string }[] };
  expect(名单.rows.map((x) => x.name)).toEqual(expect.arrayContaining([`${前缀}-1`, `${前缀}-2`, `${前缀}-3`]));
  expect((await page.request.get("/api/roster/projects")).status()).toBe(200);
  const 生人 = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  expect((await 生人.get("/api/roster/customers", { maxRedirects: 0 })).status()).toBe(401);
  await 生人.dispose();
});
