/**
 * 设计语言 R-B（11-22，落地计划-三页设计 R-B 节）：复盘「任务 / 沟通 / 数据」三页签的排版闸门。现状主题量新样，账簿主题量照旧。
 *
 *   数据·现在：概况 6 格 + 阶段 4 格两排同款（同号 26、不带彩色图标）；待回款窄格缩写、悬停 / 点开看全值；
 *             漏斗个数在条外右侧一列、不压条；「已经结束的」在漏斗卡底；按负责人默认 10 行 +「展开全部 N 人」；
 *             卡点分布收成一句摘要 +「去卡点页签 ›」
 *   数据·本月：四格同款一排，交付金额缩写 + 全值
 *   沟通：筛选条最左「沟通｜主题」；卡头「项目沟通（N）」；每条末行灰字；390「还没沟通过的项目」收一行
 *   主题：筛选条最左「沟通｜主题」（主题选中）；卡头「教练主题（N）」
 *   任务：卡头「全部待办（N）」、日期 smartTime（悬停全时间）、逾期 0 灰、卡悬停只换底
 *   各宽度 1024 / 1280 / 1366 / 390 + 长数据：不横滚、数字没被盖（elementFromPoint）、卡头 48
 *   账簿主题：阶段卡照旧 StatCard、「已经结束的」照旧在卡外、按负责人全摆、漏斗数字在条上
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-design-rb-layout", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "const 记=(u)=>{(window.__去||(window.__去=[])).push(u)};export const useRouter=()=>({push:记,refresh(){},replace:记,prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/blocker-actions$/, "const f=async()=>({ok:true});export const 发布卡点Action=f,认领卡点Action=f,完成卡点Action=f,删卡点Action=f;");
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
    import BoardTalks from '@/app/(app)/overview/BoardTalks';
    import BoardTopics from '@/app/(app)/overview/BoardTopics';
    import {ProjectNowView, ProjectPeriodView} from '@/app/(app)/overview/ProjectStatsView';
    import {阶段们, 节点们} from '@/lib/project/nodes';
    import {BusinessProvider} from '@/lib/business-client';
    import {项目漏斗of} from '@/app/(app)/overview/funnel';
    import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域销售总监';
    const 人数=14;
    const 现在={
      阶段:[{phase:'线索',count:12345,amount:0},{phase:'商机',count:8888,amount:9876543210},{phase:'订单',count:3333,amount:12345678912}],
      节点:阶段们.flatMap(p=>节点们[p].map((node,i)=>({phase:p,node,count:i+1,amount:1000000*i}))),
      结局:[{result:'线索流失',count:2},{result:'丢单',count:1},{result:'交付结清',count:5},{result:'异常状态',count:1}],
      公海:2,外币:0,
      漏斗:项目漏斗of([...Array(1200)].map(()=>({phase:'线索',result:null})).concat([...Array(800)].map(()=>({phase:'商机',result:null})),[...Array(3)].map(()=>({phase:'订单',result:'成功交付'})))),
      按人:Array.from({length:人数},(_,i)=>({id:'u'+i,name:长+i,线索:4,商机:3,订单:1,商机金额:98765432,订单金额:12345678})),
      线索节点:节点们['线索'].map((node,i)=>({node,count:i+2,流失:i,判无效:i===1?1:0,退回公海:i===0?2:0})),
      线索转商机:5,
    };
    const 概况={概况:{在跟:123456,逾期任务:3456,未解决卡点:9,已回款:12345678912,待回款:98765432109,外币项目:0,将回公海:12},
      预警:[{id:'w0',名:'要回公海的项目'+长,节点:'潜客培育',负责人:'小王',回收日:'2026-11-25'}],
      分布:{总数:9,按主体:[{主体:'客户',数:5},{主体:'某个特别长特别长特别长特别长特别长的阻碍主体',数:3},{主体:'没填',数:1}],按状态:[{状态:'待接受',数:4},{状态:'处理中',数:5}]}};
    const 一段={
      合计:{新建:6,转商机:4,转订单:2,成功交付:3,交付金额:23456789012,线索流失:1,丢单:1,异常状态:2},
      trend:Array.from({length:26},(_,i)=>({label:'10-'+String(i+1).padStart(2,'0'),新建:i%3,转商机:i%2,转订单:i%4===0?1:0,成功交付:i%5===0?1:0})),
      按人:Array.from({length:人数},(_,i)=>({id:'u'+i,name:长+i,新建:3,转商机:2,转订单:1,成功交付:1,交付金额:23456789,没成:1})),
      外币:0,
      漏斗:项目漏斗of([...Array(6)].map((_,i)=>({phase:i<4?'商机':'线索',result:i<3?'成功交付':null}))),
      线索节点:节点们['线索'].map((node,i)=>({node,count:i,流失:i===2?1:0,判无效:0,退回公海:0})),
      线索转商机:4,
    };
    const 天前=(n)=>new Date(Date.now()-n*86400000).toISOString();
    // 第 3 行跨年（去年 10 月 26 日 09:30，R-B 审查：smartTime 写成「2025 年 10 月 26 日 09:30」撑出到期列）；
    // 第 4 行旧数据：明确钟点 = null、本地零点（只定了日子），不该写出「00:00」
    const 今=new Date(), 去年=new Date(今.getFullYear()-1,9,26,9,30).toISOString(), 旧零点=new Date(今.getFullYear(),今.getMonth(),今.getDate()-20).toISOString();
    const 待办行=(n)=>Array.from({length:n},(_,i)=>({
      key:'task:'+i, kind:'task', id:String(i), 时间:i===0?天前(3):i===3?去年:i===4?旧零点:天前(40+i), 明确钟点:i===4?null:i!==1,
      内容:'第'+i+'条：'+长+'的方案回访和报价确认', customerId:'c'+i, customerName:长+i, projectName:'华东二期产线改造项目'+长,
      ownerId:'u1', ownerName:'很长很长的负责人名字', 组:'逾期', 去:'/projects/p'+i,
    }));
    const 沟通=(n)=>Array.from({length:n},(_,i)=>({
      id:'f'+i, 时间:'2026-10-2'+(i%9)+'T09:00:00.000Z', projectId:'p'+i, 项目:'华东二期产线改造项目'+长, 节点:'潜客培育', 客户:长+i, 方式:'线下拜访',
      标题:'第'+i+'次回访', 内容:'聊了'+长+'的方案和报价', 负责人:'记录人'+i, 发起:i===1?'客户主动':null, 编号:i===1?'FUL0001':null, 附件:i===1?3:0,
    }));
    const 缺行=(n)=>Array.from({length:n},(_,i)=>({id:'q'+i,名:'没沟通的项目'+i+长,客户:长,节点:'潜客培育',负责人:'小'+i,建于:'2026-10-20T09:00:00.000Z'}));
    const 主题行=(id,状态)=>({id,时间:'2026-11-17T02:00:00.000Z',projectId:'p'+id,项目:'项目'+长,节点:'线索验证',状态,标题:'主题'+长,发起人:'教练',身份:'销售教练',回复数:2});
    window.__画=(o)=>{
      let 里, 页签=o.页, view='现在';
      if(o.页==='todo') 里=o.布局==='board'
        ? <BoardTodos 数={{计数:{overdue:0,today:2,week:1,all:45},总数:6,页:1,行:[]}} 看板={{计数:{overdue:0,today:2,week:1,all:45},列:{overdue:{总数:2,行:待办行(2)},today:{总数:0,行:[]},later:{总数:0,行:[]}}}} 布局="board" 卡="all" 只看自己={false} 看全员={true} 只读={!!o.只读}/>
        : <BoardTodos 数={{计数:{overdue:0,today:2,week:1,all:45},总数:6,页:1,行:待办行(6)}} 布局="list" 卡="all" 只看自己={false} 看全员={true} 只读={!!o.只读}/>;
      else if(o.页==='talk') 里=<BoardTalks 数={{总数:1234,页:1,行:沟通(4)}} 段="all" 方式="" 只看自己={false} 有主题 缺={{总数:4567,行:缺行(5)}}/>;
      else if(o.页==='topic'){ 页签='talk'; 里=<BoardTopics 数={{总数:3,页:1,行:[主题行('1','待回复'),主题行('2','已回复'),主题行('3','已关闭')]}} 范围="all" 状态=""/>; }
      else if(o.页==='month'){ 页签='data'; view='本月'; 里=<ProjectPeriodView 数={一段} 本位币="CNY" 口径={o.口径||"2026 年 10 月"} 单人={false}/>; }
      else { 页签='data'; 里=<ProjectNowView 数={现在} 本位币="CNY" 单人={false} 概况={概况}/>; }
      createRoot(document.getElementById('root')).render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
        <DataShell view={view} 项目 页签={页签} 选人={{选项:[{value:'u1',label:'小王'}],当前:''}}>{里}</DataShell>
      </BusinessProvider></App>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 页 = "todo" | "talk" | "topic" | "data" | "month";
/**
 * 壳（R-B 审查 11-22，同 G-A 布局测试 tests/ent-design-ga-layout.ui.test.ts）：正文在 main.app-content 里，电脑宽左边让出左栏 220、正文内边距 22 / 26，
 * 宽度才是真实宽度（原来只有 padding 16，1024 下每格多出五六十）。面板 = AI 面板开着：外层 .shell-dock-open、右边让出 380
 */
async function 打开(页: 页, width = 1280, skin?: string, 布局?: "board", 面板 = false, 另?: { 只读?: boolean; 口径?: string }): Promise<{ page: Page; errors: string[] }> {
  const 手 = width < 768;
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: 手 }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const 壳 = `<div class='${面板 ? "shell-dock-open " : ""}has-ai-fab'><main class='main app-content'><div id='root'></div></main></div>`;
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{margin:0}</style>${壳}` }));
  await page.goto("http://ent.test/overview");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ content: 手 ? ".app-content{display:block}" : `.app-content{display:block;margin-left:220px;padding:22px 26px${面板 ? ";margin-right:380px" : ""}}` });
  if (skin) await page.evaluate((k) => { document.documentElement.dataset.skin = k; }, skin);
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (o: unknown) => void }).__画(x), { 页, 布局, ...另 });
  await page.locator(".data-shell-body").first().waitFor();
  await page.waitForTimeout(400);
  return { page, errors };
}
const 不横滚 = async (page: Page) => {
  const r = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= window.innerWidth) return true;
    // 溢出时把冒出去的最外层元素报出来，方便查
    const 出 = [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !(e.parentElement && e.parentElement.getBoundingClientRect().right > window.innerWidth + 1));
    return 出.slice(0, 3).map((e) => `${e.tagName}.${(e.className && typeof e.className === "string" ? e.className : "").split(" ").join(".")} → ${Math.round(e.getBoundingClientRect().right)}`).join(" | ") + ` (视口 ${window.innerWidth}，scrollWidth ${document.documentElement.scrollWidth})`;
  });
  expect(r).toBe(true);
  return true;
};
const 字 = (s: string) => s.replace(/\s+/g, "");

/** 每个选中的元素：完整在所在格子里、没被截（scrollWidth）、中心点点得中自己 */
async function 数字都露着(page: Page, sel: string, 格: string) {
  const r = await page.locator(sel).evaluateAll((els, 格) => els.map((e) => {
    (e as HTMLElement).scrollIntoView({ block: "center" });
    const b = e.getBoundingClientRect(); const p = e.closest(格)!.getBoundingClientRect();
    const 中 = document.elementFromPoint(b.left + Math.min(b.width / 2, 8), b.top + b.height / 2);
    return { t: (e as HTMLElement).innerText, 截: e.scrollWidth > (e as HTMLElement).clientWidth + 1, 出: b.right > p.right + 1 || b.left < p.left - 1, 盖: !(中 && (e === 中 || e.contains(中))) };
  }), 格);
  for (const x of r) expect(x, `${sel}「${x.t}」`).toMatchObject({ 截: false, 出: false, 盖: false });
  return r.length;
}

it.each([1024, 1280, 1366, 390])("数据·现在 %ipx：概况 6 格 + 阶段 4 格两排同款同号 26，数字都露着、不横滚", async (w) => {
  const { page, errors } = await 打开("data", w);
  const 概况 = page.locator('section[aria-label="复盘概况"]'), 阶段 = page.locator('section[aria-label="各阶段"]');
  expect(await 概况.locator(".rkpi-i").count()).toBe(6);
  expect(await 阶段.locator(".rkpi-i").count()).toBe(4);
  expect(字(await 阶段.locator(".rkpi-k").allInnerTexts().then((x) => x.join("|")))).toBe("新线索|商机阶段|订单阶段|异常状态");
  // 去彩色图标：阶段排里没有 StatCard 的图标
  expect(await page.locator(".data-shell-body .stat-card, .data-shell-body .anticon-funnel-plot").count()).toBe(0);
  const 号 = await page.locator(".rkpi-v").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).fontSize))]);
  expect(号).toEqual(["26px"]);
  expect(await 数字都露着(page, ".rkpi-v", ".rkpi-i")).toBe(10);
  // 金额窄格缩写（待回款 987 亿多 → 亿），小字里的阶段金额也缩写
  expect(await 概况.locator(".rkpi-i", { hasText: "待回款" }).locator(".rkpi-v").innerText()).toMatch(/亿/);
  expect(await 阶段.locator(".rkpi-i", { hasText: "商机阶段" }).locator(".rkpi-s").innerText()).toMatch(/进行中的 · .*亿/);
  // 异常格：公海链接在小字里
  expect(await 阶段.locator(".rkpi-i", { hasText: "异常状态" }).getByRole("link", { name: "公海里还有 2 个 ›" }).getAttribute("href")).toBe("/pool?open=1");
  expect(await 不横滚(page)).toBe(true);
  expect(errors).toEqual([]); await page.close();
});

/** R-B 审查 11-22：真实宽度下 KPI 小字不截（折行，数字在句尾也看得到），整句也并进悬停提示；大数省略号兜底不压隔壁格 */
it.each([1024, 390])("数据 %ipx：KPI 小字不截、放不下折行；数字格 overflow hidden + 省略号兜底", async (w) => {
  for (const 页 of ["data", "month"] as const) {
    const { page, errors } = await 打开(页, w);
    const r = await page.locator(".rkpi-s").evaluateAll((els) => els.map((e) => {
      const b = e.getBoundingClientRect(), p = e.closest(".rkpi-i")!, pb = p.getBoundingClientRect();
      return { t: (e as HTMLElement).innerText, 截: e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1, 出: b.right > pb.right + 1 || b.bottom > pb.bottom + 1 };
    }));
    expect(r.length).toBe(4);
    for (const x of r) expect(x, `${页}「${x.t}」`).toMatchObject({ 截: false, 出: false });
    expect(await page.locator(".rkpi-v").first().evaluate((e) => [getComputedStyle(e).overflow, getComputedStyle(e).textOverflow])).toEqual(["hidden", "ellipsis"]);
    expect(await 不横滚(page)).toBe(true);
    expect(errors).toEqual([]); await page.close();
  }
});

it("数据 1024：小字整句在悬停提示里（本月「没成」的另有异常、现在「异常状态」的公海进行中的项目）", async () => {
  const m = await 打开("month", 1024);
  await m.page.locator('section[aria-label="这一段"] .rkpi-i', { hasText: "没成" }).hover();
  await expect.poll(() => m.page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").innerText().catch(() => "")).toContain("另有异常 2，不算在没成里");
  await m.page.close();
  const d = await 打开("data", 1024);
  await d.page.locator('section[aria-label="各阶段"] .rkpi-i', { hasText: "异常状态" }).locator(".rkpi-k").hover();
  await expect.poll(() => d.page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").innerText().catch(() => "")).toContain("公海里还有 2 个进行中的项目");
  await d.page.close();
});

it("数据·现在 1440 + AI 面板开着：概况 6 格改三格一排，数字都露着", async () => {
  const { page, errors } = await 打开("data", 1440, undefined, undefined, true);
  const 概况 = page.locator('section[aria-label="复盘概况"]');
  expect(await 概况.evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(" ").length)).toBe(3);
  expect(await 数字都露着(page, 'section[aria-label="复盘概况"] .rkpi-v', ".rkpi-i")).toBe(6);
  expect(await 不横滚(page)).toBe(true);
  expect(errors).toEqual([]); await page.close();
});

it("数据·现在 390 触屏：「展开全部 N 人」「去卡点页签 ›」点击区 ≥ 44，卡点卡头不长高", async () => {
  const { page } = await 打开("data", 390);
  const 高 = (sel: string) => page.locator(sel).first().evaluate((e) => e.getBoundingClientRect().height);
  expect(await 高(".stat-more")).toBeGreaterThanOrEqual(44);
  expect(await 高(".rkpi-blk-go")).toBeGreaterThanOrEqual(44);
  expect(await 高('section[aria-label="卡点"] > .btodo-head')).toBeLessThanOrEqual(49);
  // 链接中心点点得中自己（没被卡头别的东西盖住）
  expect(await page.locator(".rkpi-blk-go").evaluate((e) => { e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); const 中 = document.elementFromPoint(b.left + b.width / 2, b.top + 4); return !!中 && e.contains(中); })).toBe(true);
  await page.close();
});

/** 3703 实操回改：小字里的金额整体不拆行；自定义时间段口径和「新建的」之间有空格；KPI 整数带千分位 */
it.each([1024, 390])("数据 %ipx：小字金额整体不拆行（「¥」和数不分家）、日期口径后带空格、KPI 整数千分位", async (w) => {
  const d = await 打开("data", w);
  const 钱 = await d.page.locator('section[aria-label="各阶段"] .rkpi-s .nowrap').evaluateAll((els) => els.map((e) => ({ t: (e as HTMLElement).innerText, 行: e.getClientRects().length })));
  expect(钱.length).toBe(2);
  for (const x of 钱) expect(x, x.t).toMatchObject({ 行: 1 });
  expect(钱[0].t).toMatch(/^¥ [\d.,]+ 亿$/);
  expect(await d.page.locator('section[aria-label="复盘概况"] .rkpi-v').first().innerText()).toBe("123,456");
  expect(await d.page.locator('section[aria-label="各阶段"] .rkpi-v').first().innerText()).toBe("12,345");
  await d.page.close();
  const m = await 打开("month", w, undefined, undefined, false, { 口径: "2026-11-01 – 2026-11-22" });
  const 排 = m.page.locator('section[aria-label="这一段"]');
  expect(await 排.locator(".rkpi-i", { hasText: "新建项目" }).locator(".rkpi-s").innerText()).toBe("2026-11-01 – 2026-11-22 新建的，含已结束");
  const 交付 = 排.locator(".rkpi-i", { hasText: "交付结清" }).locator(".rkpi-s");
  expect(字(await 交付.innerText())).toMatch(/^2026-11-01–2026-11-22结束的·¥[\d.,]+亿$/);
  expect(await 交付.locator(".nowrap").evaluate((e) => e.getClientRects().length)).toBe(1);
  await m.page.close();
});

it.each([390, 1366])("数据 %ipx：按负责人展开后滚到底点「收起」，这张卡的顶回到视口里；390 收起钮宽高 ≥ 44", async (w) => {
  const { page } = await 打开("data", w);
  const 卡 = page.locator(".ant-card", { hasText: "按负责人" }).first();
  await 卡.getByRole("button", { name: "展开全部 14 人" }).click();
  const 收 = 卡.getByRole("button", { name: "收起" });
  await 收.scrollIntoViewIfNeeded();
  if (w < 768) {
    const b = (await 收.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  await 收.click();
  await page.waitForTimeout(800);
  const 顶 = await 卡.evaluate((e) => e.getBoundingClientRect().top);
  expect(顶).toBeGreaterThanOrEqual(-1);
  expect(顶).toBeLessThan(900);
  await page.close();
});

it.each(["list", "board"] as const)("只读角色 任务 %s：不摆行首的勾（点了服务端也拒）；非只读照旧有", async (布局) => {
  const 只读 = await 打开("todo", 1280, undefined, 布局 === "board" ? "board" : undefined, false, { 只读: true });
  expect(await 只读.page.locator(".btodo-list .ant-checkbox, .btodo-board .ant-checkbox").count()).toBe(0);
  expect(await 只读.page.locator(".btodo-time").count()).toBeGreaterThan(0);
  expect(await 不横滚(只读.page)).toBe(true);
  expect(只读.errors).toEqual([]); await 只读.page.close();
  const 平常 = await 打开("todo", 1280, undefined, 布局 === "board" ? "board" : undefined);
  expect(await 平常.page.locator(".btodo-list .ant-checkbox, .btodo-board .ant-checkbox").count()).toBeGreaterThan(0);
  await 平常.page.close();
});

/**
 * 像手指那样点按：按下停 150ms 再抬起。Playwright 的 tap() 一瞬间，测不出 trigger 带 click 时
 * 「按下 pointerenter 延时打开、抬起后 click 又切回关」那一闪（C-A1 3704 实操同一个坑）
 */
async function 指点(page: Page, loc: import("playwright").Locator, 按住 = 150) {
  await loc.scrollIntoViewIfNeeded();
  const b = (await loc.boundingBox())!;
  const s = await page.context().newCDPSession(page);
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
  await page.waitForTimeout(按住);
  await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await s.detach();
}

it("数据·现在：待回款悬停看全值（电脑）、点一下看全值且留住不闪（390 触屏）", async () => {
  const { page } = await 打开("data", 1280);
  await page.locator('section[aria-label="复盘概况"] .rkpi-i', { hasText: "待回款" }).hover();
  await expect.poll(() => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").innerText().catch(() => "")).toContain("98,765,432,109");
  await page.close();
  const m = await 打开("data", 390);
  // 长按（按住 400ms，比悬停延时 300ms 长）：规范「悬停 / 长按看全值」
  await 指点(m.page, m.page.locator('section[aria-label="复盘概况"] .rkpi-i', { hasText: "待回款" }), 400);
  await expect.poll(() => m.page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").innerText().catch(() => "")).toContain("98,765,432,109");
  await m.page.waitForTimeout(500);
  expect(await m.page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").innerText().catch(() => "")).toContain("98,765,432,109");
  await m.page.close();
});

it.each([1024, 1280, 390])("数据·现在 %ipx：漏斗个数在条外不压条；「已经结束的」在漏斗卡底；卡点摘要 + 链接", async (w) => {
  const { page } = await 打开("data", w);
  const 行们 = await page.locator(".pfun-now .pfun-row").evaluateAll((rows) => rows.map((r) => {
    const bar = r.querySelector(".pfun-bar")!.getBoundingClientRect(), n = r.querySelector(".pfun-n-out")!.getBoundingClientRect();
    return { 条里有数: !!r.querySelector(".pfun-bar .pfun-n"), 压: n.left < bar.right - 0.5, 出: n.right > r.getBoundingClientRect().right + 1 };
  }));
  expect(行们.length).toBe(4);
  for (const x of 行们) expect(x).toEqual({ 条里有数: false, 压: false, 出: false });
  expect(await page.locator(".pfun-now .pfun-n-out").first().innerText()).toBe("2,003");
  // 个数列定宽：各行条的比例尺一致（原来 minmax(4ch, auto) 每行各算各的，「2,003」那行条短一截）
  const 列宽 = await page.locator(".pfun-now .pfun-row").evaluateAll((rows) => [...new Set(rows.map((r) => `${Math.round(r.querySelector(".pfun-n-out")!.getBoundingClientRect().width)}/${Math.round(r.querySelector(".pfun-track")!.getBoundingClientRect().width)}`))]);
  expect(列宽.length).toBe(1);
  const 脚 = page.locator(".pfun-card .pfun-foot");
  expect(await 脚.innerText()).toMatch(/^已经结束的：.*交付结清 5/);
  expect(await page.locator(".data-shell-body > * > p.muted", { hasText: "已经结束的" }).count()).toBe(0);
  const 卡点 = page.locator('section[aria-label="卡点"]');
  expect(字(await 卡点.locator(".section-title").innerText())).toBe("卡点（9）");
  expect(字(await 卡点.locator(".rkpi-blk-sum").innerText())).toContain(字("未解决 9 条 · 按阻碍主体前 3：客户 5"));
  expect(await 卡点.getByRole("link", { name: "去卡点页签 ›" }).getAttribute("href")).toBe("/overview?tab=block");
  expect(await page.locator('section[aria-label="卡点分布"]').count()).toBe(0);
  expect(await 不横滚(page)).toBe(true);
  await page.close();
});

it.each([1280, 390])("数据 %ipx：按负责人默认 10 行，「展开全部 14 人」/「收起」；卡头带人数", async (w) => {
  for (const 页 of ["data", "month"] as const) {
    const { page } = await 打开(页, w);
    const 卡 = page.locator(".ant-card", { hasText: "按负责人" });
    expect(字(await 卡.locator(".ant-card-head-title").innerText())).toBe("按负责人（14）");
    const 看得见 = () => 卡.locator(".ant-table-tbody > tr.ant-table-row").evaluateAll((rs) => rs.filter((r) => (r as HTMLElement).offsetParent !== null).length);
    expect(await 看得见()).toBe(10);
    await 卡.getByRole("button", { name: "展开全部 14 人" }).click();
    expect(await 看得见()).toBe(14);
    await 卡.getByRole("button", { name: "收起" }).click();
    expect(await 看得见()).toBe(10);
    expect(await 不横滚(page)).toBe(true);
    await page.close();
  }
});

it.each([1024, 1366, 390])("数据·本月 %ipx：四格同款一排，交付金额缩写 + 全值在悬停", async (w) => {
  const { page, errors } = await 打开("month", w);
  const 排 = page.locator('section[aria-label="这一段"]');
  expect(字((await 排.locator(".rkpi-k").allInnerTexts()).join("|"))).toBe("新建项目|转商机阶段|交付结清|没成");
  expect(await 排.locator(".rkpi-i", { hasText: "交付结清" }).locator(".rkpi-s").innerText()).toMatch(/亿/);
  expect(await 数字都露着(page, ".rkpi-v", ".rkpi-i")).toBe(4);
  expect(await page.locator(".data-shell-body .stat-card").count()).toBe(0);
  expect(await 不横滚(page)).toBe(true);
  expect(errors).toEqual([]); await page.close();
});

it.each([1024, 1280, 1366, 390])("沟通 %ipx：「沟通｜主题」在筛选条最左，卡头「项目沟通（1,234）」，末行灰字；不横滚", async (w) => {
  const { page, errors } = await 打开("talk", w);
  const 条 = page.locator(".rtalk-bar");
  expect(await 条.locator("> *").first().getAttribute("data-testid")).toBe("talk-kind");
  expect(await 条.locator(".ant-segmented").count()).toBe(2);
  // 卡头里不再摆「沟通｜主题」和时间段
  expect(await page.locator(".btodo-list .btodo-head [data-testid=talk-kind]").count()).toBe(0);
  const 头 = page.locator('section[aria-label="沟通记录列表"] > .btodo-head');
  expect(字(await 头.locator(".section-title").innerText())).toBe("项目沟通（1,234）");
  expect((await 头.boundingBox())!.height).toBeGreaterThanOrEqual(47.5);
  expect(字(await page.locator(".rtalk-foot").nth(1).innerText())).toBe(字("线下拜访 · 客户主动 · 附件 3 个 · 记录人1"));
  expect(await page.locator(".rblk-k-meta").count()).toBe(0);
  const 侧 = page.locator(".rtalk-side");
  // 时间线卡占满一行（3703 实操：390 被挤成 90 + 260 两列），「全部方式」下拉不伸出卡片左边
  const 量卡 = await page.evaluate(() => {
    const 卡 = document.querySelector('section[aria-label="沟通记录列表"]')!.getBoundingClientRect();
    const 正文 = document.querySelector(".app-content")!, s = getComputedStyle(正文);
    const 内宽 = 正文.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    const 下拉 = document.querySelector('section[aria-label="沟通记录列表"] .rtalk-m')!.getBoundingClientRect();
    return { 卡宽: 卡.width, 内宽, 下拉出左: 下拉.left < 卡.left - 0.5, 下拉出右: 下拉.right > 卡.right + 0.5 };
  });
  expect(量卡.下拉出左 || 量卡.下拉出右, JSON.stringify(量卡)).toBe(false);
  if (w < 768) expect(量卡.卡宽, JSON.stringify(量卡)).toBeGreaterThanOrEqual(量卡.内宽 - 1);
  if (w < 768) {
    // 390：整块收成一行
    const 行 = 侧.locator(".rtalk-side-line");
    expect(await 行.isVisible()).toBe(true);
    expect(await 行.innerText()).toBe("还有 4,567 个项目没沟通过 ›");
    expect((await 侧.boundingBox())!.height).toBeLessThanOrEqual(46);
    expect(await 侧.locator(".rtalk-miss").isVisible()).toBe(false);
  } else {
    expect(await 侧.locator(".rtalk-side-line").isVisible()).toBe(false);
    expect(字(await 侧.locator(".section-title").innerText())).toBe("还没沟通过的项目（4,567）");
    // 计数灰，不再是橙色胶囊
    expect(await 侧.locator(".rtalk-side-n").count()).toBe(0);
  }
  expect(await 不横滚(page)).toBe(true);
  expect(errors).toEqual([]); await page.close();
});

it.each([1280, 390])("主题 %ipx：筛选条最左「沟通｜主题」主题选中，卡头「教练主题（3）」", async (w) => {
  const { page, errors } = await 打开("topic", w);
  const 条 = page.locator(".rtalk-bar");
  expect(await 条.locator("> *").first().getAttribute("data-testid")).toBe("talk-kind");
  expect(await 条.locator("[data-testid=talk-kind] .ant-segmented-item-selected").innerText()).toBe("主题");
  expect(字(await page.locator('section[aria-label="教练主题列表"] .btodo-head .section-title').innerText())).toBe("教练主题（3）");
  expect(await 不横滚(page)).toBe(true);
  expect(errors).toEqual([]); await page.close();
});

it.each([1024, 1280, 1366, 390])("任务 %ipx：卡头「全部待办（45）」、到期带钟点的 smartTime + 悬停全时间、逾期 0 灰；不横滚", async (w) => {
  const { page, errors } = await 打开("todo", w);
  expect(字(await page.locator('section[aria-label="待办列表"] > .btodo-head .section-title').innerText())).toBe("全部待办（45）");
  const 时间 = page.locator(".btodo-time").first();
  // 到期带钟点（同首页待办 dashboard/todo-time 带钟点smart，11-22 总控定）
  expect(await 时间.innerText()).toMatch(/^3 天前 \d{2}:\d{2}$/);
  expect(await 时间.getAttribute("title")).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}|\d+ 月 \d+ 日/);
  const 逾期 = page.locator(".btodo-card").first();
  expect(await 逾期.getAttribute("class")).toContain("is-zero");
  const [色, 灰] = await 逾期.evaluate((e) => [getComputedStyle(e.querySelector(".home-card-v")!).color, getComputedStyle(document.documentElement).getPropertyValue("--count-fg").trim()]);
  expect(灰).not.toBe("");
  expect(色).not.toBe("rgb(0, 0, 0)");
  expect(await 不横滚(page)).toBe(true);
  expect(errors).toEqual([]); await page.close();
});

it.each([1024, 1280, 390])("任务 %ipx：只定了日子没定钟点的（明确钟点 = false、旧数据零点）不补钟点；跨年也不撑出到期列", async (w) => {
  const { page, errors } = await 打开("todo", w);
  const 时 = await page.locator(".btodo-time").allInnerTexts();
  expect(时[0]).toMatch(/^3 天前 \d{2}:\d{2}$/);
  expect(时[1]).not.toMatch(/\d{2}:\d{2}/);
  expect(时[2]).toMatch(/ \d{2}:\d{2}$/);
  // 跨年：短写「YYYY-MM-DD 09:30」（smartTime 的「2025 年 10 月 26 日 09:30」放不下）
  expect(时[3]).toBe(`${new Date().getFullYear() - 1}-10-26 09:30`);
  // 旧数据（明确钟点 = null）零点 = 只定了日子：同提醒口径（lib/reminders.ts 定了时刻），不写「00:00」
  expect(时[4]).not.toMatch(/\d{2}:\d{2}/);
  // 到期字整段在格子的内容区里：量 span 的实际宽，和 td 去掉左右内边距的宽比（行内元素的 scrollWidth / clientWidth 都是 0，量不出来）
  const 量 = await page.locator("td:has(> .btodo-time) > .btodo-time").evaluateAll((els) => els.map((e) => {
    const td = e.parentElement!, s = getComputedStyle(td);
    const 内 = td.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    return { t: (e as HTMLElement).innerText, 宽: e.getBoundingClientRect().width, 内, 高: e.getBoundingClientRect().height };
  }));
  expect(量.length).toBe(6);
  for (const x of 量) expect(x.宽 <= x.内 + 0.5 && x.高 <= 24, `「${x.t}」宽 ${x.宽.toFixed(1)} / 格内 ${x.内.toFixed(1)}`).toBe(true);
  expect(await 不横滚(page)).toBe(true);
  expect(errors).toEqual([]); await page.close();
});

it("任务看板 1280：卡上的到期也带钟点（和表格同一写法）", async () => {
  const { page, errors } = await 打开("todo", 1280, undefined, "board");
  const 时 = await page.locator(".btodo-k .btodo-time").allInnerTexts();
  expect(时.length).toBe(2);
  expect(时[0]).toMatch(/^3 天前 \d{2}:\d{2}$/);
  expect(时[1]).not.toMatch(/\d{2}:\d{2}/);
  expect(errors).toEqual([]); await page.close();
});

it("账簿主题 任务 1280：到期照旧写完整日期时间", async () => {
  const { page, errors } = await 打开("todo", 1280, "ledger");
  expect(await page.locator(".btodo-time").first().innerText()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$|\d+ 月 \d+ 日 \d{2}:\d{2}/);
  expect(errors).toEqual([]); await page.close();
});

it("任务 1280：可点卡悬停只换底，不上浮不加阴影", async () => {
  const { page } = await 打开("todo", 1280);
  const 卡 = page.locator(".btodo-card").nth(1);
  const 前 = await 卡.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, sh: getComputedStyle(e).boxShadow }));
  await 卡.hover(); await page.waitForTimeout(400);
  const 后 = await 卡.evaluate((e) => ({ tf: getComputedStyle(e).transform, bg: getComputedStyle(e).backgroundColor, sh: getComputedStyle(e).boxShadow }));
  expect(后.tf).toBe("none");
  expect(后.sh).toBe(前.sh);
  expect(后.bg).not.toBe(前.bg);
  await page.close();
});

it("换筛选时整页淡不低于 0.7；末行留 --ai-safe", async () => {
  const { page } = await 打开("talk", 390);
  const r = await page.evaluate(() => {
    const b = document.querySelector(".data-shell-body")!; b.classList.add("data-shell-pending");
    const 淡 = Number(getComputedStyle(b).opacity); b.classList.remove("data-shell-pending");
    return { 淡, 底: getComputedStyle(b).paddingBottom };
  });
  expect(r.淡).toBeGreaterThanOrEqual(0.7);
  expect(r.底).toBe("72px");
  await page.close();
});

it("账簿主题：阶段卡照旧 StatCard、「已经结束的」在卡外、按负责人全摆、漏斗数字在条上、沟通卡头照旧", async () => {
  const { page, errors } = await 打开("data", 1280, "ledger");
  expect(await page.locator('section[aria-label="各阶段"]').count()).toBe(0);
  expect(await page.locator(".data-shell-body .stat-card").count()).toBe(4);
  expect(await page.locator(".pfun-foot").count()).toBe(0);
  expect(await page.locator("p.muted", { hasText: "已经结束的" }).count()).toBe(1);
  expect(await page.locator(".pfun-bar .pfun-n").count()).toBe(4);
  expect(await page.locator(".stat-more").count()).toBe(0);
  expect(await page.locator(".ant-card", { hasText: "按负责人" }).locator(".ant-table-tbody > tr.ant-table-row:visible").count()).toBe(14);
  expect(await page.locator('section[aria-label="卡点分布"]').count()).toBe(1);
  expect(errors).toEqual([]); await page.close();
  const t = await 打开("talk", 1280, "ledger");
  expect(await t.page.locator(".rtalk-bar").count()).toBe(0);
  expect(await t.page.locator(".rblk-k-meta").count()).toBeGreaterThan(0);
  expect(await t.page.locator(".rtalk-side-n").count()).toBe(1);
  await t.page.close();
});
