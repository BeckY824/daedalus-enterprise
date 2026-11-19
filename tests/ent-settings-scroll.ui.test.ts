/**
 * 设置左目录、右正文各滚各的（11-18 客户：「设置窗口左侧导航栏的上下移动和右侧的向下移动需要解耦分开」）：
 *   - 浮层两栏（Windows 1024 / 1280 / 1366 宽，含 1366×768 这种矮屏）：外层 .setm-scroll 不再滚；
 *     左目录、右正文卡片是两个独立的滚动区（overflow-y auto + 高度封顶在框里），滚一边另一边不动，换一栏正文回到顶上
 *   - 右边的 antd 下拉（挂在 body 上）在正文滚过之后照样贴着输入框弹出、不被裁
 *   - 窄（800 宽、手机 375）：照原样上下排，目录在正文上面，整层一起滚
 *   - 整页 /settings：右边跟窗口滚，左目录粘在视口里、自己滚
 * 另：搜「节点推进」能搜到项目模式那一栏（卡片 11-18 由「进程推进」改名）
 * 11-19 点检补：整页滚下去再换栏，窗口回到正文顶（手机上下排点目录也滚到正文顶）；
 *   搜到某张卡（不是整栏）回车 / 点结果，切栏后那张卡滚进可视区、亮一下——浮层滚正文，整页滚窗口
 * 渲染照真的 SettingsModal（拦截路由那层）+ SettingsView；整页照 AppShell 的 main.main.app-content
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 打包 } from "./settings-ui-kit";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import V from '@/app/(app)/settings/SettingsView';import M from '@/components/SettingsModal';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import {默认组织规则} from '@/lib/project/org-rules';
    // 项目模式那一栏摆上企业版组织规则的几张卡（持有上限、超时回收、节点推进……），节点推进才落在正文几千像素下面，和线上一样
    window.__render=(p,浮层)=>{const v=<V business={DEFAULT_BUSINESS} {...p} 项目设置={{...p.项目设置,组织规则:默认组织规则}}/>;createRoot(document.getElementById('root')).render(<App>{浮层?<M>{v}</M>:<div className='shell'><main className='main app-content' style={{padding:'22px 26px'}}>{v}</main></div>}</App>);};`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 人 = (i: number) => ({ id: `u${i}`, name: `成员${i}`, email: `u${i}@example.com`, title: "", role: "SALES", active: true, customerCount: 0, oppCount: 0, followCount: 0, 业务角色: ["sales"] });
const 日志 = Array.from({ length: 80 }, (_, i) => ({ id: `l${i}`, at: "2026-11-18T02:00:00.000Z", userName: "周宁", action: "update", entity: "Customer", summary: `改了客户${i}的备注`, detail: null }));
const props = {
  users: Array.from({ length: 40 }, (_, i) => 人(i)),
  me: { id: "u0", name: "成员0", email: "u0@example.com", role: "ADMIN", title: "" },
  isAdmin: true, 只读: false, 只个人: false, 身份: "系统管理员", 企业版: true, 我的角色: ["director"],
  logs: 日志, 导出记录: 日志, 回收站: true, 企业版导入: true,
  llm: { source: null, baseUrl: "", model: "", keyMasked: null, options: [] }, aiUsage: [], 机器: null,
  项目设置: { 角色们: [], 类别们: [], 组织规则: null, 企业选项: null, 持有: {}, 提成比例: null, 能改提成比例: false, 挡: { 字典: null, 持有上限: null, 节点时限: null, 必填字段: null, 阶段规则: null } },
};

async function 开(width: number, height: number, 浮层: boolean, query = "?tab=audit"): Promise<{ page: Page; errors: string[] }> {
  // 减弱动态：浮层不放长出来的动画，量到的就是落定的位置
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://settings.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto(`http://settings.test/settings${query}`);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ path: path.resolve("src/app/(app)/settings/settings.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([p, m]) => (window as unknown as { __render: (x: unknown, m: boolean) => void }).__render(p, m), [props, 浮层] as const);
  await page.getByRole("tab", { name: /操作日志/ }).waitFor();
  return { page, errors };
}

/** 左目录、右正文、外层滚动区各自的样式和滚动尺寸 */
const 量 = (page: Page) => page.evaluate(() => {
  const q = (s: string) => document.querySelector(s) as HTMLElement | null;
  const 一格 = (el: HTMLElement | null) => el && ({
    oy: getComputedStyle(el).overflowY, pos: getComputedStyle(el).position, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom,
    sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth, st: el.scrollTop,
  });
  return { nav: 一格(q(".set-nav"))!, body: 一格(q(".set > .set-body"))!, 外: 一格(q(".setm-scroll")), 框: q(".setm-box")?.getBoundingClientRect().bottom ?? null, vh: innerHeight, 页宽: document.documentElement.scrollWidth, 窗宽: innerWidth };
});

for (const [w, h] of [[1024, 768], [1280, 800], [1366, 768], [1366, 900]] as const) {
  it(`浮层 ${w}×${h}：左右是两个独立的滚动区，滚一边另一边不动，换一栏正文回到顶上`, async () => {
    const { page, errors } = await 开(w, h, true);
    try {
      const a = await 量(page);
      // 两个都是竖向滚动区，高度都封在框里；外层不再有可滚的余量
      expect([a.nav.oy, a.body.oy]).toEqual(["auto", "auto"]);
      expect(a.外!.sh).toBeLessThanOrEqual(a.外!.ch + 1);
      expect(a.nav.bottom).toBeLessThanOrEqual(a.框! + 0.5);
      expect(a.body.bottom).toBeLessThanOrEqual(a.框! + 0.5);
      // 系统管理员十几项比框高：目录自己能滚；80 条日志：正文自己能滚
      expect(a.nav.sh).toBeGreaterThan(a.nav.ch);
      expect(a.body.sh).toBeGreaterThan(a.body.ch);
      // 目录不横着滚、整页不横着撑开
      expect(a.nav.sw).toBeLessThanOrEqual(a.nav.cw);
      expect(a.页宽).toBeLessThanOrEqual(a.窗宽);

      // 滚右边（滚轮滚到底也不带着左边、外层走）
      const body = await page.locator(".set > .set-body").boundingBox();
      await page.mouse.move(body!.x + body!.width / 2, body!.y + body!.height / 2);
      for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 2000);
      await page.waitForFunction(() => (document.querySelector(".set > .set-body") as HTMLElement).scrollTop > 0);
      const b = await 量(page);
      expect(b.body.st).toBeGreaterThan(0);
      expect(b.nav.st).toBe(0);
      expect(b.nav.top).toBeCloseTo(a.nav.top, 0);
      expect(b.外!.st).toBe(0);

      // 滚左边：正文停在原处
      const nav = await page.locator(".set-nav").boundingBox();
      await page.mouse.move(nav!.x + nav!.width / 2, nav!.y + nav!.height / 2);
      for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 2000);
      await page.waitForFunction(() => (document.querySelector(".set-nav") as HTMLElement).scrollTop > 0);
      const c = await 量(page);
      expect(c.body.st).toBe(b.body.st);
      expect(c.body.top).toBeCloseTo(b.body.top, 0);
      expect(c.外!.st).toBe(0);

      // 换一栏：正文从顶上看起；目录还停在滚到的地方（不跳回去）
      await page.getByRole("tab", { name: /导出记录/ }).click();
      await page.waitForFunction(() => location.search === "?tab=exports");
      const d = await 量(page);
      expect(d.body.st).toBe(0);
      expect(d.nav.st).toBe(c.nav.st);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("浮层 1366×768：正文滚过之后，右边的下拉照样贴着输入框弹出、不被正文滚动区裁掉", async () => {
  const { page, errors } = await 开(1366, 768, true, "?tab=business");
  try {
    // 币种那个下拉框在正文顶上：正文往下滚 40px，它还露在正文里（正文真的滚过）
    const 正文 = page.locator(".set > .set-body");
    expect(await 正文.evaluate((el) => { el.scrollTop = 40; return el.scrollTop; })).toBe(40);
    const 框 = 正文.locator(".ant-select-single.ant-select-show-search").first();
    await 框.click();
    const 下拉 = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
    await 下拉.waitFor();
    // 挂在 body 上，不在正文滚动区里
    expect(await 下拉.evaluate((el) => !!el.closest(".set-body"))).toBe(false);
    const s = (await 框.boundingBox())!, d = (await 下拉.boundingBox())!;
    // 贴着输入框：在它正下方或正上方几像素内，左边对齐
    expect(Math.min(Math.abs(d.y - (s.y + s.height)), Math.abs(d.y + d.height - s.y))).toBeLessThan(12);
    expect(Math.abs(d.x - s.x)).toBeLessThan(2);
    // 第一项真的点得到（没被盖住、没被裁）
    const 项 = (await 下拉.locator(".ant-select-item-option").first().boundingBox())!;
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".ant-select-dropdown"), [项.x + 10, 项.y + 项.height / 2] as const)).toBe(true);
    // 开着下拉再滚正文：下拉跟着输入框走（antd 盯着滚动的祖先重新对位），不留在原地飘着
    await 正文.evaluate((el) => { el.scrollTop = 20; });
    await page.waitForTimeout(200);
    const s2 = (await 框.boundingBox())!, d2 = (await 下拉.boundingBox())!;
    expect(s2.y - s.y).toBeCloseTo(20, 0);
    expect(Math.min(Math.abs(d2.y - (s2.y + s2.height)), Math.abs(d2.y + d2.height - s2.y))).toBeLessThan(12);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const [w, h] of [[800, 900], [375, 812]] as const) {
  it(`浮层 ${w}×${h}（正文不到 720 宽）：照原样上下排，目录在正文上面，整层一起滚`, async () => {
    const { page, errors } = await 开(w, h, true);
    try {
      const a = await 量(page);
      expect([a.nav.oy, a.body.oy]).toEqual(["visible", "visible"]);
      expect(a.nav.pos).toBe("static");
      expect(a.nav.sh).toBeLessThanOrEqual(a.nav.ch + 1);
      expect(a.nav.bottom).toBeLessThanOrEqual(a.body.top);
      // 外层整层滚，滚得到正文最底下
      expect(a.外!.sh).toBeGreaterThan(a.外!.ch);
      await page.locator(".setm-scroll").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const b = await 量(page);
      expect(b.body.bottom).toBeLessThanOrEqual(b.框! + 0.5);
      expect(b.页宽).toBeLessThanOrEqual(b.窗宽);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("整页 /settings 1366×768：右边跟窗口滚，左目录粘在视口里、比视口高时自己滚", async () => {
  const { page, errors } = await 开(1366, 768, false);
  try {
    const a = await 量(page);
    expect(a.nav.pos).toBe("sticky");
    expect(a.nav.oy).toBe("auto");
    expect(a.nav.sh).toBeGreaterThan(a.nav.ch);
    expect(a.nav.bottom - a.nav.top).toBeLessThanOrEqual(a.vh);
    await page.mouse.move(900, 500);
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 1500);
    await page.waitForFunction(() => scrollY > 300);
    const b = await 量(page);
    // 窗口滚了，目录粘在顶上没跟着走、自己也没被带着滚
    expect(b.nav.top).toBeGreaterThanOrEqual(0);
    expect(b.nav.top).toBeLessThan(40);
    expect(b.nav.st).toBe(0);
    expect(b.nav.bottom).toBeLessThanOrEqual(b.vh);
    // 滚目录：滚到头也不带着窗口走
    const y = await page.evaluate(() => scrollY);
    await page.mouse.move(120, 400);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 2000);
    await page.waitForFunction(() => (document.querySelector(".set-nav") as HTMLElement).scrollTop > 0);
    expect(await page.evaluate(() => scrollY)).toBe(y);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("手机整页 375：目录压在正文上面、不封高不自己滚（和改之前一样）", async () => {
  const { page, errors } = await 开(375, 812, false);
  try {
    const a = await 量(page);
    expect(a.nav.pos).toBe("static");
    expect(a.nav.oy).toBe("visible");
    expect(a.nav.bottom).toBeLessThanOrEqual(a.body.top);
    expect(a.页宽).toBeLessThanOrEqual(a.窗宽);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/** 正文、窗口此刻的位置；卡 = 标题是这个的 antd 卡片 */
const 位置 = (page: Page, 卡?: string) => page.evaluate((卡) => {
  const body = document.querySelector(".set > .set-body") as HTMLElement;
  const card = 卡 ? [...document.querySelectorAll(".set-body .ant-card-head-title")].find((t) => t.textContent === 卡)?.closest(".ant-card") as HTMLElement | undefined : undefined;
  const r = body.getBoundingClientRect(), c = card?.getBoundingClientRect();
  return { y: scrollY, vh: innerHeight, bodyTop: r.top, bodyBottom: Math.min(r.bottom, innerHeight), bodySt: body.scrollTop,
    cardTop: c?.top ?? null, cardBottom: c?.bottom ?? null, 亮: card?.classList.contains("set-hit") ?? false, 正文亮: body.classList.contains("set-flash") };
}, 卡);

it("搜「节点推进」能搜到项目模式那一栏，回车直达", async () => {
  const { page } = await 开(1366, 768, true);
  try {
    await page.getByRole("searchbox", { name: "搜索设置" }).fill("节点推进");
    const 项 = page.getByRole("tab", { name: /项目模式/ });
    await 项.getByText("项目模式 › 节点推进").waitFor();
    await page.getByRole("searchbox", { name: "搜索设置" }).press("Enter");
    await page.waitForFunction(() => location.search === "?tab=project");
  } finally { await page.close(); }
});

for (const [w, h] of [[1024, 768], [1366, 768]] as const) {
  it(`浮层 ${w}×${h}：搜到某张卡回车，切栏后那张卡滚进正文可视区、亮一下；命中整栏照旧回顶`, async () => {
    const { page, errors } = await 开(w, h, true);
    try {
      const 搜 = page.getByRole("searchbox", { name: "搜索设置" });
      await 搜.fill("节点推进");
      await 搜.press("Enter");
      await page.waitForFunction(() => location.search === "?tab=project");
      await page.waitForFunction(() => (document.querySelector(".set > .set-body") as HTMLElement).scrollTop > 0);
      const a = await 位置(page, "节点推进");
      // 卡在正文下面几千像素：正文自己滚过去，卡顶落在正文可视区里，窗口不动
      expect(a.bodySt).toBeGreaterThan(1000);
      expect(a.cardTop!).toBeGreaterThanOrEqual(a.bodyTop - 0.5);
      expect(a.cardTop!).toBeLessThan(a.bodyBottom - 40);
      expect(a.y).toBe(0);
      expect(a.亮).toBe(true);
      // 1.5 秒后摘掉
      await page.waitForFunction(() => !document.querySelector(".set-body .set-hit"), undefined, { timeout: 3000 });

      // 写明的锚点（data-set-find）：「进程时限」标题里没有，落在「超时回收」那张卡；同一栏里再搜也滚
      await 搜.fill("进程时限");
      await page.getByRole("tab", { name: /项目模式/ }).click();
      await page.waitForFunction(() => document.querySelector(".set-body .set-hit")?.textContent?.includes("超时回收"));
      const b = await 位置(page, "超时回收");
      expect(b.cardTop!).toBeGreaterThanOrEqual(b.bodyTop - 0.5);
      expect(b.cardTop!).toBeLessThan(b.bodyBottom - 40);

      // 命中整栏（页签名就带这个词）：回到正文顶，正文亮一下
      await 搜.fill("操作日志");
      await 搜.press("Enter");
      await page.waitForFunction(() => location.search === "?tab=audit");
      const c = await 位置(page);
      expect(c.bodySt).toBe(0);
      expect(c.正文亮).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("整页 /settings 1366×768：搜到某张卡回车，窗口滚到那张卡、亮一下", async () => {
  const { page, errors } = await 开(1366, 768, false);
  try {
    const 搜 = page.getByRole("searchbox", { name: "搜索设置" });
    await 搜.fill("节点推进");
    await 搜.press("Enter");
    await page.waitForFunction(() => location.search === "?tab=project");
    await page.waitForFunction(() => scrollY > 1000);
    const a = await 位置(page, "节点推进");
    expect(a.cardTop!).toBeGreaterThanOrEqual(0);
    expect(a.cardTop!).toBeLessThan(a.vh - 40);
    expect(a.亮).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const [w, h] of [[1024, 768], [1280, 800], [1366, 768]] as const) {
  it(`整页 /settings ${w}×${h}：滚下去再换栏，窗口回到正文顶；没滚过换栏不动`, async () => {
    const { page, errors } = await 开(w, h, false);
    try {
      // 没往下滚：换栏窗口不动（页头不被顶上去）
      await page.getByRole("tab", { name: /导出记录/ }).click();
      await page.waitForFunction(() => location.search === "?tab=exports");
      expect((await 位置(page)).y).toBe(0);
      // 项目模式那一栏两千来像素长：往下滚（点检时滚到 1796，这里的假数据短一点、能滚多少滚多少）再点左目录（粘在视口里）
      await page.getByRole("tab", { name: /项目模式/ }).click();
      await page.waitForFunction(() => location.search === "?tab=project");
      await page.evaluate(() => scrollTo(0, 1796));
      expect((await 位置(page)).y).toBeGreaterThan(1000);
      for (const [名, tab] of [["团队成员", "members"], ["业务配置", "business"]] as const) {
        if (名 === "业务配置") await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await page.getByRole("tab", { name: new RegExp(名) }).click();
        await page.waitForFunction((t) => location.search === `?tab=${t}`, tab);
        const a = await 位置(page);
        // 正文顶对齐在视口顶下面一点（scroll-margin-top 16），不停在原来滚到的地方
        expect(a.bodyTop).toBeGreaterThanOrEqual(0);
        expect(a.bodyTop).toBeLessThan(40);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("手机整页 375：目录压在正文上面，点目录换栏滚到正文顶", async () => {
  const { page, errors } = await 开(375, 812, false);
  try {
    const 前 = await 位置(page);
    expect(前.bodyTop).toBeGreaterThan(前.vh * 0.5);
    await page.getByRole("tab", { name: /团队成员/ }).click();
    await page.waitForFunction(() => location.search === "?tab=members");
    const a = await 位置(page);
    expect(a.bodyTop).toBeGreaterThanOrEqual(0);
    expect(a.bodyTop).toBeLessThan(40);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
