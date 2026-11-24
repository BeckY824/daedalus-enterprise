import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* 客户详情「历史变更」弹窗（11-24，HistoryChanges.tsx）：真组件 + globals.css + history-changes.css，只桩掉取数动作。钉的是：
   电脑居中弹窗、手机 390 从底部升起不横滚；Esc 关掉焦点回入口；打开才取数（没点开一次都不调）；客户 / 项目两块分开，
   系统批量修正折一行点开看明细，「更早的」往下接；项目块当前项目默认展开、看不到的项目只写个数不写名字；超长的一行省略 */
let browser: Browser, bundle: string;
const 长 = "超长的一句变更说明用来看会不会撑破弹窗".repeat(4);
const 动作 = `
  const 时=(h)=>new Date(Date.now()-h*3600_000).toISOString();
  const 事=(i,标,文,h)=>({id:'e'+i,at:时(h),标,文,谁:'QA',因:i===1?['原因：客户要求换人']:[]});
  const 行=(e)=>({种:'事件',事件:e});
  const 客户页1={ok:true,建档:{时间:时(24*400),行们:[{键:'建档人',值:'QA'},{键:'入口',值:'导入'},{键:'来源',值:'展会'},{键:'首任负责人',值:'QA'}]},
    行们:[行(事(1,'负责人','负责人从 甲 → 乙',1)),行(事(2,'资料修改','${长}',2)),
      {种:'批量',键:'d|批',说明:'按原表补客户资料',事件们:[事(90,'资料修改','补省份',30),事(91,'资料修改','补城市',30),事(92,'资料修改','补行业',30)]},
      ...Array.from({length:27},(_,i)=>行(事(10+i,i%2?'状态':'同号录入',i%2?'正常跟进 → 沉睡待定':'同号再次录入（电话）',50+i*5)))],
    更早:{at:时(400),id:'e36'}};
  const 客户页2={ok:true,建档:null,行们:Array.from({length:5},(_,i)=>行(事(100+i,'负责人','更早的一条 '+i,500+i))),更早:null};
  const 项目页=(id)=>({建档:{时间:时(24*30),行们:[{键:'怎么来的',值:'普通'},{键:'首个节点',值:'线索·潜客培育'}]},行们:[行(事(200,'节点','线索·潜客培育 → 商机·方案报价',3))].map(r=>({...r,事件:{...r.事件,id:id+r.事件.id}})),更早:null});
  export const 读客户历史=async(id,筛,前)=>{(window.__调??=[]).push(['客户',筛,!!前]);return 前?客户页2:筛==='全部'?客户页1:筛==='资料修改'?{ok:false,error:'服务忙'}:{ok:true,建档:null,行们:[],更早:null}};
  export const 读项目历史们=async(id,展开)=>{(window.__调??=[]).push(['项目们',展开]);return {ok:true,项目们:[
      {id:'p1',名:'${"超长的项目名称".repeat(8)}',阶段:'商机 · 方案报价',条数:12},{id:'p2',名:'第二个项目',阶段:'线索 · 潜客培育',条数:3}],
    看不到:2,展开:展开?{id:展开,...项目页(展开)}:null}};
  export const 读项目历史=async(id,pid)=>{(window.__调??=[]).push(['项目',pid]);return {ok:true,...项目页(pid)}};`;
const plugin: Plugin = { name: "history-changes", setup(b) {
  b.onResolve({ filter: /^\.\/history-actions$/ }, a => ({ path: a.path, namespace: "fixture", pluginData: 补全动作桩("src/app/(app)/customers/[id]/history-actions.ts", 动作) }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot,hydrateRoot} from 'react-dom/client';import {renderToString} from 'react-dom/server';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import HistoryChanges from '@/app/(app)/customers/[id]/HistoryChanges';
    const 树=()=><ConfigProvider locale={zhCN}><App><div className="rec-tags"><span className="rec-tags-n">客户来源：展会</span>
      <HistoryChanges customerId="a" 摘要={{客户:36,项目:15,项目数:2,最近:new Date(Date.now()-3600_000).toISOString(),状态:true}} 当前项目="p1" 客户名="${"超长客户名称".repeat(8)} · KH-0001"/></div></App></ConfigProvider>;
    window.__render=()=>createRoot(document.getElementById('root')).render(树());
    // 服务端先画一遍再水合（入口上的相对时间按浏览器的钟算，服务端那一版不带）
    window.__hydrate=()=>{const el=document.getElementById('root');el.innerHTML=renderToString(树());window.__ssr=el.innerHTML;hydrateRoot(el,树(),{onRecoverableError:(e)=>console.error('水合错：'+e)});};
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number, 暗 = false) {
  const page = await browser.newPage({ viewport: { width, height: width < 768 ? 844 : 900 }, colorScheme: 暗 ? "dark" : "light" }); page.setDefaultTimeout(5000);
  const 错: string[] = [];
  page.on("pageerror", e => 错.push(String(e)));
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") 错.push(m.text()); });
  await page.route("http://hist.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://hist.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ path: path.resolve("src/app/(app)/customers/[id]/history-changes.css") });
  if (暗) { await page.addStyleTag({ path: path.resolve("src/app/dark.css") }); await page.evaluate(() => document.documentElement.setAttribute("data-mode", "dark")); }
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
  await page.getByTestId("history-entry").waitFor();
  return { page, 错 };
}
const 调 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: unknown[] }).__调 ?? []);
const 横滚 = (page: Page) => page.evaluate(() => [document.documentElement.scrollWidth > innerWidth,
  [...document.querySelectorAll(".hist-body, .ant-drawer-body, .ant-modal-body")].some(e => e.scrollWidth > e.clientWidth + 1)]);
const 截图 = (page: Page, 名: string) => process.env.HIST_SHOT_DIR ? page.screenshot({ path: path.join(process.env.HIST_SHOT_DIR, 名) }) : Promise.resolve();

it("没点开一次都不取；入口写条数和相对时间；点开电脑居中弹窗，客户块：建档一格、批量修正折一行点开看明细、「更早的」往下接；Esc 关掉焦点回入口", async () => {
  const { page, 错 } = await open(1280);
  try {
    const 入口 = page.getByTestId("history-entry");
    expect(await 调(page)).toEqual([]);
    expect((await 入口.innerText()).replace(/\s+/g, " ")).toMatch(/^历史变更 ?51 ?· (今天|昨天) \d\d:\d\d$/);
    await 入口.click();
    await page.getByTestId("history-event").first().waitFor();
    const 窗 = page.locator(".hist-modal .ant-modal-container");
    await page.getByTestId("history-event").first().waitFor();
    // 等打开的缩放动画走完再量
    await page.waitForFunction(() => !document.querySelector('.hist-modal[class*="ant-zoom"]'));
    // 居中：左右留白相等
    const 框 = (await 窗.boundingBox())!;
    expect(Math.abs(框.x - (1280 - 框.x - 框.width))).toBeLessThanOrEqual(2);
    expect(Math.round(框.width)).toBe(760);
    // 打开只取了客户第一页；项目块没点不取
    expect(await 调(page)).toEqual([["客户", "全部", false]]);
    expect(await page.locator(".hist-born dd").allInnerTexts()).toEqual(expect.arrayContaining(["导入", "展会", "QA"]));
    // 30 行：29 条单的 + 1 行折起来的批量
    expect(await page.getByTestId("history-event").count()).toBe(29);
    const 批 = page.getByTestId("history-batch");
    expect(await 批.innerText()).toContain("系统批量修正 3 处：按原表补客户资料");
    await 批.click();
    expect(await page.getByTestId("history-event").count()).toBe(32);
    expect(await 批.getAttribute("aria-expanded")).toBe("true");
    // 超长一句一行省略，悬停看全
    const 超长 = page.locator(".hist-ev-l", { hasText: 长.slice(0, 10) });
    expect(await 超长.evaluate(e => [getComputedStyle(e).textOverflow, e.scrollWidth > e.clientWidth, e.getAttribute("title")!.startsWith(e.textContent!.slice(0, 10))])).toEqual(["ellipsis", true, true]);
    expect(await 横滚(page)).toEqual([false, false]);
    await 截图(page, "历史变更-客户-1280.png");
    await page.getByRole("button", { name: "更早的" }).click();
    await page.getByText("更早的一条 4").waitFor();
    expect(await 调(page)).toEqual([["客户", "全部", false], ["客户", "全部", true]]);
    expect(await page.getByRole("button", { name: "更早的" }).count()).toBe(0);
    // 换筛选在服务端筛
    await page.getByRole("button", { name: "同号录入", exact: true }).click();
    await page.getByText("这一类还没有变更").waitFor();
    expect((await 调(page)).at(-1)).toEqual(["客户", "同号录入", false]);
    // 换筛选没取成（审查后补）：「筛」退回上一个，报没换成
    await page.getByRole("button", { name: "资料修改", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "没换成「资料修改」" }).waitFor();
    expect(await page.getByRole("alert").innerText()).toBe("没换成「资料修改」，还是看「同号录入」：服务忙");
    expect(await page.getByRole("button", { name: "资料修改", exact: true }).getAttribute("aria-pressed")).toBe("false");
    expect(await page.getByRole("button", { name: "同号录入", exact: true }).getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("Escape");
    await 窗.waitFor({ state: "detached" });
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("history-entry");
    expect(await 入口.getAttribute("aria-expanded")).toBe("false");
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("项目块：点到才取；当前项目默认展开、别的点开才取；看不到的项目只写个数、不写名字；项目名超长一行省略", async () => {
  const { page, 错 } = await open(1280);
  try {
    await page.getByTestId("history-entry").click();
    await page.getByTestId("history-event").first().waitFor();
    await page.getByRole("tab", { name: /项目/ }).click();
    await page.getByTestId("history-project").first().waitFor();
    expect((await 调(page)).at(-1)).toEqual(["项目们", "p1"]);
    const 节 = page.getByTestId("history-project");
    expect(await 节.count()).toBe(2);
    expect(await 节.nth(0).getAttribute("data-open")).toBe("true");
    expect(await 节.nth(0).innerText()).toContain("当前项目");
    expect(await 节.nth(0).getByTestId("history-event").count()).toBe(1);
    expect(await 节.nth(1).getAttribute("data-open")).toBe("false");
    expect(await page.getByTestId("history-hidden").innerText()).toBe("还有 2 个同事在推的项目你看不到，变更不显示。");
    const 名 = 节.nth(0).locator(".hist-sec-n");
    expect(await 名.evaluate(e => [getComputedStyle(e).textOverflow, e.scrollWidth > e.clientWidth])).toEqual(["ellipsis", true]);
    expect(await 横滚(page)).toEqual([false, false]);
    await 截图(page, "历史变更-项目-1280.png");
    await 节.nth(1).locator(".hist-sec-h").click();
    await 节.nth(1).getByTestId("history-event").waitFor();
    expect((await 调(page)).at(-1)).toEqual(["项目", "p2"]);
    // 左右方向键在两块之间切
    await page.getByRole("tab", { name: /项目/ }).focus();
    await page.keyboard.press("ArrowLeft");
    expect(await page.getByRole("tab", { name: /客户/ }).getAttribute("aria-selected")).toBe("true");
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("手机 390：从底部升起（贴底、占满宽），不横滚；点击区够大；Esc 关掉焦点回入口", async () => {
  const { page, 错 } = await open(390);
  try {
    const 入口 = page.getByTestId("history-entry");
    expect(Math.round((await 入口.boundingBox())!.height)).toBe(32);
    await 入口.click();
    await page.getByTestId("history-event").first().waitFor();
    await page.waitForTimeout(400);
    const 板 = page.locator(".hist-sheet .ant-drawer-content-wrapper");
    const 框 = (await 板.boundingBox())!;
    expect(Math.round(框.x)).toBe(0);
    expect(Math.round(框.width)).toBe(390);
    expect(Math.abs(框.y + 框.height - 844)).toBeLessThanOrEqual(1);
    expect(框.y).toBeGreaterThan(844 * 0.07);
    expect(await page.locator(".hist-modal").count()).toBe(0);
    expect(await 横滚(page)).toEqual([false, false]);
    await 截图(page, "历史变更-手机-390.png");
    for (const 钮 of await page.locator(".hist-flt button, .hist-seg button").all()) expect((await 钮.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("tab", { name: /项目/ }).click();
    await page.getByTestId("history-project").first().waitFor();
    expect(await 横滚(page)).toEqual([false, false]);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("history-entry");
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("暗色：弹窗底、字、小标都跟着 token 变，不是写死的浅色", async () => {
  const { page } = await open(1280, true);
  try {
    await page.getByTestId("history-entry").click();
    await page.getByTestId("history-event").first().waitFor();
    // 鼠标挪开：停在入口上是悬停色
    await page.mouse.move(5, 890);
    await page.waitForTimeout(400);
    const 色 = await page.evaluate(() => {
      const g = (s: string, p: string) => getComputedStyle(document.querySelector(s)!).getPropertyValue(p);
      // 拿一个探针读 token 在暗色下算出来的值，和组件实际用的比
      const 探 = (v: string, p: string) => { const d = document.createElement("div"); d.style.setProperty(p, `var(${v})`); document.body.appendChild(d); const x = getComputedStyle(d).getPropertyValue(p); d.remove(); return x; };
      return { 入口: [g(".hist-entry", "background-color"), 探("--panel", "background-color")], 建档: [g(".hist-born", "background-color"), 探("--workbench", "background-color")], 字: [g(".hist-ev-l", "color"), 探("--ink", "color")], 白: g(".hist-entry", "background-color") === "rgb(255, 255, 255)" };
    });
    expect(色.入口[0]).toBe(色.入口[1]);
    expect(色.建档[0]).toBe(色.建档[1]);
    expect(色.字[0]).toBe(色.字[1]);
    expect(色.白).toBe(false);
  } finally { await page.close(); }
}, 60_000);

it("服务端先画再水合：服务端那一版入口不带「· 最近」（相对时间按浏览器的钟），水合不报对不上，水合完再补上", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(5000);
  const 错: string[] = [];
  page.on("pageerror", e => 错.push(String(e)));
  page.on("console", m => { if (m.type() === "error") 错.push(m.text()); });
  try {
    await page.route("http://hist.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
    await page.goto("http://hist.test");
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as unknown as { __hydrate: () => void }).__hydrate());
    const ssr = await page.evaluate(() => (window as unknown as { __ssr: string }).__ssr);
    expect(ssr).toContain("历史变更");
    expect(ssr).not.toContain("hist-entry-ago");
    await page.locator(".hist-entry-ago").waitFor();
    expect(await page.locator(".hist-entry-ago").innerText()).toMatch(/^· (今天|昨天) \d\d:\d\d$/);
    expect(错.filter((x) => /水合|hydrat|Hydrat/.test(x))).toEqual([]);
  } finally { await page.close(); }
}, 60_000);
