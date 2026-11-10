/**
 * 渠道页：只有主渠道（一个子渠道都没有）的主渠道也看得到、筛得到、改得了（11-10，P-渠道-10 / P-渠道-11，迁移 118）。
 *
 *   切「按主渠道」：一个子渠道都没有的主渠道也各出一行（子渠道数 0），带负责人、渠道属性两列；没填写「—」
 *   筛「负责人」：只有主渠道的按主渠道自己的负责人筛得出来
 *   行尾「编辑」（能管渠道的人才有）打开主渠道编辑弹窗；只有主渠道的那几行点名字也是编辑（底下没子渠道可看）
 *   超长主渠道名、超长人名一行省略，标签、按钮点得中，页面不横滚
 *   新建渠道：选了主渠道，属性、负责人先带主渠道的；自己动过的不被盖
 *
 * 1024 / 1280 / 1366 三个宽度都量（scrollWidth 看横滚）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const 长主 = "某某超长跨境电商直播间合作主渠道（华东区）".repeat(3);
const 长人 = "名字特别特别长的一位同事".repeat(3);
const plugin: Plugin = { name: "main-only-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/ChannelDrawer$/, "export default function D(){return null}");
  stub(/^\.\/actions$/, `const 记=(名)=>async x=>{(window.__存=window.__存||[]).push([名,x]);return{ok:true,id:'x'}};
    export const saveChannel=记('saveChannel'),toggleChannel=记('toggleChannel'),deleteChannel=记('deleteChannel'),saveMainChannel=记('saveMainChannel'),toggleMainChannel=记('toggleMainChannel');`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import ChannelsView from '@/app/(app)/channels/ChannelsView';import TruncTip from '@/components/TruncTip';
    const root=createRoot(document.getElementById('root'));
    const 长主=${JSON.stringify(长主)},长人=${JSON.stringify(长人)};
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true},{id:'u1',name:'运营甲',email:'a',role:'SALES',active:true},{id:'u2',name:长人,email:'b',role:'SALES',active:true}];
    const 壳=(x)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'me',name:'小王'}}><TruncTip/>{x}</我Provider></BusinessProvider></App></ConfigProvider>);
    const 统=(n)=>({关联线索:n,有效线索:n,关联商机:1,关联订单:0,关联项目:n,累计成交:[],当前投入:[],产出比:null,产出比说明:'还没录投入',累计运营天数:3,线索转商机:{分子:1,分母:n,比例:1/n},商机转订单:{分子:0,分母:0,比例:null}});
    const 行=(id,name,platform,mainId,ownerId,ownerName,attr,n)=>({id,name,phone:null,remark:null,active:true,attr,platform,mainId,strategies:[],endDate:null,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',createdByName:'QA',channelOwnerId:ownerId,channelOwnerName:ownerName,统计:统(n)});
    const 主=(id,name,x)=>({id,name,allowSub:true,selfDev:false,category:null,active:true,sort:0,ownerId:null,ownerName:null,attr:null,...x});
    const 主们=[
      主('m1','抖音',{ownerId:'me',ownerName:'小王',attr:'公域引流'}),
      主('m2','百度',{ownerId:'u1',ownerName:'运营甲',attr:'主动自拓'}),
      主('m3',长主,{ownerId:'u2',ownerName:长人,attr:'公域引流'}),
      主('m4','没人管的主渠道',{}),
      主('m5','停了的空主渠道',{active:false,ownerId:'u1',ownerName:'运营甲',attr:'主动自拓'}),
    ];
    const rows=[行('a','抖音|官方号','抖音','m1','me','小王','公域引流',2),行('b','抖音|小号','抖音','m1','me','小王','公域引流',3)];
    window.__channels=()=>壳(<ChannelsView rows={rows} users={users} 属性选项={['公域引流','主动自拓']} 能管 主渠道们={主们} 两层/>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://src.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://src.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as Record<string, () => void>).__channels());
  await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor();
  return { page, errors };
}
const 页不横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const 存的 = (page: Page) => page.evaluate(() => (window as unknown as { __存?: [string, Record<string, unknown>][] }).__存 ?? []);
/** 弹窗开场动画放完（antd 放完会再落一次焦点，这之前点开的下拉会被抢焦点关掉；人手没这么快，只有测试要等） */
const 开完 = (弹窗: ReturnType<Page["locator"]>) => 弹窗.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => null))).then(() => new Promise((r) => setTimeout(r, 150))));
const 选着 = (弹窗: ReturnType<Page["locator"]>, 项: string) => 弹窗.locator(".ant-form-item", { has: 弹窗.page().locator(`label[title="${项}"]`) }).locator(".ant-select").innerText();

it("新建渠道：选了主渠道，属性、负责人先带主渠道的；自己动过属性的不被盖", async () => {
  const { page, errors } = await open(1366);
  try {
    await page.getByRole("button", { name: /新建渠道/ }).click();
    const 弹窗 = page.locator(".ant-modal").filter({ hasText: "新建渠道" });
    await 弹窗.waitFor();
    await 开完(弹窗);
    // 一开始负责人默认是我、属性空着
    expect((await 选着(弹窗, "负责人")).trim()).toBe("小王");
    await 弹窗.getByLabel("主渠道").fill("百度");
    await expect.poll(async () => (await 选着(弹窗, "渠道属性")).trim()).toBe("主动自拓");
    expect((await 选着(弹窗, "负责人")).trim()).toBe("运营甲");
    // 自己把属性改成别的，再换主渠道：属性不被盖，负责人没动过的照带
    await 弹窗.locator(".ant-form-item", { has: page.locator('label[title="渠道属性"]') }).locator(".ant-select").click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: "公域引流" }).first().click();
    await 弹窗.getByLabel("主渠道").fill("抖音");
    await expect.poll(async () => (await 选着(弹窗, "负责人")).trim()).toBe("小王");
    expect((await 选着(弹窗, "渠道属性")).trim()).toBe("公域引流");
    // 主渠道自己没填的：什么都不带，原来的留着
    await 弹窗.getByLabel("主渠道").fill("没人管的主渠道");
    expect((await 选着(弹窗, "负责人")).trim()).toBe("小王");
    await 弹窗.getByLabel("主渠道").fill("百度");
    await expect.poll(async () => (await 选着(弹窗, "负责人")).trim()).toBe("运营甲");
    await 弹窗.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(async () => (await 存的(page)).length).toBe(1);
    expect((await 存的(page))[0]).toMatchObject(["saveChannel", { platform: "百度", source: "", attr: "公域引流", channelOwnerId: "u1" }]);
    expect(await 页不横滚(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/** 元素中心点上最顶层的是不是它自己（或它里面的东西） */
const 点得中 = (loc: ReturnType<Page["locator"]>) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const 中 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!中 && (el === 中 || el.contains(中));
});
const 主行 = (page: Page, 名: string) => page.locator(".ant-table-tbody tr.ant-table-row", { hasText: 名 }).first();
const 行名们 = (page: Page) => page.locator(".ant-table-tbody tr.ant-table-row .chan-name").evaluateAll((els) => els.filter((e) => e.closest("td")?.matches(":first-child")).map((e) => e.textContent));

for (const width of [1024, 1280, 1366]) {
  it(`按主渠道：只有主渠道的也出一行，带负责人、渠道属性；按负责人筛得出来；长名字不撑破、不横滚（${width} 宽）`, async () => {
    const { page, errors } = await open(width);
    try {
      await page.getByText("按主渠道", { exact: true }).click();
      await 主行(page, "百度").waitFor();
      expect(await 行名们(page)).toEqual(["抖音", "百度", 长主, "没人管的主渠道", "停了的空主渠道"]);
      const 表头 = (await page.locator(".ant-table-thead th").allInnerTexts()).map((t) => t.trim());
      const [属性列, 数列, 人列] = [表头.indexOf("渠道属性"), 表头.indexOf("子渠道数"), 表头.indexOf("负责人")];
      expect(Math.min(属性列, 数列, 人列)).toBeGreaterThan(0);
      const 格 = (名: string, i: number) => 主行(page, 名).locator("td").nth(i).innerText().then((t) => t.trim());
      expect([await 格("百度", 属性列), await 格("百度", 数列), await 格("百度", 人列)]).toEqual(["主动自拓", "0", expect.stringContaining("运营甲")]);
      expect([await 格("抖音", 属性列), await 格("抖音", 数列), await 格("抖音", 人列)]).toEqual(["公域引流", "2", expect.stringContaining("小王")]);
      expect([await 格("没人管的主渠道", 属性列), await 格("没人管的主渠道", 人列)]).toEqual(["—", "—"]);
      expect(await 主行(page, "停了的空主渠道").locator(".ant-tag", { hasText: "已停用" }).count()).toBe(1);

      // 超长主渠道名一行省略；行尾「编辑」钉在右边、点得中；页面不横滚
      const 长格 = 主行(page, 长主).locator(".chan-name").first();
      expect(await 长格.evaluate((el) => ({ 一行: el.getBoundingClientRect().height < 30, 省略: el.scrollWidth > el.clientWidth }))).toEqual({ 一行: true, 省略: true });
      const 编辑钮 = 主行(page, 长主).getByRole("button", { name: `编辑主渠道 ${长主}` });
      expect(await 点得中(编辑钮)).toBe(true);
      const 钮框 = (await 编辑钮.boundingBox())!;
      expect(钮框.x >= 0 && 钮框.x + 钮框.width <= width).toBe(true);
      // 超长人名不撑出自己那一格
      const 人格 = 主行(page, 长主).locator("td").nth(人列);
      await 人格.scrollIntoViewIfNeeded();
      expect(await 人格.evaluate((td) => { const r = td.getBoundingClientRect(); return [...td.querySelectorAll("*")].every((e) => e.getBoundingClientRect().right <= r.right + 1); })).toBe(true);
      expect(await 页不横滚(page)).toBe(true);

      // 筛负责人 = 运营甲：抖音（子渠道都是小王的）不出，只有主渠道的百度、停了的空主渠道按自己的负责人出
      await page.getByLabel("负责人", { exact: true }).click();
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: "运营甲" }).first().click();
      await expect.poll(() => 行名们(page)).toEqual(["百度", "停了的空主渠道"]);
      expect(await 页不横滚(page)).toBe(true);

      // 只有主渠道的：点名字 = 编辑（底下没有子渠道可看）；保存交的是这个主渠道
      await 主行(page, "百度").locator(".chan-name").first().click();
      const 弹窗 = page.locator(".ant-modal").filter({ hasText: "编辑：百度" });
      await 弹窗.waitFor();
      const 窗 = (await 弹窗.boundingBox())!;
      expect(窗.x >= 0 && 窗.x + 窗.width <= width).toBe(true);
      await 弹窗.getByRole("button", { name: /保\s*存/ }).click();
      await expect.poll(async () => (await 存的(page)).length).toBe(1);
      expect((await 存的(page))[0]).toMatchObject(["saveMainChannel", { id: "m2", name: "百度", ownerId: "u1", attr: "主动自拓" }]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("有子渠道的主渠道：点名字照旧回到按子渠道；行尾「编辑」打开主渠道编辑", async () => {
  const { page, errors } = await open(1366);
  try {
    await page.getByText("按主渠道", { exact: true }).click();
    await 主行(page, "抖音").getByRole("button", { name: "编辑主渠道 抖音" }).click();
    await page.locator(".ant-modal").filter({ hasText: "编辑：抖音" }).waitFor();
    await page.locator(".ant-modal").filter({ hasText: "编辑：抖音" }).getByRole("button", { name: /取\s*消/ }).click();
    await 主行(page, "抖音").locator(".chan-name").first().click();
    await expect.poll(() => 行名们(page)).toEqual(["抖音|官方号", "抖音|小号"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
