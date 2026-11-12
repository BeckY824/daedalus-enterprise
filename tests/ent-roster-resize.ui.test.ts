/**
 * 客户详情最左客户名单可拖宽（11-12 用户：「这一栏要可调节宽度，以及默认的宽度要比现在宽一点」，lib/roster-width.ts）：
 *   默认 280（原 220）；右边缘一条 role=separator 的拖条，带 aria-valuenow / min / max、可聚焦；
 *   左右键 16px、Home / End 到最窄 / 最宽；拖出界被夹住；松手记 localStorage、刷新回来还是那个宽；双击回默认
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const 长地区 = "刚果民主共和国 上加丹加省利卡西市郊区工业园区二期";
const plugin: Plugin = { name: "roster-resize", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){}});export const usePathname=()=>'/customers/c1';export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({children,prefetch,...p}){return <a {...p}>{children}</a>}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import CustomerRoster from '@/components/CustomerRoster';
    import {DockOpenContext} from '@/lib/roster';
    const 长名='某某超长国际贸易进出口集团股份有限公司华东区域分公司'.repeat(2);
    const 行=(id,name,source)=>({id,name,followStatus:'待跟进',custStatus:'意向客户',lastFollowAt:new Date().toISOString(),ownerName:'乙',lastNote:'聊过一次',mine:true,source,nextPlanAt:null});
    let 根=null;
    window.__卸=()=>根.unmount();
    window.__render=(面板)=>(根=createRoot(document.getElementById('root'))).render(<DockOpenContext.Provider value={!!面板}><div className={面板?'shell shell-dock-open':'shell'}><ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>
      <CustomerRoster data={{total:3,客户状态:{顺序:['意向客户'],颜色:{'意向客户':'blue'}},rows:[行('c1',长名,${JSON.stringify(长地区)}),行('c2','星河电子','广东省 深圳市'),行('c3','无地址公司',null)]}}/>
    </BusinessProvider></App></ConfigProvider></div></DockOpenContext.Provider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(w = 1366, 存?: string, 面板 = false) {
  const page = await browser.newPage({ viewport: { width: w, height: 768 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://roster.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://roster.test/customers/c1");
  // 没有左栏：--rail-w 记 0，和 JS 那边量不到 .rail 时同一口径
  await page.evaluate((v) => { document.documentElement.style.setProperty("--rail-w", "0px"); if (v) localStorage.setItem("daedalus.roster.w", v); else localStorage.removeItem("daedalus.roster.w"); }, 存 ?? "");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate((m) => (window as unknown as { __render: (m: boolean) => void }).__render(m), 面板);
  await page.locator(".roster-row").first().waitFor();
  return { page, errors };
}
const 宽 = (page: Page) => page.locator("aside.pane-roster").evaluate(e => Math.round(e.getBoundingClientRect().width));
const 值 = (page: Page) => page.getByRole("separator", { name: "调整客户名单宽度" }).evaluate(e => [e.getAttribute("aria-valuenow"), e.getAttribute("aria-valuemin"), e.getAttribute("aria-valuemax"), e.getAttribute("aria-orientation")]);

it("默认 280；拖条是可聚焦的竖向 separator，带当前 / 最小 / 最大值", async () => {
  const { page, errors } = await 开();
  try {
    expect(await 宽(page)).toBe(280);
    expect(await 值(page)).toEqual(["280", "220", "420", "vertical"]);
    const 条 = page.getByRole("separator", { name: "调整客户名单宽度" });
    await 条.focus();
    expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("separator");
    expect(await 条.evaluate(e => getComputedStyle(e).cursor)).toBe("col-resize");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("键盘：右键 +16、左键 −16，Home / End 到最窄 / 最宽；存进 localStorage", async () => {
  const { page, errors } = await 开();
  try {
    const 条 = page.getByRole("separator", { name: "调整客户名单宽度" });
    await 条.focus();
    await page.keyboard.press("ArrowRight");
    expect(await 宽(page)).toBe(296);
    await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");
    expect(await 宽(page)).toBe(264);
    await page.keyboard.press("End");
    expect(await 宽(page)).toBe(420);
    await page.keyboard.press("Home");
    expect(await 宽(page)).toBe(220);
    expect(await page.evaluate(() => localStorage.getItem("daedalus.roster.w"))).toBe("220");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("拖动实时改宽、出界被夹住，松手记住；双击回默认", async () => {
  const { page, errors } = await 开();
  try {
    const 条 = page.getByRole("separator", { name: "调整客户名单宽度" });
    const b = (await 条.boundingBox())!;
    const x = b.x + b.width / 2, y = b.y + 200;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 4 });
    expect(await 宽(page)).toBe(340);
    // 拖到很远：夹在 420
    await page.mouse.move(x + 600, y, { steps: 4 });
    expect(await 宽(page)).toBe(420);
    await page.mouse.move(x - 600, y, { steps: 4 });
    expect(await 宽(page)).toBe(220);
    await page.mouse.move(x + 40, y, { steps: 2 });
    await page.mouse.up();
    expect(await 宽(page)).toBe(320);
    expect(await page.evaluate(() => localStorage.getItem("daedalus.roster.w"))).toBe("320");
    // 拖的时候没选中字
    expect(await page.evaluate(() => String(getSelection()))).toBe("");
    await 条.dblclick();
    expect(await 宽(page)).toBe(280);
    expect(await page.evaluate(() => localStorage.getItem("daedalus.roster.w"))).toBeNull();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("记住的宽度：再打开就是它；窗口窄了最宽跟着收紧（1280 没左栏 → 342），记的值超了按上限摆", async () => {
  {
    const { page, errors } = await 开(1366, "360");
    try {
      expect(await 宽(page)).toBe(360);
      expect((await 值(page))[0]).toBe("360");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
  {
    const { page, errors } = await 开(1280, "400");
    try {
      expect(await 值(page)).toEqual(["342", "220", "342", "vertical"]);
      expect(await 宽(page)).toBe(342);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("坏值、越界值、取不到 localStorage：都按默认 280", async () => {
  for (const v of ["abc", "9999", "100"]) {
    const { page, errors } = await 开(1366, v);
    try {
      expect(await 宽(page), v).toBe(280);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("首帧前：外观预设脚本把记住的宽度挂到 <html> 的 --roster-cust-w（坏值不挂）", async () => {
  const { 外观预设脚本 } = await import("@/lib/appearance");
  const page = await browser.newPage();
  try {
    await page.route("http://roster.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'>" }));
    await page.goto("http://roster.test/");
    const 跑 = (v: string) => page.evaluate(([s, v]) => { localStorage.setItem("daedalus.roster.w", v); document.documentElement.style.removeProperty("--roster-cust-w"); new Function(s)(); return document.documentElement.style.getPropertyValue("--roster-cust-w"); }, [外观预设脚本, v]);
    expect(await 跑("333")).toBe("333px");
    expect(await 跑("9999")).toBe("");
  } finally { await page.close(); }
});

it("右边 AI 面板开着：上限再扣 380（DOCK_W），拖条最大值和 CSS max-width 一起收紧", async () => {
  // 1600 宽：不开面板 1600 − 938 = 662 → 封顶 420；开着 1600 − 380 − 938 = 282
  const { page, errors } = await 开(1600, "400", true);
  try {
    expect((await 值(page))[2]).toBe("282");
    expect(await 宽(page)).toBe(282);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  const 关 = await 开(1600, "400", false);
  try {
    expect((await 值(关.page))[2]).toBe("420");
    expect(await 宽(关.page)).toBe(400);
  } finally { await 关.page.close(); }
});

it("拖到一半名单被卸掉：<html> 上不留 roster-resizing（整页光标、禁选字）", async () => {
  const { page, errors } = await 开();
  try {
    const 框 = (await page.getByRole("separator", { name: "调整客户名单宽度" }).boundingBox())!;
    await page.mouse.move(框.x + 框.width / 2, 框.y + 40);
    await page.mouse.down();
    expect(await page.evaluate(() => document.documentElement.classList.contains("roster-resizing"))).toBe(true);
    await page.evaluate(() => (window as unknown as { __卸: () => void }).__卸());
    expect(await page.evaluate(() => document.documentElement.classList.contains("roster-resizing"))).toBe(false);
    await page.mouse.up();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
