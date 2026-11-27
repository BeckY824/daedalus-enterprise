import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* 合并申请页 · 第二段（11-26，customers/merge-requests/MergeRequestsView.tsx；P-界面-67）：真组件 + globals.css + merge.css，只桩掉 merge-actions。钉的是：
   等我同意每张同意 / 拒绝两颗；同意框按我站哪边说后果（并掉那家：N 个项目挪到留下那家、仍归你；留下那家：项目不动、多出联系人和沟通），
   最后一位多一句「立即合并，30 天内发起人可撤回」；拒绝原因必填、超 100 字点不了；办成了留在表里写结果，没办成原因写在框里、框不关；
   只读管理员、切换视图：列表照常、按钮置灰、悬停写原因；390 一列卡片、按钮 ≥ 44px；768 / 1024 / 1280 / 1440 / 390 不横滚，长客户名一行省略悬停看全 */
let browser: Browser, bundle: string;
const 长名 = "超长的测试客户名称用来看会不会撑破".repeat(2) + "出来的测试四"; // 40 个汉字
const 动作 = `
  const 记=(...a)=>(window.__调??=[]).push(a);
  export const 处理客户合并申请=async(id,结论,原因,已问过)=>{记('处理',id,结论,原因,...(已问过===undefined?[]:[已问过]));return (window.__处理结果??{})[id]??{ok:true,状态:'待同意'}};
  export const 撤回客户合并申请=async(id)=>{记('撤申请',id);return {ok:true}};`;
const plugin: Plugin = { name: "merge-requests", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)merge-actions$/, 补全动作桩("src/app/(app)/customers/merge-actions.ts", 动作));
  stub(/^next\/link$/, "export default function L({children,prefetch,...p}){return <a {...p}>{children}</a>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷=(window.__刷??0)+1},push(){},replace(){},prefetch(){}});export const usePathname=()=>'/customers/merge-requests';");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import MergeRequestsView from '@/app/(app)/customers/merge-requests/MergeRequestsView';import {切换视图Provider} from '@/components/ViewAsContext';
    window.__render=(p,视图)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><切换视图Provider value={!!视图}><MergeRequestsView {...p}/></切换视图Provider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 我 = "me";
const 天后 = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const 人 = (userId: string, 名: string, 状态: string, 补: object = {}) => ({ userId, 名, 凭: [], 项目: [], 状态, 一句: null, 处理: null, ...补 });
/** w1：我是并进来那家的客户负责人、那家名下有我 2 个项目，还有同事 C 没同意；w2：我是留下那家的项目负责人，同事 B 已同意（我是最后一位） */
const 等我 = [
  {
    id: "w1", 状态: "待同意", 原因: null, 留下: { id: "A1", 名: "示例客户乙" }, 并掉: { id: "B1", 名: 长名 }, 发起人: "示例同事A", 发起: 天后(-1), 到期: 天后(4), 结束: null, mergeId: null,
    同意人: [
      人(我, "我", "待同意", { 凭: ["被并客户负责人", "项目负责人"], 项目: [{ id: "p1", name: "示例项目一", customerId: "B1" }, { id: "p2", name: "示例项目二", customerId: "B1" }] }),
      人("c", "示例同事C", "待同意", { 凭: ["项目负责人"] }),
    ],
  },
  {
    id: "w2", 状态: "待同意", 原因: null, 留下: { id: "A2", 名: "示例客户丙" }, 并掉: { id: "B2", 名: "示例客户丁" }, 发起人: "示例同事A", 发起: 天后(-3), 到期: 天后(0.5), 结束: null, mergeId: null,
    同意人: [人("b", "示例同事B", "同意"), 人(我, "我", "待同意", { 凭: ["项目负责人"], 项目: [{ id: "p3", name: "示例项目三", customerId: "A2" }] })],
  },
];
const 我发起 = [
  { id: "m1", 状态: "待同意", 原因: null, 留下: { id: "A3", 名: 长名 }, 并掉: { id: "B3", 名: "同事负责的客户（号码撞上） 42" }, 发起人: "我", 发起: 天后(-2), 到期: 天后(3), 结束: null, mergeId: null, 同意人: [人("b", "示例同事B", "同意"), 人("c", "示例同事C", "待同意")] },
  { id: "m2", 状态: "已拒绝", 原因: "示例同事B拒绝：还在跟进", 留下: { id: "A4", 名: "示例客户壬" }, 并掉: { id: "B4", 名: "示例客户癸" }, 发起人: "我", 发起: 天后(-5), 到期: 天后(0), 结束: 天后(-4), mergeId: null, 同意人: [人("b", "示例同事B", "拒绝", { 一句: "还在跟进" })] },
];

async function open(width: number, 补: object = {}, 视图 = false, 设: Record<string, unknown> = {}) {
  const page = await browser.newPage({ viewport: { width, height: width < 768 ? 844 : 900 } }); page.setDefaultTimeout(5000);
  const 错: string[] = [];
  page.on("pageerror", e => 错.push(String(e)));
  page.on("console", m => { if (m.type() === "error") 错.push(m.text()); });
  await page.route("http://mrq.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://mrq.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ path: path.resolve("src/app/(app)/customers/merge.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => Object.assign(window, x), 设);
  await page.evaluate(([p, v]) => (window as unknown as { __render: (p: object, v: boolean) => void }).__render(p as object, v as boolean), [{ 等我, 我发起, 我, ...补 }, 视图] as const);
  await page.getByText("等我同意").first().waitFor();
  return { page, 错 };
}
/** 表格和卡片两套都在 DOM 里、CSS 显隐：按钮、结果这些按可见那份找 */
const 见 = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const 调 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? []);
const 横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const 框 = (page: Page) => 见(page, "merge-request-box");
const 截图 = (page: Page, 名: string) => process.env.MERGE_SHOT_DIR ? page.screenshot({ path: path.join(process.env.MERGE_SHOT_DIR, 名), fullPage: true }) : Promise.resolve();

it("同意：并掉那家这边说「N 个项目挪到留下那家，仍归你」、还差几位；确认后这一行留着写「你已同意，还差 1 位」；长客户名一行省略悬停看全", async () => {
  const { page, 错 } = await open(1280);
  try {
    const 表 = 见(page, "merge-req-wait");
    expect(await 表.locator(".ant-table-row").count()).toBe(2);
    expect(await page.locator(".mrq-cnt").innerText()).toBe("2 张等你处理");
    const 合并格 = 表.locator(".ant-table-row").first().locator("td").first().locator("span[title]");
    expect(await 合并格.getAttribute("title")).toBe(`「${长名}」并进「示例客户乙」`);
    expect(await 表.locator(".ant-table-row").first().locator("td").first().evaluate((e) => [getComputedStyle(e).textOverflow, e.scrollWidth > e.clientWidth])).toEqual(["ellipsis", true]);
    await 截图(page, "合并申请-1280.png");

    await 表.getByTestId("merge-request-agree").first().click();
    await 框(page).waitFor();
    expect(await page.locator(".mrg-modal .ant-modal-title").innerText()).toBe("同意这张合并申请？");
    expect(await 见(page, "merge-request-effect").innerText()).toBe("同意后，你的 2 个项目挪到留下那家，仍归你。");
    expect(await 框(page).innerText()).toContain("还差 1 位同意才合并。");
    expect(await 见(page, "merge-request-last").count()).toBe(0);
    // 框里两家各一行，长名省略、悬停看全
    const 并掉行 = 框(page).locator(".mrq-two-r").nth(1).locator(".mrg-one");
    expect(await 并掉行.evaluate((e) => [e.scrollWidth > e.clientWidth, e.getAttribute("title")])).toEqual([true, 长名]);
    await 截图(page, "合并申请-同意框-1280.png");
    await 见(page, "merge-request-agree-ok").click();
    await 见(page, "merge-request-done").first().waitFor();
    expect(await 调(page)).toEqual([["处理", "w1", "同意", undefined]]);
    const 完 = 见(page, "merge-request-done").first();
    expect(await 完.innerText()).toMatch(/已同意\s*你已同意，还差 1 位/);
    expect(await page.locator(".mrq-cnt").innerText()).toBe("1 张等你处理");
    // 办过的那行留在原位（第 1 行）、不再有同意 / 拒绝
    expect(await 表.locator(".ant-table-row").first().getByTestId("merge-request-agree").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __刷?: number }).__刷)).toBe(1);
    expect(错).toEqual([]);
  } finally { await page.close(); }
});

it("同意：留下那家的同事说「项目不动、多出联系人和沟通」；最后一位多一句立即合并、30 天内可撤回；合并了写「已合并 · 30 天内发起人可撤回」", async () => {
  const { page, 错 } = await open(1440, {}, false, { __处理结果: { w2: { ok: true, 状态: "已合并", mergeId: "mg1" } } });
  try {
    await 见(page, "merge-request-agree").nth(1).click();
    await 框(page).waitFor();
    expect(await 见(page, "merge-request-effect").innerText()).toBe("同意后，你的项目不动，客户会多出另一家的联系人和沟通。");
    expect(await 见(page, "merge-request-last").innerText()).toBe("你是最后一位：同意后立即合并，30 天内发起人可撤回。");
    await 见(page, "merge-request-agree-ok").click();
    await 见(page, "merge-request-done").waitFor();
    expect(await 见(page, "merge-request-done").innerText()).toMatch(/已合并\s*已合并 · 30 天内发起人可撤回/);
    // 进度格跟着办完结果：不再写办之前的「0 / 1 位同意」
    const 行 = page.locator(".ant-table-row", { has: page.getByTestId("merge-request-done") });
    expect(await 行.innerText()).not.toContain("位同意");
    expect(await 行.innerText()).toContain("已合并");
    expect(错).toEqual([]);
  } finally { await page.close(); }
});

it("拒绝：原因必填、空着和全空白点不了并提示、超 100 字点不了并写超出几字；带原因确认后写「你已拒绝：…」；没办成的原因写在框里、框不关", async () => {
  const { page, 错 } = await open(1280, {}, false, { __处理结果: { w2: { ok: false, error: "超过 5 个工作日没有全部同意，申请已失效，要重新发起" } } });
  try {
    await 见(page, "merge-request-reject").first().click();
    await 框(page).waitFor();
    expect(await page.locator(".mrg-modal .ant-modal-title").innerText()).toBe("拒绝这张合并申请");
    expect(await 见(page, "merge-request-effect").count()).toBe(0);
    const 确认 = 见(page, "merge-request-reject-ok");
    expect(await 确认.isDisabled()).toBe(true); // 必填：不写点不了「确认拒绝」
    expect(await 见(page, "merge-request-why-hint").innerText()).toBe("写一句原因才能拒绝");
    await 见(page, "merge-request-why").fill("   ");
    expect(await 确认.isDisabled()).toBe(true);
    await 见(page, "merge-request-why").fill("字".repeat(101));
    expect(await 确认.isDisabled()).toBe(true);
    expect(await 框(page).innerText()).toContain("超出 1 字");
    expect(await 框(page).innerText()).toContain("101 / 100");
    await 见(page, "merge-request-why").fill("  这家还在我手上跟进  ");
    expect(await 确认.isDisabled()).toBe(false);
    await 确认.click();
    await 见(page, "merge-request-done").waitFor();
    expect(await 调(page)).toEqual([["处理", "w1", "拒绝", "这家还在我手上跟进"]]);
    expect(await 见(page, "merge-request-done").innerText()).toMatch(/已拒绝\s*你已拒绝：这家还在我手上跟进（已通知发起人和其余同意人）/);

    // 第二张：服务端说已失效 → 框不关、原因写在框里
    await 见(page, "merge-request-agree").first().click();
    await 见(page, "merge-request-agree-ok").click();
    await 见(page, "merge-request-err").waitFor();
    expect(await 见(page, "merge-request-err").innerText()).toContain("申请已失效");
    expect(await 框(page).isVisible()).toBe(true);
    expect(错).toEqual([]);
  } finally { await page.close(); }
});

it("只读管理员 / 切换视图在看别人：列表照常显示，同意、拒绝、撤回置灰，悬停写原因，点了不调动作", async () => {
  for (const [补, 视图, 话] of [[{ 只读原因: "只读管理员不能替人同意或拒绝" }, false, "只读管理员不能替人同意或拒绝"], [{}, true, "正在看别人的视角，只能看"]] as const) {
    const { page, 错 } = await open(1280, 补, 视图);
    try {
      expect(await 见(page, "merge-req-wait").locator(".ant-table-row").count()).toBe(2);
      expect(await 见(page, "merge-req-mine").locator(".ant-table-row").count()).toBe(2);
      expect(await 见(page, "merge-req-ro").innerText()).toContain(话);
      for (const id of ["merge-request-agree", "merge-request-reject", "merge-request-withdraw"]) {
        const 钮 = 见(page, id).first();
        expect(await 钮.isDisabled()).toBe(true);
        expect(await 钮.evaluate((e) => e.closest(".mrq-ro")?.getAttribute("title"))).toBe(话);
      }
      await page.locator(".mrq-ro").first().click({ force: true });
      expect(await 框(page).count()).toBe(0);
      expect(await 调(page)).toEqual([]);
      expect(错).toEqual([]);
    } finally { await page.close(); }
  }
});

it("手机 390：一张一块卡片、一项一行，同意 / 拒绝、撤回申请点击区 ≥ 44px；长名一行省略；各宽度不横滚", async () => {
  const { page, 错 } = await open(390);
  try {
    const 卡 = page.getByTestId("merge-req-wait-item");
    expect(await 卡.count()).toBe(2);
    expect(await page.locator(".ant-table:visible").count()).toBe(0);
    for (const id of ["merge-request-agree", "merge-request-reject", "merge-request-withdraw"]) {
      const h = await 见(page, id).first().evaluate((e) => e.getBoundingClientRect().height);
      expect(h, id).toBeGreaterThanOrEqual(44);
    }
    const 名 = 卡.first().locator(".mrq-v .mrg-one").first();
    expect(await 名.evaluate((e) => [getComputedStyle(e).whiteSpace, e.scrollWidth > e.clientWidth])).toEqual(["nowrap", true]);
    expect(await 横滚(page)).toBe(false);
    await 截图(page, "合并申请-390.png");
    // 手机上同意框照样弹、按钮 ≥ 44px
    await 见(page, "merge-request-agree").first().click();
    await 框(page).waitFor();
    // 弹框入场动画在缩放：量 offsetHeight（不受 transform 影响）
    expect(await 见(page, "merge-request-agree-ok").evaluate((e) => (e as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44);
    expect(await 横滚(page)).toBe(false);
    await 截图(page, "合并申请-同意框-390.png");
    expect(错).toEqual([]);
  } finally { await page.close(); }
  for (const w of [768, 1024, 1199, 1440]) {
    const { page } = await open(w);
    try { expect(await 横滚(page), String(w)).toBe(false); } finally { await page.close(); }
  }
});

it("处理第 1 张后它仍在第 1 行（3 张里），不跳到表底；状态标签读「显示状态」，作废显示「已作废」", async () => {
  const w3 = { ...等我[1], id: "w3", 留下: { id: "A5", 名: "示例客户戊" }, 并掉: { id: "B5", 名: "示例客户己" } };
  const 作废 = { ...我发起[1], id: "m3", 状态: "已失效", 显示状态: "已作废" };
  const { page, 错 } = await open(1280, { 等我: [等我[0], 等我[1], w3], 我发起: [...我发起, 作废] });
  try {
    const 表 = 见(page, "merge-req-wait");
    await 见(page, "merge-request-agree").first().click();
    await 见(page, "merge-request-agree-ok").click();
    await 见(page, "merge-request-done").waitFor();
    const 行 = 表.locator(".ant-table-row");
    expect(await 行.count()).toBe(3);
    expect(await 行.first().innerText()).toContain("你已同意，还差 1 位");
    expect(await 行.nth(1).getByTestId("merge-request-agree").count()).toBe(1);
    expect(await 行.nth(2).getByTestId("merge-request-agree").count()).toBe(1);
    const 发起 = 见(page, "merge-req-mine").locator(".ant-table-row");
    expect(await 发起.last().locator(".ant-tag").first().innerText()).toBe("已作废");
    expect(错).toEqual([]);
  } finally { await page.close(); }
});

it("E-431 ③：第 3 次交系统管理员判：同意框列出前两次拒绝原因（空写未填）、勾选框写出两位负责人姓名，不勾确认同意点不了，勾了才带「已问过」提交", async () => {
  const 管理员行 = {
    id: "w9", 状态: "待同意", 原因: null, 留下: { id: "A9", 名: "示例客户乙" }, 并掉: { id: "B9", 名: "示例客户丙" }, 发起人: "示例同事A", 发起: 天后(-1), 到期: 天后(4), 结束: null, mergeId: null,
    同意人: [人(我, "我", "待同意", { 凭: ["系统管理员"] })],
    管理员判: { 负责人们: ["示例甲", "示例乙"], 前拒绝: [{ 人: "示例甲", 原因: "不是同一家", 时间: 天后(-20) }, { 人: "示例乙", 原因: "未填", 时间: 天后(-10) }] },
  };
  const { page, 错 } = await open(1280, { 等我: [管理员行] });
  try {
    await 见(page, "merge-req-wait").getByTestId("merge-request-agree").first().click();
    await 框(page).waitFor();
    const 前 = await 见(page, "merge-request-prev").innerText();
    expect(前).toContain("示例甲 拒绝：不是同一家");
    expect(前).toContain("示例乙 拒绝：未填");
    expect(await 框(page).locator("label.mrq-asked").innerText()).toBe("已问过两位负责人（示例甲、示例乙）");
    const 确认 = 见(page, "merge-request-agree-ok");
    expect(await 确认.isDisabled()).toBe(true);
    await 框(page).locator("label.mrq-asked").click();
    expect(await 确认.isDisabled()).toBe(false);
    await 确认.click();
    await 见(page, "merge-request-done").first().waitFor();
    expect(await 调(page)).toEqual([["处理", "w9", "同意", undefined, true]]);
    expect(错).toEqual([]);
  } finally { await page.close(); }
});
