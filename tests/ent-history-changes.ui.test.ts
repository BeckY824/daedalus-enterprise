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
const 合并动作 = `
  export const 并进来的合并单=async(id)=>{(window.__合并调??=[]).push(['合并单',id]);if(window.__合并慢)await new Promise(r=>{window.__合并放=r});if(window.__合并坏)throw new Error('连不上');return window.__合并单??[]};
  export const 撤回合并单=async(mid)=>{(window.__合并调??=[]).push(['撤回',mid]);return window.__撤回结果??{ok:true,没还原:[]}};
  export const 项目合并单们=async(pid)=>{(window.__合并调??=[]).push(['项目合并单',pid]);return (window.__项目合并单??{})[pid]??[]};
  export const 撤回项目合并单=async(mid)=>{(window.__合并调??=[]).push(['撤回项目',mid]);return window.__撤回项目结果??{ok:true,没还原:[]}};`;
const plugin: Plugin = { name: "history-changes", setup(b) {
  b.onResolve({ filter: /^\.\/history-actions$/ }, a => ({ path: a.path, namespace: "fixture", pluginData: 补全动作桩("src/app/(app)/customers/[id]/history-actions.ts", 动作) }));
  // 合并单（合并客户第一批 11-25）：window.__合并单 给几张；撤回回 window.__撤回结果
  b.onResolve({ filter: /(^|\/)merge-actions$/ }, a => ({ path: a.path, namespace: "fixture", pluginData: 补全动作桩("src/app/(app)/customers/merge-actions.ts", 合并动作) }));
  b.onResolve({ filter: /^next\/navigation$/ }, a => ({ path: a.path, namespace: "fixture", pluginData: "export const useRouter=()=>({refresh(){window.__刷新=(window.__刷新||0)+1},push(){},replace(){},prefetch(){}});" }));
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
  await page.addStyleTag({ path: path.resolve("src/app/(app)/customers/merge.css") });
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
    expect((await 入口.innerText()).replace(/\s+/g, " ")).toMatch(/^历史变更 ?51 ?· (今天 \d\d:\d\d|昨天( \d\d:\d\d)?)$/);
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
    expect(await page.locator(".hist-entry-ago").innerText()).toMatch(/^· (今天 \d\d:\d\d|昨天( \d\d:\d\d)?)$/);
    expect(错.filter((x) => /水合|hydrat|Hydrat/.test(x))).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("合并单（合并客户第一批 11-25）：客户块筛选行下面列出并进来的合并单和单独合成的联系人；能撤的才给「撤回合并」，后果框确认后写明留下几条、为什么；手机 390 不横滚", async () => {
  for (const 宽 of [1280, 390]) {
    const { page, 错 } = await open(宽);
    try {
      await page.evaluate((长名) => {
        const w = window as unknown as Record<string, unknown>;
        w.__合并单 = [
          { id: "m1", kind: "客户", 从: 长名, 编号: "NO.00012", at: new Date(Date.now() - 3600_000).toISOString(), status: "已合并", 能撤: true },
          { id: "m2", kind: "联系人", 从: "王五", 到: "王 五", 编号: null, at: new Date(Date.now() - 86_400_000).toISOString(), status: "已撤回", 能撤: false },
          // 没撤过但服务端说这会儿不能撤（留下这家已不归本人 / 在交接中 / 只读）：照样列出，不摆按钮
          { id: "m4", kind: "客户", 从: "转走的", 编号: "NO.00013", at: new Date(Date.now() - 2 * 86_400_000).toISOString(), status: "已合并", 能撤: false },
        ];
        w.__撤回结果 = { ok: true, 没还原: [{ 类: "项目", id: "p1", 原因: "合并之后被改到别的客户，没改回" }, { 类: "联系人", id: "c1", 原因: "主客户之后又改过，整组留下" }] };
      }, "超长的被并客户名称".repeat(5));
      await page.getByTestId("history-entry").click();
      await page.getByTestId("merge-order").first().waitFor();
      expect(await page.getByTestId("merge-order").count()).toBe(3);
      const 第一张 = page.getByTestId("merge-order").first();
      expect(await 第一张.locator(".mrg-order-t").innerText()).toContain("NO.00012「超长的被并客户名称");
      expect(await 第一张.locator(".mrg-order-t").evaluate((e) => getComputedStyle(e).textOverflow)).toBe("ellipsis");
      // 已撤回的、能撤 false 的都不给按钮
      expect(await page.getByTestId("merge-undo").count()).toBe(1);
      expect(await page.getByTestId("merge-order").nth(1).innerText()).toContain("已撤回");
      expect(await 横滚(page)).toEqual([false, false]);
      await page.getByTestId("merge-undo").click();
      const 框 = page.locator(".csq");
      await 框.waitFor();
      expect(await 框.innerText()).toContain("新建的项目不跟着走");
      await 框.getByRole("button", { name: "撤回合并" }).click();
      await page.getByTestId("merge-undo-left").waitFor();
      expect(await page.getByTestId("merge-undo-left").innerText()).toContain("项目：合并之后被改到别的客户，没改回");
      expect(await 第一张.innerText()).toContain("留下 2 条没还原");
      expect(await page.getByTestId("merge-undo").count()).toBe(0);
      expect(await page.evaluate(() => (window as unknown as { __合并调?: unknown[] }).__合并调)).toEqual([["合并单", "a"], ["撤回", "m1"]]);
      expect(await 横滚(page)).toEqual([false, false]);
      await 截图(page, `历史变更-合并单-${宽}.png`);
      expect(错).toEqual([]);
    } finally { await page.close(); }
  }
}, 90_000);

it("合并单后到不顶跳：合并单没回来时建档格、时间线先不画（只一句正在读取），回来后合并单在筛选行下面、和时间线同一下出来，不会先画再被顶", async () => {
  const { page, 错 } = await open(1280);
  try {
    await page.evaluate(() => Object.assign(window, { __合并慢: true, __合并单: [{ id: "m3", kind: "联系人", 从: "王五", 到: "王 五", 编号: null, at: new Date(Date.now() - 3600_000).toISOString(), status: "已合并", 能撤: true }] }));
    await page.getByTestId("history-entry").click();
    const 筛 = page.locator(".hist-flt");
    await 筛.waitFor();
    // 第一页早回来了，合并单还没回：时间线、建档格都先不画
    await page.waitForTimeout(300);
    expect(await page.getByTestId("history-event").count()).toBe(0);
    expect(await page.locator(".hist-born-w").count()).toBe(0);
    expect(await page.locator("#hist-panel-客户").innerText()).toContain("正在读取");
    // 合并单一回来，同一帧里建档格、合并单、时间线都在（不是先画时间线、合并单后插进来）
    const 同帧 = page.evaluate(() => new Promise<boolean[]>((ok) => {
      new MutationObserver((_, o) => {
        if (!document.querySelector("[data-testid=merge-order]")) return;
        o.disconnect();
        ok([!!document.querySelector(".hist-born-w"), !!document.querySelector("[data-testid=history-event]")]);
      }).observe(document.body, { childList: true, subtree: true });
    }));
    await page.evaluate(() => (window as unknown as { __合并放: () => void }).__合并放());
    expect(await 同帧).toEqual([true, true]);
    const [单, 第一条, 筛后] = await Promise.all([page.getByTestId("merge-orders").boundingBox(), page.getByTestId("history-event").first().boundingBox(), 筛.boundingBox()]);
    // 合并单夹在筛选行和时间线中间
    expect(单!.y).toBeGreaterThan(筛后!.y);
    expect(第一条!.y).toBeGreaterThan(单!.y + 单!.height - 1);
    // 单独合成的联系人：按钮和后果框确认键叫「撤回合成」
    const 钮 = page.getByTestId("merge-undo");
    expect(await 钮.innerText()).toBe("撤回合成");
    await 钮.click();
    const 框 = page.locator(".csq");
    await 框.waitFor();
    expect(await 框.getByRole("button", { name: "撤回合成" }).count()).toBe(1);
    expect(await 框.getByRole("button", { name: "撤回合并" }).count()).toBe(0);
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("合并单没读到：写一行「合并单没读到，请稍后再试」，时间线照常出", async () => {
  const { page, 错 } = await open(390);
  try {
    await page.evaluate(() => Object.assign(window, { __合并坏: true }));
    await page.getByTestId("history-entry").click();
    const 话 = page.getByTestId("merge-orders-err");
    await 话.waitFor();
    expect(await 话.innerText()).toBe("合并单没读到，请稍后再试");
    await page.getByTestId("history-event").first().waitFor();
    expect(await page.getByTestId("merge-order").count()).toBe(0);
    expect(await 横滚(page)).toEqual([false, false]);
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("项目合并单（第二批 2a）：两个项目那一节都列这一张（并入「A」/「B」并入这个项目）；能撤的给「撤回合并」，已合并不能撤的写原因；撤回后写结果、两节都不再给按钮", async () => {
  for (const 宽 of [1280, 390]) {
    const { page, 错 } = await open(宽);
    try {
      await page.evaluate((长名) => {
        const w = window as unknown as Record<string, unknown>;
        const at = new Date(Date.now() - 3600_000).toISOString();
        const 老 = new Date(Date.now() - 40 * 86_400_000).toISOString();
        const 单 = { id: "pm1", 从: "第二个项目", 到: 长名, 从id: "p2", 到id: "p1", at, status: "已合并", 谁: "测试销售甲", 能撤: true };
        const 过期 = { id: "pm0", 从: "更早并进来的", 到: 长名, 从id: "p9", 到id: "p1", at: 老, status: "已合并", 谁: "测试销售甲", 能撤: false, 不能撤因: "合并已超过 30 天，不能撤回" };
        w.__项目合并单 = { p1: [{ ...单, 方向: "并进来" }, { ...过期, 方向: "并进来" }], p2: [{ ...单, 方向: "并出去" }] };
        w.__撤回项目结果 = { ok: true, 没还原: [{ 类: "沟通", id: "f1", 原因: "合并之后被改过（换了项目或删了）" }] };
      }, "超长的项目名称".repeat(8));
      await page.getByTestId("history-entry").click();
      await page.getByRole("tab", { name: /项目/ }).click();
      const 节 = page.getByTestId("history-project");
      // 当前项目（留下的 p1）默认展开：并进来的两张；过了 30 天的写原因、不给按钮
      await 节.nth(0).getByTestId("pmerge-order").first().waitFor();
      expect(await 节.nth(0).getByTestId("pmerge-order").count()).toBe(2);
      expect(await 节.nth(0).getByTestId("pmerge-order").first().locator(".mrg-order-t").innerText()).toBe("「第二个项目」并入这个项目");
      expect(await 节.nth(0).getByTestId("pmerge-why").innerText()).toBe("合并已超过 30 天，不能撤回");
      expect(await 节.nth(0).getByTestId("pmerge-undo").count()).toBe(1);
      // 被并掉的 p2 那一节点开也看得到同一张：并入「A」，一行省略、悬停看全（带谁并的）
      await 节.nth(1).locator(".hist-sec-h").click();
      await 节.nth(1).getByTestId("pmerge-order").waitFor();
      const 题 = 节.nth(1).locator(".mrg-order-t");
      expect(await 题.innerText()).toContain("并入「超长的项目名称");
      expect(await 题.evaluate((e) => [getComputedStyle(e).textOverflow, e.scrollWidth > e.clientWidth])).toEqual(["ellipsis", true]);
      expect(await 题.getAttribute("title")).toContain("（测试销售甲 ");
      expect(await 横滚(page)).toEqual([false, false]);
      if (宽 < 768) expect((await 节.nth(1).getByTestId("pmerge-undo").boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await 节.nth(1).getByTestId("pmerge-undo").click();
      const 框 = page.locator(".csq");
      await 框.waitFor();
      expect(await 框.innerText()).toContain("撤回合并：把「第二个项目」从「超长的项目名称");
      await 框.getByRole("button", { name: "撤回合并" }).click();
      await 节.nth(1).getByTestId("merge-undo-left").waitFor();
      expect(await 节.nth(1).getByTestId("pmerge-order").innerText()).toContain("已撤回；留下 1 条没还原：");
      expect(await 节.nth(1).getByTestId("merge-undo-left").innerText()).toContain("沟通：合并之后被改过（换了项目或删了）");
      expect(await 节.nth(1).getByTestId("pmerge-undo").count()).toBe(0);
      // 留下那一节的同一张也改成已撤回、不再给按钮（过了 30 天那张照旧写原因）
      expect(await 节.nth(0).getByTestId("pmerge-order").first().innerText()).toContain("已撤回");
      expect(await 节.nth(0).getByTestId("pmerge-undo").count()).toBe(0);
      expect(await 节.nth(0).getByTestId("pmerge-why").count()).toBe(1);
      expect(await page.evaluate(() => (window as unknown as { __刷新?: number }).__刷新)).toBe(1);
      const 调们 = await page.evaluate(() => (window as unknown as { __合并调?: unknown[] }).__合并调);
      expect(调们).toEqual([["合并单", "a"], ["项目合并单", "p1"], ["项目合并单", "p2"], ["撤回项目", "pm1"]]);
      expect(await 横滚(page)).toEqual([false, false]);
      await 截图(page, `历史变更-项目合并单-${宽}.png`);
      expect(错).toEqual([]);
    } finally { await page.close(); }
  }
}, 90_000);
