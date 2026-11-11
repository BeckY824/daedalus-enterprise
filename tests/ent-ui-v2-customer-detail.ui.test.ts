/**
 * 16a 界面样板（.ui-v2，只客户列表 + 客户详情）：客户详情左栏信息显示完整。
 *
 * 改前实测（1366，管理员）：左栏卡只有 240 宽，联系人一行塞「头像 + 姓名 + 关键 + 职位 + 号码保护」不换行，
 * 姓名被挤到 1px（看不见）、电话 / 邮箱截断、备注一行五六个字。用户原话：「客户详情页感觉有些模块的显示信息都不太完整」。
 * 现在钉住：
 *   - 1024 / 1280 / 1366 左栏 ≥ 320；联系人姓名独占一行、看得见（常见长度不截；28 个字的超长名照 11-04 规矩一行省略）；
 *     电话可见宽度 > 0、整串不截、不横向溢出；整页不横滚
 *   - 备注（真 InlineField）上下排、一行至少 12 个字宽；超过 4 行收起，「展开」只展开不进编辑，再点「收起」
 *   - 沟通记录的类型筛选一行排开（不折两行），放不下横着滑
 * 渲染法照 ent-cust-detail-layout（真 RecordView，只桩服务端动作），这里不桩 InlineField。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "customer-ui-v2", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;");
  stub(/(^|\/)useTransferConfirm$/, "export const useTransferConfirm=()=>({先问转走的项目:async()=>true});");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>\"/customers/x\";");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(^|\/)(TaskForm|PlanForm|ContactForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|NewProjectModal|ContactLinks|ResearchRun|ResearchPerson)$/, "export default function Empty(){return null}");
  stub(/research\/ResearchEntry$/, "export const useResearchEntry=()=>false;");
  stub(/research\/actions$/, "export const 最近背调=async()=>null,背调价目=async()=>({可用:false,原因:'桩'});");
  stub(/^\.\/pick$/, "export const 搜客户=async()=>[];");
  stub(/^\.\/link-actions$/, "export const 关联客户=async()=>({ok:true}),改关联说明=关联客户,取消关联=关联客户;");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({问怎么拿掉(){}});");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海,退回原因选项=async()=>[];");
  stub(/^\.\.\/actions$/, "export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=async()=>({ok:true}),patchCustomer=async()=>({ok:true});");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  stub(/projects\/actions$/, "export const 项目沟通须知=async()=>({ok:true,能记:false}),记项目沟通Action=async()=>({ok:true,followUpId:'f1'});");
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
    const contacts=Array.from({length:6},(_,i)=>({id:'c'+i,name:i?'联系人'+i:长,position:'采购',phone:'+86 138-0013-80'+String(i).padStart(2,'0'),email:'buyer'+i+'@example.com',wechat:'wx_'+i,isPrimary:!i,remark:null,updatedAt:'2026-01-01T00:00:00.000Z'}));
    const tasks=Array.from({length:14},(_,i)=>({id:'t'+i,title:'待办事项'+i,dueAt:'2026-11-0'+(1+i%9)+'T02:00:00.000Z',done:false}));
    const followUps=Array.from({length:30},(_,i)=>({id:'f'+i,type:'PHONE',title:'沟通'+i,content:'谈了交期和价格，'.repeat(3),status:'已完成',duration:null,occurredAt:'2026-10-'+String(30-(i%28)).padStart(2,'0')+'T02:00:00.000Z',dueAt:null,participants:null,sourceText:null,ownerName:'QA',contactName:null,contactPosition:null,contactId:null,opportunityId:null,updatedAt:'2026-10-20T02:00:00.000Z',项目:{id:'p1',名:'项目一'}}));
    const 项目们=[{id:'p1',name:'项目一'+'很长的项目名字'.repeat(3),phase:'进行中',node:'报价',result:null,pooledAt:null,amount:120000,currency:'CNY'},{id:'p2',name:'项目二',phase:'进行中',node:'打样',result:null,pooledAt:null,amount:0,currency:'CNY'}];
    const 参与项目们=[{projectId:'p9',名:'别家的项目',主:false,身份:['终端客户']}];
    const 关联们=[{id:'l1',otherId:'b',otherName:'关联的另一位客户',看得到:true,note:'同一集团',createdAt:'2026-10-01T00:00:00.000Z'}];
    const 项目={跟进去处:[{id:'p1',名:'项目一',主:true,结束:false,说明:null,下一步:'2026-11-03T02:00:00.000Z',下一步文字:'寄样品'}],待办计划:[],followUps};
    const 名单=<aside className='pane pane-roster'><div className='pane-h'><span className='pane-t'>客户</span></div><div className='pane-rows'>{Array.from({length:40},(_,i)=><div key={i} style={{height:40}}>客户{i}</div>)}</div></aside>;
    window.__render=(ai)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><div className='shell'><nav className='rail' aria-label='主导航'/>{名单}<main className='main app-content' style={{padding:'22px 26px'}}><div><Record customer={{id:'a',extra:null,name:'客户A',phone:'13800138000',school:'某某学校',grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:window.__备注??null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z'}} contacts={contacts} contracts={[]} opportunities={[]} tasks={tasks} plan={null} users={[]} channels={[]} aiEnabled={ai} followUpsHasMore={false} 项目们={项目们} 参与项目们={参与项目们} 关联们={关联们} 旺旺们={[]} {...项目}/></div></main></div></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });


async function open(width: number, 备注: string | null = null, height = 800) {
  const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("http://cust-v2.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://cust-v2.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(b => { (window as unknown as { __备注: string | null }).__备注 = b; (window as unknown as { __render: (ai: boolean) => void }).__render(false); }, 备注);
  await page.locator(".rec-contact").first().waitFor();
  return { page, errors };
}

const 宽们 = [1024, 1280, 1366];

it("1024 / 1280 / 1366：左栏 ≥ 320；联系人姓名、电话可见、不截、不横向溢出；整页不横滚", async () => {
  for (const w of 宽们) {
    const { page, errors } = await open(w);
    try {
      expect(await page.locator(".rec-page.ui-v2").count(), `${w}`).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${w}`).toBeLessThanOrEqual(0);
      const 量 = await page.evaluate(() => {
        const 框 = (e: Element) => { const r = e.getBoundingClientRect(); return { 宽: r.width, 右: r.right, 左: r.left, sw: (e as HTMLElement).scrollWidth, cw: (e as HTMLElement).clientWidth }; };
        const 左栏 = document.querySelector(".rec > .rec-rail")!;
        return {
          左栏: 框(左栏),
          人: [...document.querySelectorAll(".rec-contact")].map(c => ({
            卡: 框(c),
            名: 框(c.querySelector(".rec-contact-n")!),
            电话: [...c.querySelectorAll(".rec-contact-line")].filter(l => l.querySelector(".rec-contact-k")?.textContent === "电话").map(l => 框(l.querySelector(".rec-contact-v")!)),
          })),
        };
      });
      expect(量.左栏.宽, `${w} 左栏`).toBeGreaterThanOrEqual(320);
      expect(量.人.length, `${w}`).toBe(6);
      for (const [i, p] of 量.人.entries()) {
        // 姓名：独占一行、看得见、不出卡；普通长度（联系人1…5）不截
        expect(p.名.宽, `${w} 联系人${i} 姓名宽`).toBeGreaterThan(200);
        if (i) expect(p.名.sw, `${w} 联系人${i} 姓名被截`).toBeLessThanOrEqual(p.名.cw + 1);
        expect(p.名.右, `${w} 联系人${i} 姓名出卡`).toBeLessThanOrEqual(p.卡.右 + 1);
        // 电话：看得见、整串放得下（+86 138-0013-8000 不打省略号）、不出卡
        expect(p.电话.length, `${w} 联系人${i}`).toBe(1);
        expect(p.电话[0].宽, `${w} 联系人${i} 电话宽`).toBeGreaterThan(0);
        expect(p.电话[0].sw, `${w} 联系人${i} 电话被截`).toBeLessThanOrEqual(p.电话[0].cw + 1);
        expect(p.电话[0].右, `${w} 联系人${i} 电话出卡`).toBeLessThanOrEqual(p.卡.右 + 1);
      }
      // 那位 28 个字的长名字：一行、带省略号（悬停看全文走全站 TruncTip），前十几个字照样看得到
      const 长名 = page.locator(".rec-contact-n", { hasText: "超长联系人名字超长联系人名字" });
      expect(await 长名.evaluate(e => { const s = getComputedStyle(e); return [s.whiteSpace, s.textOverflow, Math.round(e.getBoundingClientRect().height)]; }), `${w}`).toEqual(["nowrap", "ellipsis", 22]);
      // 各栏里没东西横着溢出
      expect(await page.evaluate(() => [...document.querySelectorAll(".rec > *, .rec-page .proj-fold .ant-card-head, .rec-page .proj-fold .ant-card-body")].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className)), `${w}`).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("1024 / 1366：备注上下排、一行至少 12 个字宽；超过 4 行收起，「展开」不进编辑，「收起」收回", async () => {
  const 长备注 = "客户希望下个月安排样品寄送，并确认交期与付款方式。".repeat(12);
  for (const w of [1024, 1366]) {
    const { page, errors } = await open(w, 长备注);
    try {
      const 格 = page.locator('.rec-field[data-field="remark"]');
      await 格.waitFor();
      const 值 = 格.locator(".rec-field-clamp");
      const 一行 = await 值.evaluate(e => e.getBoundingClientRect().width / parseFloat(getComputedStyle(e).fontSize));
      expect(一行, `${w} 一行几个字`).toBeGreaterThanOrEqual(12);
      const 收着高 = await 值.evaluate(e => e.getBoundingClientRect().height);
      expect(收着高, `${w} 收着最多 4 行`).toBeLessThanOrEqual(4 * 22 + 1);
      const 展开 = 格.getByRole("button", { name: "展开" });
      expect(await 展开.count(), `${w}`).toBe(1);
      await 展开.click();
      expect(await 格.locator("textarea").count(), `${w} 点展开不进编辑`).toBe(0);
      expect(await 值.evaluate(e => e.getBoundingClientRect().height), `${w}`).toBeGreaterThan(收着高 + 22);
      await 格.getByRole("button", { name: "收起" }).click();
      expect(await 值.evaluate(e => e.getBoundingClientRect().height), `${w}`).toBeLessThanOrEqual(4 * 22 + 1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("短备注：不出「展开」", async () => {
  const { page, errors } = await open(1366, "寄样品");
  try {
    const 格 = page.locator('.rec-field[data-field="remark"]');
    await 格.waitFor();
    expect(await 格.getByRole("button", { name: /展开|收起/ }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("1024 / 1366：沟通记录的类型筛选一行排开、不折行，放不下横着滑；选中项有底色", async () => {
  for (const w of [1024, 1366]) {
    const { page, errors } = await open(w);
    try {
      const 片 = await page.evaluate(() => {
        const 条 = document.querySelector(".rec-page .rec-filters")!;
        const 们 = [...条.querySelectorAll(".rec-chip")].map(c => c.getBoundingClientRect().top);
        const 选中 = 条.querySelector(".rec-chip-on")!;
        return { 顶们: new Set(们.map(Math.round)).size, 个: 们.length, 横滑: getComputedStyle(条).overflowX, 底: getComputedStyle(选中).backgroundColor };
      });
      expect(片.个, `${w}`).toBeGreaterThan(5);
      expect(片.顶们, `${w} 折行了`).toBe(1);
      expect(片.横滑, `${w}`).toBe("auto");
      expect(片.底, `${w}`).not.toBe("rgba(0, 0, 0, 0)");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
