/**
 * 企业版站内通知的铃铛（components/NoticeBell.tsx，11-01）。
 *
 *   左栏顶上搜索框右边：红数 = 未读条数；aria-label「通知，N 条未读」
 *   点开右侧抽屉「通知」：列最近的通知，没读的加粗 + 蓝点；「全部已读」清掉红数
 *   点一条：标已读、红数减一、关抽屉、跳到那条的链接
 *   空：「还没有通知」
 *   Windows 1024：搜索框 + 铃铛一行不折、页面不横向溢出；抽屉标题和「全部已读」不折行；超长标题截断
 *   暗黑：标题字是暗底的浅色；减弱动态：抽屉不走过渡
 *   此刻还能放弃的（服务端给 放弃项目，11-21）：条目下多一颗「放弃（豁免）」，点了原地弹放弃框、交了换成「已放弃，转给 X」；
 *   链接带 ?giveup=1 但服务端没给 放弃项目（现在放弃不了）的没有这颗；点条目本身去不带参数的
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import { 补全动作桩 } from "./helpers/action-stubs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-notice-bell", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/navigation$/, "const 记=(u)=>{(window.__去||(window.__去=[])).push(u)};export const useRouter=()=>({push:记,refresh(){window.__刷=(window.__刷||0)+1},replace:记});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  // 服务端动作：读 window.__通知，标已读改它，并把调用记在 window.__调
  stub(/notice-actions$/, `
    const 记=(x)=>{(window.__调||(window.__调=[])).push(x)};
    const 未=()=>window.__通知.filter(r=>!r.read).length;
    export const 读我的通知=async()=>{记('读');return {行们:window.__通知.map(r=>({...r})),未读:未()}};
    export const 读未读通知数=async()=>未();
    export const 标已读=async(id)=>{记('标:'+id);window.__通知=window.__通知.map(r=>r.id===id?{...r,read:true}:r);return 未()};
    export const 全部标已读=async()=>{记('全部');window.__通知=window.__通知.map(r=>({...r,read:true}));return 0};
  `);
  // 放弃框（projects/[id]/GiveUpDialog）的动作：记下调用，回 window.__放弃回 或成功
  stub(/^\.\/giveup-actions$/, 补全动作桩("src/app/(app)/projects/[id]/giveup-actions.ts",
    "export const 放弃线索Action=async(...a)=>{(window.__放弃||(window.__放弃=[])).push(a);return window.__放弃回||{ok:true,接手人:'乙'}};"));
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import NoticeBell from '@/components/NoticeBell';
    window.__画=(o)=>{
      window.__通知=o.行们;
      const 未读=o.行们.filter(r=>!r.read).length;
      // 晚到（11-26）：layout 不等这个数，初始未读是个 Promise，测试里手动 __给(n) 让它到
      const 初=o.晚?new Promise(r=>{window.__给=r}):未读;
      createRoot(document.getElementById('root')).render(<App><div style={{display:'flex'}}>
        <nav className="rail" aria-label="主导航"><div className="rail-top">
          <button type="button" className="rail-search"><span>搜索</span><kbd>⌘K</kbd></button>
          <NoticeBell 初始未读={初}/>
        </div></nav>
        <main style={{flex:1,minWidth:0,padding:24}}>页面</main>
      </div></App>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 长 = "某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域销售中心";
const 刚才 = (分钟: number) => new Date(Date.now() - 分钟 * 60_000).toISOString();
const 三条 = [
  { id: "n1", kind: "自动分配", title: "自动分配给你一条新线索：" + 长, body: "市场小李 点的自动分配，轮到了你。", link: "/leads", read: false, createdAt: 刚才(0) },
  { id: "n2", kind: "卡点", title: "销售经理 把卡点 KD-0012 指给了你", body: "项目「华东二期」· 技术：" + 长 + 长, link: "/projects/p2", read: false, createdAt: 刚才(90) },
  { id: "n3", kind: "交接", title: "总管 确认接手了 3 位客户", body: "", link: "/customers", read: true, createdAt: 刚才(60 * 24 * 2) },
];

async function 打开(行们: unknown[] = 三条, o: { width?: number; 暗?: boolean; 减弱?: boolean; 地址?: string; 晚?: boolean } = {}): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: o.width ?? 1280, height: 800 }, reducedMotion: o.减弱 ? "reduce" : "no-preference" }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html${o.暗 ? ' data-mode="dark"' : ""}><meta charset='utf-8'><body><div id='root'></div></body></html>` }));
  await page.goto(`http://ent.test${o.地址 ?? "/customers"}`);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ path: path.resolve("src/app/dark.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([x, 晚]) => (window as unknown as { __画: (o: unknown) => void }).__画({ 行们: x, 晚 }), [行们, !!o.晚] as const);
  await page.locator(".notice-bell").waitFor();
  return { page, errors };
}
const 窗 = <T,>(page: Page, k: string) => page.evaluate((k) => (window as unknown as Record<string, unknown>)[k], k) as Promise<T>;
const 铃 = (page: Page) => page.locator(".notice-bell");

it("红数 = 未读；点开抽屉列通知，没读的标出来；时间说人话", async () => {
  const { page, errors } = await 打开();
  expect(await 铃(page).getAttribute("aria-label")).toBe("通知，2 条未读");
  expect(await page.locator(".ant-badge-count").innerText()).toBe("2");
  await 铃(page).click();
  const 抽屉 = page.locator(".notice-drawer .ant-drawer-section");
  await 抽屉.waitFor();
  expect(await 抽屉.locator(".ant-drawer-title").innerText()).toBe("通知");
  const 项 = page.getByRole("list", { name: "通知列表" }).locator(".notice-item");
  await expect.poll(() => 项.count()).toBe(3);
  expect(await 项.nth(0).getAttribute("aria-label")).toBe("未读，自动分配给你一条新线索：" + 长);
  expect(await 项.nth(2).getAttribute("aria-label")).toBe("总管 确认接手了 3 位客户");
  expect(await page.locator(".notice-item.unread").count()).toBe(2);
  expect(await 项.locator(".notice-meta").allInnerTexts()).toEqual(["自动分配 · 刚刚", "卡点 · 1 小时前", "交接 · 2 天前"]);
  expect(await 窗<string[]>(page, "__调")).toEqual(["读"]);
  expect(errors).toEqual([]); await page.close();
});

it("点一条：标已读、红数减一、关抽屉、跳到链接", async () => {
  const { page } = await 打开();
  await 铃(page).click();
  await page.locator(".notice-item").nth(1).click();
  expect(await 窗<string[]>(page, "__去")).toEqual(["/projects/p2"]);
  await expect.poll(() => 窗<string[]>(page, "__调")).toEqual(["读", "标:n2"]);
  expect(await 铃(page).getAttribute("aria-label")).toBe("通知，1 条未读");
  await expect.poll(() => page.locator(".notice-drawer .ant-drawer-section").isVisible()).toBe(false);
  // 已读的再点：不再标、照样跳
  await 铃(page).click();
  await page.locator(".notice-item").nth(2).click();
  expect(await 窗<string[]>(page, "__去")).toEqual(["/projects/p2", "/customers"]);
  expect((await 窗<string[]>(page, "__调")).filter((x) => x.startsWith("标"))).toEqual(["标:n2"]);
  await page.close();
});

it("[11-21] 此刻能放弃的那条：多一颗「放弃（豁免）」，原地弹放弃框（标已读、不跳页），交了换成「已放弃，转给 X」；现在放弃不了的没有这颗", async () => {
  const 行们 = [
    { id: "g1", kind: "自动分配", title: "自动分配给你一条新线索：" + 长, body: "", link: "/projects/p9?giveup=1", 放弃项目: "p9", read: false, createdAt: 刚才(0) },
    { id: "g2", kind: "超时未跟进", title: "超时未跟进：华东二期", body: "接手已满 1 小时还没记有效沟通", link: "/projects/p8?giveup=1", read: false, createdAt: 刚才(5) },
    三条[2],
  ];
  for (const w of [1280, 390]) {
    const { page, errors } = await 打开(行们, { width: w, 减弱: true });
    try {
      await 铃(page).click();
      await page.locator(".notice-drawer .ant-drawer-section").waitFor();
      expect(await page.getByTestId("notice-giveup").count()).toBe(1);
      const 键 = page.getByTestId("notice-giveup");
      expect(await 键.innerText()).toBe("放弃（豁免）");
      const 框位 = (await 键.boundingBox())!;
      expect(框位.x + 框位.width).toBeLessThanOrEqual(w);
      // 3703 实操 11-21：390 宽只有 28 高不好点；和首页置顶条那两颗同一规格（≥40 高）
      expect(框位.height).toBeGreaterThanOrEqual(40);
      await 键.click();
      const 框 = page.getByRole("dialog", { name: "放弃这条线索（豁免）" });
      await 框.waitFor();
      expect(await 窗<string[] | undefined>(page, "__去")).toBeUndefined();
      await expect.poll(() => 窗<string[]>(page, "__调")).toEqual(["读", "标:g1"]);
      const 盒 = (await 框.boundingBox())!;
      expect(盒.x).toBeGreaterThanOrEqual(0);
      expect(盒.x + 盒.width).toBeLessThanOrEqual(w);
      await 框.getByText("忙不过来", { exact: true }).click();
      await 框.getByRole("button", { name: "确认放弃" }).click();
      await page.getByTestId("notice-giveup-done").waitFor();
      expect(await page.getByTestId("notice-giveup-done").innerText()).toBe("已放弃，转给 乙");
      expect(await page.getByTestId("notice-giveup").count()).toBe(0);
      expect(await 窗<unknown[][]>(page, "__放弃")).toEqual([["p9", "忙不过来", ""]]);
      // 点条目本身：去不带参数的地址
      await page.locator(".notice-item").nth(1).click();
      expect(await 窗<string[]>(page, "__去")).toEqual(["/projects/p8"]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("[11-21] 放弃没成：错误写在框里，按钮还在；「去判无效」关抽屉去项目页", async () => {
  const 行们 = [{ id: "g1", kind: "分配", title: "分配给你一条新线索：华东", body: "", link: "/projects/p9?giveup=1", 放弃项目: "p9", read: true, createdAt: 刚才(0) }];
  const { page } = await 打开(行们, { width: 390, 减弱: true });
  try {
    await page.evaluate(() => { (window as unknown as { __放弃回: unknown }).__放弃回 = { ok: false, error: "这条转不出去：本线其他人都不能接" }; });
    await 铃(page).click();
    await page.getByTestId("notice-giveup").click();
    const 框 = page.getByRole("dialog", { name: "放弃这条线索（豁免）" });
    await 框.getByText("外出", { exact: true }).click();
    await 框.getByRole("button", { name: "确认放弃" }).click();
    await 框.getByTestId("proj-giveup-error").waitFor();
    expect(await 框.getByTestId("proj-giveup-error").innerText()).toContain("转不出去");
    await 框.getByTestId("proj-giveup-to-invalid").click();
    expect(await 窗<string[]>(page, "__去")).toEqual(["/projects/p9"]);
    expect(await page.getByTestId("notice-giveup").count()).toBe(1);
  } finally { await page.close(); }
});

it("[11-21 审查] 放弃成了：正停在这条（项目页、客户详情 ?project=这条、跟着转走 / 没留给他的这位客户）不刷新、去项目列表；别的页照旧刷新", async () => {
  const 行们 = [{ id: "g1", kind: "分配", title: "分配给你一条新线索：华东", body: "", link: "/projects/p9?giveup=1", 放弃项目: "p9", read: true, createdAt: 刚才(0) }];
  const 情形: [string, unknown, boolean][] = [
    ["/projects/p9", undefined, true],
    ["/customers/c1?project=p9", undefined, true],
    ["/customers/c1", { ok: true, 接手人: "乙", customerId: "c1", 客户去向: "跟着走" }, true],
    ["/customers/c1", { ok: true, 接手人: "乙", customerId: "c1", 客户去向: "留给原负责人" }, false],
    // 审查 3：客户没留给他（不动）、停在客户详情没选项目 = 也离开
    ["/customers/c1", { ok: true, 接手人: "乙", customerId: "c1", 客户去向: "不动" }, true],
    ["/customers/c1?project=p8", { ok: true, 接手人: "乙", customerId: "c1", 客户去向: "不动" }, false],
    ["/customers/c1?project=p8", undefined, false],
    ["/projects/p8", undefined, false],
  ];
  for (const [地址, 回, 离开] of 情形) {
    const { page, errors } = await 打开(行们, { width: 390, 减弱: true, 地址 });
    try {
      if (回) await page.evaluate((x) => { (window as unknown as { __放弃回: unknown }).__放弃回 = x; }, 回);
      await 铃(page).click();
      await page.getByTestId("notice-giveup").click();
      const 框 = page.getByRole("dialog", { name: "放弃这条线索（豁免）" });
      await 框.getByText("外出", { exact: true }).click();
      await 框.getByRole("button", { name: "确认放弃" }).click();
      await page.getByTestId("notice-giveup-done").waitFor();
      expect(await page.getByTestId("notice-giveup-done").innerText()).toBe("已放弃，转给 乙");
      expect([地址, await 窗<string[] | undefined>(page, "__去") ?? [], await 窗<number | undefined>(page, "__刷") ?? 0])
        .toEqual([地址, 离开 ? ["/projects"] : [], 离开 ? 0 : 1]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("全部已读：红数没了、按钮变灰、蓝点没了", async () => {
  const { page } = await 打开();
  await 铃(page).click();
  const 全 = page.getByRole("button", { name: "全部已读" });
  await expect.poll(() => page.locator(".notice-item").count()).toBe(3);
  await 全.click();
  await expect.poll(() => page.locator(".notice-item.unread").count()).toBe(0);
  expect(await 铃(page).getAttribute("aria-label")).toBe("通知");
  // 红数退场有个缩小动画：等它走完
  await expect.poll(() => page.locator(".ant-badge-count:visible").count()).toBe(0);
  expect(await 全.isDisabled()).toBe(true);
  expect(await 窗<string[]>(page, "__调")).toEqual(["读", "全部"]);
  await page.close();
});

it("空：还没有通知，没有红数", async () => {
  const { page } = await 打开([]);
  expect(await 铃(page).getAttribute("aria-label")).toBe("通知");
  await 铃(page).click();
  await expect.poll(() => page.locator(".notice-drawer").innerText()).toContain("还没有通知");
  expect(await page.getByRole("button", { name: "全部已读" }).isDisabled()).toBe(true);
  await page.close();
});

it.each([1024, 1280])("Windows %ipx：搜索框 + 铃铛一行不折，页面不横向溢出；抽屉头不折行，超长标题截断", async (w) => {
  const 多 = Array.from({ length: 12 }, (_, i) => ({ ...三条[i % 3], id: "m" + i }));
  const { page } = await 打开(多, { width: w });
  const 顶 = await page.locator(".rail-top").boundingBox();
  const 搜 = await page.locator(".rail-search").boundingBox();
  const 钟 = await 铃(page).boundingBox();
  expect(顶!.height).toBeLessThanOrEqual(40);
  expect(Math.abs(搜!.y + 搜!.height / 2 - (钟!.y + 钟!.height / 2))).toBeLessThanOrEqual(2);
  expect(钟!.x).toBeGreaterThan(搜!.x + 搜!.width - 1);
  expect(钟!.x + 钟!.width).toBeLessThanOrEqual(顶!.x + 顶!.width + 1);
  expect(await page.locator(".rail-search span").evaluate((e) => e.getBoundingClientRect().height)).toBeLessThan(24);
  await 铃(page).click();
  await expect.poll(() => page.locator(".notice-item").count()).toBe(12);
  await page.waitForTimeout(400);
  const 头 = page.locator(".notice-drawer .ant-drawer-header");
  expect((await 头.boundingBox())!.height).toBeLessThanOrEqual(56);
  const 全 = await page.getByRole("button", { name: "全部已读" }).boundingBox();
  expect(全!.height).toBeLessThanOrEqual(32);
  const 标题 = page.locator(".notice-title").first();
  expect(await 标题.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  expect(await 标题.evaluate((e) => getComputedStyle(e).textOverflow)).toBe("ellipsis");
  const 抽屉 = await page.locator(".notice-drawer .ant-drawer-content-wrapper").boundingBox();
  expect(抽屉!.x + 抽屉!.width).toBeLessThanOrEqual(w + 1);
  expect(抽屉!.width).toBeLessThanOrEqual(380);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.close();
});

it("手机 375：抽屉不超出屏幕（浮起的面板两边各留 8px）", async () => {
  const { page } = await 打开(三条, { width: 375 });
  await 铃(page).click();
  await page.waitForTimeout(400);
  const 抽屉 = await page.locator(".notice-drawer .ant-drawer-content-wrapper").boundingBox();
  expect(抽屉!.x).toBeGreaterThanOrEqual(-1);
  expect(抽屉!.width).toBeLessThanOrEqual(376);
  await page.close();
});

it("暗黑：抽屉是暗底、标题是浅色字", async () => {
  const { page } = await 打开(三条, { 暗: true });
  await 铃(page).click();
  await expect.poll(() => page.locator(".notice-item").count()).toBe(3);
  const 亮度 = (rgb: string) => { const [r, g, b] = rgb.match(/\d+/g)!.map(Number); return (r * 299 + g * 587 + b * 114) / 1000; };
  const 字 = await page.locator(".notice-title").first().evaluate((e) => getComputedStyle(e).color);
  expect(亮度(字)).toBeGreaterThan(180);
  await page.close();
});

it("减弱动态：抽屉打开不走过渡，一点就到位", async () => {
  const { page, errors } = await 打开(三条, { 减弱: true });
  await 铃(page).click();
  // 不等动画：下一帧抽屉就在最终位置
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const 盒 = await page.locator(".notice-drawer .ant-drawer-content-wrapper").boundingBox();
  // g.notice：浮起的面板离窗口右边 8px
  expect(Math.round(盒!.x + 盒!.width)).toBe(1280 - 8);
  const 时长 = await page.locator(".notice-drawer .ant-drawer-content-wrapper").evaluate((e) => getComputedStyle(e).transitionDuration);
  expect(时长.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
  expect(errors).toEqual([]);
  await page.close();
});

it.each([1024, 1280, 1366])("%ipx 正文 1200 字：铃铛里只两行，「展开全文」原地看全文、不跳页；短的不给展开（11-03 B6-6）", async (w) => {
  const 千字 = "展会上又聊了一次，客户想先看样机再定。".repeat(64).slice(0, 1200);
  const { page, errors } = await 打开([{ id: "L", kind: "撞号", title: "同号又录了一次：" + 长, body: 千字, link: "/projects/pL", read: false, createdAt: 刚才(3) }, 三条[0]], { width: w });
  await 铃(page).click();
  await expect.poll(() => page.locator(".notice-item").count()).toBe(2);
  const 正文 = page.locator(".notice-body").first();
  const 行高 = await 正文.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.6);
  expect((await 正文.boundingBox())!.height).toBeLessThanOrEqual(行高 * 2 + 2);
  // 只有长的那条有「展开全文」
  expect(await page.getByRole("button", { name: "展开全文" }).count()).toBe(1);
  await page.getByRole("button", { name: "展开全文" }).click();
  const 全 = page.locator(".notice-body.full");
  await 全.waitFor();
  expect((await 全.innerText()).length).toBe(1200);
  // 展开后在这一格里滚，不撑过 40vh；不跳页、不标已读
  expect((await 全.boundingBox())!.height).toBeLessThanOrEqual(800 * 0.4 + 2);
  expect(await 窗<string[] | undefined>(page, "__去")).toBeUndefined();
  expect(await 窗<string[]>(page, "__调")).toEqual(["读"]);
  expect(await page.getByRole("button", { name: "收起" }).getAttribute("aria-expanded")).toBe("true");
  const 抽屉 = await page.locator(".notice-drawer .ant-drawer-content-wrapper").boundingBox();
  expect(抽屉!.x + 抽屉!.width).toBeLessThanOrEqual(w + 1);
  expect(await page.locator(".notice-drawer .ant-drawer-body").evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "收起" }).click();
  await expect.poll(() => page.locator(".notice-body.full").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

it("g.notice：浮起的面板——离窗口边 8px、四角圆、不压暗页面；条目依次落位（减弱动态不位移）", async () => {
  for (const 减弱 of [false, true]) {
    const { page, errors } = await 打开(三条, { width: 1024, 减弱 });
    await 铃(page).click();
    const 壳 = page.locator(".notice-drawer .ant-drawer-content-wrapper");
    await 壳.waitFor();
    await page.getByRole("list", { name: "通知列表" }).waitFor();
    await expect.poll(() => 壳.evaluate((e) => Math.round(e.getBoundingClientRect().top))).toBe(8);
    await expect.poll(() => 壳.evaluate((e) => Math.round(innerWidth - e.getBoundingClientRect().right))).toBe(8);
    const 位 = await 壳.evaluate((e) => { const r = e.getBoundingClientRect(); return { 右: Math.round(innerWidth - r.right), 下: Math.round(innerHeight - r.bottom), 圆: parseFloat(getComputedStyle(e).borderTopLeftRadius) }; });
    expect(位).toMatchObject({ 右: 8, 下: 8 });
    expect(位.圆).toBeGreaterThan(0);
    // 遮罩透明（不压暗），但还在：点页面别处照样收
    expect(await page.locator(".notice-drawer .ant-drawer-mask").evaluate((e) => getComputedStyle(e).backgroundColor)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    // 第一条落位后不再有位移；减弱动态从头到尾没有 transform
    const 第一条 = page.getByRole("list", { name: "通知列表" }).locator("li").first();
    if (减弱) expect(await 第一条.evaluate((e) => getComputedStyle(e).transform)).toBe("none");
    await expect.poll(() => 第一条.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    await expect.poll(() => 第一条.evaluate((e) => getComputedStyle(e).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    await page.mouse.click(300, 400);
    await expect.poll(() => page.locator(".notice-drawer.ant-drawer-open").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }
});

it("初始未读晚到（11-26 layout 不等这个数）：铃铛先出、不带红数；数到了只多出角上红数，铃铛不挪位置", async () => {
  const { page, errors } = await 打开(三条, { 晚: true });
  try {
    expect(await 铃(page).getAttribute("aria-label")).toBe("通知");
    expect(await page.locator(".notice-bell-badge .ant-badge-count").count()).toBe(0);
    const 前 = await 铃(page).boundingBox();
    await page.evaluate(() => (window as unknown as { __给: (n: number) => void }).__给(2));
    await expect.poll(() => 铃(page).getAttribute("aria-label")).toBe("通知，2 条未读");
    expect(await page.locator(".notice-bell-badge .ant-badge-count").count()).toBe(1);
    expect(await 铃(page).boundingBox()).toEqual(前);
    // 之后照旧以自己问到的为准：点开抽屉、点一条，红数减一
    await 铃(page).click();
    await page.getByRole("button", { name: /^未读，自动分配给你/ }).click();
    await expect.poll(() => 铃(page).getAttribute("aria-label")).toBe("通知，1 条未读");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
