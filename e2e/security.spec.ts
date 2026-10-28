/**
 * 安全组的浏览器端部分。
 *
 * 存储型 XSS 只能在真浏览器里验：要看的是「脚本会不会被执行」，
 * 在 Node 里断言字符串里有没有尖括号毫无意义——
 * 转义与否取决于渲染时怎么插进 DOM，不取决于存了什么。
 */
import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { 企业版, 负责人锁给自己 } from "./owner-pick";
import { 连库 } from "./mock-data";
import { 阈值 } from "../src/lib/rate-limit";

const 账号 = { 用户名: "zhangsan", 密码: "admin123" };
const 戳 = String(Date.now()).slice(-6);

/** 几种常见载荷：标签注入、属性事件、伪协议 */
const 载荷 = [
  '<script>window.__被执行了=1</script>',
  '<img src=x onerror="window.__被执行了=1">',
  '"><svg onload="window.__被执行了=1">',
];

async function 登录(page: Page) {
  await page.goto("/login");
  const 提示 = page.locator(".ant-alert");
  for (let i = 0; i < 3; i++) {
    await page.getByPlaceholder("用户名").fill(账号.用户名);
    await page.getByPlaceholder("登录密码").fill(账号.密码);
    await page.getByRole("button", { name: /登\s*录/ }).click();
    for (let t = 0; t < 40; t++) {
      if (/\/dashboard/.test(page.url())) return;
      if (await 提示.isVisible().catch(() => false)) throw new Error("登录失败");
      await page.waitForTimeout(200);
    }
  }
  throw new Error("登录没反应");
}

test.describe.configure({ mode: "serial" });

test("存储型 XSS：客户备注里的脚本不会被执行，按字面显示", async ({ page }) => {
  test.skip(企业版, "企业版只用项目：客户 / 线索的「新建」去项目页新建，不弹老的新建框；在开关关着那套里验（备注按字面显示的渲染两套共用）");
  const 弹窗数 = { n: 0 };
  page.on("dialog", async (d) => { 弹窗数.n++; await d.dismiss(); });

  await 登录(page);
  const 姓名 = `XSS${戳}`;

  await page.goto("/customers");
  await page.getByRole("button", { name: /新建客户/ }).click();
  const 表单 = page.getByRole("dialog");
  await 表单.getByLabel("客户姓名").fill(姓名);
  await 表单.getByLabel("联系电话").fill(`1375${戳}`.slice(0, 11).padEnd(11, "8"));
  await 表单.getByLabel("备注").fill(载荷.join("\n"));
  if (企业版) await 负责人锁给自己(表单);
  else {
    await 表单.getByLabel("销售负责人").click();
    const 下拉 = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
    await 下拉.waitFor({ state: "visible" });
    await 下拉.locator(".ant-select-item-option").first().click();
  }
  await 表单.getByRole("button", { name: /保\s*存/ }).click();
  await expect(表单).toBeHidden();

  // 重新加载，走的是「从库里读出来再渲染」这条路——存储型 XSS 真正发作的时机
  await page.goto("/customers");
  // 三栏壳的中栏也列客户，同一个名字会出现两个链接——要点的是正文列表里那个
  await page.locator("main").getByRole("link", { name: 姓名 }).click();
  // 记录页的备注常驻左栏，不用切页签
  await page.getByText("备注").first().waitFor();

  // 1. 脚本没有执行
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__被执行了)).toBeUndefined();
  expect(弹窗数.n, "弹出了对话框，说明载荷被执行了").toBe(0);

  // 2. 没有真的往 DOM 里插进标签
  const 注入的元素 = await page.evaluate(() =>
    document.querySelectorAll("script[data-x], img[onerror], svg[onload]").length,
  );
  expect(注入的元素).toBe(0);

  // 3. 内容按字面显示出来，不是被吞掉了——转义正确的表现是「看得见但不生效」
  await expect(page.locator("main").getByText("<script>", { exact: false }).first()).toBeVisible();
});

test("存储型 XSS：跟进内容同样不会被执行", async ({ page }) => {
  test.skip(企业版, "依赖上一条新建的 XSS 客户；企业版新建客户去项目页，上一条已跳过；在开关关着那套里验");
  const 弹窗数 = { n: 0 };
  page.on("dialog", async (d) => { 弹窗数.n++; await d.dismiss(); });

  await 登录(page);
  await page.goto("/customers");
  await page.locator("main").getByRole("link", { name: `XSS${戳}` }).click();

  await page.getByRole("button", { name: /记录跟进/ }).first().click();
  const 表单 = page.getByRole("dialog");
  await 表单.getByLabel("标题").fill(`跟进${戳}`);
  await 表单.getByLabel("沟通内容").fill(载荷.join(" "));
  await 表单.getByRole("button", { name: /保\s*存|确\s*定/ }).click();
  await expect(表单).toBeHidden();

  await page.reload();
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__被执行了)).toBeUndefined();
  expect(弹窗数.n).toBe(0);
  // 中栏的「最近一句」也会把这段载荷按字面显示出来，这里要验的是正文那条
  await expect(page.locator("main").getByText("onerror", { exact: false }).first()).toBeVisible();
});

/*
  限流的计数在服务端进程内（src/lib/rate-limit.ts 的 Map，按账号记），别的用例只要登录 lisi 成功就会把 lisi 的计数清零，
  CI 重试时状态也被上一遍动过。所以这条自己造一个只给它用的账号（真账号、密码错——走的是「密码错误」那条路，
  和原来试 lisi 一样），每一遍换一个名字，计数从 0 开始、谁也碰不到。
*/
const 限流账号 = `rl-${戳}-${Math.random().toString(36).slice(2, 6)}`;
test.afterAll(async () => {
  const p = 连库();
  try {
    await p.user.deleteMany({ where: { email: { startsWith: `rl-${戳}-` } } });
  } finally {
    await p.$disconnect();
  }
});

test("登录失败到阈值后会被限流，且提示说明要等多久", async ({ page }) => {
  const p = 连库();
  try {
    await p.user.create({ data: { name: "限流专用", email: 限流账号, password: await bcrypt.hash("对的密码-不会用到", 4), role: "SALES", active: true } });
  } finally {
    await p.$disconnect();
  }
  await page.goto("/login");

  /*
    每一下都等这一次登录请求真的回来，再看它回的是什么。
    原来是点完 `await expect(提示).toBeVisible()` 就读字：提交时提示先收起、带着淡出动画还在，
    上一次的「密码错误」那条立刻算「看得见」，读到的是旧字；到阈值那一下可能读漏。
    前几次的提示字一模一样，等「字变了」也分不出新旧，所以看这一次请求的回话。
    回话从路由里转一手拿：浏览器那边的 response.body() 对这种没写字符集的 text/x-component 会按西文解码，中文成了乱码；
    route.fetch() 拿到的是服务端原样的字节，照样交还给页面，页面行为不变
  */
  const 回话们: string[] = [];
  await page.route("**/login", async (route) => {
    const req = route.request();
    if (req.method() !== "POST" || !req.headers()["next-action"]) return route.fallback();
    const 回 = await route.fetch();
    回话们.push((await 回.body()).toString("utf8"));
    await route.fulfill({ response: 回 });
  });
  let 被限流 = false;
  let 试了 = 0;
  for (let i = 0; i < 8 && !被限流; i++) {
    await page.getByPlaceholder("用户名").fill(限流账号);
    await page.getByPlaceholder("登录密码").fill(`错的密码${i}`);
    await page.getByRole("button", { name: /登\s*录/ }).click();
    await expect.poll(() => 回话们.length, { message: `第 ${试了 + 1} 次登录请求没回来` }).toBe(试了 + 1);
    const 字 = 回话们[试了];
    试了++;
    被限流 = 字.includes("失败次数过多");
    // 没被限流的那几下，回的必须是「密码错误」：别的错（比如服务器挂了）不能被当成「还没到阈值」一路试下去
    if (!被限流) expect(字, `第 ${试了} 次没被限流，回的也不是密码错误`).toContain("密码错误");
  }

  expect(被限流, "连试 8 次都没有被限流，撞库脚本可以不限速地试").toBe(true);
  // 按账号的阈值是 5 次：错满 5 次，第 6 次就该挡住（账号是新造的，前面没有别人留下的计数）
  expect(试了).toBe(阈值 + 1);
  // 页面上看得到这句，且说了要等多久
  const 限流提示 = page.locator(".ant-alert", { hasText: /失败次数过多/ });
  await expect(限流提示).toBeVisible();
  await expect(限流提示).toContainText(/分钟后再试/);
});
