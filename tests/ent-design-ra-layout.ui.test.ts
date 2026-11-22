/**
 * 设计语言 R-A（11-22）复盘 · 卡点 排版门槛：超长数据下 1024 / 1280 / 1366 / 390 不横向溢出、按钮点得中。
 *
 *   看板：13 条待接受 + 处理中、已解决都空 → 空栏收窄（不是平均三等分）；9 个阻碍原因（含待审核、未分类）只露前 5 + 「其余 N 个」
 *   筛选：1366 一行；1024（内容区约 760）范围一行、四个下拉一行；390 下拉收成「筛选」钮、点开底部面板
 *   卡片：认领 / 我已完成 / ⋯ 点得中（elementFromPoint）；不在分栏（项目详情）时首行写状态
 *   「我已完成」框：提交键一直能点、最后一位写「我已完成，标为已解决」，没填的格子下一行红字、焦点到第一处；填好才交
 *   ⋯ → 删除：原地确认「连流转记录一起删」，确认了才删
 *   有筛选、三栏都空：整体收成一句「没有对得上筛选的卡点」+ 一颗「重置」（不三栏各写一遍）；390 范围分段 44 高
 * 内容区按真实页面算：≥768 左边留 232 侧栏（1024 时内容约 760），390 没有侧栏、底部留 AI 安全区。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-design-ra-layout", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "const 记=(u)=>{(window.__去||(window.__去=[])).push(u)};export const useRouter=()=>({push:记,refresh(){},replace:记});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/blocker-actions$/, "const f=async()=>({ok:true});export const 发布卡点Action=f,认领卡点Action=async(id)=>{(window.__认领??=[]).push(id);return {ok:true}},完成卡点Action=async(id,x)=>{(window.__完成??=[]).push([id,x]);return {ok:true}},删卡点Action=async(id)=>{(window.__删??=[]).push(id);return {ok:true}};");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import BoardBlockers from '@/app/(app)/overview/BoardBlockers';
    import {BlockerList} from '@/app/(app)/projects/BlockerPanel';
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域销售中心';
    const 前天=new Date(Date.now()-2*86400000).toISOString();
    const 人=(n,done,note)=>({名字:n+长,done,note,doneAt:null,是我:false});
    const 卡=(i,status,x={})=>({id:'b'+i,code:'BLK-20261122-'+String(i).padStart(3,'0'),title:'',有标题:false,projectId:'p'+i,项目:'华东二期产线改造项目'+长,followUpId:'f'+i,phase:'订单',type:i%2?'重要卡点':'中度卡点',impact:'可能丢单',
      原因们:[{id:'r1',name:'价格'+长,status:'启用'},{id:'r9',name:'前台新加的'+长,status:'待审核'}],description:'第'+i+'个卡点：'+长.repeat(3),status,发布人:'很长很长的发布人名字'+长,resourceRequest:'要总部特批价格'+长,solution:null,result:null,
      resolvedAt:null,createdAt:前天,流转:[],认领:[],进度:{完成:0,共:0},能:{认领:status==='待接受',完成:false,最后一个:false,删:true},...x});
    const 原因=['价格','交期','技术方案','竞品','付款方式','资质','内部审批','客户换人'].map((n,i)=>({id:'r'+i,名:n+长,状态:i===3?'待审核':'启用',数:9-i}));
    原因.push({id:'r-none',名:'未分类',状态:'启用',数:1});
    const 统计={未解决:13,已解决:0,按影响:[{名:'可能丢单',数:8},{名:'短期不影响',数:5}],按原因:原因};
    const 栏={待接受:Array.from({length:13},(_,i)=>卡(i+1,'待接受')),处理中:[],已解决:[]};
    // 项目详情：不在分栏；一条三人会签带备注、轮到我且是最后一位
    const 详情们=[卡(21,'处理中',{认领:[人('甲',true,'我这边报价改好了'+长),人('乙',true,'合同条款对过了'),{...人('我',false,null),是我:true}],进度:{完成:2,共:3},能:{认领:false,完成:true,最后一个:true,删:true}}),
      卡(22,'处理中',{认领:[人('甲',false,null),{...人('我',false,null),是我:true}],进度:{完成:0,共:2},能:{认领:false,完成:true,最后一个:false,删:false}})];
    window.__画=(o)=>{
      const 里=o.页==='detail'?<section className="rbk-card"><BlockerList 们={详情们}/></section>
        :<BoardBlockers 开 全部 能管 栏={o.空?{待接受:[],处理中:[],已解决:[]}:栏} 已解决共={0} 统计={o.空?{未解决:0,已解决:0,按影响:[],按原因:[]}:统计} 项目们={[{id:'p1',name:'华东二期产线改造项目'+长}]} 原因们={[{id:'r0',name:'价格',status:'启用'}]} 筛={o.筛??{}}/>;
      const 窄=window.innerWidth<768;
      createRoot(document.getElementById('root')).render(<App><div style={{display:'flex'}}>{窄?null:<aside style={{flex:'0 0 232px'}}/>}<main style={{flex:'1 1 0',minWidth:0,padding:窄?16:24}}>{里}</main></div></App>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(o: Record<string, unknown>, width: number): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><div id='root'></div>" }));
  await page.goto("http://ent.test/overview?tab=block");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (o: unknown) => void }).__画(x), o);
  await page.locator("main > *").first().waitFor();
  return { page, errors };
}
const 不溢出 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** 按钮中心点 elementFromPoint 命中的就是它自己（没被别的东西盖住、没跑出屏） */
async function 点得中(page: Page, btn: import("playwright").Locator) {
  await btn.scrollIntoViewIfNeeded();
  const box = (await btn.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  return btn.evaluate((e, [x, y]) => { const hit = document.elementFromPoint(x, y); return !!hit && (e === hit || e.contains(hit)); }, [box.x + box.width / 2, box.y + box.height / 2] as const);
}

it.each([1024, 1280, 1366, 390])("看板 %ipx：超长数据不横向溢出；认领、⋯ 点得中；原因只露前 5", async (w) => {
  const { page, errors } = await 打开({ 页: "block" }, w);
  try {
    expect(await 不溢出(page)).toBe(true);
    const 卡 = page.locator(".bk-card").first();
    expect(await 点得中(page, 卡.getByRole("button", { name: /^认\s*领$/ }))).toBe(true);
    expect(await 点得中(page, 卡.getByRole("button", { name: "更多操作" }))).toBe(true);
    const 原因行 = page.locator('[aria-label="按阻碍原因"] .rbk-bar-row');
    expect(await 原因行.count()).toBe(5);
    await page.getByRole("button", { name: /其余 4 个/ }).click();
    expect(await 原因行.count()).toBe(9);
    expect(await page.locator('[aria-label="按阻碍原因"]').innerText()).toContain("未分类");
    expect(await 不溢出(page)).toBe(true);
    if (w === 390) {
      // 手机：底部留 AI 安全区；认领 / ⋯ 触控 44
      const h = (await 卡.getByRole("button", { name: /^认\s*领$/ }).boundingBox())!.height;
      expect(h).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("1366：13 / 0 / 0 时空栏收窄，待接受那栏占大头（不是平均三等分）", async () => {
  const { page } = await 打开({ 页: "block" }, 1366);
  try {
    const 宽 = async (s: string) => (await page.locator(`section[aria-label="${s}的卡点"]`).boundingBox())!.width;
    const [甲, 乙, 丙] = [await 宽("待接受"), await 宽("处理中"), await 宽("已解决")];
    expect(甲).toBeGreaterThan(乙 * 2);
    expect(Math.abs(乙 - 丙)).toBeLessThan(2);
    // 待接受栏里卡片多列铺开
    const 顶 = await page.locator('section[aria-label="待接受的卡点"] .bk-card').evaluateAll(es => es.slice(0, 2).map(e => e.getBoundingClientRect().top));
    expect(Math.abs(顶[0] - 顶[1])).toBeLessThan(2);
  } finally { await page.close(); }
});

it("筛选行：1366 一行；1024 范围一行、四个下拉一行；390 收成「筛选」钮、点开底部面板", async () => {
  const 顶 = (page: Page, sel: string) => page.locator(sel).evaluate(e => Math.round(e.getBoundingClientRect().top));
  {
    const { page } = await 打开({ 页: "block" }, 1366);
    try {
      const 范 = await 顶(page, ".rbk-scope");
      const 下 = await page.locator(".rbk-sel").evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().top)));
      expect(下.every(t => Math.abs(t - 下[0]) <= 2)).toBe(true);
      expect(Math.abs(下[0] - 范)).toBeLessThanOrEqual(4);
      expect(await page.locator(".rbk-more").isVisible()).toBe(false);
    } finally { await page.close(); }
  }
  {
    const { page } = await 打开({ 页: "block" }, 1024);
    try {
      const 范 = await 顶(page, ".rbk-scope");
      const 下 = await page.locator(".rbk-sel").evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().top)));
      expect(下).toHaveLength(4);
      expect(下.every(t => Math.abs(t - 下[0]) <= 2)).toBe(true);
      expect(下[0]).toBeGreaterThan(范 + 20);
      expect(await 不溢出(page)).toBe(true);
    } finally { await page.close(); }
  }
  {
    const { page } = await 打开({ 页: "block", 筛: { 原因: "r0" } }, 390);
    try {
      expect(await page.locator(".rbk-sels").isVisible()).toBe(false);
      // 范围分段触屏点击区 44
      const 段高 = await page.locator(".rbk-scope .ant-segmented-item").evaluateAll(es => es.map(e => e.getBoundingClientRect().height));
      expect(段高.length).toBeGreaterThanOrEqual(2);
      for (const h of 段高) expect(h).toBeGreaterThanOrEqual(44);
      const 钮 = page.locator(".rbk-more");
      expect(await 钮.innerText()).toMatch(/筛选（1）/);
      expect((await 钮.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await 钮.click();
      await page.locator(".rbk-sheet .rbk-sel").first().waitFor();
      expect(await page.locator(".rbk-sheet .rbk-sel").count()).toBe(4);
      expect(await 不溢出(page)).toBe(true);
    } finally { await page.close(); }
  }
});

it("项目详情（不在分栏）：首行写状态；三人会签带备注；我已完成 → 最后一位校验 → 交；⋯ → 删除原地确认", async () => {
  for (const w of [1024, 390]) {
    const { page, errors } = await 打开({ 页: "detail" }, w);
    try {
      expect(await 不溢出(page)).toBe(true);
      const 卡 = page.locator(".bk-card").first();
      expect(await 卡.locator(".bk-st").innerText()).toContain("处理中");
      expect(await 卡.innerText()).toMatch(/会签 2\/3/);
      expect(await 卡.innerText()).toContain("我这边报价改好了");
      // 我已完成：最后一位
      const 完 = 卡.getByRole("button", { name: /我已完成/ });
      expect(await 点得中(page, 完)).toBe(true);
      await 完.click();
      const dlg = page.locator(".bk-done-modal .ant-modal");
      await dlg.waitFor();
      const 交键 = dlg.getByRole("button", { name: /我已完成，标为已解决/ });
      expect(await 交键.isDisabled()).toBe(false);
      await 交键.click();
      await dlg.locator(".fm-err").first().waitFor();
      expect(await dlg.locator(".fm-err").allInnerTexts()).toEqual(["写一下怎么解决的", "写一下结果怎样"]);
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("解决方案");
      expect(await page.evaluate(() => Reflect.get(window, "__完成") ?? null)).toBeNull();
      expect(await 不溢出(page)).toBe(true);
      await dlg.getByLabel("解决方案").fill("降价 3%");
      await dlg.getByLabel("解决结果").fill("签了");
      await 交键.click();
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__完成") ?? null)).toEqual([["b21", { note: "", solution: "降价 3%", result: "签了" }]]);
      await dlg.waitFor({ state: "hidden" });
      // 非最后一位：只要备注、键写「我已完成」
      await page.locator(".bk-card").nth(1).getByRole("button", { name: /我已完成/ }).click();
      await dlg.waitFor();
      expect(await dlg.getByLabel("解决方案").count()).toBe(0);
      expect(await dlg.locator(".ant-modal-footer").getByRole("button").last().innerText()).toMatch(/^我已完成$/);
      await dlg.getByRole("button", { name: /取\s*消/ }).click();
      await dlg.waitFor({ state: "hidden" });
      // 没删权限的那条没有 ⋯
      expect(await page.locator(".bk-card").nth(1).getByRole("button", { name: "更多操作" }).count()).toBe(0);
      // ⋯ → 删除：原地确认，确认了才删
      const 多 = 卡.getByRole("button", { name: "更多操作" });
      expect(await 点得中(page, 多)).toBe(true);
      await 多.click();
      await page.locator(".ant-dropdown-menu-item").filter({ hasText: "删除" }).click();
      await page.getByText("连流转记录一起删").waitFor();
      expect(await page.evaluate(() => Reflect.get(window, "__删") ?? null)).toBeNull();
      await page.getByRole("button", { name: /^确认删除$|^删\s*除$/ }).last().click();
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__删") ?? null)).toEqual(["b21"]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
}, 60_000);

it.each([1366, 390])("有筛选、三栏都空 %ipx：整体一句「没有对得上筛选的卡点」+ 一颗重置，不三栏各写一遍", async (w) => {
  const { page, errors } = await 打开({ 页: "block", 空: true, 筛: { 原因: "r0" } }, w);
  try {
    expect(await page.getByText("没有对得上筛选的卡点").count()).toBe(1);
    expect(await page.locator(".rbk-col").count()).toBe(0);
    expect(await page.locator('section[aria-label="卡点概况"]').count()).toBe(1);
    const 钮 = page.locator(".rbk-filter-none").getByRole("button", { name: /重\s*置/ });
    expect(await 点得中(page, 钮)).toBe(true);
    if (w === 390) expect((await 钮.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await 钮.click();
    expect(await page.evaluate(() => (window as unknown as { __去?: string[] }).__去 ?? [])).toEqual(["/overview?tab=block"]);
    expect(await 不溢出(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
