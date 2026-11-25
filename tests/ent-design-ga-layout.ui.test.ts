/**
 * 设计语言 G-A（11-22，公海；落地计划「G-A」，依据《现在-公海》G0–G8；原 E3 公海那几条并在这里）：
 *   G0 标题后总数（--count-fg）、「我手上 N / 上限 M」中性胶囊，到上限换橙底
 *   G1 两行固定结构：池子行（分段 + 最右「公海回收站」独立开关）/ 筛选行（搜索占位写全、「全部入池方式」墨色、排序、更多筛选 … 列）；
 *      1024 不折第三行；390 池子改下拉（D34）、筛选三排（D06）；1024 日期面板不出界（K2）
 *   G2 提示条浅蓝底 13 号；截断说明写数
 *   G3 属性列「全部」里灰标签、选了某一池整列不摆（D10）；项目名 = 客户名写灰字「同客户名」照旧点得进（G-新5）；
 *      跨年「2025 年 10 月 26 日」不截（D15）；1024 不摆「当前进程」、两列时间并一列、「入池原因」留着看得见（G-新4）
 *   G4「领取」是 .row-act 文字钮（D09）；确认条在行下整行宽、不被钉住的操作列盖（K4）；390「领取」44 高不成方块（D34）；
 *      「标成无效客户」前一道分隔线、不标红
 *   G5 客户池并成一行：名字前展开箭头、「N 个项目」灰字不用胶囊
 *   G6 批量条同客户列表（浮在底部、「已选 N 个」、「领取」唯一主色钮、390 让出 AI 球）
 *   G7 空态句 / 筛了没对上 / 只选了某一池；换池骨架 --skel-delay 后才出
 *   G8 选人框输入框白底 + --field-line；底下那句 13 号、行距 22
 *   D12 390 触屏点格子不冒悬停浮层；D40 滚到底末行「⋯」不在 AI 球底下
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, 包: string;
type 参 = { attr?: string; quick?: string; keyword?: string; 空?: boolean; 库里有?: boolean; 持有?: { 有: number; 上限: number } | null; 截断?: boolean; 只读?: boolean };

beforeAll(async () => {
  const plugin: Plugin = { name: "design-ga", setup(b) {
    const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
    const 成 = "async(...a)=>{await new Promise(r=>setTimeout(r,40));return {ok:true,updated:a[0].length,unchanged:0,原负责人:a[0].map(id=>({id,值:''})),项目:{领到:a[2]||[],没领到:[]},给谁:{id:'u1',name:'同事'}}}";
    stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){(window.__去=window.__去||[]).push(u)},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
    stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
    // 领取调用次数记在 window.__领（G4「取消不领」要断言一次都没调）
    stub(/customers\/pool-actions$/, `export const 领取=async(...a)=>{window.__领=(window.__领||0)+1;return (${成})(...a)},分配公海=${成},撤销公海=async()=>({ok:true,updated:1});`);
    stub(/\/projects\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "export const 领取项目=async()=>({ok:true,updated:0});"));
    stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
    stub(/^\.\/actions$/, "const f=async()=>({ok:true,updated:1,unchanged:0});export const 标无效客户=f,恢复有效客户=f,分配公海项目=async(a)=>({ok:true,分到:a,没分到:[],给谁:{id:'u1',name:'同事'}}),撤销公海项目=f;");
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
  } };
  包 = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import {themeConfig} from '@/lib/theme';
    import Pool from '@/app/(app)/pool/PoolView';import TruncTip from '@/components/TruncTip';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 时=new Date().toISOString();
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域销售服务中心';
    // c0 超长客户名、项目名同客户名；c1 项目行、跨年最后跟进；c2 没跟进过；k:k1 客户池并成一行（3 个项目）；其余凑满一屏
    const 行=[];
    for(let i=0;i<16;i++){const 名=i===0?长:'蓝湾科技'+i;const 项目=i%2===1;行.push({id:'c'+i,种:项目?'项目':'客户',customerId:'c'+i,projectId:项目?'p'+i:null,客户名:名,项目名:i===0||i===3?名:'二期扩产自动化产线改造项目'+i,进程:'线索-潜客培育',属性:['线索池','商机池','订单池','客户池'][i%4],最后跟进:i===1?'2025-10-26T03:00:00.000Z':i===2?null:时,入池时间:时,创建时间:时,类:'主动退回',累计:1,进程明细:null,入池原因:'客户那边预算冻结，明年再说',快捷:'首次退回',原负责人是我:false});}
    const 子=[3,2,1].map(i=>({id:'p:'+i,种:'项目',customerId:'k1',projectId:''+i,客户名:'客户池里的一位客户',项目名:'三期项目'+i,进程:'商机-方案敲定',属性:'客户池',最后跟进:null,入池时间:时,创建时间:时,类:'主动退回',累计:1,进程明细:null,入池原因:'客户主动终止合作',快捷:'首次退回',原负责人是我:i===1}));
    行.splice(4,0,{...子[0],id:'k:k1',projectId:null,进程明细:'x',子});
    const 快捷数={超时回收:31234,首次退回:12000,二次退回:300,三次退回:20,多次退回:9,无效客户:2949};
    let root;
    window.__render=(o={})=>{root=root||createRoot(document.getElementById('root'));root.render(<ConfigProvider theme={themeConfig}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><TruncTip/>
      <Pool 行={o.空?[]:行} 总数={o.空?0:67093} 当前页={1} pageSize={20} 快捷数={快捷数} 属性数={{全部:67093,线索池:54341,商机池:12719,订单池:33,客户池:0}} 截断={!!o.截断} 库里有={o.库里有??true}
        filters={{keyword:o.keyword??'',attr:o.attr??'',quick:o.quick??'',sort:''}} 渠道筛选项={[]} 能标无效={!o.只读} 能恢复={!o.只读} 能分配={!o.只读} 只读={!!o.只读}
        users={[{id:'u1',name:'李想',email:'a'},{id:'u2',name:'周宁',email:'b'}]} 持有={o.持有===undefined?{有:9,上限:10}:o.持有}/>
    </BusinessProvider></App></ConfigProvider>);};
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

/** 壳：.has-ai-fab 给正文底下留白，右下角一颗 AI 球（同 AppShell / AiFab 的类名）；电脑宽左边让出左栏 220 */
const 壳 = "<div class='has-ai-fab'><main class='main app-content'><div id='root'></div></main><button class='ai-fab' aria-label='AI 助手'><span class='ai-fab-core'></span></button></div>";
async function 开(w: number, o: 参 = {}): Promise<{ page: Page; errors: string[] }> {
  const 手 = w < 768;
  const page = await browser.newPage({ viewport: { width: w, height: 900 }, ...(手 ? { isMobile: true, hasTouch: true } : {}) });
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://design-ga.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{margin:0}</style>${壳}` }));
  await page.goto("http://design-ga.test/pool");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ content: 手 ? ".app-content{display:block}" : ".app-content{display:block;margin-left:220px;padding:22px 26px}" });
  await page.addScriptTag({ content: 包 });
  await page.evaluate((x) => (window as unknown as { __render: (x: object) => void }).__render(x), o);
  await page.locator(o.空 ? ".list" : "tr[data-row-key='c1']").first().waitFor();
  if (process.env.GA_SHOT) await page.screenshot({ path: `${process.env.GA_SHOT}/ga-${w}-${Object.entries(o).map(([k, v]) => `${k}${v}`).join("_") || "base"}.png` });
  return { page, errors };
}
const 页横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
/** 元素中心点下面是不是它自己（没被钉住列、AI 球、别的层盖住），在不在屏内 */
const 点得中 = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((el) => {
  const r = el.getBoundingClientRect(); const 中 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { 中: !!中 && el.contains(中), 在屏: r.left >= 0 && r.right <= document.documentElement.clientWidth + 1 };
}));
const 中线 = (page: Page, sels: string[]) => page.evaluate((qs) => qs.map((q) => { const r = document.querySelector(q)!.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }), sels);
const 色 = (page: Page, sel: string, prop = "color") => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const 变量色 = (page: Page, v: string) => page.evaluate((x) => { const d = document.createElement("i"); d.style.color = `var(${x})`; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }, v);

it("G0：标题后总数（千分位、--count-fg）；「我手上 N / 上限 M」中性胶囊，到上限换橙底", async () => {
  const { page, errors } = await 开(1366);
  try {
    expect(await page.locator(".pool-head-n").innerText()).toBe("67,093");
    expect(await 色(page, ".pool-head-n")).toBe(await 变量色(page, "--count-fg"));
    const 胶囊 = page.locator(".pool-hold");
    expect(await 胶囊.innerText()).toBe("我手上 9 / 上限 10");
    const 中底 = await 色(page, ".pool-hold", "background-color");
    await page.evaluate(() => (window as unknown as { __render: (x: object) => void }).__render({ 持有: { 有: 10, 上限: 10 } }));
    await expect.poll(() => 色(page, ".pool-hold", "background-color")).not.toBe(中底);
    expect(await 色(page, ".pool-hold", "background-color")).toBe(await page.evaluate(() => { const d = document.createElement("i"); d.style.backgroundColor = "var(--warning-bg)"; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; }));
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [1024, 1280, 1366]) {
  it(`G1：两行固定结构——池子行（分段 + 最右回收站开关，和「列」右齐）、筛选行一行到「列」，不折第三行；搜索占位写全、「全部入池方式」墨色；页面不横滚（${w} 宽）`, async () => {
    const { page, errors } = await 开(w);
    try {
      const [分段, 回收站, 搜, 入池方式, 列] = await 中线(page, [".pool-pools .ant-segmented", ".pool-bin", ".pool-fl .ant-input-affix-wrapper", ".pool-fl .ant-select", "button[aria-label='选择要显示的列']"]);
      expect(Math.abs(分段 - 回收站)).toBeLessThanOrEqual(2);
      expect([Math.abs(搜 - 入池方式), Math.abs(搜 - 列)].every((d) => d <= 2)).toBe(true);
      expect(搜 - 分段).toBeGreaterThan(20);
      // 回收站开关顶到池子行最右，和下面的「列」右齐；分段里只有五个池（回收站不并进分段、不叫池）
      const 右 = await page.evaluate(() => ["..pool-bin", "button[aria-label='选择要显示的列']"].map((q) => Math.round(document.querySelector(q.replace(/^\.\./, "."))!.getBoundingClientRect().right)));
      expect(Math.abs(右[0] - 右[1])).toBeLessThanOrEqual(1);
      expect(await page.locator(".pool-pools .ant-segmented-item").allInnerTexts()).toEqual(["全部 67,093", "线索池 54,341", "商机池 12,719", "订单池 33", "客户池 0"]);
      // 筛选行只一行高（不折）
      const 行高 = await page.locator(".pool-fl").evaluate((el) => el.getBoundingClientRect().height);
      expect(行高).toBeLessThanOrEqual(34);
      // 搜索占位「搜客户名 / 项目名」写全：量同字号的字宽，不比输入格宽
      const 占位 = await page.locator(".pool-fl .ant-input-affix-wrapper input").evaluate((el: HTMLInputElement) => {
        const s = getComputedStyle(el); const c = document.createElement("canvas").getContext("2d")!; c.font = `${s.fontSize} ${s.fontFamily}`;
        return { 字: el.placeholder, 要: c.measureText(el.placeholder).width, 有: el.clientWidth };
      });
      expect(占位.字).toBe("搜客户名 / 项目名");
      expect(占位.要).toBeLessThanOrEqual(占位.有);
      expect(await page.locator(".pool-fl .ant-select-placeholder").first().innerText()).toBe("全部入池方式");
      expect(await 色(page, ".pool-fl .ant-select-placeholder")).toBe(await 变量色(page, "--ink"));
      expect(await 页横滚(page)).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("G1：回收站开关 = 入池方式「无效客户」（地址栏 quick 改成「无效客户」）、按下态；选了某一池写清数是这一池里的", async () => {
  const { page, errors } = await 开(1366, { attr: "线索池" });
  try {
    const 钮 = page.getByRole("button", { name: /公海回收站/ });
    expect((await 钮.innerText()).replace(/\s+/g, " ").trim()).toBe("公海回收站（线索池 2,949）");
    expect(await 钮.getAttribute("aria-pressed")).toBe("false");
    await 钮.click();
    expect(await page.evaluate(() => (window as unknown as { __去: string[] }).__去.map((u) => new URL(u, location.href).searchParams.get("quick")))).toEqual(["无效客户"]);
    expect(await 钮.getAttribute("aria-pressed")).toBe("true");
    expect(await 色(page, ".pool-bin", "background-color")).toBe(await page.evaluate(() => { const d = document.createElement("i"); d.style.backgroundColor = "var(--brand-bg)"; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; }));
    // 和入池方式下拉联动（同一个值）
    expect(await page.locator(".pool-fl .ant-select").first().innerText()).toContain("公海回收站");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("G1 / D34 / D06：390 池子改下拉（不横滑），同一排回收站开关和「列」；筛选三排，表头在首屏上半；页面不横滚", async () => {
  const { page, errors } = await 开(390);
  try {
    expect(await page.locator(".pool-pools .ant-segmented").count()).toBe(0);
    const 下拉 = page.getByRole("combobox", { name: "公海属性" });
    await 下拉.waitFor();
    const [池, 回收站, 列] = await 中线(page, [".pool-pick-attr", ".pool-bin", "button[aria-label='选择要显示的列']"]);
    expect([Math.abs(池 - 回收站), Math.abs(池 - 列)].every((d) => d <= 2)).toBe(true);
    expect((await 点得中(page, ".pool-pick-attr, .pool-bin, button[aria-label='选择要显示的列']")).every((x) => x.中 && x.在屏)).toBe(true);
    // 筛选三排：池子 · 回收站 · 列 / 搜索 · 排序 / 入池方式 · 更多筛选（· 重置）
    const 排 = await page.evaluate(() => new Set([".pool-pick-attr", ".pool-fl .ant-input-affix-wrapper", ".pool-sort", ".pool-fl .ant-select:not(.pool-sort)", ".pool-fl .ant-btn:has(.anticon-filter)"].map((q) => Math.round(document.querySelector(q)!.getBoundingClientRect().top))).size);
    expect(排).toBe(3);
    expect(await page.locator(".ant-table-thead").evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(300);
    // 下拉里五个池都在、带数
    await 下拉.click();
    const 项 = await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").allInnerTexts();
    expect(项.map((x) => x.replace(/\s+/g, " ").trim())).toEqual(["全部 67,093", "线索池 54,341", "商机池 12,719", "订单池 33", "客户池 0"]);
    await page.locator(".ant-select-dropdown .ant-select-item-option").filter({ hasText: "订单池" }).click();
    expect(await page.evaluate(() => (window as unknown as { __去: string[] }).__去.map((u) => new URL(u, location.href).searchParams.get("attr")))).toEqual(["订单池"]);
    expect(await 页横滚(page)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// 375 × 线索池五位数（54,341）：375 下拉比 390 窄 15，原来数字右沿超出下拉内容框约 10px，显示成「线 53,83」（#414 3704 补点）
for (const [w, 池] of [[390, ""], [390, "订单池"], [390, "线索池"], [375, ""], [375, "线索池"]] as const) it(`G1 / D34：${w} 池子下拉选了「${池 || "全部"}」，后面的数显示全（挤的时候只截池名）`, async () => {
  const { page, errors } = await 开(w, { attr: 池 });
  try {
    const 数 = page.locator(".pool-pick-attr .ant-select-content .pool-n");
    const 量 = await 数.evaluate((el) => {
      const 框 = el.closest(".ant-select-content")!.getBoundingClientRect(), r = el.getBoundingClientRect();
      return { 字: el.textContent, 全: el.scrollWidth <= el.clientWidth && r.right <= 框.right + 0.5 && r.left >= 框.left - 0.5 && r.width > 0 };
    });
    expect(量).toEqual({ 字: { "": "67,093", 订单池: "33", 线索池: "54,341" }[池], 全: true });
    expect(await 页横滚(page)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("K2：1024 宽「更多筛选」里的创建时间面板整块在屏里", async () => {
  const { page, errors } = await 开(1024);
  try {
    await page.getByRole("button", { name: /更多筛选/ }).click();
    await page.getByPlaceholder("创建时间起").click();
    const 板 = page.locator(".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)");
    await 板.waitFor();
    await page.waitForTimeout(250);
    const 框 = await 板.evaluate((el) => { const r = el.getBoundingClientRect(); return { 左: r.left, 右: r.right }; });
    expect(框.左).toBeGreaterThanOrEqual(0);
    expect(框.右).toBeLessThanOrEqual(1024);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("G2：提示条浅蓝底 13 号；截断说明 13 号灰字、写明列了几条", async () => {
  const { page, errors } = await 开(1366, { 截断: true });
  try {
    const 截 = page.locator(".pool-cut");
    expect(await 截.innerText()).toContain("只列最近入池的 67,093 条");
    expect(await 色(page, ".pool-cut", "font-size")).toBe("13px");
    // 领两个：没领到的说明是提示条（这里全领到，不出）；用页面上的样式量提示条本身
    await page.evaluate(() => { const d = document.createElement("div"); d.className = "pool-note"; d.id = "量"; document.querySelector(".list")!.prepend(d); });
    expect(await 色(page, "#量", "font-size")).toBe("13px");
    expect(await 色(page, "#量", "background-color")).toBe(await page.evaluate(() => { const d = document.createElement("i"); d.style.backgroundColor = "var(--brand-bg)"; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; }));
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("G3：「全部」里属性是中性灰标签；选了某一池整列不摆；项目名 = 客户名写灰字「同客户名」、照旧点得进、悬停看全名", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 标 = page.locator("tr[data-row-key='c1'] .pool-attr");
    expect(await 标.innerText()).toBe("商机池");
    expect(await 标.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await page.evaluate(() => { const d = document.createElement("i"); d.style.backgroundColor = "var(--tag-bg)"; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; }));
    // 项目行（c3）项目名同客户名：灰字、链接还在、悬停是全名
    const 同 = page.locator("tr[data-row-key='c3'] td.dl-col-项目 .pool-same");
    expect(await 同.innerText()).toBe("同客户名");
    expect(await 同.getAttribute("title")).toBe("蓝湾科技3");
    expect(await 同.getAttribute("href")).toBe("/projects/p3");
    expect(await 同.evaluate((el) => getComputedStyle(el).color)).toBe(await 变量色(page, "--text-muted"));
    // 客户行（c0）同名：灰字，不是链接
    expect(await page.locator("tr[data-row-key='c0'] td.dl-col-项目").innerText()).toBe("同客户名");
    expect(await page.locator("thead th").filter({ hasText: "公海属性" }).count()).toBe(1);
    await page.evaluate(() => (window as unknown as { __render: (x: object) => void }).__render({ attr: "线索池" }));
    await expect.poll(() => page.locator("thead th").filter({ hasText: "公海属性" }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("G3 / D15：1366 跨年最后跟进写全「2025 年 10 月 26 日」不截；日期右对齐", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 格 = page.locator("tr[data-row-key='c1'] td.dl-col-跟进");
    expect(await 格.innerText()).toBe("2025 年 10 月 26 日");
    expect(await 格.evaluate((el) => ({ 截: el.scrollWidth > el.clientWidth + 1, 齐: getComputedStyle(el).textAlign }))).toEqual({ 截: false, 齐: "right" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("G3 / G-新4：1024 不摆「当前进程」，两列时间并成一列两行（跨年也不截），「入池原因」整列在表里看得见、不被钉住的操作列盖", async () => {
  const { page, errors } = await 开(1024);
  try {
    const 头 = await page.locator("thead th").allInnerTexts();
    expect(头.map((x) => x.trim()).filter(Boolean)).toEqual(["客户名称", "公海属性", "项目名称", "入池 / 跟进", "入池原因", "操作"]);
    const 两行 = page.locator("tr[data-row-key='c1'] td.dl-col-时间");
    expect((await 两行.innerText()).split("\n").map((x) => x.trim())).toEqual([expect.stringMatching(/今天/), "2025 年 10 月 26 日"]);
    expect(await 两行.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    // 不用横滚：表格不比框宽；入池原因那一格中点下面就是它自己
    expect(await page.locator(".ant-table-content, .ant-table-body").first().evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect((await 点得中(page, "tr[data-row-key='c1'] td.dl-col-原因")).every((x) => x.中 && x.在屏)).toBe(true);
    expect(await 页横滚(page)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// 29K（11-26）：375 / 768 / 1280 一起钉（r7 实操 375 / 390 后果字被钉住的操作列盖）；后果每一行都在条里、露得出来
for (const w of [1024, 1366, 390, 375, 768, 1280]) {
  it(`G4 / K4：「领取」是文字钮；点了确认条在这一行下面整行宽，后果写全、两颗键点得中（不被钉住的操作列盖）；取消不领、确认才领（${w} 宽）`, async () => {
    const { page, errors } = await 开(w);
    try {
      const 钮 = page.locator("tr[data-row-key='c0']").getByRole("button", { name: /^领取/ });
      expect(await 钮.evaluate((el) => { const s = getComputedStyle(el); return { 框: s.borderTopColor, 底: s.backgroundColor }; })).toEqual({ 框: "rgba(0, 0, 0, 0)", 底: "rgba(0, 0, 0, 0)" });
      expect(await 钮.evaluate((el) => getComputedStyle(el).color)).toBe(await 变量色(page, "--brand"));
      await 钮.click();
      const 条 = page.getByRole("group", { name: /^确认领取 某某超长/ });
      await 条.waitFor();
      expect(await 钮.getAttribute("aria-expanded")).toBe("true");
      // 就在这一行下面的那一行（表格展开行），不在客户名那一格里
      expect(await 条.evaluate((el) => el.closest("tr")!.previousElementSibling?.getAttribute("data-row-key"))).toBe("c0");
      expect(await page.locator("tr[data-row-key='c0'] .pool-why").count()).toBe(0);
      const 后 = await 条.locator(".pool-why").innerText();
      expect(后).toContain("超时没跟进会收回公海");
      expect(后).toContain("以后退回公海就不能再领回");
      // 整行宽：比任何一格都宽，不超出表框
      const 宽 = await 条.evaluate((el) => { const t = el.closest(".ant-table-container")!.getBoundingClientRect(); const r = el.getBoundingClientRect(); return { 条: r.width, 表: t.width, 右: r.right <= t.right + 1 }; });
      expect(宽.条).toBeGreaterThan(宽.表 * 0.8);
      expect(宽.右).toBe(true);
      expect((await 点得中(page, ".pool-ask .inlc-yes, .pool-ask .inlc-no")).every((x) => x.中 && x.在屏)).toBe(true);
      // 每一行后果字的右端（字最容易被钉住的操作列盖的那头）露得出来、在屏里
      const 后果行 = await 条.locator(".pool-why > div").evaluateAll((es) => es.map((e) => {
        const g = document.createRange(); g.selectNodeContents(e); const r = g.getBoundingClientRect();
        const 中 = document.elementFromPoint(r.right - 2, r.top + r.height / 2);
        return { 盖: !(中 && e.contains(中)), 出屏: r.left < 0 || r.right > document.documentElement.clientWidth + 1 };
      }));
      expect(后果行.length).toBeGreaterThan(1);
      expect(后果行.filter((x) => x.盖 || x.出屏), `${w} 宽后果字被盖 / 出屏`).toEqual([]);
      expect(await 条.locator(".pool-why > div").evaluateAll((es) => es.filter((e) => e.scrollWidth > e.clientWidth + 1).length), `${w} 宽后果字被裁`).toBe(0);
      await 条.getByRole("button", { name: "取消" }).click();
      await expect.poll(() => page.locator(".pool-ask").count()).toBe(0);
      // 取消不领：领取一次都没调
      expect(await page.evaluate(() => (window as unknown as { __领?: number }).__领 ?? 0)).toBe(0);
      await 钮.click();
      await page.getByRole("group", { name: /^确认领取 某某超长/ }).getByRole("button", { name: "确认领取" }).click();
      await page.locator("tr[data-row-key='c0']").getByText("已领取 ✓").waitFor();
      expect(await page.evaluate(() => (window as unknown as { __领?: number }).__领 ?? 0)).toBe(1);
      expect(await 页横滚(page)).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("G4 / K4：键盘打开领取确认条——焦点到「取消」、8 秒不自己收、Esc 收回且焦点回「领取」（同旧摆法）", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 钮 = page.locator("tr[data-row-key='c0']").getByRole("button", { name: /^领取/ });
    await 钮.focus();
    await page.keyboard.press("Enter");
    const 条 = page.getByRole("group", { name: /^确认领取 某某超长/ });
    await 条.waitFor();
    await expect.poll(() => page.evaluate(() => document.activeElement?.matches(".pool-ask .inlc-no") ?? false)).toBe(true);
    // 焦点在条里：8 秒计时停住
    await page.waitForTimeout(8500);
    expect(await 条.count()).toBe(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".pool-ask").count()).toBe(0);
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.claim ?? "")).toBe("c0");
    expect(await page.evaluate(() => (window as unknown as { __领?: number }).__领 ?? 0)).toBe(0);
    // 鼠标点开的不挪焦点（焦点停在条里会让它一直不收）。紧接着点：Esc 收回后焦点回到「领取」还带着 :focus-visible，
    // 这时鼠标点它也不能当成键盘打开（#414 3704 实操）
    expect(await page.evaluate(() => document.activeElement?.matches(":focus-visible") ?? false)).toBe(true);
    await 钮.click();
    await 条.waitFor();
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.activeElement?.closest(".pool-ask") ? "条里" : "外面")).toBe("外面");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30_000);

for (const w of [1024, 1366]) {
  it(`列宽留够余量（${w} 宽）：内容区减掉 Windows 纵向滚动条 17px、再减到 24px，表格都不横滚`, async () => {
    const { page, errors } = await 开(w);
    try {
      const 框 = page.locator(".ant-table-content").first();
      for (const 让 of [17, 24]) {
        await page.addStyleTag({ content: `.app-content{padding-right:${26 + 让}px}` });
        await expect.poll(() => 框.evaluate((el) => el.scrollWidth <= el.clientWidth), { message: `内容区减 ${让}px 横滚了（差 1px 也算：Windows 上就是这 1px）` }).toBe(true);
      }
      expect(await 页横滚(page)).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

for (const w of [375, 390]) it(`G4 / D34：${w} 触屏「领取」44 高、宽随字（不是 44 × 44 方块），「⋯」也 44；不撑出操作格`, async () => {
  const { page, errors } = await 开(w);
  try {
    const 框 = await page.locator("tr[data-row-key='c1']").getByRole("button", { name: /^领取/ }).evaluate((el) => { const r = el.getBoundingClientRect(); return { 高: Math.round(r.height), 宽: Math.round(r.width) }; });
    expect(框.高).toBeGreaterThanOrEqual(44);
    expect(框.宽).toBeGreaterThan(框.高 + 4);
    const 更 = await page.locator("tr[data-row-key='c1']").getByRole("button", { name: /^更多操作/ }).evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(更).toBeGreaterThanOrEqual(44);
    expect((await 点得中(page, "tr[data-row-key='c1'] td.dl-col-操作 button")).every((x) => x.中 && x.在屏)).toBe(true);
    // 排版闸门「撑出」（PR #414 CI，375 / 390）：「领取 · ⋯」那一组不伸出 .pool-op、也不伸出操作格的内容区
    const 伸出 = await page.locator("td.dl-col-操作 .pool-act").evaluateAll((els) => els.flatMap((el) => {
      const op = el.closest(".pool-op")!, td = el.closest("td")!;
      const s = getComputedStyle(td);
      const 格右 = td.getBoundingClientRect().right - parseFloat(s.paddingRight), 组右 = op.getBoundingClientRect().right;
      const 右 = el.getBoundingClientRect().right;
      const 多 = Math.max(右 - 组右, 右 - 格右);
      return 多 > 0.5 ? [`${el.closest("tr")!.getAttribute("data-row-key")} 伸出 ${Math.round(多)}px`] : [];
    }));
    expect(伸出).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("G4：⋯ 菜单「标成无效客户」前一道分隔线、不标红（能恢复，不是删除）；点了照旧走后果框", async () => {
  const { page, errors } = await 开(1366);
  try {
    await page.locator("tr[data-row-key='c0']").getByRole("button", { name: /^更多操作/ }).click();
    const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
    await 菜单.waitFor();
    const 项 = await 菜单.locator(":scope > li").evaluateAll((xs) => xs.map((x) => x.classList.contains("ant-dropdown-menu-item-divider") ? "—" : `${(x.textContent ?? "").trim()}${x.classList.contains("ant-dropdown-menu-item-danger") ? "!" : ""}`));
    expect(项).toEqual(["分配给同事", "—", "标成无效客户"]);
    const [甲, 乙] = await Promise.all(["分配给同事", "标成无效客户"].map((t) => 菜单.getByText(t, { exact: true }).evaluate((el) => getComputedStyle(el.closest("li")!).color)));
    expect(乙).toBe(甲);
    await 菜单.getByText("标成无效客户", { exact: true }).click();
    await page.getByRole("dialog").filter({ hasText: "标成无效客户" }).waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("G5：客户池并成一行——名字前展开箭头（点开转 90°）、「3 个项目」13 号灰字不是胶囊；子列表左缩、浅底", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 行 = page.locator("tr[data-row-key='k:k1']");
    const 箭 = 行.locator(".pool-fold");
    expect(await 箭.count()).toBe(1);
    const 数 = 行.locator(".pool-many-n");
    expect(await 数.innerText()).toBe("3 个项目");
    expect(await 数.evaluate((el) => ({ 标: el.classList.contains("ant-tag"), 字: getComputedStyle(el).fontSize }))).toEqual({ 标: false, 字: "13px" });
    const 转 = () => 箭.locator("svg").evaluate((el) => getComputedStyle(el).transform);
    const 前 = await 转();
    await 行.getByRole("button", { name: /展开/ }).click();
    await page.locator(".pool-sub-row").first().waitFor();
    await expect.poll(转).not.toBe(前);
    expect(await page.locator(".pool-sub").evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("24px");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [1366, 390]) {
  it(`G6：批量条同客户列表——浮在底部、写「已选 N 个」（不说「位」）、「领取」是唯一主色钮；每颗点得中，手机宽让出 AI 球（${w} 宽）`, async () => {
    const { page, errors } = await 开(w);
    try {
      await page.locator("tr[data-row-key='c0'] .ant-checkbox-input").check();
      await page.locator("tr[data-row-key='c1'] .ant-checkbox-input").check();
      const 条 = page.locator(".list-sel.list-sel-float");
      await 条.waitFor();
      const 字 = await 条.innerText();
      expect(字).toContain("已选 2 个");
      expect(字).not.toContain("位已选");
      expect(await 条.locator(".ant-btn-primary").allInnerTexts()).toEqual([expect.stringMatching(/^领\s*取$/)]);
      expect((await 点得中(page, ".list-sel-float button, .list-sel-float .ant-checkbox-input")).every((x) => x.中 && x.在屏)).toBe(true);
      if (w < 768) {
        const 右 = await 条.evaluate((el) => el.getBoundingClientRect().right);
        expect(右).toBeLessThanOrEqual(390 - 72 + 1);
      }
      // 原地确认照旧（P-界面-41）
      await 条.getByRole("button", { name: /^领\s*取$/ }).click();
      expect(await 条.getByRole("group", { name: "确认批量领取" }).innerText()).toContain("已选 2 个");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("G7：空库「公海里还没有客户和项目」；搜了没对上「没有对得上「词」的客户或项目」；只选了某一池「X 里还没有」", async () => {
  let { page, errors } = await 开(1366, { 空: true, 库里有: false });
  try {
    expect(await page.locator(".list").innerText()).toContain("公海里还没有客户和项目");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  ({ page, errors } = await 开(1366, { 空: true, keyword: "某某" }));
  try {
    expect(await page.locator(".list-none").innerText()).toBe("没有对得上「某某」的客户或项目，换个条件或点「重置」看全部");
  } finally { await page.close(); }
  ({ page, errors } = await 开(1366, { 空: true, attr: "客户池" }));
  try {
    expect(await page.locator(".list-none").innerText()).toBe("客户池里还没有");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("G7 / D07：换池骨架等 --skel-delay（180ms）后才出", async () => {
  const { page, errors } = await 开(1366);
  try {
    await page.evaluate(() => { const d = document.createElement("div"); d.className = "pool-skel"; d.id = "骨"; document.body.appendChild(d); });
    expect(await page.locator("#骨").evaluate((el) => getComputedStyle(el).animationDelay)).toBe("0.18s");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("G8 / D17：分配选人框的输入框白底 + --field-line 框；底下那句 13 号、行距 22", async () => {
  const { page, errors } = await 开(1366);
  try {
    await page.locator("tr[data-row-key='c0']").getByRole("button", { name: /^更多操作/ }).click();
    await page.getByRole("menuitem", { name: "分配给同事" }).click();
    const 搜 = page.getByLabel("搜同事名字");
    await 搜.waitFor();
    await page.mouse.move(1, 1);
    await 搜.blur();
    // 失焦后框色有一段过渡（主色 → --field-line），等它放完再量
    const 线色 = await page.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--field-line)"; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; });
    await expect.poll(() => 搜.evaluate((el) => getComputedStyle(el.closest(".ant-input-affix-wrapper")!).borderTopColor)).toBe(线色);
    expect(await 搜.evaluate((el) => getComputedStyle(el.closest(".ant-input-affix-wrapper")!).backgroundColor)).toBe("rgb(255, 255, 255)");
    expect(await page.locator(".pool-pick-eff").evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).lineHeight])).toEqual(["13px", "22px"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D12：390 触屏点表头、属性格、截了的客户名，不冒悬停浮层盖住表格", async () => {
  const { page, errors } = await 开(390);
  try {
    for (const q of ["thead th.dl-col-属性", "tr[data-row-key='c0'] .pool-attr", "tr[data-row-key='c0'] td.dl-col-客户 a"]) {
      const r = await page.locator(q).first().evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.left + Math.min(20, b.width / 2), y: b.top + b.height / 2 }; });
      // 点名字会进详情：拦下跳转，只看浮层
      await page.evaluate(() => document.addEventListener("click", (e) => e.preventDefault(), { capture: true, once: true }));
      await page.touchscreen.tap(r.x, r.y);
      await page.waitForTimeout(300);
      expect(await page.locator(".trunc-tip.is-on, .ant-tooltip:not(.ant-tooltip-hidden)").count(), q).toBe(0);
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D40：滚到底，末行的「⋯」不在右下 AI 球底下（点得中）", async () => {
  const { page, errors } = await 开(1366);
  try {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const 末 = page.getByRole("button", { name: /^更多操作 / }).last();
    const 下 = await 末.evaluate((el) => el.getBoundingClientRect().bottom);
    const 球上 = await page.locator(".ai-fab").evaluate((el) => el.getBoundingClientRect().top - 6);
    expect(下).toBeLessThanOrEqual(球上);
    const [x] = await 末.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }));
    expect(x).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("只读（市场管理、只读管理员）：没有操作列、没有勾选；池子行、筛选行照样两行", async () => {
  const { page, errors } = await 开(1366, { 只读: true });
  try {
    expect(await page.locator("thead th").filter({ hasText: "操作" }).count()).toBe(0);
    expect(await page.locator("tr[data-row-key='c1'] .ant-checkbox-input").count()).toBe(0);
    expect(await page.locator(".pool-pools .ant-segmented").count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

