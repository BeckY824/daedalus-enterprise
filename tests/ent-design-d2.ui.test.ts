import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
/* D2 · 设计语言 11-21（客户详情规范 M1–M2）：客户名单、页头星标、菜单说明在真浏览器里量（真 CustomerRoster / PaneToggle / FavoriteStar + antd + globals.css）。
   - M2-a 计数 --count-fg；没有来源时时间并到名字那一行；「本周要跟」底下写「本周要跟就这 N 位」，名单没摆全时如实写「最近 N 位里…」
   - M2-b 悬停只换底色；当前那位浅蓝底 + 左边 2px 主色（原来浅灰底）
   - M2-c（K8）手机名单 = 底部抽屉：顶上圆角、把手、右上 × 44；× 关、往下拉关
   - M1-c 星标 28×28，手机 44×44；M1-b 菜单灰项说明 12px muted
   - 换皮主题（tech）不动：当前行照旧 --nav-on-bg、没有左边那道
   页头、中栏右栏各自滚、超长公司名四个宽度在 ent-cust-detail-merge.ui.test.ts（真 CustomerDetail） */
let browser: Browser, bundle: string;
const 长名 = "某某超长贸易进出口有限公司".repeat(6);
const plugin: Plugin = { name: "design-d2", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__去=u},replace(){},prefetch(){}});export const usePathname=()=>'/customers/c1';export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({children,prefetch,scroll,replace,...p}){return <a {...p}>{children}</a>}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {themeConfig} from '@/lib/theme';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import CustomerRoster from '@/components/CustomerRoster';import PaneToggle from '@/components/PaneToggle';import FavoriteStar from '@/components/FavoriteStar';
    import {两行} from '@/app/(app)/projects/[id]/project-menu';
    const 长名=${JSON.stringify(长名)};
    const 今=new Date();const 后天=new Date(今.getTime()+2*864e5).toISOString();
    const 行=(id,name,source,x={})=>({id,name,followStatus:'待跟进',custStatus:'意向客户',lastFollowAt:今.toISOString(),ownerName:'乙',lastNote:'聊过一次',mine:true,source,nextPlanAt:null,...x});
    const root=createRoot(document.getElementById('root'));
    window.__render=(o={})=>flushSync(()=>root.render(<ConfigProvider locale={zhCN} theme={themeConfig}><App><BusinessProvider value={DEFAULT_BUSINESS}><div className='shell'>
      <CustomerRoster data={{total:o.total??3,客户状态:{顺序:['意向客户'],颜色:{'意向客户':'blue'}},rows:[行('c1',长名,'广东省 深圳市'),行('c2','无地址公司',null,{nextPlanAt:后天}),行('c3','星河电子','上海市',{lastFollowAt:'2026-01-01T00:00:00.000Z'})]}}/>
      <main className='main app-content' style={{padding:16}}><div className='rec-page ui-v2'><div className='rec-head'>
        <PaneToggle 栏='roster' 位置='主区'/>
        <div className='rec-head-id'><div className='rec-head-line'><h1 className='rec-head-name' style={{margin:0}}>客户A</h1><FavoriteStar 初值={false} 切换={async()=>({ok:true,收藏了:true})}/></div></div>
      </div></div>
      <ul className='ant-dropdown-menu rec-head-menu' style={{width:300}}><li className='ant-dropdown-menu-item ant-dropdown-menu-item-disabled' id='m-dis'>{两行('项目转让','正在处理上一步，稍等')}</li></ul>
      </main></div></BusinessProvider></App></ConfigProvider>));
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(width: number, o: { total?: number; 皮?: string } = {}) {
  const 手机 = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: 手机 });
  const page = await ctx.newPage(); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("http://design-d2.test/**", r => r.fulfill({ contentType: "text/html", body: `<html${o.皮 ? ` data-skin="${o.皮}"` : ""}><meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div></html>` }));
  await page.goto("http://design-d2.test/customers/c1");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  if (o.皮) for (const f of ["src/app/skins/shared.css", `src/app/skins/${o.皮}.css`]) await page.addStyleTag({ path: path.resolve(f) });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(a => (window as unknown as { __render: (o: object) => void }).__render(a), { total: o.total });
  await page.locator(".rec-head").waitFor();
  const 色 = (v: string, 属 = "color") => page.evaluate(([v, 属]) => { const s = document.createElement("span"); s.style.setProperty(属, `var(${v})`); document.body.append(s); const c = getComputedStyle(s).getPropertyValue(属); s.remove(); return c; }, [v, 属]);
  return { page, errors, 色, close: () => ctx.close() };
}
const 当前行 = (page: Page) => page.locator(".roster-row.on").evaluate(e => {
  const b = getComputedStyle(e, "::before");
  return { 底: getComputedStyle(e).backgroundColor, 条: b.content === "none" ? null : { 宽: b.width, 色: b.backgroundColor, 左: b.left } };
});

it("名单（1280 / 1366）：当前行浅蓝 + 左 2px 主色，悬停只换底色；计数 --count-fg；没有来源时时间并到名字行；冷的点 --text-muted", async () => {
  for (const w of [1280, 1366]) {
    const { page, errors, 色, close } = await 开(w);
    try {
      await page.locator(".pane-roster .roster-row").first().waitFor();
      expect(await 当前行(page), `宽 ${w}`).toEqual({ 底: await 色("--brand-bg", "background-color"), 条: { 宽: "2px", 色: await 色("--brand"), 左: "0px" } });
      // 悬停（不是当前那位）：底色换 --row-hover，字色不动
      const 别的 = page.locator(".roster-row:not(.on)").first();
      const 字前 = await 别的.evaluate(e => getComputedStyle(e).color);
      await 别的.hover(); await page.waitForTimeout(250);
      expect(await 别的.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await 色("--row-hover", "background-color"));
      expect(await 别的.evaluate(e => getComputedStyle(e).color)).toBe(字前);
      const 数 = await 色("--count-fg");
      expect(await page.locator(".pane-n").evaluate(e => getComputedStyle(e).color)).toBe(数);
      expect(await page.locator(".roster-cnt").first().evaluate(e => getComputedStyle(e).color)).toBe(数);
      expect(await page.locator(".roster-dot.cold").first().evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await 色("--text-muted", "background-color"));
      // 没来源的那位：没有第一行，时间和名字同一行（名字在左、时间在右）；有来源的照旧来源 · 时间 / 名字两行
      const 无 = page.locator(".roster-row").filter({ hasText: "无地址公司" });
      expect(await 无.locator(".roster-l0").count()).toBe(0);
      const [名, 时] = await Promise.all([无.locator(".roster-l1 .roster-n").boundingBox(), 无.locator(".roster-l1 .roster-t").boundingBox()]);
      expect(Math.abs(名!.y + 名!.height - (时!.y + 时!.height)), "时间和名字同一行（底边差 < 4）").toBeLessThan(4);
      expect(时!.x).toBeGreaterThan(名!.x + 名!.width - 1);
      expect(await 无.locator(".roster-t").innerText()).not.toBe("");
      const 有 = page.locator(".roster-row.on");
      const [源, 名2] = await Promise.all([有.locator(".roster-src").boundingBox(), 有.locator(".roster-n").boundingBox()]);
      expect(名2!.y).toBeGreaterThanOrEqual(源!.y + 源!.height - 1);
      // 超长名字一行省略，不撑破名单
      expect(await 有.locator(".roster-n").evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

it("「本周要跟」底下那句：名单摆全了写「本周要跟就这 N 位」；没摆全写「最近 N 位里本周要跟的有 M 位」；「只有最近…位」那句只在全部 / 我的", async () => {
  for (const [total, 句] of [[3, "本周要跟就这 1 位"], [120, "最近 3 位里本周要跟的有 1 位"]] as const) {
    const { page, errors, close } = await 开(1366, { total });
    try {
      await page.locator(".pane-roster .roster-row").first().waitFor();
      const 全部句 = await page.locator(".pane-rows .pane-more").allInnerTexts();
      if (total > 3) expect(全部句.join("")).toMatch(/^这里只有最近 3 位/); else expect(全部句).toEqual([]);
      await page.getByRole("tab", { name: "本周要跟" }).click();
      await expect.poll(() => page.locator(".roster-swap").getAttribute("data-tab")).toBe("本周");
      expect(await page.locator(".pane-rows .pane-more").allInnerTexts()).toEqual([句]);
      expect(await page.locator(".pane-rows .pane-more").evaluate(e => e.tagName)).toBe("DIV");
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

it("手机 390（K8）：页头「显示客户名单」44×44，点了名单从底部弹出（顶上圆角、把手、× 44）；× 关，往下拉也关", async () => {
  const { page, errors, 色, close } = await 开(390);
  try {
    const 钮 = page.locator(".rec-head > .pane-toggle");
    expect(await 钮.boundingBox()).toMatchObject({ width: 44, height: 44 });
    expect(await page.locator(".pane-roster").count(), "手机上不摆整栏名单").toBe(0);
    await 钮.click();
    const 壳 = page.locator(".pane-sheet .ant-drawer-content-wrapper");
    await 壳.waitFor();
    await page.waitForTimeout(400);
    const 框 = (await 壳.boundingBox())!;
    expect(Math.round(框.y + 框.height), "贴着屏幕底").toBe(844);
    expect(框.width).toBe(390);
    // 顶上两角 --r-pop，底下两角不圆
    const 角 = await 壳.evaluate(e => { const c = getComputedStyle(e); const s = document.createElement("div"); s.style.borderTopLeftRadius = "var(--r-pop)"; document.body.append(s); const 期 = getComputedStyle(s).borderTopLeftRadius; s.remove(); return { 左上: c.borderTopLeftRadius, 右上: c.borderTopRightRadius, 左下: c.borderBottomLeftRadius, 期 }; });
    expect(角.期).not.toBe("0px");
    expect(角).toEqual({ 左上: 角.期, 右上: 角.期, 左下: "0px", 期: 角.期 });
    expect(await page.locator(".pane-sheet .sheet-grab").boundingBox()).toMatchObject({ width: 36, height: 5 });
    expect(await page.locator(".pane-sheet .sheet-grab").evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await 色("--field-line", "background-color"));
    expect(await page.locator(".pane-sheet .sheet-x").boundingBox()).toMatchObject({ width: 44, height: 44 });
    expect(await page.locator(".pane-sheet .roster-row").count()).toBe(3);
    // 抽屉里也是当前那位浅蓝 + 左 2px
    expect((await 当前行(page)).条).not.toBeNull();
    expect(await page.evaluate(() => document.activeElement?.tagName), "手机上开抽屉不自动聚焦搜索框（不弹键盘）").not.toBe("INPUT");
    await page.locator(".pane-sheet .sheet-x").click();
    await expect.poll(() => page.locator(".pane-sheet .ant-drawer-content-wrapper:visible").count()).toBe(0);
    // 再开，往下拉 120 松手 → 关
    await 钮.click();
    await 壳.waitFor({ state: "visible" });
    await page.locator(".pane-sheet .sheet-top").evaluate(t => {
      const 点 = (y: number) => new Touch({ identifier: 1, target: t, clientX: 200, clientY: y });
      t.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [点(200)], changedTouches: [点(200)] }));
      t.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [点(320)] }));
    });
    await expect.poll(() => page.locator(".pane-sheet .ant-drawer-content-wrapper:visible").count()).toBe(0);
    // 拉得短（30）不关
    await 钮.click();
    await 壳.waitFor({ state: "visible" });
    await page.locator(".pane-sheet .sheet-top").evaluate(t => {
      const 点 = (y: number) => new Touch({ identifier: 1, target: t, clientX: 200, clientY: y });
      t.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [点(200)], changedTouches: [点(200)] }));
      t.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [点(230)] }));
    });
    await page.waitForTimeout(400);
    expect(await page.locator(".pane-sheet .ant-drawer-content-wrapper:visible").count()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await close(); }
});

it("1024：名单收成左边抽屉（不是底部抽屉），抽屉页头照旧那颗收起钮", async () => {
  const { page, errors, close } = await 开(1024);
  try {
    await page.locator(".rec-head > .pane-toggle").click();
    await page.locator(".pane-drawer .ant-drawer-content-wrapper").waitFor();
    expect(await page.locator(".pane-sheet").count()).toBe(0);
    expect(await page.locator(".pane-drawer .sheet-x").count()).toBe(0);
    expect(await page.locator(".pane-drawer .pane-h .pane-toggle").count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await close(); }
});

it("星标点击区 28×28（1366），手机 44×44；菜单里灰项的说明 12px muted", async () => {
  for (const [w, 边] of [[1366, 28], [390, 44]] as const) {
    const { page, errors, 色, close } = await 开(w);
    try {
      expect(await page.locator(".rec-head .rec-star").boundingBox(), `宽 ${w}`).toMatchObject({ width: 边, height: 边 });
      if (w === 1366) {
        const 注 = await page.locator("#m-dis .menu-2l-note").evaluate(e => ({ 字: getComputedStyle(e).fontSize, 色: getComputedStyle(e).color }));
        expect(注).toEqual({ 字: "12px", 色: await 色("--text-muted") });
      }
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

it("换皮主题（tech）不动：当前行照旧 --nav-on-bg、没有左边那道；计数照旧 faint", async () => {
  const { page, errors, 色, close } = await 开(1366, { 皮: "tech" });
  try {
    await page.locator(".pane-roster .roster-row").first().waitFor();
    expect(await 当前行(page)).toEqual({ 底: await 色("--nav-on-bg", "background-color"), 条: null });
    expect(await page.locator(".roster-cnt").first().evaluate(e => getComputedStyle(e).color)).toBe(await 色("--text-faint"));
    expect(errors).toEqual([]);
  } finally { await close(); }
});
