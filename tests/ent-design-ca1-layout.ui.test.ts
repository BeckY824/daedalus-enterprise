/**
 * 设计语言 C-A1（11-22）渠道看板 + 抽屉 · 排版门槛：50 个渠道、长渠道名、金额过亿，1024 / 1280 / 1366 / 390 不横向溢出、点得中。
 *
 *   页头：标题后写渠道个数；「按子渠道 / 按主渠道」在看板头（和时段一行，C-新1），新建渠道在最右（D31）
 *   KPI：数字 --fs-num 26；说明换行不截（D33）；成交额 / 投入窄格缩写「¥ 1.28 亿」、悬停看全值（D39）；「?」点击区 ≥28（D05）；
 *        「投入待录入」并进投入格，「去补录 ›」只给能录的（P-渠道-16）；390 KPI 照旧 2×3（不横滑）
 *   漏斗右侧写转化率「→ x%」（P-渠道-19/20/21），流失率进悬停；三层转化率卡留着、不用浅蓝底（P-渠道-18）
 *   低效渠道：普通卡 + 橙圆点，不整块黄底（P-渠道-22）；进公海：创建人下拉写「全部创建人」，数字列右对齐
 *   390：分布 / 三层 / TOP5 / 进公海 默认收成卡头一行，「展开」点得中；漏斗、低效渠道照开
 *   抽屉：三块卡头（编辑在基本信息卡头），标签无冒号、不折行，空值「—」，投入空态句、无插图
 *   换皮主题（账簿）：照旧
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ca1-layout", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/actions$/, `const f=async()=>({ok:true,id:'x'});
    export const saveChannel=f,toggleChannel=f,deleteChannel=f,saveMainChannel=f,toggleMainChannel=f,deleteMainChannel=f,addChannelInvest=f,deleteChannelInvest=f;
    export const listChannelInvests=async()=>({ok:true,能录:window.__能录!==false,rows:[]});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import ChannelsView from '@/app/(app)/channels/ChannelsView';
    const 长='某某超长跨境电商直播间合作渠道华东区旗舰店'.repeat(2);
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true}];
    const 统=(n)=>({关联线索:n,有效线索:n,已判定:n,关联商机:1,关联订单:0,关联项目:n,累计成交:[],当前投入:[],产出比:null,产出比说明:'还没录投入',累计运营天数:3,线索转商机:{分子:1,分母:n,比例:1/n},商机转订单:{分子:0,分母:0,比例:null}});
    const 行=(i)=>({id:'c'+i,name:'渠道'+i+长,phone:null,remark:null,active:true,attr:i%3?'公域引流':'私域转化'+长,platform:'渠道'+i+长,mainId:'m1',strategies:[],endDate:null,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',createdByName:'QA',channelOwnerId:'me',channelOwnerName:'小王',统计:统(40+i),客户数:0,投入数:i<3?1:0,项目数:0});
    const rows=Array.from({length:50},(_,i)=>行(i));
    const 格=(i)=>({线索:i<4?900-i*10:40+i,已判定:i<4?800:30,有效:i<4?20:20,商机:i<4?0:3,订单:i<4?0:1,成交:[{币种:'CNY',合计:i===5?12800000000:3000000+i}],投入:i<3?[{币种:'CNY',合计:5326000}]:[],起线索:i<4?900:40+i,起有效:20,起转商机:i<4?0:3});
    const 份=()=>Object.fromEntries(rows.map((r,i)=>[r.id,格(i)]));
    const 底数={本月:份(),本季:份(),全部:份()};
    const 公格=(n)=>({线索:100,进:n,方式:{超时回收:1,被退回:n-1,回收站:0,判无效:0,验证判无效:0,离职交接:0},退回因:{['客户说预算要再批一下'+长]:n-1},无效因:{},验证无效因:{}});
    const 公底=Object.fromEntries(rows.slice(0,6).map((r,i)=>[r.id,{me:公格(12-i)}]));
    const 公海={视角:'市场管理',创建人们:[{id:'me',name:'小王'}],底:{本月:公底,本季:公底,全部:公底}};
    const 壳=(x)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'me',name:'小王'}}>{x}</我Provider></BusinessProvider></App></ConfigProvider>);
    window.__画=(o)=>壳(<ChannelsView rows={rows} users={users} 属性选项={['公域引流']} 能管={o.能管!==false} 能录={o.能录!==false} 看板底数={底数} 公海={o.公海===false?null:公海} 两层 主渠道们={[{id:'m1',name:'主渠道'+长,active:true,allowSub:true,attr:null,ownerId:null,owner:null}]}/>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

/** 内容区按真实页面算：≥768 左边留 232 侧栏 + 24 页边距；390 没侧栏、16 边距 */
async function 打开(width: number, o: Record<string, unknown> = {}, skin?: string, 触屏 = false): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: 触屏 }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const 窄 = width < 768;
  const 壳 = 窄 ? "padding:0 16px" : "margin-left:232px;padding:0 24px";
  await page.route("http://ca1.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><div id='root' style='${壳}'></div>` }));
  await page.goto("http://ca1.test/channels");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  if (skin) await page.evaluate((k) => { document.documentElement.dataset.skin = k; }, skin);
  await page.evaluate((x) => { (window as unknown as { __能录: boolean }).__能录 = x; }, o.能录 !== false);
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (o: unknown) => void }).__画(x), o);
  await page.locator(".chan-dash").waitFor();
  return { page, errors };
}
const 不溢出 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function 点得中(page: Page, loc: import("playwright").Locator) {
  await loc.scrollIntoViewIfNeeded();
  const b = (await loc.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  return loc.evaluate((e, [x, y]) => { const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h)); }, [b.x + b.width / 2, b.y + b.height / 2] as const);
}

it.each([1024, 1280, 1366, 390])("%ipx：50 个长名渠道、成交过亿不横向溢出；页头计数、口径在看板头、KPI 26 号不截", async (w) => {
  const { page, errors } = await 打开(w);
  try {
    expect(await 不溢出(page)).toBe(true);
    expect(await page.locator(".page-head .page-count").innerText()).toBe("50");
    // 口径切换在看板头，不在标题旁
    expect(await page.locator(".page-head [aria-label='统计口径']").count()).toBe(0);
    expect(await page.locator(".chan-dash-bar [aria-label='统计口径']").count()).toBe(1);
    expect(await page.locator(".chan-dash-bar h2").innerText()).toBe("总览");
    // 新建渠道在页头动作最右
    const 动作 = await page.locator(".page-head-a .ant-btn").allInnerTexts();
    expect(动作[动作.length - 1]).toMatch(/新建渠道/);
    // KPI：数字 26、说明行不截（没有省略号、内容不超出格子）
    const kv = await page.locator(".chan-dash-kv").first().evaluate((e) => getComputedStyle(e).fontSize);
    expect(kv).toBe("26px");
    const 截 = await page.locator(".chan-dash-k").evaluateAll((ks) => ks.flatMap((k) => [...k.querySelectorAll(".chan-dash-ks, .chan-dash-kv")].filter((e) => getComputedStyle(e).textOverflow === "ellipsis" || e.scrollWidth > e.clientWidth + 1).map((e) => `${e.className}:${(e as HTMLElement).innerText}:${e.scrollWidth}/${e.clientWidth}`)));
    expect(截).toEqual([]);
    // 成交额缩写（过亿），悬停出全值（antd Tooltip，不只靠 title）
    const 成交 = page.locator(".chan-dash-k").filter({ hasText: "成交额" }).locator(".chan-dash-kv");
    expect(await 成交.innerText()).toMatch(/^¥ [\d.]+ 亿$/);
    await 成交.hover();
    expect(await page.getByRole("tooltip").filter({ hasText: /^¥ [\d,]+$/ }).first().innerText()).toMatch(/^¥ 12,9\d{2},\d{3},\d{3}$/);
    // 投入待录入并进投入格；能录才有「去补录 ›」；没有虚线条
    const 投入 = page.locator(".chan-dash-k").filter({ hasText: "投入 / ROI" });
    expect(await 投入.innerText()).toMatch(/47 个渠道没录/);
    expect(await 点得中(page, 投入.getByRole("button", { name: /去补录/ }))).toBe(true);
    expect(await page.locator(".chan-dash-empty").count()).toBe(0);
    // 「?」点击区 ≥28：中心往外 12px 还点得到它
    const q = page.locator(".chan-dash-q").first();
    const qb = (await q.boundingBox())!;
    expect(await q.evaluate((e, [x, y]) => document.elementFromPoint(x, y) === e, [qb.x + qb.width / 2 + 12, qb.y + qb.height / 2] as const)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("漏斗写转化率「→ x%」不写流失率；三层转化率卡留着、不用浅蓝底；低效渠道普通卡 + 橙圆点；进公海写「全部创建人」、数字右对齐", async () => {
  const { page, errors } = await 打开(1366);
  try {
    const 漏斗 = await page.locator(".chan-dash-fun-side").allInnerTexts();
    expect(漏斗).toHaveLength(3);
    for (const t of 漏斗) expect(t).toMatch(/^→ /);
    expect(漏斗.join("")).not.toMatch(/−/);
    const 三层 = page.locator(".chan-dash-cell").filter({ hasText: "三层转化率" });
    expect(await 三层.locator(".chan-dash-tier").count()).toBe(3);
    expect(await 三层.locator(".chan-dash-tier").first().evaluate((e) => getComputedStyle(e).backgroundColor)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    // 三格一行
    const 顶 = await 三层.locator(".chan-dash-tier").evaluateAll((es) => es.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(顶).size).toBe(1);
    const 预警 = page.locator(".chan-dash-cell").filter({ hasText: "低效渠道预警" });
    expect((await 预警.locator(".chan-dash-h").innerText()).replace(/\s+/g, "")).toMatch(/低效渠道预警（3）/);
    expect(await 预警.locator(".chan-dot.is-warn").count()).toBe(3);
    expect(await 预警.locator("li").first().evaluate((e) => getComputedStyle(e).backgroundColor)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    await 预警.locator("li button").first().click();
    await page.locator(".ant-drawer").waitFor();
    await page.keyboard.press("Escape");
    const 公海 = page.locator(".chan-dash-pool");
    expect(await 公海.locator(".ant-select-content, .ant-select-selection-item").first().innerText()).toBe("全部创建人");
    expect((await 公海.locator(".chan-dash-h").innerText()).replace(/\s+/g, "")).toMatch(/进公海.*（57）/);
    const 右 = await 公海.locator("li b").evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().right)));
    expect(new Set(右).size).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("390：KPI 照旧 2×3（不横滑）；分布 / 三层 / TOP5 / 进公海默认收成卡头一行，「展开」44 高点得中；漏斗、低效渠道照开", async () => {
  const { page, errors } = await 打开(390);
  try {
    const 列 = await page.locator(".chan-dash-k").evaluateAll((ks) => new Set(ks.map((k) => Math.round(k.getBoundingClientRect().left))).size);
    expect(列).toBe(2);
    expect(await page.locator(".chan-dash-kpi").evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(await page.locator(".chan-dash-fun").isVisible()).toBe(true);
    expect(await page.locator(".chan-dash-warn").isVisible()).toBe(true);
    for (const 名 of ["三层转化率", "线索 TOP5", "进公海"]) {
      const 卡 = page.locator(".chan-dash-cell").filter({ hasText: 名 }).first();
      expect(await 卡.getAttribute("class")).toContain("is-fold");
      const 钮 = 卡.locator(".chan-fold");
      expect((await 钮.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await 点得中(page, 钮)).toBe(true);
    }
    expect(await page.getByTestId("chan-dash-top").isVisible()).toBe(false);
    await page.locator(".chan-dash-cell").filter({ hasText: "线索 TOP5" }).locator(".chan-fold").click();
    expect(await page.getByTestId("chan-dash-top").isVisible()).toBe(true);
    expect(await 不溢出(page)).toBe(true);
    // 宽屏不收：没有「展开」钮
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  const 宽 = await 打开(1366);
  try {
    expect(await 宽.page.locator(".chan-fold").evaluateAll((bs) => bs.every((b) => getComputedStyle(b).display === "none"))).toBe(true);
    expect(await 宽.page.getByTestId("chan-dash-top").isVisible()).toBe(true);
  } finally { await 宽.page.close(); }
});

it("不能录投入（市场管理以外）：投入格写没录几个，没有「去补录 ›」", async () => {
  const { page } = await 打开(1366, { 能录: false, 能管: false, 公海: false });
  try {
    const 投入 = page.locator(".chan-dash-k").filter({ hasText: "投入 / ROI" });
    expect(await 投入.innerText()).toMatch(/个渠道没录/);
    expect(await 投入.getByRole("button", { name: /去补录/ }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /新建渠道/ }).count()).toBe(0);
  } finally { await page.close(); }
});

it.each([1366, 390])("抽屉 %ipx：基本信息卡头有「编辑」、标签无冒号不折行、空值「—」、投入空态句无插图、录一笔投入是 ghost", async (w) => {
  const { page, errors } = await 打开(w);
  try {
    await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor();
    await page.locator(".ant-table-tbody button.chan-name").first().click();
    const 抽 = page.locator(".ant-drawer").filter({ has: page.locator("section[aria-label='基本信息']") });
    await 抽.waitFor();
    await 抽.getByText("还没有投入记录").waitFor();
    expect(await 抽.locator(".ant-empty").count()).toBe(0);
    expect(await 抽.locator(".ant-drawer-extra").count()).toBe(0);
    const 基本 = 抽.locator("section[aria-label='基本信息']");
    // 抽屉滑进来要一会儿：等它停在屏内
    await expect.poll(async () => { const b = await 基本.boundingBox(); return b ? Math.round(b.x + b.width) : 99999; }).toBeLessThanOrEqual(w);
    expect(await 点得中(page, 基本.locator(".chan-block-h").getByRole("button", { name: /编辑/ }))).toBe(true);
    const 标签 = 抽.locator(".chan-desc .ant-descriptions-item-label");
    expect((await 标签.allInnerTexts()).some((t) => /[：:]$/.test(t.trim()))).toBe(false);
    const 折 = await 标签.evaluateAll((ls) => ls.some((l) => l.getBoundingClientRect().height > 30));
    expect(折).toBe(false);
    expect(await 抽.locator("section[aria-label='统计'] .chan-block-h").innerText()).toBe("统计 · 全部时间");
    // 投入产出比没录 → 「—」，原因进悬停
    const 比 = 抽.locator(".ant-descriptions-item").filter({ hasText: "投入产出比" }).locator(".ant-descriptions-item-content");
    expect((await 比.innerText()).trim()).toBe("—");
    const 录 = 抽.getByRole("button", { name: /录一笔投入/ });
    expect(await 录.getAttribute("class")).not.toContain("ant-btn-primary");
    expect(await 点得中(page, 录)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("换皮主题（账簿）：页头照旧挂口径切换，看板头没有「总览」，投入待录入还是虚线条", async () => {
  const { page, errors } = await 打开(1366, {}, "ledger");
  try {
    expect(await page.locator(".page-head [aria-label='统计口径']").count()).toBe(1);
    expect(await page.locator(".chan-dash-bar h2").count()).toBe(0);
    expect(await page.locator(".chan-dash-empty").count()).toBe(1);
    expect(await page.locator(".page-count").count()).toBe(0);
    // TOP5 条宽照原样（行内样式按比例，不按 5% 取整）
    const 第二条 = page.getByTestId("chan-dash-top").locator(".chan-dash-top-bar i").nth(1);
    expect(await 第二条.getAttribute("style")).toMatch(/width:\s*98\.8/);
    expect(await 第二条.getAttribute("class")).toBeNull();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("页头计数跟当前视图走：按子渠道写渠道个数，切「按主渠道」写主渠道个数；现状主题 TOP5 条宽按 5% 一档给类", async () => {
  const { page, errors } = await 打开(1366);
  try {
    expect(await page.locator(".page-count").innerText()).toBe("50");
    expect(await page.getByTestId("chan-dash-top").locator(".chan-dash-top-bar i").nth(1).getAttribute("class")).toBe("chan-w100");
    await page.locator(".chan-dash-bar [aria-label='统计口径']").getByText("按主渠道").click();
    await expect.poll(() => page.locator(".page-count").innerText()).toBe("1");
    expect(await page.locator(".page-count").getAttribute("aria-label")).toBe("共 1 个主渠道");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("390 触屏：点按 KPI 缩写金额出全值；抽屉里「投入产出比 —」点按出原因", async () => {
  const { page, errors } = await 打开(390, {}, undefined, true);
  try {
    const 成交 = page.locator(".chan-dash-k").filter({ hasText: "成交额" }).locator(".chan-dash-kv");
    await 成交.scrollIntoViewIfNeeded();
    await 成交.tap();
    await page.getByRole("tooltip").filter({ hasText: /^¥ 12,9\d{2},\d{3},\d{3}$/ }).first().waitFor();
    const 投入 = page.locator(".chan-dash-k").filter({ hasText: "投入 / ROI" }).locator(".chan-dash-kv");
    expect(await 投入.innerText()).toBe("¥ 1,598 万");
    await 投入.tap();
    await page.getByRole("tooltip").filter({ hasText: "¥ 15,978,000" }).first().waitFor();
    // 抽屉：没录投入的渠道，投入产出比「—」点按出原因
    await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor();
    await page.locator(".ant-table-tbody button.chan-name").nth(5).tap();
    const 抽 = page.locator(".ant-drawer").filter({ has: page.locator("section[aria-label='基本信息']") });
    await 抽.waitFor();
    const 横 = 抽.locator(".ant-descriptions-item").filter({ hasText: "投入产出比" }).locator(".chan-empty-tip");
    await expect.poll(async () => { const b = await 横.boundingBox(); return b ? Math.round(b.x) : 99999; }).toBeLessThan(390);
    await 横.tap();
    await page.getByRole("tooltip").filter({ hasText: "还没录投入" }).first().waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
