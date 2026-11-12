import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* 10-31 改版 R3（客户详情）：整页不滚、页头不动。10-31 用户：「左中右…上下滑动没有分开」「三列统一一个固定窗口大小，
   多余的内容就上下滑动……三列要分开做上下滚动」——三栏时资料、沟通、右栏一样高、各自滚，三栏都不露滚动条
   （同天「不要露滚动条」）；两栏时资料栏是一扇窗、第 2 列跟着这一格滚；
   单栏整格一起滚；手机宽还是整页滚。左边客户名单不露滚动条。
   渲染照 AppShell 桌面那套 .shell > nav.rail + 名单 + main.main.app-content > 换页那层 div */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "customer-scroll-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;");
  stub(/(^|\/)InlineField$/, "export default function Inline(p){return <div className='rec-field' data-field={p.field}>{p.label}: {p.value}</div>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>\"/customers/x\";");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(^|\/)(TaskForm|PlanForm|ContactForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|LinkedCustomers|NewProjectModal|ContactLinks)$/, "export default function Empty(){return null}");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({问怎么拿掉(){}});");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海,退回原因选项=async()=>[];");
  stub(/(^|\/)tri-state-actions$/, "export const 三态继续持有=async()=>({ok:false,error:\"\"}),三态暂缓回收=三态继续持有,三态让同事结束项目=三态继续持有;");
  stub(/^\.\.\/actions$/, "export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=async()=>({ok:true});");
  stub(/^\.\/useCustomerResearch$/, "export function CustomerResearchCard(){return null} export function CustomerResearchTag(){return null}");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  stub(/projects\/actions$/, "export const 项目沟通须知=async()=>(window.__须知??{ok:true,能记:false}),记项目沟通Action=async(id,x)=>{window.__项目存={id,...x};return{ok:true,followUpId:'f1',自动推到:window.__推到}};");
  stub(/^\.\/actions$/, `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,saveFollowUp=toggleTask,deleteFollowUp=toggleTask;
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
  
    export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'p1'});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Record from '@/app/(app)/customers/[id]/RecordView';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 长='超长联系人名字'.repeat(4);
    const contacts=Array.from({length:12},(_,i)=>({id:'c'+i,name:i?'联系人'+i:长,position:'采购',phone:'+86 138-0013-80'+String(i).padStart(2,'0'),email:'buyer'+i+'@example.com',wechat:'wx_'+i,isPrimary:!i,remark:null,updatedAt:'2026-01-01T00:00:00.000Z'}));
    const tasks=Array.from({length:14},(_,i)=>({id:'t'+i,title:'待办事项'+i,dueAt:'2026-11-0'+(1+i%9)+'T02:00:00.000Z',done:false}));
    const followUps=Array.from({length:30},(_,i)=>({id:'f'+i,type:'PHONE',title:'沟通'+i,content:'谈了交期和价格，'.repeat(3),status:'已完成',duration:null,occurredAt:'2026-10-'+String(30-(i%28)).padStart(2,'0')+'T02:00:00.000Z',dueAt:null,participants:null,sourceText:null,ownerName:'QA',contactName:null,contactPosition:null,contactId:null,opportunityId:null,updatedAt:'2026-10-20T02:00:00.000Z',项目:{id:'p1',名:'项目一'}}));
    const 项目={跟进去处:[{id:'p1',名:'项目一',主:true,结束:false,说明:null,下一步:null}],待办计划:[],followUps};
    const 名单=<aside className='pane pane-roster'><div className='pane-h'><span className='pane-t'>客户</span></div><div className='pane-rows'>{Array.from({length:80},(_,i)=><div key={i} style={{height:40}}>客户{i}</div>)}</div></aside>;
    window.__render=(fab,老)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><div className={fab?'shell has-ai-fab':'shell'}><nav className='rail' aria-label='主导航'/>{名单}<main className='main app-content' style={{padding:'22px 26px'}}><div><Record customer={{id:'a',extra:null,name:'客户A',phone:'13800138000',school:'某某学校',grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z'}} contacts={contacts} contracts={[]} opportunities={[]} tasks={tasks} plan={null} users={[]} channels={[]} aiEnabled={!!window.__ai} followUps={[]} followUpsHasMore={false} 项目们={[]} 旺旺们={[]} {...(老?{followUps}:项目)}/></div></main></div></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
/** 老 = 没开项目模式（待办在右栏、三栏）；默认企业版项目模式：待办在沟通记录下方、AI 关着时没有右栏 */
async function open(width: number, height = 560, fab = false, 老 = false, 没量 = false) {
  const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("http://cust-scroll.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://cust-scroll.test");
  // 没量：开着 AI、量宽度的 ResizeObserver 不回话——等于服务端渲染出来、页面还没接管的那一帧
  if (没量) await page.evaluate(() => { const w = window as unknown as { __ai: boolean; ResizeObserver: unknown }; w.__ai = true; w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; }); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(([f, o]) => (window as unknown as { __render: (fab: boolean, 老: boolean) => void }).__render(f, o), [fab, 老] as const);
  await page.locator(".rec-contact").first().waitFor();
  return { page, errors };
}
const 量 = (page: import("playwright").Page) => page.evaluate(() => {
  const q = (s: string) => document.querySelector(s) as HTMLElement;
  const 格 = q(".rec-page > .rec"), 资料 = q(".rec > .rec-rail:first-child"), 沟通 = q(".rec > .rec-col"), 右 = q(".rec > .rec-right") ?? 沟通, 待办 = [...document.querySelectorAll<HTMLElement>(".rec > .rec-col > .proj-fold")].find(e => e.querySelector('.proj-fold-btn[aria-label="收起待办"]')) ?? null,
    // 项目模式（11-01 起）：沟通记录、待办各是一张能收起的卡，沟通记录在卡身里滚；非项目模式还是中栏里的时间线
    记录 = (document.querySelector(".rec > .rec-col .rec-tl")?.closest(".proj-mod-body") as HTMLElement | null) ?? q(".rec > .rec-col > .rec-tl"),
    记录块 = (记录?.closest(".proj-fold") as HTMLElement | null) ?? 记录;
  const 样 = (e: HTMLElement) => getComputedStyle(e);
  return {
    栏: 样(格).gridTemplateColumns.split(" ").length,
    页滚: document.documentElement.scrollHeight - window.innerHeight,
    横滚: document.documentElement.scrollWidth - window.innerWidth,
    头: q(".rec-head").getBoundingClientRect().top,
    格顶: 格.scrollTop, 资料顶: 资料.scrollTop, 沟通顶: 沟通.scrollTop, 右顶: 右.scrollTop, 高: [资料, 沟通, 右].map(e => Math.round(e.getBoundingClientRect().height)), 格高: Math.round(格.clientHeight),
    格溢: 格.scrollHeight - 格.clientHeight, 资料溢: 资料.scrollHeight - 资料.clientHeight, 沟通溢: 沟通.scrollHeight - 沟通.clientHeight,
    格滚: 样(格).overflowY, 资料滚: 样(资料).overflowY, 沟通滚: 样(沟通).overflowY, 记录滚: 记录 ? 样(记录).overflowY : null, 右滚: 样(右).overflowY,
    格条: 样(格).scrollbarWidth, 资料条: 样(资料).scrollbarWidth, 沟通条: 样(沟通).scrollbarWidth, 右条: 样(右).scrollbarWidth,
    沟通上: 沟通.getBoundingClientRect().top - 格.getBoundingClientRect().top,
    名单条: 样(q(".pane-roster .pane-rows")).scrollbarWidth,
    右钉: 样(右).position,
    资料上: 资料.getBoundingClientRect().top - 格.getBoundingClientRect().top,
    资料底: 资料.getBoundingClientRect().bottom, 格底: 格.getBoundingClientRect().bottom, 右底: 右.getBoundingClientRect().bottom,
    有右栏: !!q(".rec > .rec-right"), 沟通自滚: 样(沟通).overflowY === "auto",
    待办: 待办 && { 左: Math.round(待办.getBoundingClientRect().left), 右: Math.round(待办.getBoundingClientRect().right), 底: 待办.getBoundingClientRect().bottom, 上: 待办.getBoundingClientRect().top, 滚: 样(待办).overflowY },
    资料左: Math.round(资料.getBoundingClientRect().left), 沟通左: Math.round(沟通.getBoundingClientRect().left), 沟通右: Math.round(沟通.getBoundingClientRect().right),
    记录底: 记录块 ? 记录块.getBoundingClientRect().bottom : 0, 待办在中栏: !!待办 && 沟通.contains(待办), 沟通底: 沟通.getBoundingClientRect().bottom,
    底: 格.getBoundingClientRect().bottom,
  };
});
it("1680px（3 栏，没开项目模式）：资料、沟通、右栏一样高的窗口、各自滚，滚一栏别的不动、页头不动；只有最右栏露一条细滚动条", async () => {
  const { page, errors } = await open(1680, 560, false, true);
  try {
    const 起 = await 量(page);
    expect(起.栏).toBe(3);
    expect(起.页滚).toBeLessThanOrEqual(0);
    expect(起.横滚).toBeLessThanOrEqual(0);
    expect([起.资料滚, 起.沟通滚, 起.右滚]).toEqual(["auto", "auto", "auto"]);
    // 三栏都自己滚，这一格本身没东西可滚
    expect(起.格溢).toBeLessThanOrEqual(1);
    expect(起.资料溢).toBeGreaterThan(0);
    expect(起.沟通溢).toBeGreaterThan(0);
    expect(起.右底).toBeLessThanOrEqual(560);
    expect(起.名单条).toBe("none");
    // 三栏一样高，都是这一格的可见高度（右栏内容短也不缩）；11-01 用户「右侧只需要一个整体页面的上下滚动条」：只最右栏露细条
    expect(起.高).toEqual([起.格高, 起.格高, 起.格高]);
    expect([起.资料条, 起.沟通条, 起.右条]).toEqual(["none", "none", "thin"]);
    // 资料栏滚到底，最后一样东西露在窗里，不被截
    await page.locator(".rec > .rec-rail:first-child").evaluate(e => { e.scrollTop = e.scrollHeight; });
    expect(await page.locator(".rec > .rec-rail:first-child").evaluate(e => { const r = e.getBoundingClientRect(); const 末 = [...e.querySelectorAll("*")].filter(x => (x as HTMLElement).offsetParent && !x.children.length).pop()!; return 末.getBoundingClientRect().bottom <= r.bottom + 1; })).toBe(true);
    await page.locator(".rec > .rec-rail:first-child").evaluate(e => { e.scrollTop = 0; });
    for (const [栏, 键] of [[".rec > .rec-rail:first-child", "资料顶"], [".rec > .rec-col", "沟通顶"], [".rec > .rec-right", "右顶"]] as const) {
      await page.locator(栏).evaluate(e => { e.scrollTop = 200; });
      const 滚 = await 量(page);
      expect(滚[键], 栏).toBeGreaterThan(0);
      const 别的 = (["资料顶", "沟通顶", "右顶"] as const).filter(k => k !== 键);
      expect([...别的.map(k => 滚[k]), 滚.格顶, 滚.头], 栏).toEqual([0, 0, 0, 起.头]);
      await page.locator(栏).evaluate(e => { e.scrollTop = 0; });
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* U-客户-03：背调去左栏，右栏只剩 AI；AI 关着就不留空栏，资料、沟通两栏。11-01 用户：「待办模块放到沟通记录下方，而不是整体下方。」 */
it("1680px 项目模式、AI 关着：没有空右栏，资料、沟通两栏一样高、各自滚；待办在沟通记录下方、沟通栏里；沟通、待办自己不滚，整栏一条滚动条", async () => {
  const { page, errors } = await open(1680, 760);
  try {
    const 起 = await 量(page);
    expect(起.有右栏).toBe(false);
    expect(起.栏).toBe(2);
    expect(起.页滚).toBeLessThanOrEqual(0);
    expect(起.横滚).toBeLessThanOrEqual(0);
    // 11-01 起项目模式中栏是一列卡（沟通记录、待办各一张、和项目详情页一样）。同天用户「沟通页内的滚动条要隐藏」「待办也是」
    // 「右侧只需要一个整体页面的上下滚动条」：卡身不再自己滚，滚的是整栏，最右这栏露一条细滚动条
    expect([起.资料滚, 起.沟通滚, 起.记录滚]).toEqual(["auto", "auto", "visible"]);
    expect([起.资料条, 起.沟通条]).toEqual(["none", "thin"]);
    expect(起.高.slice(0, 2)).toEqual([起.格高, 起.格高]);
    expect(起.格溢).toBeLessThanOrEqual(1);
    expect(起.待办).not.toBeNull();
    const 待办 = 起.待办!;
    expect(起.待办在中栏).toBe(true);
    expect(待办.上).toBeGreaterThanOrEqual(起.记录底 - 1);
    expect(待办.左).toBeGreaterThanOrEqual(起.沟通左);
    expect(待办.右).toBeLessThanOrEqual(起.沟通右);
    // 沟通记录卡身没有自己的滚动（原来限高 60vh、滚到底不往外传，鼠标停在上面整栏拉不下去，11-01 用户「客户详情页右边我都拉不下去看待办」）
    expect(await page.locator(".rec > .rec-col .proj-mod-body:has(.rec-tl)").evaluate(e => { const c = getComputedStyle(e); return [c.overflowY, c.maxHeight]; })).toEqual(["visible", "none"]);
    // 鼠标停在沟通记录上往下滚：整栏往下走，一路滚到待办露出来；资料栏、整格、页头不动
    const 卡 = await page.locator(".rec > .rec-col .rec-tl").first().boundingBox();
    await page.mouse.move(卡!.x + 40, 卡!.y + 40);
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 400);
    await page.waitForFunction(() => { const c = document.querySelector(".rec > .rec-col") as HTMLElement; return c.scrollTop >= c.scrollHeight - c.clientHeight - 1; });
    const 滚 = await 量(page);
    expect([滚.沟通顶 > 0, 滚.资料顶, 滚.格顶, 滚.头]).toEqual([true, 0, 0, 起.头]);
    expect(滚.待办!.底).toBeLessThanOrEqual(滚.沟通底 + 1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("1280px（2 栏）：资料栏自己滚、不跟第 2 列走；第 2 列跟着这一格滚，页头不动", async () => {
  const { page, errors } = await open(1280);
  try {
    const 起 = await 量(page);
    expect(起.栏).toBe(2);
    expect(起.页滚).toBeLessThanOrEqual(0);
    expect(起.横滚).toBeLessThanOrEqual(0);
    expect([起.格滚, 起.资料滚]).toEqual(["auto", "auto"]);
    // 第 2 列跟着整格滚，露整格的细滚动条（11-01「右侧只需要一个整体页面的上下滚动条」）
    expect(起.格条).toBe("thin");
    expect(起.资料条).toBe("none");
    expect(起.高[0]).toBe(起.格高);
    expect(起.资料溢).toBeGreaterThan(0);
    expect(起.格溢).toBeGreaterThan(0);
    await page.locator(".rec > .rec-rail:first-child").evaluate(e => { e.scrollTop = 200; });
    const 滚资料 = await 量(page);
    expect([滚资料.资料顶 > 0, 滚资料.格顶, 滚资料.头]).toEqual([true, 0, 起.头]);
    await page.locator(".rec > .rec-rail:first-child").evaluate(e => { e.scrollTop = 0; });
    await page.locator(".rec-page > .rec").evaluate(e => { e.scrollTop = 300; });
    const 滚格 = await 量(page);
    expect(滚格.格顶).toBeGreaterThan(0);
    expect(滚格.头).toBe(起.头);
    // 资料栏钉在这一格顶上不动，第 2 列往上走
    expect(Math.abs(滚格.资料上 - 起.资料上)).toBeLessThanOrEqual(24);
    expect(滚格.沟通上).toBeLessThan(起.沟通上 - 100);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("800px 退成一栏：整页不滚，整格一起滚、页头不动；390 手机宽还是整页滚", async () => {
  const { page, errors } = await open(800);
  try {
    const 起 = await 量(page);
    expect(起.栏).toBe(1);
    expect(起.页滚).toBeLessThanOrEqual(0);
    expect(起.资料滚).toBe("visible");
    await page.locator(".rec-page > .rec").evaluate(e => { e.scrollTop = 400; });
    const 滚 = await 量(page);
    expect(滚.格顶).toBeGreaterThan(0);
    expect(滚.头).toBe(起.头);
    await page.setViewportSize({ width: 390, height: 700 });
    const 手机 = await 量(page);
    expect(手机.格滚).toBe("visible");
    expect(手机.页滚).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* 10-31 改版 R7：和项目详情同一套字阶（ent-project-detail.ui 里同样的数）。档案字段这里是桩，
   照 InlineField 的结构在资料栏里补一行有值、一行没填的。
   16a 界面样板（.ui-v2）起客户详情回到全站六档：标题 22、模块标题 15、值 14、字段名 13、辅助 13
   （原来大一号的 26 / 18 / 16 / 16 / 14 和列表页 22 / 15 / 14 不是一套）；项目详情（.proj-wrap）不在样板里，照旧大一号 */
it("10-31 改版 R7（16a 样板回六档）：标题 22、模块标题 15、值 14 正文色、字段名 13 灰、辅助 13 灰、没填 14 浅灰、链接品牌色", async () => {
  const { page, errors } = await open(1680, 900);
  try {
    await page.evaluate(() => {
      const 栏 = document.querySelector(".rec-rail .rec-mod > .ant-card-body") ?? document.querySelector(".rec-rail .rec-card") ?? document.querySelector(".rec-rail")!;
      栏.insertAdjacentHTML("beforeend", "<div class='rec-field' id='r7-有'><div class='rec-field-k'>渠道负责人</div><div class='rec-field-v'>0</div></div>"
        + "<div class='rec-field' id='r7-空'><div class='rec-field-k'>官网</div><div class='rec-field-v'><span class='rec-field-empty'>待填写官网</span></div></div>");
    });
    const 色 = (v: string) => page.evaluate(v => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.querySelector(".rec-page")!.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }, v);
    const 样 = (sel: string) => page.locator(sel).first().evaluate(e => { const c = getComputedStyle(e); return { 字: c.fontSize, 色: c.color }; });
    const [墨, 灰, 浅, 蓝] = [await 色("--ink"), await 色("--text-muted"), await 色("--text-faint"), await 色("--brand")];
    expect(await 样(".rec-head-name")).toEqual({ 字: "22px", 色: 墨 });
    // 项目模式（11-01 起）模块是卡，模块标题在卡头
    expect(await 样(".rec-sec-t, .rec-mod > .ant-card-head")).toEqual({ 字: "15px", 色: 墨 });
    expect(await 样("#r7-有 .rec-field-k")).toEqual({ 字: "13px", 色: 灰 });
    expect(await 样("#r7-有 .rec-field-v")).toEqual({ 字: "14px", 色: 墨 });
    expect(await 样("#r7-空 .rec-field-empty")).toEqual({ 字: "14px", 色: 浅 });
    expect(await 样(".rec-tl-time")).toEqual({ 字: "13px", 色: 灰 });
    expect(await 样(".rec-contact-p")).toEqual({ 字: "13px", 色: 灰 });
    expect((await 样(".rec-tl-content")).字).toBe("14px");
    const 链 = ".rec-sec-t a, .rec-mod > .ant-card-head .ant-card-extra a";
    if (await page.locator(链).count()) expect(await 样(链)).toEqual({ 字: "14px", 色: 蓝 });
    // 最长的内置字段名五个字一行放下
    expect(await page.locator("#r7-有 .rec-field-k").evaluate(e => e.getBoundingClientRect().height)).toBeLessThanOrEqual(25);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// 11-04 用户改了规矩：「尽量所有信息都在一行显示完整」「一行显示不下的用... 但是悬浮要做好，鼠标移上去可以看完整。」
// 超长名字不再折行：一行 + 省略号，页面照旧不许横滚
it("10-31 改版 R7（11-04 改一行）：字号放大后，1024 / 800 / 390 宽、超长联系人名都不横滚，放不下的一行带省略号", async () => {
  for (const w of [1024, 800, 390]) {
    const { page, errors } = await open(w, 700);
    try {
      // 手机上 AppShell 不渲染图标栏和名单（AppShell「手机上没有图标栏和中栏」），这里照着拿掉
      if (w < 768) await page.evaluate(() => document.querySelectorAll(".shell > nav.rail, .pane-roster").forEach(e => e.remove()));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${w}`).toBe(true);
      const 溢 = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".rec-head-name, .rec-sec-t, .rec-mod .ant-card-head-title, .rec-contact-n, .rec-field-k")]
        .filter(e => e.scrollWidth > e.clientWidth + 1)
        .filter(e => { const s = getComputedStyle(e); return !(s.textOverflow === "ellipsis" && s.whiteSpace === "nowrap"); })
        .map(e => e.className + " | " + e.innerText.slice(0, 12)));
      expect(溢, `${w}`).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

/* 10-31 用户：「现在就是一开始就要往下滑才能看到。我要整个页面本来就有显示。」——真机上 shell 带 has-ai-fab（右下角 AI 浮标），
   正文底下给浮标让的 88px 把三栏整个顶短，栏底下空一截灰。详情页不让这 88：栏铺到窗口底（只留正文原本的 22），
   让位挪进各栏自己的滚动里，滚到底最后一张卡停在浮标上面 */
it("带 AI 浮标：1024 / 1280 / 1366 / 1680 宽栏都铺到窗口底，整页、横向都不滚；滚到底最后一张卡在浮标上面", async () => {
  for (const w of [1024, 1280, 1366, 1680]) {
    const { page, errors } = await open(w, 760, true);
    try {
      const 起 = await 量(page);
      const 高 = 760;
      expect(起.页滚, `${w}`).toBeLessThanOrEqual(0);
      expect(起.横滚, `${w}`).toBeLessThanOrEqual(0);
      // 栏铺到这一格底（项目模式待办在沟通栏里，11-01）
      expect(起.底, `${w}`).toBeGreaterThanOrEqual(高 - 24);
      expect(起.资料底, `${w}`).toBeGreaterThanOrEqual(起.格底 - 1);
      if (起.栏 === 3) expect(起.右底, `${w}`).toBeGreaterThanOrEqual(高 - 24);
      // 自己滚的栏滚到底：最后一个子元素离栏底至少 60（浮标 52 高、离窗口底 24）
      const 滚的 = 起.栏 === 3 ? [".rec > .rec-rail:first-child", ".rec > .rec-col", ".rec > .rec-right"] : 起.沟通自滚 ? [".rec > .rec-rail:first-child", ".rec > .rec-col"] : [".rec > .rec-rail:first-child", ".rec-page > .rec"];
      for (const s of 滚的) {
        const 留 = await page.locator(s).evaluate(e => {
          e.scrollTop = e.scrollHeight;
          const 栏 = e.classList.contains("rec") ? e.querySelector(":scope > .rec-col")! : e;
          const 最后 = 栏.lastElementChild!;
          return Math.min(e.getBoundingClientRect().bottom, window.innerHeight) - 最后.getBoundingClientRect().bottom;
        });
        expect(留, `${w} ${s}`).toBeGreaterThanOrEqual(60);
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("带 AI 浮标、反馈提示出着：栏照样铺到底，滚到底让出提示的高度", async () => {
  const { page, errors } = await open(1680, 760, true);
  try {
    await page.evaluate(() => { document.documentElement.classList.add("fbt-room"); document.documentElement.style.setProperty("--fbt-room", "120px"); });
    const 起 = await 量(page);
    expect(起.页滚).toBeLessThanOrEqual(0);
    expect(起.底).toBeGreaterThanOrEqual(760 - 24);
    const 留 = await page.locator(".rec > .rec-rail:first-child").evaluate(e => { e.scrollTop = e.scrollHeight; return e.getBoundingClientRect().bottom - e.lastElementChild!.getBoundingClientRect().bottom; });
    expect(留).toBeGreaterThanOrEqual(116);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* 11-11 用户：「沟通记录模块，目前是无限长度。但是我需要你给他设一个最长的长度（整页显示上给待办留位置）。多的就在模块内上下移动。」
   项目模式 30 条沟通：三档常见笔记本窗口下，首屏同时看得到沟通记录卡头 + 筛选行和待办卡标题；记录列表在卡里滚，卡头、筛选行不动；
   列表滚到底再滚交给整栏（不套死，11-01 拿掉 60vh 限高就是因为滚不下去） */
for (const [w, h] of [[1366, 768], [1280, 720], [1440, 900]] as const) {
  it(`${w}×${h} 项目模式 30 条沟通：沟通记录限高、列表卡内滚，待办标题在首屏；列表滚到底整栏接着滚`, async () => {
    const { page, errors } = await open(w, h);
    try {
      const 量2 = () => page.evaluate(() => {
        const 栏 = document.querySelector(".rec > .rec-col") as HTMLElement;
        const 列表 = 栏.querySelector(".proj-mod-body > .rec-tl") as HTMLElement;
        const 沟通卡 = 列表.closest(".ant-card") as HTMLElement;
        const 待办 = [...栏.querySelectorAll<HTMLElement>(".proj-fold")].find(e => e.querySelector('.proj-fold-btn[aria-label="收起待办"]'))!;
        const 待办头 = (待办.querySelector(".ant-card-head") ?? 待办) as HTMLElement;
        const 栏框 = 栏.getBoundingClientRect();
        return {
          列表滚: getComputedStyle(列表).overflowY, 列表溢: 列表.scrollHeight - 列表.clientHeight, 列表顶: 列表.scrollTop, 栏顶: 栏.scrollTop,
          卡头顶: (沟通卡.querySelector(".ant-card-head") as HTMLElement).getBoundingClientRect().top, 筛选顶: (沟通卡.querySelector(".rec-filters") as HTMLElement).getBoundingClientRect().top,
          待办头底: 待办头.getBoundingClientRect().bottom, 栏底: Math.min(栏框.bottom, window.innerHeight), 栏上: 栏框.top,
          横滚: document.documentElement.scrollWidth - window.innerWidth, 页滚: document.documentElement.scrollHeight - window.innerHeight,
        };
      });
      const 起 = await 量2();
      expect([起.横滚 <= 0, 起.页滚 <= 0]).toEqual([true, true]);
      expect(起.列表滚).toBe("auto");
      expect(起.列表溢).toBeGreaterThan(0);
      // 待办卡标题整条落在这一栏的可见窗里（不用先把沟通记录滚完）
      expect(起.待办头底).toBeLessThanOrEqual(起.栏底);
      expect(起.卡头顶).toBeGreaterThanOrEqual(起.栏上 - 1);
      // 滚记录列表：卡头、筛选行不动，整栏不动
      await page.locator(".rec > .rec-col .proj-mod-body > .rec-tl").evaluate(e => { e.scrollTop = 300; });
      const 滚 = await 量2();
      expect(滚.列表顶).toBeGreaterThan(0);
      expect([滚.卡头顶, 滚.筛选顶, 滚.栏顶]).toEqual([起.卡头顶, 起.筛选顶, 起.栏顶]);
      // 列表到底以后，鼠标停在列表上接着滚：交给整栏（不套死）
      await page.locator(".rec > .rec-col .proj-mod-body > .rec-tl").evaluate(e => { e.scrollTop = e.scrollHeight; });
      const 框 = await page.locator(".rec > .rec-col .proj-mod-body > .rec-tl").boundingBox();
      await page.mouse.move(框!.x + 40, 框!.y + 40);
      // 滚轮一格一格停顿着滚（Chrome 一串连续滚轮锁在开头那层，停一下新的一串才交给外层；人手滚就是这样）
      for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(150); }
      // 三栏时沟通栏自己滚，两栏时（容器 < 1090）第 2 列跟着整格滚：哪一层往下走了都算接上
      await page.waitForFunction(() => (document.querySelector(".rec > .rec-col") as HTMLElement).scrollTop + (document.querySelector(".rec-page > .rec") as HTMLElement).scrollTop > 0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

/* 11-11 3702 真页面：打开后沟通记录先空 4～6 秒（第一屏记录做淡入，服务端渲染出来是透明的，要等页面接管）；
   两栏时右边沟通卡比左边资料卡低一截（还没量到宽度时右栏那张猜着摆的 AI 栏藏着、却占了第一行）。
   这里停在「没量到」那一帧看：记录一出来就不透明，两栏第一张卡同一条顶线 */
for (const w of [1024, 1366]) {
  it(`${w}px 页面还没接管那一帧：沟通记录和卡头同时出现（不透明），资料、沟通两栏顶线齐`, async () => {
    const { page, errors } = await open(w, 768, false, false, true);
    try {
      const v = await page.evaluate(() => {
        const 项 = document.querySelector(".rec > .rec-col .rec-tl .rec-tl-item") as HTMLElement;
        const 首 = (s: string) => (document.querySelector(s) as HTMLElement).getBoundingClientRect().top;
        return { 透明: getComputedStyle(项).opacity, 左: Math.round(首(".rec > .rec-rail:first-child > .proj-fold")), 右: Math.round(首(".rec > .rec-col > .proj-fold")), 右栏: !!document.querySelector(".rec > .rec-right") };
      });
      expect(v.右栏).toBe(true); // 确实停在「没量到」那一帧：猜着摆的右栏在
      expect(v.透明).toBe("1");
      expect(v.右).toBe(v.左);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}
