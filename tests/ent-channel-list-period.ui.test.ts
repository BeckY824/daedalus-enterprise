/**
 * 渠道列表统计跟看板时间段（员工反馈第 2 批 2D）的界面：
 * - 默认「全部」，列表、看板同一档；看板上切「本月」，列表的数、抽屉的数跟着换，表格上方那行写明「列表统计：本月 · YYYY-MM-DD 起」；
 * - 数字点进项目列表带同一段创建时间（createdFrom），切回全部不带；
 * - 本月没数的格显示「—」；
 * - Windows 1024 / 1280 / 1366 宽（主栏 = 视口扣掉左栏 220 和页边距），超长渠道名：页面不横滚、说明那行不撑宽、档位点得中。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const 长名 = "某某超长跨境电商直播间合作渠道（华东区）".repeat(4);
const plugin: Plugin = { name: "chan-period-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  // 抽屉换成一块牌子：只看它拿到的是哪一档的数、标题写哪一段
  stub(/^\.\/ChannelDrawer$/, "export default function D(p){return <div data-testid='drawer-stub'>{(p.时段名??'全部')+'|'+String(p.row.统计?.关联线索??'空')}</div>}");
  stub(/^(\.\/|\.\.\/)actions$/, `const f=${空跑};export const saveChannel=f,toggleChannel=f,deleteChannel=f,saveMainChannel=f,toggleMainChannel=f,deleteMainChannel=f;`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import ChannelsView from '@/app/(app)/channels/ChannelsView';
    const 长名=${JSON.stringify(长名)};
    const users=[{id:'me',name:'小王',email:'s1',role:'ADMIN',active:true},{id:'u2',name:'小李',email:'s2',role:'SALES',active:true}];
    const 统=(n,成)=>({关联线索:n,有效线索:n,关联商机:n?1:0,关联订单:0,关联项目:n,累计成交:成?[{币种:'CNY',合计:成}]:[],当前投入:[],产出比:null,产出比说明:'还没录投入',累计运营天数:30,线索转商机:{分子:n?1:0,分母:n,比例:n?1/n:null},商机转订单:{分子:0,分母:0,比例:null},
      名单:{关联线索:{列表:n,公海:0},有效线索:{列表:n,公海:0},关联商机:{列表:n?1:0,公海:0},关联订单:{列表:0,公海:0},关联项目:{列表:n,公海:0}}});
    const 行=(id,name,全,月)=>({id,name,phone:null,remark:null,active:true,attr:'公域引流',platform:name,mainId:'m1',strategies:[],endDate:null,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',createdByName:'QA',channelOwnerId:'me',channelOwnerName:'小王',
      统计:统(全,全*100),期统计:{本月:统(月,0),本季:统(全,全*100)}});
    const rows=[行('a',长名+'|账号一',41,7),行('b',长名+'|账号二',23,0),行('c','短名',5,2)];
    const 空期={线索:0,已判定:0,有效:0,商机:0,订单:0,成交:[],投入:[],起线索:0,起有效:0,起转商机:0};
    const 份=(k)=>Object.fromEntries(rows.map((r)=>[r.id,{...空期,线索:r[k]}]));
    const 底数={本月:Object.fromEntries(rows.map((r)=>[r.id,{...空期,线索:r.期统计.本月.关联项目}])),本季:Object.fromEntries(rows.map((r)=>[r.id,{...空期,线索:r.统计.关联项目}])),全部:Object.fromEntries(rows.map((r)=>[r.id,{...空期,线索:r.统计.关联项目}]))};
    // 地址栏带着自定义、那一段的数还没到（期统计里没有 自定义）：表格出骨架
    const 段=location.hash==='#custom'?{from:'2026-10-01',to:'2026-10-31'}:null;
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'me',name:'小王'}}>
      <ChannelsView rows={rows} users={users} 属性选项={['公域引流']} 能管 能录 看板底数={段?{...底数,自定义:底数.本月}:底数} 看板段={段} 主渠道们={[{id:'m1',name:长名,allowSub:true,selfDev:false,category:'三方平台',active:true,sort:1}]} 两层/>
    </我Provider></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number, hash = "") {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const 主栏 = width - 220 - 48;
  await page.route("http://period.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><div id='root' style='width:${主栏}px;padding:0 24px;margin-left:220px'></div>` }));
  await page.goto("http://period.test/" + hash); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.locator(".ant-table-tbody tr").first().waitFor();
  return { page, errors, 右界: 220 + 24 + 主栏 };
}
/** 「线索」那一列每行的字（列表按创建时间倒序，顺序同 rows） */
const 线索列 = async (page: Page) => {
  const 表头 = await page.locator(".chan-list .ant-table-thead th").allInnerTexts();
  const i = 表头.findIndex((t) => t.trim() === "线索");
  return page.locator(".chan-list .ant-table-tbody tr.ant-table-row").evaluateAll((trs, i) => trs.map((tr) => (tr.children[i] as HTMLElement).innerText.trim()), i);
};
const 说明 = (page: Page) => page.getByTestId("chan-period-note");
const 档 = (page: Page, 名: string) => page.locator("[aria-label='统计周期']").getByText(名, { exact: true });

for (const width of [1024, 1280, 1366]) {
  it(`看板切本月：列表、抽屉跟着换，点数字带创建时间；切回全部复原；不横滚、说明不撑宽（${width} 宽）`, async () => {
    const { page, errors, 右界 } = await open(width);
    try {
      // 默认全部，和看板一致
      expect(await 说明(page).locator(".chan-period-label").innerText()).toBe("列表统计：全部");
      expect(await 线索列(page)).toEqual(["41", "23", "5"]);
      const 首链 = page.locator(".chan-list .ant-table-tbody a.chan-num").first();
      expect(await 首链.getAttribute("href")).not.toContain("createdFrom");

      await 档(page, "本月").click();
      await expect.poll(() => 线索列(page)).toEqual(["7", "—", "2"]);
      expect(await 说明(page).locator(".chan-period-label").innerText()).toMatch(/^列表统计：本月 · \d{4}-\d{2}-01 起$/);
      expect(await 首链.getAttribute("href")).toMatch(/[?&]createdFrom=\d{4}-\d{2}-01(&|$)/);
      // 商机按到达时间数（同看板），点开不带创建时间段；说明行写明
      const 商机链 = page.locator(".chan-list .ant-table-tbody tr.ant-table-row").first().locator("a.chan-num").nth(1);
      expect(await 商机链.getAttribute("href")).toMatch(/phase=%E5%95%86%E6%9C%BA/);
      expect(await 商机链.getAttribute("href")).not.toContain("createdFrom");
      expect(await 说明(page).locator(".chan-period-hint").innerText()).toContain("商机、订单、成交按到达该阶段的时间算");
      // 累计成交本月没有 → 「—」
      const 表头 = await page.locator(".chan-list .ant-table-thead th").allInnerTexts();
      const 成交列 = 表头.findIndex((t) => t.trim() === "累计成交");
      const 成交 = await page.locator(".chan-list .ant-table-tbody tr.ant-table-row").evaluateAll((trs, i) => trs.map((tr) => (tr.children[i] as HTMLElement).innerText.trim()), 成交列);
      expect(成交).toEqual(["—", "—", "—"]);

      // 抽屉拿的是这一档的数、标题写明哪一段
      await page.locator(".chan-list .ant-table-tbody .chan-name").first().click();
      expect(await page.getByTestId("drawer-stub").innerText()).toMatch(/^本月 · \d{4}-\d{2}-01 起\|7$/);

      // 量排版：页面不横滚；说明那行在主栏里、自己不横向溢出；档位点得中
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const 量 = await 说明(page).evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, right: el.getBoundingClientRect().right }));
      expect(量.sw).toBeLessThanOrEqual(量.cw + 1);
      expect(量.right).toBeLessThanOrEqual(右界 + 1);
      const 全部钮 = 档(page, "全部");
      await 全部钮.scrollIntoViewIfNeeded();
      const bb = (await 全部钮.boundingBox())!;
      expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[aria-label='统计周期']") != null, [bb.x + bb.width / 2, bb.y + bb.height / 2])).toBe(true);

      await 全部钮.click();
      await expect.poll(() => 线索列(page)).toEqual(["41", "23", "5"]);
      expect(await 说明(page).locator(".chan-period-label").innerText()).toBe("列表统计：全部");
      expect(await 首链.getAttribute("href")).not.toContain("createdFrom");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("按主渠道合计也跟档：本月合成一行 = 7 + 0 + 2", async () => {
  const { page, errors } = await open(1280);
  try {
    await 档(page, "本月").click();
    await page.locator("[aria-label='统计口径']").getByText("按主渠道").click();
    await expect.poll(() => page.locator(".chan-list .ant-table-thead th").allInnerTexts()).toContain("子渠道数");
    await expect.poll(() => 线索列(page)).toEqual(["9"]);
    expect(await 说明(page).locator(".chan-period-label").innerText()).toMatch(/^列表统计：本月/);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("自定义那一段的数还没到：表格出骨架、不拿「—」冒充，和看板一样", async () => {
  const { page, errors } = await open(1280, "#custom");
  try {
    expect(await 说明(page).locator(".chan-period-label").innerText()).toBe("列表统计：自定义 · 2026-10-01 至 2026-10-31");
    expect(await page.locator(".chan-list .list-skel-on").count()).toBe(1);
    expect(await page.locator(".chan-list [aria-busy=true]").count()).toBeGreaterThan(0);
    // 切回预设，骨架收起、数回来
    await 档(page, "全部").click();
    await expect.poll(() => page.locator(".chan-list .list-skel-on").count()).toBe(0);
    await expect.poll(() => 线索列(page)).toEqual(["41", "23", "5"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
