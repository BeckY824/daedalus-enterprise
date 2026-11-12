import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
/* 11-12 客户详情合并第 2 批（定稿 UI 客户详情-定稿UI-20261112.html）：客户和项目合成一页。
   真 CustomerDetail（RecordView + ProjectZone + 嵌入版 ProjectDetail）+ globals.css，只桩掉服务端动作。钉的是：
   页签切换后左栏「关键」跟着换；项目各动作收进右上角「项目操作 ▾」、客户的进「客户操作 ▾」（11-12 用户）；页签行一行不换行（1024 / 1280 / 1366，超长项目名、超长公司名）；提醒条在中栏进程卡正上方；
   同事项目只给带锁个数；空状态；没项目时关键退回客户级；沟通「本项目 / 这位客户全部」；只读没有写入口；手机单栏顺序 */
let browser: Browser, bundle: string;
const 空跑 = "async()=>({ok:true})";
const plugin: Plugin = { name: "cust-detail-merge", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;");
  stub(/(^|\/)InlineField$/, "export default function Inline(p){return <div className='rec-field' data-field={p.field}>{p.label}: {p.value}</div>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__去=u},replace(u){window.__换=u},prefetch(){}});export const usePathname=()=>\"/customers/a\";export const useSearchParams=()=>new URLSearchParams(window.__sp||'');");
  stub(/^next\/link$/, "export default function L({prefetch,scroll,replace,...p}){return <a {...p}/>}");
  stub(/(^|\/)(TaskForm|PlanForm|ContactForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|NewProjectModal|ContactLinks|ResearchRun|ResearchPerson)$/, "export default function Empty(){return null}");
  stub(/research\/ResearchEntry$/, "export const useResearchEntry=()=>false;");
  stub(/research\/actions$/, "export const 最近背调=async()=>null,背调价目=async()=>({可用:false,原因:'桩'});");
  stub(/^\.\/pick$|customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[];");
  stub(/^\.\/link-actions$/, "export const 关联客户=async()=>({ok:true}),改关联说明=关联客户,取消关联=关联客户;");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({问怎么拿掉(){}});");
  stub(/^\.\/ai$|customers\/\[id\]\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海,退回原因选项=async()=>[];");
  stub(/(^|\/)tri-state-actions$/, "export const 三态继续持有=async()=>({ok:false,error:\"\"}),三态暂缓回收=三态继续持有,三态让同事结束项目=三态继续持有;");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  // customers/actions（RecordView 的 ../actions）和 projects/actions（ProjectDetail 的 ../actions）都是 ../actions：并成一份桩
  stub(/^\.\.\/actions$|projects\/actions$/, `const f=${空跑};
    export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=f;
    export const 项目沟通须知=async()=>({ok:true,能记:false}),记项目沟通Action=async()=>({ok:true,followUpId:'f1'});
    export const 编辑项目=f,改项目沟通=f,改项目节点=f,终止项目进程=f,勾项目交付=f,删除项目=f,放回项目公海=(...a)=>window.__挂起?new Promise(()=>{}):f(...a),领取项目=f,判MQLAction=f,线索初判Action=f,市场复核Action=f,销售终验Action=f,总管理终判Action=f,销售认领Action=f,撤回验证Action=f,改项目画像Action=f,删项目沟通=f,加项目组员=f,换项目组员角色=f,移出项目组员=f;`);
  stub(/^\.\/actions$/, `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,saveFollowUp=toggleTask,deleteFollowUp=toggleTask;
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
    export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'p1'});`);
  stub(/^\.\.\/commission-actions$/, `const f=${空跑};export const 存项目底价=f,存提成分配=f,更正实际提成=f;`);
  stub(/^\.\.\/payment-actions$/, `const f=${空跑};export const 记回款=f,删回款=f;`);
  stub(/readonly-card-actions$/, "export const 打开客户只读卡Action=async()=>({ok:false,error:'桩'});");
  stub(/^\.\/blocker-actions$/, `const f=${空跑};export const 发布卡点Action=f,认领卡点Action=f,完成卡点Action=f,删卡点Action=f,存卡点默认Action=f,存卡点角色开关Action=f,新增原因Action=f,改原因名Action=f,改原因状态Action=f,删原因Action=f,合并原因Action=f,我的卡点Action=async()=>[];`);
  stub(/^\.\.\/relate-actions$/, `const f=${空跑};export const 加关联客户Action=f,改客户身份Action=f,解除关联客户Action=f,加关联联系人Action=f,改联系人角色立场Action=f,解除关联联系人Action=f,搜项目联系人=async()=>[];`);
  stub(/^\.\.\/\.\.\/favorites$/, `export const 切换项目收藏=async()=>({ok:true,收藏了:true});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import CustomerDetail from '@/app/(app)/customers/[id]/CustomerDetail';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 人=(id,name,isPrimary)=>({id,name,position:'采购',phone:'138000000'+id.slice(1),email:null,wechat:null,isPrimary,remark:null,updatedAt:'2026-01-01T00:00:00.000Z'});
    const contacts=[人('c1','王总',true),人('c2','李工',false),人('c3','陈经理',false)];
    const 客户沟通=Array.from({length:5},(_,i)=>({id:'cf'+i,type:'PHONE',title:'',content:'客户全部里的沟通'+i,status:'已完成',duration:null,occurredAt:'2026-10-2'+i+'T02:00:00.000Z',dueAt:null,participants:null,sourceText:null,ownerName:'QA',contactName:null,contactPosition:null,contactId:null,opportunityId:null,updatedAt:'2026-10-20T02:00:00.000Z',项目:{id:i%2?'p2':'p1',名:i%2?'项目二':'项目一'}}));
    const 关联=(主,本)=>({客户们:[],联系人们:本.map(([id,角色,立场])=>({contactId:id,名:id,姓名:id,customerId:'a',角色,立场,主:id===主,看得到:true})),选项:{身份:[],角色:[],立场:[]},上限:30});
    const 项目=(id,name,主,本,x={})=>({id,name,remark:null,amount:860000,currency:'CNY',customer:{id:'a',name:'客户A',school:null},contact:主?{id:主,name:主,position:null}:null,
      来源线索:null,原因选项:{回收:[],无效:[]},ownerId:'qa',ownerName:'QA',creatorName:'QA',createdAt:'2026-10-01T00:00:00.000Z',historyOwners:[],
      phase:'商机',node:'方案报价',result:null,exceptionReason:null,exceptionCategory:null,pooled:false,能放公海:true,能领取:false,领取不给:null,进公海:null,出口叫法:{},有效沟通差:[],
      nextStepAt:null,回收日:null,expectedDealAt:'2026-12-01',要下一步:false,必填:null,不给推:null,能改节点:true,能转让:true,能删:false,
      balanceSettled:false,balanceSettledBy:null,balanceSettledAt:null,acceptancePassed:false,acceptancePassedBy:null,acceptancePassedAt:null,logs:[],
      followUps:[{id:'f-'+id,type:'PHONE',method:null,initiator:null,content:'挂在'+name+'上的沟通',occurredAt:'2026-10-03T02:00:00.000Z',who:'QA',node:'方案报价',版本:'v1',我记的:true,附件:[]}],
      members:[],删前清点:{留痕:0,组员:0,沟通:1},企业版:true,能记沟通:true,可改沟通:false,可删沟通:false,提成:null,level:'A',项目来源:null,channelId:null,已立项天数:3,渠道们:[],aiEnabled:false,
      关联:关联(主,本),...x});
    const 卡点={们:[],能发:false,默认:{类型:'',影响:'',期限天:3},原因们:[]};
    const 当前of=(p,能改=true)=>({p,能改,候选:[{id:'qa',name:'QA',email:'qa@x'},{id:'u2',name:'同事乙',email:'b@x'}],在职:[],联系人们:[],角色们:[],类别们:[],卡点});
    const 长='超长项目名字'.repeat(6);
    const 项目们={
      p1:项目('p1','项目一'+长,'c1',[['c1',['决策人'],null],['c2',['使用方'],'支持']]),
      p2:项目('p2','项目二'+长,'c3',[['c3',['决策人'],null]]),
    };
    const 页签们=[{id:'p1',name:项目们.p1.name,节点:'方案报价',阶段:'商机',结局:null},{id:'p2',name:项目们.p2.name,节点:'需求确认',阶段:'商机',结局:null}];
    // 项目多（审查 #1）：再补 6 个只有页签的项目，一共 8 个
    const 多页签=[...页签们,...Array.from({length:6},(_,i)=>({id:'q'+i,name:'第'+(i+3)+'个项目'+长,节点:i===0?'丢单':'需求确认',阶段:i%2?'订单':'线索',结局:i===0?'丢单':null}))];
    // 导航收成 56 宽的图标栏；名单在 1214 以上摆着（lib/roster.ts 名单门槛，再窄收成抽屉），手机没有导航
    const 名单=<aside className='pane pane-roster'><div className='pane-h'><span className='pane-t'>客户</span></div><div className='pane-rows'>{Array.from({length:20},(_,i)=><div key={i}>客户{i}</div>)}</div></aside>;
    window.__render=(o={})=>{
      window.__sp=o.地址||'';window.__换=undefined;
      const 签=o.空?[]:o.多?(o.末?[...多页签.slice(1),多页签[0]]:多页签):o.单?[页签们[0]]:页签们;
      const 当前=o.空?null:当前of(项目们[o.选||'p1'],!o.只读);
      if(当前&&o.只读) 当前.p={...当前.p,能记沟通:false,能放公海:false,能转让:false,能改节点:false,能删:false,关联:当前.p.关联};
      if(当前&&o.删) 当前.p={...当前.p,能删:true};
      if(当前&&o.领不了) 当前.p={...当前.p,能领取:false,领取不给:'你是原负责人，不能领回'};
      root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><div className='shell rail-mini'>{innerWidth>=768&&<nav className='rail' aria-label='主导航'/>}{innerWidth>=1214&&名单}<main className='main app-content' style={{padding:'22px 26px'}}><div>
        <CustomerDetail customer={{id:'a',extra:null,name:o.公司名||'客户A',phone:'13800138000',school:null,grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z',pool:null}}
          contacts={contacts} contracts={[]} tasks={[{id:'t1',title:'周五带合同上门',dueAt:'2026-11-13T02:00:00.000Z',done:false}]} plan={null}
          users={[{id:'qa',name:'QA',email:'qa@x'},{id:'u2',name:'同事乙',email:'b@x'}]} channels={[]} aiEnabled={false} followUps={客户沟通} followUpsHasMore={false}
          项目们={签.map(t=>({id:t.id,name:t.name,phase:'商机',node:t.节点,result:null,pooledAt:null,amount:0,currency:'CNY'}))} 参与项目们={[]} 关联们={[]} 旺旺们={[]}
          跟进去处={[{id:'p1',名:'项目一',主:true,结束:false,说明:null,下一步:null,下一步文字:null}]} 待办计划={[]} 能放公海 新建项目={{节点们:['线索验证'],要下一步:false}}
          只读={o.只读?'全':false}
          三态条={o.提醒?{状态:'沉睡',文字:'满 90 天没有有效沟通，也可以用右上角「客户操作」转让或退回公海',悬停:'满 90 天没有有效沟通',旁注:null,按钮们:[{动作:'继续持有',字:'我还在跟',说明:'顺延 30 天',要理由:false,主:true}]}:null}
          项目数据={{customerId:'a',页签们:签,锁数:o.锁数??0,当前}}/>
      </div></main></div></BusinessProvider></App></ConfigProvider>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 参 = { 单?: boolean; 末?: boolean; 选?: string; 空?: boolean; 只读?: boolean; 锁数?: number; 公司名?: string; 多?: boolean; 地址?: string; 删?: boolean; 领不了?: boolean; 提醒?: boolean };
/** 11-12 用户「右上角只保存三个按钮：AI，项目操作，客户操作」：点开某个下拉，返回菜单 */
const 开菜单 = async (page: Page, 名: "项目操作" | "客户操作") => {
  await page.locator(".rec-head-acts").getByRole("button", { name: new RegExp(名) }).click();
  const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) ul.rec-head-menu").filter({ has: page.locator("li") }).last();
  await 菜单.waitFor();
  return 菜单;
};
/** 菜单里的项：文字（灰着的带 ⊘ 前缀），分隔线写成「—」 */
const 菜单项们 = (菜单: import("playwright").Locator) => 菜单.evaluate((ul) => ([...ul.children] as HTMLElement[]).map(l =>
  l.classList.contains("ant-dropdown-menu-item-divider") ? "—" : `${l.getAttribute("aria-disabled") === "true" ? "⊘" : ""}${l.classList.contains("ant-dropdown-menu-item-danger") ? "!" : ""}${l.innerText.replace(/\s+/g, " ").trim()}`));
async function 开(width: number, o: 参 = {}, height = 800) {
  const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("http://cust-merge.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://cust-merge.test/customers/a"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await 画(page, o);
  return { page, errors };
}
const 画 = async (page: Page, o: 参) => {
  await page.evaluate(a => (window as unknown as { __render: (o: object) => void }).__render(a), o as object);
  await page.locator(".rec-zone").first().waitFor();
  await page.locator(".rec-contact").first().waitFor();
};
/** 左栏联系人：名字 + 有没有「关键」，按页面上的顺序 */
const 联系人们 = (page: Page) => page.locator(".rec-rail .rec-contact").evaluateAll((cs: HTMLElement[]) => cs.map(c => c.querySelector(".rec-contact-n")!.textContent + (c.querySelector(".tag-key") ? "*" : "")));

it("页签切换后左栏「关键」跟着换：本项目主联系人排最前，接着本项目联系人（带角色 / 立场），再是这位客户的其他联系人", async () => {
  const { page, errors } = await 开(1366);
  try {
    expect(await 联系人们(page)).toEqual(["王总*", "李工", "陈经理"]);
    expect(await page.locator(".rec-contact-sub").innerText()).toBe("这位客户的其他联系人");
    // 11-12 起左栏第一位联系人摊开、其余收在手风琴里：先全摊开再量
    while (await page.locator('.rec-contact-tog[aria-expanded="false"]').count()) await page.locator('.rec-contact-tog[aria-expanded="false"]').first().click();
    // 李工在本项目里是使用方、支持
    expect(await page.locator(".rec-contact", { hasText: "李工" }).getByTestId("contact-project-role").innerText()).toMatch(/本项目\s*使用方 · 支持/);
    // 页签是到客户详情 ?project= 的链接，当前那个标着
    const 页签 = page.locator(".cd-pj-pills").getByRole("tab");
    expect(await 页签.evaluateAll((ts: HTMLElement[]) => ts.map(t => [t.getAttribute("href"), t.getAttribute("aria-selected")]))).toEqual([["/customers/a?project=p1", "true"], ["/customers/a?project=p2", "false"]]);
    // 切到项目二（服务端按 ?project=p2 重画）：关键换成陈经理、排最前；王总变成其他联系人，不再是关键
    await 画(page, { 选: "p2" });
    expect(await 联系人们(page)).toEqual(["陈经理*", "王总", "李工"]);
    while (await page.locator('.rec-contact-tog[aria-expanded="false"]').count()) await page.locator('.rec-contact-tog[aria-expanded="false"]').first().click();
    expect(await page.locator(".rec-contact", { hasText: "李工" }).getByTestId("contact-project-role").count()).toBe(0);
    expect(await page.locator(".cd-pj-pills").getByRole("tab", { selected: true }).getAttribute("href")).toBe("/customers/a?project=p2");
    expect(await page.locator(".rec-zone").getAttribute("data-project")).toBe("p2");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("没有项目可选：项目区空状态 +「＋ 新建项目」；关键联系人退回客户级「主要联系人」，不分「其他联系人」", async () => {
  const { page, errors } = await 开(1280, { 空: true });
  try {
    const 空 = page.getByTestId("project-zone-empty");
    expect(await 空.innerText()).toMatch(/这位客户还没有项目/);
    expect(await 空.getByRole("button", { name: /新建项目/ }).count()).toBe(1);
    // 页签行不再摆「＋ 新建项目」；没有项目时「项目操作」里只剩新建项目
    expect(await page.locator(".cd-zh button, .cd-pj button, .cd-add:not(.cd-add-big)").count()).toBe(0);
    expect(await 菜单项们(await 开菜单(page, "项目操作"))).toEqual(["新建项目"]);
    await page.keyboard.press("Escape");
    expect(await page.locator(".cd-pj-pills").getByRole("tab").count()).toBe(0);
    expect(await 联系人们(page)).toEqual(["王总*", "李工", "陈经理"]);
    expect(await page.locator(".rec-contact-sub").count()).toBe(0);
    // 没有项目也照样看得到这位客户的沟通记录（只看，不能新建）和待办
    const 沟通 = page.locator(".rec-zone .cd-comm");
    expect(await 沟通.getByText(/客户全部里的沟通/).count()).toBe(5);
    expect(await 沟通.getByRole("button", { name: /新建沟通/ }).count()).toBe(0);
    expect(await page.locator(".rec-zone").getByText("周五带合同上门").count()).toBe(1);
    // 页头不再有「新开项目」
    expect(await page.getByRole("button", { name: /新开项目/ }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("同事项目只给带锁的个数：不是链接、不是按钮，不露项目名；没有能看的项目时空状态说「没有你能看的项目」", async () => {
  const { page, errors } = await 开(1366, { 锁数: 2 });
  try {
    const 锁 = page.locator(".cd-pj .cd-lock");
    // 正文窄（1366 开着名单）只露锁 + 个数，宽了写「同事项目 2」；读屏都念全
    expect(await 锁.innerText()).toMatch(/^(同事项目\s*)?2$/);
    expect(await 锁.getAttribute("aria-label")).toBe("同事项目 2 个");
    expect(await 锁.locator("svg").count()).toBe(1);
    expect(await 锁.evaluate(el => !!el.closest("a, button") || !!el.querySelector("a, button"))).toBe(false);
    expect(await page.locator(".cd-pj-pills").getByRole("tab").count()).toBe(2);
    await 画(page, { 空: true, 锁数: 1 });
    expect(await page.getByTestId("project-zone-empty").innerText()).toMatch(/没有你能看的项目/);
    expect(await page.locator(".cd-pj .cd-lock").count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("1024 / 1280 / 1366：页签行一行不换行、右端不再有按钮；页头只有「项目操作 ▾」「客户操作 ▾」，项目各动作在菜单里、只作用于当前项目；超长项目名、超长公司名省略不撑出、不横滚", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 开(w, { 锁数: 1, 公司名: "超长公司名有限责任公司".repeat(8) });
    try {
      // 11-12 方案一：项目切换在进程卡卡头左边、「完成节点」在同一行右边，一行放下；客户详情不摆三个阶段页签
      const 行 = page.locator(".cd-mid > .ant-card .proj-stage-bar.has-head");
      expect(await page.locator(".rec-zone .proj-stage-tabs").count(), `宽 ${w}`).toBe(0);
      const 量 = await 行.evaluate((el) => {
        const 框 = el.getBoundingClientRect();
        const 块 = [...el.querySelectorAll(".cd-pj-pills > *, .cd-lock, .proj-stage-acts button")].map(b => { const r = b.getBoundingClientRect(); return { 字: (b as HTMLElement).innerText.replace(/\s+/g, ""), 上: r.top, 下: r.bottom, 左: r.left, 右: r.right }; });
        const 页签 = [...el.querySelectorAll<HTMLElement>(".cd-pj-pills .cd-pj-pill[role=tab]")].map(t => { const n = t.querySelector<HTMLElement>(".cd-pj-nm")!; return { 截: n.scrollWidth > n.clientWidth, title: t.title, 名: n.textContent, 标: t.querySelector(".cd-pj-st")!.textContent }; });
        return { 框: { 左: 框.left, 右: 框.right, 高: 框.height }, 块, 页签, 溢出: el.scrollWidth > el.clientWidth + 1 };
      });
      const 中 = 量.块.map(b => (b.上 + b.下) / 2);
      expect(Math.max(...中) - Math.min(...中), `宽 ${w}`).toBeLessThanOrEqual(4);
      expect(量.框.高, `宽 ${w}`).toBeLessThanOrEqual(44);
      expect(量.溢出, `宽 ${w}`).toBe(false);
      expect(量.块.some(b => b.字 === "完成节点"), `宽 ${w}`).toBe(true);
      for (const b of 量.块) { expect(b.左, `宽 ${w} ${b.字}`).toBeGreaterThanOrEqual(量.框.左 - 1); expect(b.右, `宽 ${w} ${b.字}`).toBeLessThanOrEqual(量.框.右 + 1); }
      // 胶囊 = 项目名 + 所在阶段（不写具体节点）；超长名省略号 + 悬停全名（title）
      expect(量.页签.every(t => t.标 === "商机"), `宽 ${w}`).toBe(true);
      expect(量.页签.some(t => t.截), `宽 ${w}`).toBe(true);
      for (const t of 量.页签) expect(t.title.startsWith(t.名!)).toBe(true);
      // 右栏卡头带当前项目名
      expect(await page.locator(".cd-side .ant-card-head-title").first().innerText()).toMatch(/^项目资料 · 项目一/);
      // 页头：两颗下拉和客户名同一行、不折行
      expect(await page.locator(".rec-head-acts button").evaluateAll((bs: HTMLElement[]) => bs.map(b => b.innerText.replace(/\s+/g, "")))).toEqual(["项目操作", "客户操作"]);
      const [名, 排] = await Promise.all([page.locator(".rec-head-id").boundingBox(), page.locator(".rec-head-acts").boundingBox()]);
      expect(排!.y, `宽 ${w}`).toBeLessThan(名!.y + 名!.height);
      expect(await page.locator(".rec-head-acts button").evaluateAll((bs: HTMLElement[]) => bs.every(b => b.getBoundingClientRect().height <= 40))).toBe(true);
      // 项目操作：第一行灰字当前项目（超长一行省略、title 全名），新建、转让、退回公海
      const 菜单 = await 开菜单(page, "项目操作");
      const 项们 = await 菜单项们(菜单);
      expect(项们.slice(1), `宽 ${w}`).toEqual(["新建项目", "项目转让", "项目退回公海"]);
      expect(项们[0]).toMatch(/^⊘当前项目：项目一/);
      const 名格 = 菜单.locator(".rec-menu-cur-t");
      expect(await 名格.getAttribute("title")).toMatch(/^项目一超长项目名字/);
      expect(await 名格.evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).whiteSpace === "nowrap")).toBe(true);
      // 点「项目转让」开的是项目那只框
      await 菜单.getByRole("menuitem", { name: /^项目转让$/ }).click();
      expect(await page.getByRole("dialog").locator(".ant-modal-title").innerText()).toBe("项目转让");
      // 整页不横滚，右栏在 1280 也还是右栏（和中栏并排、顶边对齐）
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `宽 ${w}`).toBe(true);
      const [中栏, 右栏] = await Promise.all([page.locator(".cd-mid").boundingBox(), page.locator(".cd-side").boundingBox()]);
      expect(右栏!.x, `宽 ${w}`).toBeGreaterThan(中栏!.x + 中栏!.width - 1);
      expect(Math.abs(右栏!.y - 中栏!.y), `宽 ${w}`).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("项目操作：删除项目在最后、危险色、上面一条线，点了走原来的确认；领取灰着时菜单项灰着并写原因；客户操作里是客户转让、客户退回公海", async () => {
  const { page, errors } = await 开(1280, { 删: true, 领不了: true });
  try {
    const 菜单 = await 开菜单(page, "项目操作");
    const 项们 = await 菜单项们(菜单);
    expect(项们.slice(1)).toEqual(["新建项目", "⊘领取 你是原负责人，不能领回", "项目转让", "项目退回公海", "—", "!删除项目"]);
    await 菜单.getByRole("menuitem", { name: /删除项目/ }).click();
    await page.locator(".ant-modal-confirm-title").filter({ hasText: "删除这个项目？" }).waitFor();
    await page.locator(".ant-modal-confirm").getByRole("button", { name: /取\s*消/ }).click();
    expect(await 菜单项们(await 开菜单(page, "客户操作"))).toEqual(["客户转让", "客户退回公海"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("项目区正在提交（退回公海还没回来）：页头「项目操作 ▾」里对当前项目的几项灰着写「正在处理」，新建项目照常能点", async () => {
  const { page, errors } = await 开(1280, { 删: true });
  try {
    await page.evaluate(() => { (window as unknown as { __挂起: boolean }).__挂起 = true; });
    await (await 开菜单(page, "项目操作")).getByRole("menuitem", { name: /项目退回公海/ }).click();
    const 框 = page.getByRole("dialog", { name: "把项目退回公海？" });
    await 框.getByRole("button", { name: "项目退回公海" }).click();
    await expect.poll(() => 框.getByRole("button", { name: "项目退回公海" }).evaluate(b => b.classList.contains("ant-btn-loading"))).toBe(true);
    await 框.getByRole("button", { name: /取\s*消/ }).click();
    const 菜单 = await 开菜单(page, "项目操作");
    const 项们 = await 菜单项们(菜单);
    expect(项们.slice(1)).toEqual(["新建项目", "⊘项目转让 正在处理上一步，稍等", "⊘项目退回公海 正在处理上一步，稍等", "—", "⊘!删除项目 正在处理上一步，稍等"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1280, 1366, 1440])("提醒条 %ipx：在项目区中栏、进程卡正上方，宽度等于中栏；进程卡和右栏项目资料顶边对齐；没有提醒不占位", async (w) => {
  const { page, errors } = await 开(w, { 提醒: true });
  try {
    const 条 = page.getByTestId("tri-state-bar");
    expect(await 条.count()).toBe(1);
    // 不在客户名下面通栏，在项目区那张网格里
    expect(await 条.evaluate(el => !!el.closest(".rec-zone .cd-zb > .cd-alert"))).toBe(true);
    const [框, 中栏, 右栏, 进程卡] = await Promise.all([条.boundingBox(), page.locator(".cd-mid").boundingBox(), page.locator(".cd-side").boundingBox(), page.locator(".cd-mid > .ant-card").first().boundingBox()]);
    expect(Math.abs(框!.x - 中栏!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(框!.width - 中栏!.width)).toBeLessThanOrEqual(1);
    expect(框!.y + 框!.height).toBeLessThanOrEqual(进程卡!.y + 1);
    expect(Math.abs(右栏!.y - 中栏!.y)).toBeLessThanOrEqual(1);
    expect(await page.locator(".rec-head + [data-testid=tri-state-bar]").count()).toBe(0);
    expect(await 条.innerText()).toContain("右上角「客户操作」");
    // 没有提醒：不占位，中栏、右栏照样对齐
    await 画(page, {});
    expect(await page.locator(".cd-alert").count()).toBe(0);
    const [中2, 右2] = await Promise.all([page.locator(".cd-mid").boundingBox(), page.locator(".cd-side").boundingBox()]);
    expect(Math.abs(右2!.y - 中2!.y)).toBeLessThanOrEqual(1);
    // 没有项目：提醒条仍在项目区顶上
    await 画(page, { 空: true, 提醒: true });
    expect(await page.locator(".rec-zone > .cd-alert [data-testid=tri-state-bar]").count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("项目区里：中栏 阶段 → 沟通 → 待办 → 卡点，右栏项目资料在最上；沟通默认「本项目」，切「这位客户全部」列客户时间线、切回只列本项目", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 中 = await page.locator(".cd-mid > *").evaluateAll((es: HTMLElement[]) => es.map(e => e.querySelector(":scope > .proj-fold-btn, :scope > .ant-card > .ant-card-head .split-caret")?.getAttribute("aria-label") ?? e.className));
    // 卡点默认收着（同项目详情）
    expect(中.filter(x => /^(收起|展开)/.test(x)).map(x => x.replace(/^(收起|展开)/, ""))).toEqual(["沟通记录", "所有待办", "当前卡点"]);
    expect(中[0]).toMatch(/ant-card/);
    expect(await page.locator(".cd-side .ant-card-head-title").first().innerText()).toMatch(/^项目资料 · 项目一/);
    const 卡 = page.locator(".cd-comm");
    expect(await 卡.getByRole("button", { name: "本项目" }).getAttribute("aria-pressed")).toBe("true");
    expect(await 卡.getByText(/挂在项目一.*上的沟通/).count()).toBe(1);
    expect(await 卡.getByText(/客户全部里的沟通/).count()).toBe(0);
    // 新建沟通是卡头的主按钮，记到当前页签的项目上
    expect(await 卡.locator(".ant-card-extra").getByRole("button", { name: /新建沟通/ }).evaluate(el => el.classList.contains("ant-btn-primary"))).toBe(true);
    await 卡.getByRole("button", { name: "这位客户全部" }).click();
    expect(await 卡.getByText(/客户全部里的沟通/).count()).toBe(5);
    expect(await 卡.locator(".ant-card-head-title").innerText()).toMatch(/沟通记录（5）/);
    await 卡.getByRole("button", { name: "本项目" }).click();
    expect(await 卡.getByText(/客户全部里的沟通/).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("只读的客户（全只读）：页头、项目区都没有写入口", async () => {
  const { page, errors } = await 开(1366, { 只读: true });
  try {
    for (const 名 of [/客户转让/, /客户退回公海/, /项目转让/, /项目退回公海/, /新建沟通/, /新增沟通/, /新建待办/, /新建项目/, /完成节点/, /编辑联系人/]) {
      expect(await page.getByRole("button", { name: 名 }).count(), String(名)).toBe(0);
    }
    expect(await page.locator(".cd-add, .rec-head-acts").count()).toBe(0);
    expect(await page.getByRole("button", { name: /项目操作|客户操作/ }).count()).toBe(0);
    // 页签照样能切（只是看）
    expect(await page.locator(".cd-pj-pills").getByRole("tab").count()).toBe(2);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* 11-12 用户「模块内的按钮格式保持一致，都以完成节点为参照」：中栏沟通 / 待办 / 卡点卡头是连体按钮（左半主动作、右半收起展开） */
const 连体们 = (page: Page) => page.locator(".cd-mid > .proj-fold").evaluateAll((fs: HTMLElement[]) => fs.map(f => {
  const 组 = f.querySelector(":scope > .ant-card > .ant-card-head .ant-card-extra .split-btn");
  const 钮 = 组 ? [...组.querySelectorAll("button")] : [];
  const 尾 = 钮.at(-1);
  return {
    名: 尾?.getAttribute("aria-label") ?? "", 色: 组 ? [...组.classList].find(c => /^split-(brand|plain|success)$/.test(c)) ?? "" : "",
    独: 组?.classList.contains("split-solo") ?? false, 字: 钮.slice(0, -1).map(b => b.textContent!.trim()),
    右半: !!尾?.classList.contains("split-caret"), 散钮: f.querySelectorAll(":scope > .proj-fold-btn").length,
    贴: 钮.length === 2 ? Math.abs(钮[0].getBoundingClientRect().right - 钮[1].getBoundingClientRect().left) <= 1 : null,
  };
}));

it("中栏连体按钮：沟通（品牌蓝）、待办 / 卡点（描边）左半主动作、右半收起；不再有单独的收起钮；完成节点照旧", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 们 = await 连体们(page);
    expect(们.map(x => [x.名, x.色, x.字, x.右半, x.散钮, x.贴])).toEqual([
      ["收起沟通记录", "split-brand", ["新建沟通"], true, 0, true],
      ["收起所有待办", "split-plain", ["新建待办"], true, 0, true],
      // 这份桩里卡点不能发（卡点.能发 = false）：左半不给，只剩右半
      ["展开当前卡点", "split-plain", [], true, 0, null],
    ]);
    // 完成节点那颗还是原样：绿色连体、右半是「终止进程」下拉
    const 完 = page.locator(".proj-stage-acts .split-btn.split-success");
    expect(await 完.getByRole("button", { name: "完成节点" }).count()).toBe(1);
    expect(await 完.getByRole("button", { name: "终止进程" }).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("连体右半管收起 / 展开：只藏卡身、留卡头和左半主动作，箭头跟着翻，aria-expanded 跟着变", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 壳 = page.locator(".cd-mid > .proj-fold").nth(1);
    const 身 = 壳.locator(":scope > .ant-card > .ant-card-body");
    expect(await 身.isVisible()).toBe(true);
    await 壳.getByRole("button", { name: "收起所有待办" }).click();
    expect(await 身.isVisible()).toBe(false);
    const 右 = 壳.getByRole("button", { name: "展开所有待办" });
    expect(await 右.getAttribute("aria-expanded")).toBe("false");
    expect(await 壳.getByRole("button", { name: /新建待办/ }).isVisible()).toBe(true);
    await 右.click();
    expect(await 身.isVisible()).toBe(true);
    expect(await 壳.getByRole("button", { name: "收起所有待办" }).getAttribute("aria-expanded")).toBe("true");
    // 卡点默认收着，点右半摊开
    const 卡点 = page.locator("#project-blockers");
    await 卡点.getByRole("button", { name: "展开当前卡点" }).click();
    expect(await 卡点.locator(":scope > .ant-card > .ant-card-body").isVisible()).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("只读（没权限）：连体只剩右半那颗收起钮，照样能收起展开", async () => {
  const { page, errors } = await 开(1366, { 只读: true });
  try {
    const 们 = await 连体们(page);
    expect(们.map(x => [x.名, x.独, x.字, x.右半])).toEqual([
      ["收起沟通记录", true, [], true],
      ["收起所有待办", true, [], true],
      ["展开当前卡点", true, [], true],
    ]);
    await page.getByRole("button", { name: "收起沟通记录" }).click();
    expect(await page.locator("#project-follow > .ant-card > .ant-card-body").isVisible()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* 11-12 用户：客户详情三栏的叫法——左栏客户的、中栏待办是客户全部 / 卡点是当前项目、右栏都带「项目」（src/app/(app)/projects/[id]/card-names.tsx） */
it("客户详情三栏叫法：左栏客户资料 / 客户联系人 / 关联组织；中栏所有待办、当前卡点、沟通记录不改；右栏卡名都带「项目」", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 题们 = (sel: string) => page.locator(sel).evaluateAll((es: HTMLElement[]) => es.map(e => e.innerText.replace(/（[\s\S]*$/, "").trim()));
    expect(await 题们(".rec-rail .rec-sec-t > span:first-child, .rec-rail .ant-card-head-title")).toEqual(expect.arrayContaining(["客户资料", "客户联系人"]));
    expect(await 题们(".cd-mid > .proj-fold > .ant-card .ant-card-head-title")).toEqual(["沟通记录", "所有待办", "当前卡点"]);
    const 右 = await 题们(".cd-side > .proj-fold > .ant-card > .ant-card-head .ant-card-head-title");
    expect(右.length).toBeGreaterThan(0);
    for (const t of 右) expect(t, t).toMatch(/^项目/);
    // 收起钮的读屏名跟着标题走
    expect(await page.getByRole("button", { name: "收起所有待办" }).count()).toBe(1);
    expect(await page.locator('.cd-mid .proj-mod-body[aria-label="所有待办"]').count()).toBe(1);
    expect(await page.getByRole("button", { name: "展开当前卡点" }).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("手机单栏：客户名和客户按钮 → 卡头项目切换 → 阶段 → 沟通 → 待办 → 卡点 → 项目资料 → 客户资料；不横滚", async () => {
  const { page, errors } = await 开(375, {}, 900);
  try {
    await expect.poll(() => page.locator(".rec.rec-cd").evaluate(el => el.classList.contains("rec-1col"))).toBe(true);
    const 上 = (s: string) => page.locator(s).first().evaluate(el => el.getBoundingClientRect().top);
    const 顺序 = [
      ".rec-head",
      ".cd-mid > .ant-card",
      "#project-follow",
      '.cd-mid > .proj-fold:has(.split-caret[aria-label="收起所有待办"])',
      "#project-blockers",
      ".cd-side",
      ".rec-rail",
    ];
    const 高们 = [];
    for (const s of 顺序) 高们.push(await 上(s));
    for (let i = 1; i < 高们.length; i++) expect(高们[i], `${顺序[i - 1]} → ${顺序[i]}`).toBeGreaterThan(高们[i - 1]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("项目多（8 个）、1024 / 1280 宽：放不下的胶囊收进「更多 N 个」，不折行不横滚；选中的在「更多」里时顶到可见的最后一颗；锁一直看得见；「更多」里点了切项目", async () => {
  for (const w of [1024, 1280]) {
    const { page, errors } = await 开(w, { 多: true, 末: true, 锁数: 3 });
    try {
      const 行 = page.locator(".cd-pj");
      const 胶囊 = page.locator(".cd-pj-pills").getByRole("tab");
      const 更多 = page.locator(".cd-pj-pills .cd-pj-more");
      await 更多.waitFor();
      const 见 = await 胶囊.count();
      expect(await 更多.innerText(), `宽 ${w}`).toMatch(new RegExp(`更多 ${8 - 见} 个`));
      expect(见, `宽 ${w}`).toBeGreaterThanOrEqual(1);
      // 选中的（排在最后的项目一）看得见、是可见的最后一颗
      expect(await 胶囊.last().getAttribute("aria-selected"), `宽 ${w}`).toBe("true");
      expect(await 胶囊.last().getAttribute("href")).toBe("/customers/a?project=p1");
      // 一行、不溢出、不横滚
      expect(await 行.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await page.locator(".cd-pj-pills").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const 点得着 = (sel: string) => page.locator(sel).first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        const 中 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.width > 0 && !!中 && (中 === el || el.contains(中));
      });
      expect(await 点得着(".cd-pj .cd-lock")).toBe(true);
      expect(await 点得着(".cd-pj-more")).toBe(true);
      // 「更多」里列收起来的项目；点一个 = 换地址切过去
      await 更多.click();
      const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .cd-pj-menu");
      await 菜单.locator("li").first().waitFor();
      expect(await 菜单.locator("li").count()).toBe(8 - 见);
      await 菜单.locator("li").last().click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __换?: string }).__换)).toMatch(/^\/customers\/a\?project=q\d$/);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("页签变少（router.refresh 后项目删了 / 转走了）：上一轮量出来的下标越界也不崩，照新的页签重排", async () => {
  const { page, errors } = await 开(1024, { 多: true, 末: true, 锁数: 3 });
  try {
    await page.locator(".cd-pj-pills .cd-pj-more").waitFor();
    // 同一个根重画（状态留着）：8 个项目变回 2 个
    await 画(page, {});
    await expect.poll(() => page.locator(".cd-pj-pills").getByRole("tab").count()).toBe(2);
    expect(await page.locator(".cd-pj-pills .cd-pj-more").count()).toBe(0);
    expect(await page.locator(".cd-pj-pills").getByRole("tab", { selected: true }).getAttribute("href")).toBe("/customers/a?project=p1");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("有结局的项目胶囊写结局（同原页签），没有的写所在阶段带阶段色点", async () => {
  const { page, errors } = await 开(1920, { 多: true });
  try {
    const 标们 = await page.locator(".cd-pj-pills [role=tab]").evaluateAll((ts: HTMLElement[]) => ts.map(t => [t.querySelector(".cd-pj-st")!.textContent, !!t.querySelector(".cd-pj-dot")]));
    expect(标们[2]).toEqual(["丢单", false]);
    expect(标们[3]).toEqual(["订单", true]);
    expect(标们[0]).toEqual(["商机", true]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("只有 1 个项目：卡头直接写项目名（加粗、一行省略、悬停全文）和所在阶段，没有胶囊；右栏卡头只写「项目资料」", async () => {
  const { page, errors } = await 开(1280, { 单: true });
  try {
    const 名 = page.locator(".cd-pj-one");
    expect(await 名.locator(".cd-pj-nm").innerText()).toMatch(/^项目一超长项目名字/);
    expect(await 名.getAttribute("title")).toMatch(/^项目一.* · 商机$/);
    expect(await 名.locator(".cd-pj-nm").evaluate(el => getComputedStyle(el).fontWeight)).toBe("600");
    expect(await 名.locator(".cd-pj-tag").innerText()).toBe("商机");
    expect(await page.getByRole("tab").count()).toBe(0);
    expect(await page.locator(".cd-side .ant-card-head-title").first().innerText()).toBe("项目资料");
    expect(await page.locator(".proj-stage-tabs").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("嵌入版的项目资料卡：收藏星在卡头（只管当前项目），负责人、创建人、创建时间摆在卡里；阶段卡上没有「新增沟通」，⌘N 落到沟通卡头的「新建沟通」", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 卡 = page.locator(".cd-side .ant-card").first();
    expect(await 卡.locator(".ant-card-head-title").innerText()).toMatch(/^项目资料 · 项目一/);
    expect(await 卡.locator(".ant-card-extra").getByRole("button", { name: /收藏/ }).count()).toBe(1);
    expect(await 卡.getByTestId("project-owner-row").innerText()).toMatch(/负责人\s*QA/);
    expect(await 卡.getByTestId("project-creator-row").innerText()).toMatch(/创建人\s*QA/);
    expect(await 卡.getByTestId("project-created-row").innerText()).toMatch(/创建于\s*2026-10-01/);
    // 新建沟通只剩沟通卡头那一颗
    expect(await page.locator(".rec-zone").getByRole("button", { name: /新增沟通/ }).count()).toBe(0);
    expect(await page.locator(".rec-zone").getByRole("button", { name: /新建沟通/ }).count()).toBe(1);
    expect(await page.locator("button[data-cmd-new]").evaluateAll((bs: HTMLElement[]) => bs.map((b) => b.innerText.replace(/\s+/g, "")))).toEqual(["新建沟通"]);
    expect(await page.locator("button[data-cmd-new]").getAttribute("data-testid")).toBe("follow-card-new");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("沟通切「这位客户全部」：搜索框藏起来、词清掉（那条时间线不归它管）；切回本项目搜索框回来", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 搜 = page.locator(".rec-zone .proj-search input");
    await 搜.fill("项目一");
    const 卡 = page.locator(".cd-comm");
    await 卡.getByRole("button", { name: "这位客户全部" }).click();
    expect(await page.locator(".rec-zone .proj-search").count()).toBe(0);
    expect(await 卡.getByText(/客户全部里的沟通/).count()).toBe(5);
    await 卡.getByRole("button", { name: "本项目" }).click();
    expect(await 搜.inputValue()).toBe("");
    expect(await 卡.getByText(/挂在项目一.*上的沟通/).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("地址上的 ?project= 读不出来、服务端换成了别的：地址改成实际显示的那个，页签高亮和内容是同一个", async () => {
  const { page, errors } = await 开(1366, { 地址: "project=看不了的" });
  try {
    await expect.poll(() => page.evaluate(() => (window as unknown as { __换?: string }).__换)).toBe("/customers/a?project=p1");
    expect(await page.locator(".cd-pj-pills").getByRole("tab", { selected: true }).getAttribute("href")).toBe("/customers/a?project=p1");
    expect(await page.locator(".rec-zone").getAttribute("data-project")).toBe("p1");
    // 地址本来就对：不动
    await 画(page, { 地址: "project=p2", 选: "p2" });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as unknown as { __换?: string }).__换)).toBeUndefined();
    // 没有项目可选、地址还带着：去掉 project
    await 画(page, { 地址: "project=p2", 空: true });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __换?: string }).__换)).toBe("/customers/a");
    // 别的查询参数（?focus= 等）不丢，只改 project 这一项
    await 画(page, { 地址: "focus=plan:x&project=看不了的&tab=2" });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __换?: string }).__换)).toBe("/customers/a?focus=plan%3Ax&project=p1&tab=2");
    await 画(page, { 地址: "focus=plan:x&project=p2", 空: true });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __换?: string }).__换)).toBe("/customers/a?focus=plan%3Ax");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
