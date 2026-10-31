import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* 10-31 改版 R3（客户详情）：整页不滚、页头不动；资料栏、三栏时的沟通栏各自滚且不露滚动条，
   只有最右边那条（.rec 这一格）露；左边客户名单也不露。单栏整格一起滚；手机宽还是整页滚。
   渲染照 AppShell 桌面那套 .shell > nav.rail + 名单 + main.main.app-content > 换页那层 div */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "customer-scroll-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;");
  stub(/(^|\/)InlineField$/, "export default function Inline(p){return <div className='rec-field' data-field={p.field}>{p.label}: {p.value}</div>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>\"/customers/x\";");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(^|\/)(TaskForm|PlanForm|ContactForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|LinkedCustomers|NewProjectModal|ContactLinks)$/, "export default function Empty(){return null}");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({问怎么拿掉(){}});");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海;");
  stub(/^\.\.\/actions$/, "export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false});");
  stub(/^\.\/useCustomerResearch$/, "export function CustomerResearchCard(){return null}");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  stub(/projects\/actions$/, "export const 项目沟通须知=async()=>(window.__须知??{ok:true,能记:false}),记项目沟通Action=async(id,x)=>{window.__项目存={id,...x};return{ok:true,followUpId:'f1',自动推到:window.__推到}};");
  stub(/^\.\/actions$/, `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,saveFollowUp=toggleTask,deleteFollowUp=toggleTask,restoreFollowUp=toggleTask;
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
    window.__render=()=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><div className='shell'><nav className='rail' aria-label='主导航'/>{名单}<main className='main app-content' style={{padding:'22px 26px'}}><div><Record customer={{id:'a',extra:null,name:'客户A',phone:'13800138000',school:'某某学校',grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z'}} contacts={contacts} contracts={[]} opportunities={[]} tasks={tasks} plan={null} users={[]} channels={[]} aiEnabled={false} followUps={[]} followUpsHasMore={false} 项目们={[]} 旺旺们={[]} {...项目}/></div></main></div></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(width: number, height = 560) {
  const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("http://cust-scroll.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://cust-scroll.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
  await page.locator(".rec-contact").first().waitFor();
  return { page, errors };
}
const 量 = (page: import("playwright").Page) => page.evaluate(() => {
  const q = (s: string) => document.querySelector(s) as HTMLElement;
  const 格 = q(".rec-page > .rec"), 资料 = q(".rec > .rec-rail:first-child"), 沟通 = q(".rec > .rec-col"), 右 = q(".rec > .rec-right");
  const 样 = (e: HTMLElement) => getComputedStyle(e);
  return {
    栏: 样(格).gridTemplateColumns.split(" ").length,
    页滚: document.documentElement.scrollHeight - window.innerHeight,
    横滚: document.documentElement.scrollWidth - window.innerWidth,
    头: q(".rec-head").getBoundingClientRect().top,
    格顶: 格.scrollTop, 资料顶: 资料.scrollTop, 沟通顶: 沟通.scrollTop,
    格溢: 格.scrollHeight - 格.clientHeight, 资料溢: 资料.scrollHeight - 资料.clientHeight, 沟通溢: 沟通.scrollHeight - 沟通.clientHeight,
    格滚: 样(格).overflowY, 资料滚: 样(资料).overflowY, 沟通滚: 样(沟通).overflowY,
    格条: 样(格).scrollbarWidth, 资料条: 样(资料).scrollbarWidth, 沟通条: 样(沟通).scrollbarWidth,
    名单条: 样(q(".pane-roster .pane-rows")).scrollbarWidth,
    右钉: 样(右).position,
    资料上: 资料.getBoundingClientRect().top - 格.getBoundingClientRect().top,
    资料底: 资料.getBoundingClientRect().bottom, 格底: 格.getBoundingClientRect().bottom,
  };
});
it.each([[1680, 3], [1280, 2]])("%ipx（%i 栏）：整页不滚、页头不动，资料栏各自滚不露条，只有最右那条露；名单不露", async (w, 栏数) => {
  const { page, errors } = await open(w);
  try {
    const 起 = await 量(page);
    expect(起.栏).toBe(栏数);
    expect(起.页滚).toBeLessThanOrEqual(0);
    expect(起.横滚).toBeLessThanOrEqual(0);
    expect([起.格滚, 起.资料滚]).toEqual(["auto", "auto"]);
    expect(起.格条).not.toBe("none");
    expect(起.资料条).toBe("none");
    expect(起.名单条).toBe("none");
    expect(起.右钉).toBe("static");
    expect(起.资料溢).toBeGreaterThan(0);
    expect(起.格溢).toBeGreaterThan(0);
    // 资料栏底边不超出这一格（不被裁、不顶出窗口）
    expect(起.资料底).toBeLessThanOrEqual(起.格底 + 0.5);
    expect(起.格底).toBeLessThanOrEqual(560);
    if (栏数 === 3) {
      expect(起.沟通滚).toBe("auto");
      expect(起.沟通条).toBe("none");
      expect(起.沟通溢).toBeGreaterThan(0);
    }
    // 滚资料栏：别的都不动
    await page.locator(".rec > .rec-rail:first-child").evaluate(e => { e.scrollTop = 200; });
    const 滚资料 = await 量(page);
    expect(滚资料.资料顶).toBeGreaterThan(0);
    expect([滚资料.格顶, 滚资料.沟通顶, 滚资料.头, 滚资料.页滚 <= 0]).toEqual([0, 0, 起.头, true]);
    if (栏数 === 3) {
      await page.locator(".rec > .rec-col").evaluate(e => { e.scrollTop = 200; });
      const 滚沟通 = await 量(page);
      expect(滚沟通.沟通顶).toBeGreaterThan(0);
      expect([滚沟通.格顶, 滚沟通.资料顶, 滚沟通.头]).toEqual([0, 滚资料.资料顶, 起.头]);
    }
    // 滚最右那条：页头不动，资料栏钉在这一格顶上、自己的滚动位置不变
    await page.locator(".rec-page > .rec").evaluate(e => { e.scrollTop = 300; });
    const 滚格 = await 量(page);
    expect(滚格.格顶).toBeGreaterThan(0);
    expect(滚格.头).toBe(起.头);
    expect(Math.abs(滚格.资料上)).toBeLessThanOrEqual(0.5);
    expect(滚格.资料顶).toBe(滚资料.资料顶);
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
   照 InlineField 的结构在资料栏里补一行有值、一行没填的 */
it("10-31 改版 R7：标题 26、模块标题 18、值 16 正文色、字段名 16 灰、辅助 14 灰、没填 16 浅灰、链接品牌色", async () => {
  const { page, errors } = await open(1680, 900);
  try {
    await page.evaluate(() => {
      const 栏 = document.querySelector(".rec-rail .rec-card") ?? document.querySelector(".rec-rail")!;
      栏.insertAdjacentHTML("beforeend", "<div class='rec-field' id='r7-有'><div class='rec-field-k'>渠道负责人</div><div class='rec-field-v'>0</div></div>"
        + "<div class='rec-field' id='r7-空'><div class='rec-field-k'>官网</div><div class='rec-field-v'><span class='rec-field-empty'>待填写官网</span></div></div>");
    });
    const 色 = (v: string) => page.evaluate(v => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.querySelector(".rec-page")!.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }, v);
    const 样 = (sel: string) => page.locator(sel).first().evaluate(e => { const c = getComputedStyle(e); return { 字: c.fontSize, 色: c.color }; });
    const [墨, 灰, 浅, 蓝] = [await 色("--ink"), await 色("--text-muted"), await 色("--text-faint"), await 色("--brand")];
    expect(await 样(".rec-head-name")).toEqual({ 字: "26px", 色: 墨 });
    expect(await 样(".rec-sec-t")).toEqual({ 字: "18px", 色: 墨 });
    expect(await 样("#r7-有 .rec-field-k")).toEqual({ 字: "16px", 色: 灰 });
    expect(await 样("#r7-有 .rec-field-v")).toEqual({ 字: "16px", 色: 墨 });
    expect(await 样("#r7-空 .rec-field-empty")).toEqual({ 字: "16px", 色: 浅 });
    expect(await 样(".rec-tl-time")).toEqual({ 字: "14px", 色: 灰 });
    expect(await 样(".rec-contact-p")).toEqual({ 字: "14px", 色: 灰 });
    expect((await 样(".rec-tl-content")).字).toBe("16px");
    if (await page.locator(".rec-sec-t a").count()) expect(await 样(".rec-sec-t a")).toEqual({ 字: "16px", 色: 蓝 });
    // 最长的内置字段名五个字一行放下
    expect(await page.locator("#r7-有 .rec-field-k").evaluate(e => e.getBoundingClientRect().height)).toBeLessThanOrEqual(25);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("10-31 改版 R7：字号放大后，1024 / 800 / 390 宽、超长联系人名都不横滚、不截字", async () => {
  for (const w of [1024, 800, 390]) {
    const { page, errors } = await open(w, 700);
    try {
      // 手机上 AppShell 不渲染图标栏和名单（AppShell「手机上没有图标栏和中栏」），这里照着拿掉
      if (w < 768) await page.evaluate(() => document.querySelectorAll(".shell > nav.rail, .pane-roster").forEach(e => e.remove()));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${w}`).toBe(true);
      const 溢 = await page.evaluate(() => [...document.querySelectorAll(".rec-head-name, .rec-sec-t, .rec-contact-n, .rec-field-k")].filter(e => e.scrollWidth > e.clientWidth + 1).length);
      expect(溢, `${w}`).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
