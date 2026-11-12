import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
/* 11-01 用户：「客户详情页的整体设计要像项目详情页靠齐……客户详情页各个模块都要分开，和项目详情页一致。
   你看待办板块你就和沟通记录放一起了。另外模块的收起和新增都参考项目详情页的设计。」
   企业版项目模式客户页：每个模块一张卡、包 ProjectFold（卡头最右一颗收起钮），新增按钮摆在卡头 extra（标题 + 计数在左、按钮在右、收起钮最右）；
   待办单独一张卡，不在沟通记录卡里。照 ent-customer-detail-scroll 的渲染法，关联客户、客户背调用真组件（只桩掉服务端动作） */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "customer-modules", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;");
  stub(/(^|\/)InlineField$/, "export default function Inline(p){return <div className='rec-field' data-field={p.field}>{p.label}: {p.value}</div>}");
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
  stub(/(^|\/)tri-state-actions$/, "export const 三态继续持有=async()=>({ok:false,error:\"\"}),三态暂缓回收=三态继续持有,三态让同事结束项目=三态继续持有;");
  stub(/^\.\.\/actions$/, "export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=async()=>({ok:true});");
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
    window.__render=(ai)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><div className='shell'><nav className='rail' aria-label='主导航'/>{名单}<main className='main app-content' style={{padding:'22px 26px'}}><div><Record customer={{id:'a',extra:null,name:'客户A',phone:'13800138000',school:'某某学校',grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z'}} contacts={contacts} contracts={[]} opportunities={[]} tasks={tasks} plan={null} users={[]} channels={[]} aiEnabled={ai} followUpsHasMore={false} 项目们={项目们} 参与项目们={参与项目们} 关联们={关联们} 旺旺们={[]} {...项目}/></div></main></div></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number, height = 800, ai = false) {
  const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("http://cust-modules.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://cust-modules.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(a => (window as unknown as { __render: (ai: boolean) => void }).__render(a), ai);
  await page.locator(".rec-contact").first().waitFor();
  return { page, errors };
}

/** 页上各模块：收起钮上的名字、所在栏、外框 */
const 模块们 = (page: Page) => page.evaluate(() => [...document.querySelectorAll(".rec-page .proj-fold")].map(f => {
  const r = f.getBoundingClientRect();
  const 栏 = f.closest(".rec > *");
  return {
    名: (f.querySelector(":scope > .proj-fold-btn, :scope > .ant-card > .ant-card-head .split-caret")?.getAttribute("aria-label") ?? "").replace(/^(收起|展开)/, ""),
    栏: 栏?.classList.contains("rec-col") ? "中" : 栏?.classList.contains("rec-right") ? "右" : "左",
    左: r.left, 右: r.right, 上: r.top, 下: r.bottom,
  };
}));

const 宽们 = [1024, 1280, 1366];
const 该有 = ["基本资料", "联系人", "项目", "参与的项目", "关联客户", "沟通记录", "待办"];

it("1024 / 1280 / 1366：每个模块各一张卡、都有收起钮；待办单独一张卡，不在沟通记录卡里", async () => {
  for (const w of 宽们) {
    const { page, errors } = await open(w);
    try {
      const 有 = await 模块们(page);
      expect(有.map(m => m.名), `${w}`).toEqual(expect.arrayContaining(该有));
      // 每层壳里正好一张卡、一颗收起钮
      expect(await page.evaluate(() => [...document.querySelectorAll(".rec-page .proj-fold")].every(f => f.querySelectorAll(":scope > .ant-card").length === 1 && f.querySelectorAll(":scope > .proj-fold-btn, :scope > .ant-card > .ant-card-head .split-caret").length === 1)), `${w}`).toBe(true);
      const 待办 = page.locator(".proj-fold", { has: page.getByRole("button", { name: "收起待办" }) });
      const 沟通 = page.locator(".proj-fold", { has: page.getByRole("button", { name: "收起沟通记录" }) });
      // 待办和沟通记录是两张卡，互不包含
      expect(await 沟通.locator(".proj-fold").count(), `${w}`).toBe(0);
      expect(await 沟通.getByRole("button", { name: /新建待办/ }).count(), `${w}`).toBe(0);
      expect(await 待办.getByRole("button", { name: /新建待办/ }).count(), `${w}`).toBe(1);
      expect(await 待办.locator(".rec-task").count(), `${w}`).toBeGreaterThan(10);
      // 待办摆在沟通记录下方、同一栏
      const 中 = 有.filter(m => m.栏 === "中").map(m => m.名);
      expect(中, `${w}`).toEqual(["沟通记录", "待办"]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("1024 / 1280 / 1366：卡头标题 + 计数在左，新增按钮在右，收起钮在最右，互不压；计数照项目详情写（n）", async () => {
  for (const w of 宽们) {
    const { page, errors } = await open(w);
    try {
      const 头们 = await page.evaluate(() => [...document.querySelectorAll(".rec-page .proj-fold")].map(f => {
        const 卡 = f.querySelector(":scope > .ant-card")!;
        const 题 = 卡.querySelector(":scope > .ant-card-head .ant-card-head-title");
        const 加 = 卡.querySelector(":scope > .ant-card-head .ant-card-extra");
        const 钮 = f.querySelector(":scope > .proj-fold-btn, :scope > .ant-card > .ant-card-head .split-caret")!.getBoundingClientRect();
        const 头 = 卡.querySelector(":scope > .ant-card-head")!.getBoundingClientRect();
        const r = (e: Element | null) => e && e.getBoundingClientRect();
        return { 连: f.classList.contains("has-split"), 名: f.querySelector(":scope > .proj-fold-btn, :scope > .ant-card > .ant-card-head .split-caret")!.getAttribute("aria-label"), 题字: 题?.textContent ?? "", 题: r(题), 加: r(加), 钮: { l: 钮.left, r: 钮.right, t: 钮.top, b: 钮.bottom }, 头: { l: 头.left, r: 头.right, t: 头.top, b: 头.bottom }, 题截: 题 ? 题.scrollWidth > 题.clientWidth + 1 : false };
      }));
      for (const h of 头们) {
        // 收起钮在卡头里、最右
        expect(h.钮.t, `${w} ${h.名}`).toBeGreaterThanOrEqual(h.头.t);
        expect(h.钮.b, `${w} ${h.名}`).toBeLessThanOrEqual(h.头.b + 1);
        expect(h.钮.r, `${w} ${h.名}`).toBeLessThanOrEqual(h.头.r);
        if (h.连) {
          // 连体：收起并进卡头那颗连体按钮的右半，标题在它左边
          expect(h.题!.right, `${w} ${h.名} 标题在连体钮左边`).toBeLessThanOrEqual(h.加!.left + 1);
        } else if (h.加) {
          expect(h.加.right, `${w} ${h.名} 新增钮在收起钮左边`).toBeLessThanOrEqual(h.钮.l + 1);
          expect(h.题!.right, `${w} ${h.名} 标题在新增钮左边`).toBeLessThanOrEqual(h.加.left + 1);
        } else {
          expect(h.题!.right, `${w} ${h.名}`).toBeLessThanOrEqual(h.钮.l + 1);
        }
        expect(h.题截, `${w} ${h.名} 标题不截字`).toBe(false);
      }
      const 题 = Object.fromEntries(头们.map(h => [h.名!.replace(/^收起/, ""), h.题字]));
      expect(题["联系人"]).toBe("联系人（6）");
      expect(题["项目"]).toBe("项目（2）");
      expect(题["关联客户"]).toBe("关联客户（1）");
      expect(题["待办"]).toMatch(/^待办（15）$/);
      expect(题["沟通记录"]).toBe("沟通记录（30）");
      // 新增按钮跟项目详情一样摆在卡头：沟通记录「新建沟通」、待办「新建待办」、关联客户「关联」
      const 卡头钮 = (名: string, 钮: RegExp) => page.locator(".proj-fold", { has: page.getByRole("button", { name: `收起${名}` }) }).locator(".ant-card-head .ant-card-extra").getByRole("button", { name: 钮 }).count();
      expect(await 卡头钮("沟通记录", /新建沟通/), `${w}`).toBe(1);
      expect(await 卡头钮("待办", /新建待办/), `${w}`).toBe(1);
      expect(await 卡头钮("关联客户", /关联/), `${w}`).toBe(1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("1024 / 1280 / 1366：点收起只藏卡身、留卡头，再点又摊开；每个模块都能收", async () => {
  for (const w of 宽们) {
    const { page, errors } = await open(w);
    try {
      const 名们 = (await 模块们(page)).map(m => m.名);
      for (const 名 of 名们) {
        const 壳 = page.locator(".proj-fold", { has: page.getByRole("button", { name: `收起${名}` }) });
        const 身 = 壳.locator(":scope > .ant-card > .ant-card-body");
        const 头 = 壳.locator(":scope > .ant-card > .ant-card-head");
        expect(await 身.isVisible(), `${w} ${名}`).toBe(true);
        const 开高 = (await 壳.boundingBox())!.height;
        await 壳.getByRole("button", { name: `收起${名}` }).click();
        const 收 = page.locator(".proj-fold", { has: page.getByRole("button", { name: `展开${名}` }) });
        expect(await 收.locator(":scope > .ant-card > .ant-card-body").isVisible(), `${w} ${名}`).toBe(false);
        expect(await 收.locator(":scope > .ant-card > .ant-card-head").isVisible(), `${w} ${名}`).toBe(true);
        expect((await 收.boundingBox())!.height, `${w} ${名}`).toBeLessThan(开高);
        await 收.getByRole("button", { name: `展开${名}` }).click();
        expect(await 头.isVisible(), `${w} ${名}`).toBe(true);
        expect(await 身.isVisible(), `${w} ${名}`).toBe(true);
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("1024 / 1280 / 1366：不横滚、卡不出栏、模块互不重叠", async () => {
  for (const w of 宽们) {
    const { page, errors } = await open(w);
    try {
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${w}`).toBeLessThanOrEqual(0);
      // 各栏里没东西横着溢出
      expect(await page.evaluate(() => [...document.querySelectorAll(".rec > *, .rec-page .proj-fold .ant-card-head, .rec-page .proj-fold .ant-card-body")].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className)), `${w}`).toEqual([]);
      const 有 = await 模块们(page);
      const 栏框 = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".rec > *")].map(e => { const r = e.getBoundingClientRect(); return [e.classList.contains("rec-col") ? "中" : e.classList.contains("rec-right") ? "右" : "左", { 左: r.left, 右: r.right }]; })));
      for (const m of 有) {
        expect(m.左, `${w} ${m.名}`).toBeGreaterThanOrEqual(栏框[m.栏].左 - 1);
        expect(m.右, `${w} ${m.名}`).toBeLessThanOrEqual(栏框[m.栏].右 + 1);
      }
      for (let i = 0; i < 有.length; i++) for (let j = i + 1; j < 有.length; j++) {
        const [a, c] = [有[i], 有[j]];
        const 叠 = Math.min(a.右, c.右) - Math.max(a.左, c.左) > 1 && Math.min(a.下, c.下) - Math.max(a.上, c.上) > 1;
        expect(叠, `${w} ${a.名} × ${c.名}`).toBe(false);
      }
      // 同一栏的卡之间留缝（和项目详情一样 12～16）
      for (const 栏 of ["左", "中"]) {
        const 列 = 有.filter(m => m.栏 === 栏).sort((a, c) => a.上 - c.上);
        for (let i = 1; i < 列.length; i++) expect(列[i].上 - 列[i - 1].下, `${w} ${列[i - 1].名} → ${列[i].名}`).toBeGreaterThanOrEqual(10);
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("开了 AI：客户背调也是一张能收的卡，状态标签在卡里", async () => {
  const { page, errors } = await open(1366, 800, true);
  try {
    const 名们 = (await 模块们(page)).map(m => m.名);
    expect(名们).toContain("客户背调");
    const 壳 = page.locator(".proj-fold", { has: page.getByRole("button", { name: "收起客户背调" }) });
    expect(await 壳.locator(".ant-card-head-title").textContent()).toBe("客户背调");
    expect(await 壳.locator(".rec-research-tag").textContent()).toBe("无");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
