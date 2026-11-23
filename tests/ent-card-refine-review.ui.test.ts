import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* 卡片改进 · 第三阶段（11-23，原型-卡片改进-20261123「改后」；用户 11-23 定最终外观：现状主题、白页面底 + 白卡）：复盘任务页、首页指标卡在真浏览器里量。
   真 DataShell + BoardTodos、真 HomeCards + globals.css，只桩掉服务端动作（桩照 ent-design-rb-layout）。钉的是：
   统计条（逾期 / 今天到期 / 本周到期 / 全部待办）是一整张卡，格与格竖线贯通；选中 = --brand-bg 底 + 底边 2px 品牌色条左右各缩 16、不碰圆角；悬停只给浅底；
   390 的 2×2 下色条落在所选那一格底边；页签底线 --field-line；看板列之间竖线贯通；首页指标卡和统计条同一套字（大数 26、标签 13 灰）；
   这些只挂现状主题 + 非一张纸：白底（D-2 一张纸）、换皮主题照旧；暗黑跟着 token */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "card-refine-review", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "const 记=(u)=>{(window.__去||(window.__去=[])).push(u)};export const useRouter=()=>({push:记,refresh(){},replace:记,prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/customers\/\[id\]\/actions$/, 补全动作桩("src/app/(app)/customers/[id]/actions.ts", "export const toggleTask=async()=>({ok:true}),completePlan=async()=>({ok:true});export const 沟通可选项目=async()=>({ok:true,项目们:null,能建项目:true});"));
  stub(/projects\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "export const 记项目沟通Action=async()=>({ok:true});"));
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import DataShell from '@/app/(app)/overview/DataShell';
    import BoardTodos from '@/app/(app)/overview/BoardTodos';
    import HomeCards from '@/app/(app)/dashboard/HomeCards';
    import {BusinessProvider} from '@/lib/business-client';
    import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域销售总监';
    const 天前=(n)=>new Date(Date.now()-n*86400000).toISOString();
    const 行=(前,n,组)=>Array.from({length:n},(_,i)=>({
      key:前+':'+i, kind:'task', id:前+i, 时间:天前(3+i), 明确钟点:true,
      内容:'第'+i+'条：'+长+'的方案回访和报价确认', customerId:'c'+i, customerName:长+i, projectName:'华东二期产线改造项目'+长,
      ownerId:'u1', ownerName:'很长很长的负责人名字', 组, 去:'/projects/p'+i,
    }));
    const root=()=>window.__root||(window.__root=createRoot(document.getElementById('root')));
    window.__画=(o)=>{
      const 计数={overdue:o.逾期??3,today:1,week:0,all:6};
      const 看板={计数,列:{overdue:{总数:3,行:行('overdue',3,'逾期')},today:{总数:1,行:行('today',1,'今天')},later:{总数:2,行:行('later',2,'以后')}}};
      root().render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
        <DataShell view="现在" 项目 页签="todo" 选人={{选项:[{value:'u1',label:'小王'}],当前:''}}>
          <BoardTodos 数={{计数,总数:6,页:1,行:[]}} 看板={o.卡&&o.卡!=='all'?undefined:看板} 布局="board" 卡={o.卡??'all'} 只看自己={false} 看全员={true}/>
        </DataShell>
      </BusinessProvider></App>);
    };
    window.__首页=()=>root().render(<div className="cli cli-empty"><div className="cli-ck"><div className="cli-ck-g">
      <div className="cli-col cli-frame"><div style={{height:240}}/></div>
      <HomeCards 数={{"month-new":591,key:123,"no-follow":4802,"due-soon":0}}/>
    </div></div></div>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 参 = { 首页?: boolean; 卡?: string; 逾期?: number; 皮?: string; 纸?: "tone" | "white" | null; 暗?: boolean };
/** 壳照 ent-design-rb-layout：正文在 main.app-content 里，电脑宽左边让出左栏 220、正文内边距 22 / 26 */
async function 开(width: number, o: 参 = {}) {
  const 手 = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: 手 });
  const page = await ctx.newPage(); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const 纸 = o.纸 === undefined ? "tone" : o.纸;
  const 属 = `${o.皮 || o.暗 ? ` data-skin="${o.皮 ?? "now"}"` : ""}${纸 ? ` data-paper="${纸}"` : ""} data-mode="${o.暗 ? "dark" : "light"}"`;
  const 壳 = `<div class='has-ai-fab'><main class='main app-content'><div id='root'></div></main></div>`;
  await page.route("http://card-refine.test/**", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html${属}><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{margin:0;background:var(--page-bg)}</style>${壳}</html>` }));
  await page.goto(`http://card-refine.test/${o.首页 ? "dashboard" : "overview"}`);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  if (o.皮 || o.暗) await page.addStyleTag({ path: path.resolve("src/app/skins/shared.css") });
  if (o.皮) await page.addStyleTag({ path: path.resolve(`src/app/skins/${o.皮}.css`) });
  if (o.暗) await page.addStyleTag({ path: path.resolve("src/app/dark.css") });
  await page.addStyleTag({ content: 手 ? ".app-content{display:block}" : ".app-content{display:block;margin-left:220px;padding:22px 26px}" });
  await page.addScriptTag({ content: bundle });
  if (o.首页) { await page.evaluate(() => (window as unknown as { __首页: () => void }).__首页()); await page.locator(".home-cards").waitFor(); }
  else { await page.evaluate(a => (window as unknown as { __画: (o: object) => void }).__画(a), o as object); await page.locator(".btodo-cards").waitFor(); }
  await page.waitForTimeout(300);
  return { page, errors, close: () => ctx.close() };
}
const 量变量 = (page: Page, v: string, 属 = "color") => page.evaluate(([v, 属]) => { const s = document.createElement("span"); s.style.setProperty(属, `var(${v})`); document.body.append(s); const c = getComputedStyle(s).getPropertyValue(属); s.remove(); return c; }, [v, 属]);

const 框 = async (l: import("playwright").Locator) => { const b = (await l.boundingBox())!; return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
const 字 = (l: import("playwright").Locator) => l.first().evaluate(e => { const s = getComputedStyle(e); return { 号: s.fontSize, 重: s.fontWeight, 色: s.color, 行高: s.lineHeight }; });
/** 选中那一格的底边色条（::after）：相对格子的左右缩进、离底边、高、色 */
const 色条 = (l: import("playwright").Locator) => l.evaluate(e => { const s = getComputedStyle(e, "::after"); return { 有: s.content !== "none", 左: s.left, 右: s.right, 底: s.bottom, 高: s.height, 色: s.backgroundColor, 定位: s.position }; });
const 不横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

it("统计条一整张卡（1024 / 1280）：四边 --field-line、圆角 10、淡影；格与格之间竖线从卡顶贯通到卡底；页签底线 --field-line", async () => {
  for (const w of [1024, 1280]) {
    const { page, errors, close } = await 开(w);
    try {
      const 线 = await 量变量(page, "--field-line", "border-top-color");
      const 条 = page.locator(".btodo-cards");
      expect(await 条.evaluate(e => { const s = getComputedStyle(e); return `${s.borderTopWidth} ${s.borderTopColor} ${s.borderBottomColor} ${s.borderTopLeftRadius} ${s.boxShadow} ${s.columnGap}`; }), `宽 ${w}`)
        .toBe(`1px ${线} ${线} 10px rgba(0, 0, 0, 0.04) 0px 1px 2px 0px 0px`);
      const 卡框 = await 框(条);
      const 格 = page.locator(".btodo-cards > .btodo-card");
      expect(await 格.count()).toBe(4);
      const 格框 = await Promise.all([0, 1, 2, 3].map(i => 框(格.nth(i))));
      // 一行四格：同一条顶线、等高、首尾贴卡边（只差 1px 卡边），格与格之间没有缝
      expect(new Set(格框.map(b => b.y)), `宽 ${w}`).toEqual(new Set([卡框.y + 1]));
      expect(new Set(格框.map(b => b.y + b.h)), `宽 ${w}：竖线到卡底`).toEqual(new Set([卡框.y + 卡框.h - 1]));
      for (let i = 1; i < 4; i++) expect(Math.abs(格框[i].x - (格框[i - 1].x + 格框[i - 1].w)), `宽 ${w}：第 ${i + 1} 格紧挨上一格（取整差 ≤ 1）`).toBeLessThanOrEqual(1);
      const 边 = await 格.evaluateAll(es => es.map(e => { const s = getComputedStyle(e); return `${s.borderLeftWidth} ${s.borderLeftColor} ${s.borderTopWidth} ${s.borderRadius}`; }));
      expect(边[0]).toMatch(/^0px .* 0px 0px$/);
      expect(new Set(边.slice(1)), `宽 ${w}：格间竖线 --field-line`).toEqual(new Set([`1px ${线} 0px 0px`]));
      // 页签底线：antd Tabs nav 的 ::before
      expect(await page.locator(".data-shell-tabs > .ant-tabs-nav").evaluate(e => { const s = getComputedStyle(e, "::before"); return `${s.borderBottomWidth} ${s.borderBottomColor}`; })).toBe(`1px ${线}`);
      // 卡距 12：统计条和「全部待办」卡
      const 单 = await 框(page.locator(".btodo-wrap > .btodo-list").first());
      expect(单.y - (卡框.y + 卡框.h), `宽 ${w}：卡距`).toBe(12);
      expect(await 不横滚(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

it("统计条选中：--brand-bg 底 + 底边 2px 品牌色条左右各缩 16、贴底不碰圆角、标签品牌深色 600；悬停只给浅底不给色条；字：标签 13 灰、大数 26 · 600 行高 32", async () => {
  const { page, errors, close } = await 开(1280);
  try {
    const [品, 品深, 浅, 灰] = await Promise.all([量变量(page, "--brand", "background-color"), 量变量(page, "--brand-deep"), 量变量(page, "--row-hover", "background-color"), 量变量(page, "--text-muted")]);
    const 中 = page.locator(".btodo-cards > .btodo-card.is-on");
    expect(await 中.locator(".home-card-k").innerText()).toBe("全部待办");
    expect(await 中.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await 量变量(page, "--brand-bg", "background-color"));
    expect(await 色条(中)).toEqual({ 有: true, 左: "16px", 右: "16px", 底: "0px", 高: "2px", 色: 品, 定位: "absolute" });
    expect(await 字(中.locator(".home-card-k"))).toMatchObject({ 号: "13px", 重: "600", 色: 品深 });
    // 没选中的：标签 13 灰常规，大数 26 · 600 行高 32
    const 平 = page.locator(".btodo-cards > .btodo-card:not(.is-on)");
    expect(await 字(平.locator(".home-card-k"))).toEqual({ 号: "13px", 重: "400", 色: 灰, 行高: "20px" });
    expect(await 字(平.locator(".home-card-v"))).toMatchObject({ 号: "26px", 重: "600", 行高: "32px" });
    // 悬停「今天到期」：只换浅底，没有色条、不浮起
    const 今 = 平.nth(1);
    await 今.hover(); await page.waitForTimeout(300);
    expect(await 今.evaluate(e => { const s = getComputedStyle(e); return { 底: s.backgroundColor, 影: s.boxShadow, 移: s.transform }; })).toEqual({ 底: 浅, 影: "none", 移: "none" });
    expect((await 色条(今)).有).toBe(false);
    expect(errors).toEqual([]);
  } finally { await close(); }
});

it("390：统计条 2×2 横竖线都贯通，选中「今天到期」（右上格）色条落在那一格底边", async () => {
  const { page, errors, close } = await 开(390, { 卡: "today" });
  try {
    const 线 = await 量变量(page, "--field-line", "border-top-color");
    const 格 = page.locator(".btodo-cards > .btodo-card");
    const 框们 = await Promise.all([0, 1, 2, 3].map(i => 框(格.nth(i))));
    expect([框们[1].y, 框们[2].x, 框们[3].y], "两行两列").toEqual([框们[0].y, 框们[0].x, 框们[2].y]);
    expect(框们[2].y, "第二行紧挨第一行").toBe(框们[0].y + 框们[0].h);
    const 边 = await 格.evaluateAll(es => es.map(e => { const s = getComputedStyle(e); return [s.borderLeftWidth, s.borderTopWidth]; }));
    expect(边).toEqual([["0px", "0px"], ["1px", "0px"], ["0px", "1px"], ["1px", "1px"]]);
    expect(await 格.nth(3).evaluate(e => getComputedStyle(e).borderTopColor)).toBe(线);
    const 中 = 格.nth(1);
    expect(await 中.getAttribute("aria-pressed")).toBe("true");
    expect(await 色条(中)).toMatchObject({ 有: true, 左: "16px", 右: "16px", 底: "0px", 高: "2px" });
    expect(await 不横滚(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await close(); }
});

it("看板：三列铺到卡边，列与列之间竖线从卡头线下贯通到卡底；列头 13 · 600、计数 13 灰（没有小胶囊）；390 一列换横线", async () => {
  for (const w of [1280, 390]) {
    const { page, errors, close } = await 开(w);
    try {
      const 线 = await 量变量(page, "--field-line", "border-top-color");
      const 卡 = await 框(page.locator(".btodo-wrap > .btodo-list").first());
      const 头 = await 框(page.locator(".btodo-wrap > .btodo-list").first().locator("> .btodo-head"));
      expect(await page.locator(".btodo-list > .btodo-head").first().evaluate(e => getComputedStyle(e).borderBottomColor)).toBe(线);
      const 列 = page.locator(".btodo-board > .btodo-col");
      const 列框 = await Promise.all([0, 1, 2].map(i => 框(列.nth(i))));
      if (w === 1280) {
        expect(new Set(列框.map(b => b.y)), "列顶 = 卡头线下").toEqual(new Set([头.y + 头.h]));
        expect(new Set(列框.map(b => b.y + b.h)), "列底 = 卡底（只差 1px 卡边）").toEqual(new Set([卡.y + 卡.h - 1]));
        expect([列框[0].x, 列框[2].x + 列框[2].w], "左右贴卡边").toEqual([卡.x + 1, 卡.x + 卡.w - 1]);
        expect(await 列.evaluateAll(es => es.map(e => getComputedStyle(e).borderLeftWidth + " " + getComputedStyle(e).borderLeftColor))).toEqual([expect.stringMatching(/^0px/), `1px ${线}`, `1px ${线}`]);
      } else {
        expect(new Set(列框.map(b => b.x)), "一列").toEqual(new Set([卡.x + 1]));
        expect(await 列.evaluateAll(es => es.map(e => getComputedStyle(e).borderTopWidth + " " + getComputedStyle(e).borderLeftWidth))).toEqual(["0px 0px", "1px 0px", "1px 0px"]);
        expect(列框[2].y + 列框[2].h).toBe(卡.y + 卡.h - 1);
      }
      expect(await 字(page.locator(".btodo-col-h > b"))).toMatchObject({ 号: "13px", 重: "600" });
      expect(await page.locator(".btodo-col-h > .btodo-col-n").first().evaluate(e => { const s = getComputedStyle(e); return `${s.fontSize} ${s.color} ${s.backgroundColor}`; })).toBe(`13px ${await 量变量(page, "--count-fg")} rgba(0, 0, 0, 0)`);
      expect(await 不横滚(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

it("首页指标卡（1280 / 390）：和统计条同一套字（标签 13 灰、大数 26 · 600 行高 32），卡四边 --field-line + 淡影；不横滚", async () => {
  for (const w of [1280, 390]) {
    const { page, errors, close } = await 开(w, { 首页: true });
    try {
      const 线 = await 量变量(page, "--field-line", "border-top-color");
      const 卡 = page.locator(".home-cards > .home-card");
      expect(await 卡.count()).toBe(4);
      expect(new Set(await 卡.evaluateAll(es => es.map(e => { const s = getComputedStyle(e); return `${s.borderTopWidth} ${s.borderTopColor} ${s.borderTopLeftRadius} ${s.boxShadow}`; }))), `宽 ${w}`)
        .toEqual(new Set([`1px ${线} 10px rgba(0, 0, 0, 0.04) 0px 1px 2px 0px`]));
      expect(await 字(卡.locator(".home-card-k"))).toEqual({ 号: "13px", 重: "400", 色: await 量变量(page, "--text-muted"), 行高: "20px" });
      expect(await 字(卡.locator(".home-card-v"))).toMatchObject({ 号: "26px", 重: "600", 行高: "32px" });
      if (w === 390) {
        const b = await Promise.all([0, 1, 2].map(i => 框(卡.nth(i))));
        expect([b[1].y, b[2].x], "手机 2×2").toEqual([b[0].y, b[0].x]);
      }
      // 悬停只换底，框线、影不变
      await 卡.first().locator(".home-kpi-head").hover(); await page.waitForTimeout(300);
      expect(await 卡.first().evaluate(e => `${getComputedStyle(e).borderTopColor} ${getComputedStyle(e).boxShadow}`)).toBe(`${线} rgba(0, 0, 0, 0.04) 0px 1px 2px 0px`);
      expect(await 不横滚(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

it("暗黑（现状）：统计条线是暗黑的 --field-line、影 .30，选中底 --brand-bg、色条 --brand", async () => {
  const { page, errors, close } = await 开(1280, { 暗: true });
  try {
    const 线 = await 量变量(page, "--field-line", "border-top-color");
    expect(线).toBe("rgb(58, 63, 72)");
    expect(await page.locator(".btodo-cards").evaluate(e => `${getComputedStyle(e).borderTopColor} ${getComputedStyle(e).boxShadow}`)).toBe(`${线} rgba(0, 0, 0, 0.3) 0px 1px 2px 0px`);
    const 中 = page.locator(".btodo-cards > .btodo-card.is-on");
    expect(await 中.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await 量变量(page, "--brand-bg", "background-color"));
    expect((await 色条(中)).色).toBe(await 量变量(page, "--brand", "background-color"));
    expect(await page.locator(".btodo-cards > .btodo-card").nth(1).evaluate(e => getComputedStyle(e).borderLeftColor)).toBe(线);
    expect(errors).toEqual([]);
  } finally { await close(); }
});

it("白底（D-2 一张纸）、换皮主题照旧：统计条没有外框和色条、页签线不是 --field-line、首页卡字号照旧", async () => {
  for (const o of [{ 纸: "white" as const }, { 皮: "tech" }, { 皮: "ledger" }]) {
    const 名 = JSON.stringify(o);
    const { page, errors, close } = await 开(1280, o);
    try {
      expect(await page.locator(".btodo-cards").evaluate(e => getComputedStyle(e).borderTopWidth), 名).toBe("0px");
      expect((await 色条(page.locator(".btodo-cards > .btodo-card.is-on"))).有, 名).toBe(false);
      const 线 = await 量变量(page, "--field-line", "border-top-color");
      const 页签线 = await page.locator(".data-shell-tabs > .ant-tabs-nav").evaluate(e => getComputedStyle(e, "::before").borderBottomColor);
      if (线 !== await 量变量(page, "--line", "border-top-color")) expect(页签线, 名).not.toBe(线);
      // 看板列头计数还是小胶囊（换皮主题、一张纸都没改）
      expect(await page.locator(".btodo-col-h > .btodo-col-n").first().evaluate(e => getComputedStyle(e).borderTopLeftRadius), 名).not.toBe("0px");
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});
