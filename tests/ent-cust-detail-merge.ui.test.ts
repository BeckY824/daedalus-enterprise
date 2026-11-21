import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* 11-12 客户详情合并第 2 批（定稿 UI 客户详情-定稿UI-20261112.html）：客户和项目合成一页。
   真 CustomerDetail（RecordView + ProjectZone + 嵌入版 ProjectDetail）+ globals.css，只桩掉服务端动作。钉的是：
   页签切换后左栏「关键」跟着换；项目各动作、客户的动作都收进右上角「更多操作 ▾」（11-12 用户两颗「项目操作 / 客户操作」，11-21 教练点评改版 PR1 合成一颗、分组）；
   能发点评的人右上角多一颗「发起点评 ▾」（写点评 / 录音点评灰着），按角色摆；页签行一行不换行（1024 / 1280 / 1366，超长项目名、超长公司名）；提醒条在中栏进程卡正上方；
   同事项目只给带锁个数；空状态；没项目时关键退回客户级；沟通「本项目 / 这位客户全部」；只读没有写入口；手机单栏顺序 */
let browser: Browser, bundle: string;
const 空跑 = "async()=>({ok:true})";
const plugin: Plugin = { name: "cust-detail-merge", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  // 教练主题（11-17）的动作：服务端那串（prisma、通知）进不了浏览器包
  stub(/coach-topic-actions$/, "const f=async()=>({ok:true});export const 发主题动作=f,回复主题动作=f,关闭主题动作=f,删主题动作=f;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>window.__习惯??null;", "async()=>null"));
  stub(/(^|\/)InlineField$/, "export default function Inline(p){return <div className='rec-field' data-field={p.field}>{p.label}: {p.value}</div>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__去=u},replace(u){window.__换=u},prefetch(){}});export const usePathname=()=>\"/customers/a\";export const useSearchParams=()=>new URLSearchParams(window.__sp||'');");
  stub(/^next\/link$/, "export default function L({prefetch,scroll,replace,...p}){return <a {...p}/>}");
  stub(/(^|\/)(TaskForm|PlanForm|ContactForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|NewProjectEntry|ResearchRun|ResearchPerson)$/, "export default function Empty(){return null}");
  // 联系人组头和行经 ContactLinks 摆（D3 · 方案 A 的「⋯」在它里面）：桩照样把头和行摆出来，只是不给菜单
  stub(/(^|\/)ContactLinks$/, "export default function L(p){return <>{p.头?.(null)}{p.children}</>}");
  stub(/research\/ResearchEntry$/, "export const useResearchEntry=()=>false;");
  stub(/research\/actions$/, "export const 最近背调=async()=>null,背调价目=async()=>({可用:false,原因:'桩'});");
  stub(/^\.\/pick$|customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[];");
  stub(/^\.\/link-actions$/, "export const 关联客户=async()=>({ok:true}),改关联说明=关联客户,取消关联=关联客户;");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({});export const ContactRemoveInline=()=>null;");
  stub(/^\.\/ai$|customers\/\[id\]\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海,退回原因选项=async()=>[];");
  stub(/(^|\/)tri-state-actions$/, "export const 三态继续持有=async()=>({ok:false,error:\"\"}),三态暂缓回收=三态继续持有,三态让同事结束项目=三态继续持有;");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  // customers/actions（RecordView 的 ../actions）和 projects/actions（ProjectDetail 的 ../actions）都是 ../actions：并成一份桩
  stub(/^\.\.\/actions$|projects\/actions$/, `const f=${空跑};
    export const saveCustomerNumbers=async()=>({ok:true});export const 转走项目预览of=async()=>({项目数:0,项目:[]}),deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=f;
    export const 项目沟通须知=async()=>({ok:true,能记:false}),记项目沟通Action=async()=>({ok:true,followUpId:'f1'});
    export const 编辑项目=f,改项目沟通=f,改项目节点=f,终止项目进程=f,勾项目交付=f,删除项目=f,放回项目公海=(...a)=>window.__挂起?new Promise(()=>{}):f(...a),领取项目=f,判MQLAction=f,线索初判Action=f,市场复核Action=f,销售终验Action=f,总管理终判Action=f,销售认领Action=f,撤回验证Action=f,改项目画像Action=f,删项目沟通=f,加项目组员=f,换项目组员角色=f,移出项目组员=f;`);
  stub(/^\.\/actions$/, `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,沟通可选项目=async()=>({ok:true,项目们:null,能建项目:true}),saveFollowUp=toggleTask,deleteFollowUp=toggleTask;
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
    export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'p1'});`);
  stub(/^\.\.\/commission-actions$/, `const f=${空跑};export const 存项目底价=f,存提成分配=f,更正实际提成=f;`);
  // 定时分配（11-17）改 / 取消 / 现在分：服务端那串（prisma、通知）进不了浏览器包
  stub(/(^|\/)schedule-actions$/, 补全动作桩("src/app/(app)/leads/schedule-actions.ts", `const f=${空跑};export const 改定时分配=f,取消定时分配=f,定时分配现在分=f;`));
  stub(/^\.\.\/payment-actions$/, `const f=${空跑};export const 记回款=f,删回款=f;`);
  stub(/readonly-card-actions$/, 补全动作桩("src/app/(app)/projects/[id]/readonly-card-actions.ts", "export const 打开客户只读卡Action=async()=>({ok:false,error:'桩'});"));
  stub(/giveup-actions$/, 补全动作桩("src/app/(app)/projects/[id]/giveup-actions.ts",
    "export const 放弃说明Action=async(id)=>{(window.__问||(window.__问=[])).push(id);return {可:false,话:'你已经在这条线索（这位客户）上记过有效沟通，不能放弃了'}};"));
  stub(/^\.\/blocker-actions$/, `const f=${空跑};export const 发布卡点Action=f,认领卡点Action=f,完成卡点Action=f,删卡点Action=f,存卡点默认Action=f,存卡点角色开关Action=f,新增原因Action=f,改原因名Action=f,改原因状态Action=f,删原因Action=f,合并原因Action=f;`);
  stub(/^\.\.\/relate-actions$/, `const f=${空跑};export const 加关联客户Action=f,改客户身份Action=f,解除关联客户Action=f,加关联联系人Action=f,改联系人角色立场Action=f,解除关联联系人Action=f,搜项目联系人=async()=>[];`);
  stub(/project-only-contact-actions$/, `const f=${空跑};export const 新增仅项目联系人Action=f,改仅项目联系人Action=f;`);
  stub(/^\.\.\/\.\.\/favorites$/, `export const 切换项目收藏=async()=>({ok:true,收藏了:true});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import CustomerDetail from '@/app/(app)/customers/[id]/CustomerDetail';import RestrictedCustomerDetail from '@/app/(app)/customers/[id]/RestrictedCustomerDetail';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 人=(id,name,isPrimary)=>({id,name,position:'采购',phone:'1381200000'+id.slice(1),email:null,wechat:null,isPrimary,remark:null,updatedAt:'2026-01-01T00:00:00.000Z'});
    const contacts=[人('c1','王总',true),人('c2','李工',false),人('c3','陈经理',false)];
    // D3：8 位联系人（超长名字、没填名字、超长号码）
    const 八人=[{...人('c1','王总',true),phone:'+86 138-0013-8000 转 1234'},人('c2','李工',false),人('c3','陈经理',false),人('c4','超长联系人名字'.repeat(4),false),{...人('c5','',false),position:null},人('c6','赵六',false),人('c7','钱七',false),{...人('c8','孙八',false),phone:null}];
    const 换负责人=[{at:'2026-09-01T02:00:00.000Z',操作人:'管理员',从:'欧阳某某某某',到:'同事乙',kind:'转让'},{at:'2026-10-01T02:00:00.000Z',操作人:'管理员',从:'同事乙',到:'QA',kind:'转让'}];
    const 客户沟通=Array.from({length:5},(_,i)=>({id:'cf'+i,type:i===0?'OTHER':'PHONE',method:null,title:'',content:'客户全部里的沟通'+i,status:'已完成',duration:null,occurredAt:'2026-10-2'+i+'T02:00:00.000Z',dueAt:null,participants:null,sourceText:null,ownerName:'QA',contactName:null,contactPosition:null,contactId:null,opportunityId:null,updatedAt:'2026-10-20T02:00:00.000Z',项目:{id:i%2?'p2':'p1',名:i%2?'项目二':'项目一'}}));
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
      // 教练点评改版 PR1：当前项目的教练主题（能发 = 服务端按 P-教练-11/12/13 算好的），按角色给；只读管理员看得到主题但不能发
      if(当前&&o.点评!==undefined) 当前.教练主题={们:[],能发:o.点评,填写人:{id:'qa',name:'QA',身份:'销售教练'},负责人:{id:'u2',name:'同事乙'},项目名:当前.p.name,当前节点:'方案报价',待回复数:0,冻结:false};
      flushSync(()=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><div className='shell rail-mini'>{innerWidth>=768&&<nav className='rail' aria-label='主导航'/>}{innerWidth>=1214&&名单}<main className='main app-content' style={{padding:'22px 26px'}}><div>
        <CustomerDetail customer={{id:'a',extra:null,name:o.公司名||'客户A',phone:'13800138000',school:null,grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z',pool:null}}
          contacts={o.八人?八人:contacts} {...(o.历史?{换负责人记录:换负责人}:{})} contracts={[]} tasks={[{id:'t1',title:'周五带合同上门',dueAt:'2026-11-13T02:00:00.000Z',done:false}]} plan={null}
          users={[{id:'qa',name:'QA',email:'qa@x'},{id:'u2',name:'同事乙',email:'b@x'}]} channels={[]} aiEnabled={false} followUps={客户沟通} followUpsHasMore={false}
          项目们={签.map(t=>({id:t.id,name:t.name,phase:'商机',node:t.节点,result:null,pooledAt:null,amount:0,currency:'CNY'}))} 参与项目们={[]} 关联们={[]} 旺旺们={[]}
          跟进去处={[{id:'p1',名:'项目一',主:true,结束:false,说明:null,下一步:null,下一步文字:null}]} 待办计划={[]} 能放公海 新建项目={{节点们:['线索验证'],要下一步:false}}
          只读={o.只读?'全':false} {...(o.不能转?{能转让客户:false}:{})} {...(o.不能放?{能放公海:false}:{})}
          三态条={o.提醒?{状态:'沉睡',文字:'满 90 天没有有效沟通，也可以用右上角「客户操作」转让或退回公海',悬停:'满 90 天没有有效沟通',旁注:null,按钮们:[{动作:'继续持有',字:'我还在跟',说明:'顺延 30 天',要理由:false,主:true}]}:null}
          项目数据={{customerId:'a',页签们:签,锁数:o.锁数??0,当前}}
          {...(o.号码?{号码种类:[{名:'手机',kind:'phone',active:true},{名:'座机',kind:'landline',active:true},{名:'WhatsApp',kind:'whatsapp',active:true}],客户号码们:[{kind:'landline',value:'010-66001234'},{kind:'whatsapp',value:'+44 20 7946 0958'}]}:{})}/>
      </div></main></div></BusinessProvider></App></ConfigProvider>));
    };
    // 受限客户详情（只负责项目的人）：同一套项目区 + 嵌入版 ProjectDetail，左栏客户只读卡
    window.__renderR=(o={})=>{
      window.__sp='';
      const 当前=当前of({...项目们.p1,name:'项目一'+长,能删:!!o.删},true);
      flushSync(()=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><div className='shell rail-mini'>{innerWidth>=768&&<nav className='rail' aria-label='主导航'/>}<main className='main app-content' style={{padding:'22px 26px'}}><div>
        <RestrictedCustomerDetail 数据={{客户:{id:'a',name:o.公司名||'客户A'},
          卡:{客户:{name:o.公司名||'客户A',shortName:'A',school:null,customerType:null,customerAttr:null,地区:'',addrDetail:null,website:null},联系人:[{name:'王总',position:'采购',给联系方式:true,phone:'138****0001',email:null,wechat:null,号码们:[]},{name:'李工',position:null,给联系方式:false,phone:null,email:null,wechat:null,号码们:[]}]},
          可改联系人:[],项目区:{customerId:'a',页签们:o.空?[]:o.两个?页签们:[页签们[0]],锁数:0,当前:o.空?null:当前},
          沟通:[{id:'rf1',type:'PHONE',method:null,content:'我项目上的沟通',occurredAt:'2026-10-03T02:00:00.000Z',who:'QA',项目:{id:'p1',名:'项目一'}},{id:'rf2',type:'OTHER',method:null,content:'没填方式的沟通',occurredAt:'2026-10-02T02:00:00.000Z',who:'QA',项目:{id:'p1',名:'项目一'}}],
          待办:{任务:[],计划:[]},号码种类:[],职务选项:[]}}/>
      </div></main></div></BusinessProvider></App></ConfigProvider>));
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 参 = { 八人?: boolean; 历史?: boolean; 皮?: string; 号码?: boolean; 单?: boolean; 末?: boolean; 选?: string; 空?: boolean; 只读?: boolean; 锁数?: number; 公司名?: string; 多?: boolean; 地址?: string; 删?: boolean; 领不了?: boolean; 提醒?: boolean; 点评?: boolean; 不能转?: boolean; 不能放?: boolean };
/** 右上角下拉（11-21 教练点评改版 PR1：「发起点评 ▾」「更多操作 ▾」；原 11-12「AI / 项目操作 / 客户操作」）：点开，返回菜单 */
const 开菜单 = async (page: Page, 名: "更多操作" | "发起点评") => {
  await page.locator(".rec-head-acts").getByRole("button", { name: new RegExp(名) }).click();
  const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) ul.rec-head-menu").filter({ has: page.locator("li") }).last();
  await 菜单.waitFor();
  return 菜单;
};
/** 菜单里的项：文字（灰着的带 ⊘ 前缀、危险色带 !），分隔线写成「—」，分组小标题写成「#标题」、组里的项接着往下排 */
const 菜单项们 = (菜单: import("playwright").Locator) => 菜单.evaluate((ul) => {
  const 项 = (l: HTMLElement) => `${l.getAttribute("aria-disabled") === "true" ? "⊘" : ""}${l.classList.contains("ant-dropdown-menu-item-danger") ? "!" : ""}${l.innerText.replace(/\s+/g, " ").trim()}`;
  return ([...ul.children] as HTMLElement[]).flatMap(l =>
    l.classList.contains("ant-dropdown-menu-item-divider") ? ["—"]
      : l.classList.contains("ant-dropdown-menu-item-group")
        ? [`#${(l.querySelector(".ant-dropdown-menu-item-group-title") as HTMLElement).innerText.trim()}`, ...([...l.querySelectorAll(":scope > ul > li")] as HTMLElement[]).map(项)]
        : [项(l)]);
});
/** 页头右端那几颗按钮的字 */
const 头按钮 = (page: Page) => page.locator(".rec-head-acts > button").evaluateAll((bs: HTMLElement[]) => bs.map(b => b.innerText.replace(/\s+/g, "")));
async function 开(width: number, o: 参 = {}, height = 800) {
  const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("http://cust-merge.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://cust-merge.test/customers/a"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  if (o.皮) {
    await page.evaluate(k => document.documentElement.setAttribute("data-skin", k), o.皮);
    for (const f of ["src/app/skins/shared.css", `src/app/skins/${o.皮}.css`]) await page.addStyleTag({ path: path.resolve(f) });
  }
  await page.addScriptTag({ content: bundle });
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
    // D3 起左栏先摊开前 3 位、其余收在「展开其余 N 位」后面：先全摊开再量
    if (await page.locator('.rec-contact-rest-btn[aria-expanded="false"]').count()) await page.locator('.rec-contact-rest-btn[aria-expanded="false"]').click();
    // 李工在本项目里是使用方、支持
    expect(await page.locator(".rec-contact", { hasText: "李工" }).getByTestId("contact-project-role").innerText()).toMatch(/本项目\s*使用方 · 支持/);
    // 页签是到客户详情 ?project= 的链接，当前那个标着
    const 页签 = page.locator(".cd-pj-pills").getByRole("tab");
    expect(await 页签.evaluateAll((ts: HTMLElement[]) => ts.map(t => [t.getAttribute("href"), t.getAttribute("aria-selected")]))).toEqual([["/customers/a?project=p1", "true"], ["/customers/a?project=p2", "false"]]);
    // 切到项目二（服务端按 ?project=p2 重画）：关键换成陈经理、排最前；王总变成其他联系人，不再是关键
    await 画(page, { 选: "p2" });
    expect(await 联系人们(page)).toEqual(["陈经理*", "王总", "李工"]);
    if (await page.locator('.rec-contact-rest-btn[aria-expanded="false"]').count()) await page.locator('.rec-contact-rest-btn[aria-expanded="false"]').click();
    expect(await page.locator(".rec-contact", { hasText: "李工" }).getByTestId("contact-project-role").count()).toBe(0);
    expect(await page.locator(".cd-pj-pills").getByRole("tab", { selected: true }).getAttribute("href")).toBe("/customers/a?project=p2");
    expect(await page.locator(".rec-zone").getAttribute("data-project")).toBe("p2");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// 用例时序（11-12 推送前偶发）：createRoot.render 是排进调度的，__render 返回时 DOM 可能还是上一页签，而 画 等的元素上一页早就有，
// 有负载时就读到旧的「王总*」。__render / __renderR 用 flushSync 画完才返回；这条在同一次 evaluate 里同步读，没 flushSync 必红
it("测试桩：__render 切页签后同步就画好（防读到上一页签的左栏）", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 读 = await page.evaluate(() => { (window as unknown as { __render: (o: object) => void }).__render({ 选: "p2" }); return [...document.querySelectorAll(".rec-rail .rec-contact")].map(c => c.querySelector(".rec-contact-n")!.textContent + (c.querySelector(".tag-key") ? "*" : "")); });
    expect(读).toEqual(["陈经理*", "王总", "李工"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("没有项目可选：项目区空状态 +「＋ 新建项目」；关键联系人退回客户级「主要联系人」，不分「其他联系人」", async () => {
  const { page, errors } = await 开(1280, { 空: true });
  try {
    const 空 = page.getByTestId("project-zone-empty");
    expect(await 空.innerText()).toMatch(/这位客户还没有项目/);
    expect(await 空.getByRole("button", { name: /新建项目/ }).count()).toBe(1);
    // 页签行不再摆「＋ 新建项目」；没有项目时「更多操作」里项目那组只剩新建项目（小标题只写「项目」），客户那组照旧
    expect(await page.locator(".cd-zh button, .cd-pj button, .cd-add:not(.cd-add-big)").count()).toBe(0);
    expect(await 菜单项们(await 开菜单(page, "更多操作"))).toEqual(["#项目", "新建项目", "—", "#客户", "客户转让 客户换负责人，名下项目一起走", "客户退回公海"]);
    await page.keyboard.press("Escape");
    expect(await page.locator(".cd-pj-pills").getByRole("tab").count()).toBe(0);
    expect(await 联系人们(page)).toEqual(["王总*", "李工", "陈经理"]);
    expect(await page.locator(".rec-contact-sub").count()).toBe(0);
    // 没有项目也照样看得到这位客户的沟通记录（只看，不能新建）和待办
    const 沟通 = page.locator(".rec-zone .cd-comm");
    expect(await 沟通.getByText(/客户全部里的沟通/).count()).toBe(5);
    expect(await 沟通.getByRole("button", { name: /新建沟通/ }).count()).toBe(0);
    // 没填沟通方式的（11-17：c2 上「未注明」清成空）显示「—」，不显示「其他记录」
    expect(await 沟通.locator(".rec-tl-type, .rec-sum-type").allInnerTexts()).toEqual(["电话沟通", "电话沟通", "电话沟通", "电话沟通", "—"]);
    expect(await 沟通.getByText("其他记录").count()).toBe(0);
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

it("1024 / 1280 / 1366：页签行一行不换行、右端不再有按钮；页头只有「更多操作 ▾」（项目、客户两组），项目各动作在菜单里、只作用于当前项目；超长项目名、超长公司名省略不撑出、不横滚", async () => {
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
      // 页头：下拉和客户名同一行、不折行；没有「AI」按钮（11-21 PR1 去掉，AI 从浮标 / ⌘J 进）
      expect(await 头按钮(page)).toEqual(["更多操作"]);
      const [名, 排] = await Promise.all([page.locator(".rec-head-id").boundingBox(), page.locator(".rec-head-acts").boundingBox()]);
      expect(排!.y, `宽 ${w}`).toBeLessThan(名!.y + 名!.height);
      expect(await page.locator(".rec-head-acts button").evaluateAll((bs: HTMLElement[]) => bs.every(b => b.getBoundingClientRect().height <= 40))).toBe(true);
      // 更多操作：项目组小标题灰字「项目 · 名字（节点）」（设计语言 D2 · M1-b）（超长一行省略、title 全名），新建、转让、退回公海；再是客户组
      const 菜单 = await 开菜单(page, "更多操作");
      const 项们 = await 菜单项们(菜单);
      expect(项们.slice(1), `宽 ${w}`).toEqual(["新建项目", "项目转让", "项目退回公海", "—", "#客户", "客户转让 客户换负责人，名下项目一起走", "客户退回公海"]);
      expect(项们[0]).toMatch(/^#项目 · 项目一/);
      expect(项们[0]).not.toContain("当前：");
      const 名格 = 菜单.locator(".rec-menu-cur-t").first();
      expect(await 名格.getAttribute("title")).toMatch(/^项目 · 项目一超长项目名字.*（.+）$/);
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

it("更多操作：项目组、客户组，删除项目单独放整个菜单最后、危险色、上面一条线，点了走原来的确认；领取灰着时菜单项灰着并写原因", async () => {
  const { page, errors } = await 开(1280, { 删: true, 领不了: true });
  try {
    const 菜单 = await 开菜单(page, "更多操作");
    const 项们 = await 菜单项们(菜单);
    expect(项们.slice(1)).toEqual(["新建项目", "⊘领取 你是原负责人，不能领回", "项目转让", "项目退回公海", "—", "#客户", "客户转让 客户换负责人，名下项目一起走", "客户退回公海", "—", "!删除项目"]);
    await 菜单.getByRole("menuitem", { name: /删除项目/ }).click();
    // 后果框（PR5a，替代 modal.confirm）：标题、删前清点写在框里，取消关掉
    const 删框 = page.getByRole("dialog").filter({ hasText: "删除这个项目？" });
    await 删框.waitFor();
    await 删框.getByRole("button", { name: /取\s*消/ }).click();
    await 删框.waitFor({ state: "hidden" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("项目区正在提交（退回公海还没回来）：页头「更多操作 ▾」里对当前项目的几项灰着写「正在处理」，新建项目、客户那组照常能点", async () => {
  const { page, errors } = await 开(1280, { 删: true });
  try {
    await page.evaluate(() => { (window as unknown as { __挂起: boolean }).__挂起 = true; });
    await (await 开菜单(page, "更多操作")).getByRole("menuitem", { name: /项目退回公海/ }).click();
    const 框 = page.getByRole("dialog", { name: "把项目退回公海？" });
    await 框.getByRole("button", { name: "项目退回公海" }).click();
    await expect.poll(() => 框.getByRole("button", { name: "项目退回公海" }).evaluate(b => b.classList.contains("ant-btn-loading"))).toBe(true);
    await 框.getByRole("button", { name: /取\s*消/ }).click();
    const 菜单 = await 开菜单(page, "更多操作");
    const 项们 = await 菜单项们(菜单);
    expect(项们.slice(1)).toEqual(["新建项目", "⊘项目转让 正在处理上一步，稍等", "⊘项目退回公海 正在处理上一步，稍等", "—", "#客户", "客户转让 客户换负责人，名下项目一起走", "客户退回公海", "—", "⊘!删除项目 正在处理上一步，稍等"]);
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
    // 和中栏那一列同宽（量进程卡：D2 起中栏是一扇自己滚的窗，左右各让 4px 给卡片阴影，栏框比列宽 8px）
    expect(Math.abs(框!.x - 进程卡!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(框!.width - 进程卡!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(框!.x - 中栏!.x)).toBeLessThanOrEqual(5);
    expect(框!.y + 框!.height).toBeLessThanOrEqual(进程卡!.y + 1);
    expect(Math.abs(右栏!.y - 中栏!.y)).toBeLessThanOrEqual(1);
    expect(await page.locator(".rec-head + [data-testid=tri-state-bar]").count()).toBe(0);
    expect(await 条.innerText()).toContain("右上角「客户操作」"); // 桩里的话（服务端那句 11-21 起说「更多操作」，见 ent-tri-state-detail.test.ts）
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
    expect(await page.getByRole("button", { name: /更多操作|发起点评|项目操作|客户操作/ }).count()).toBe(0);
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

/* ---------- 11-21 教练点评改版 PR1：页头「发起点评 ▾」「更多操作 ▾」 ---------- */
it.each([
  // [角色, 参, 页头右端]：发起点评只给能发的人（P-教练-11/12/13：教练、实线 / 虚线上级、条线总管理、系统管理员），项目负责人本人、只读管理员不摆（不是灰着）
  ["销售（项目负责人本人）", { 点评: false }, ["更多操作"]],
  ["销售管理（实线上级，能转让、能退回、能发点评）", { 点评: true }, ["发起点评", "更多操作"]],
  ["销售教练（全只读，能发点评）", { 点评: true, 只读: true }, ["发起点评"]],
  ["只读管理员（全只读，看得到主题不能发）", { 点评: false, 只读: true }, []],
] as const)("页头按角色：%s", async (_角色, o, 期望) => {
  const { page, errors } = await 开(1366, o);
  try {
    expect(await 头按钮(page)).toEqual([...期望]);
    expect(await page.getByRole("button", { name: /^AI$/ }).count()).toBe(0);
    if (!期望.length) expect(await page.locator(".rec-head-acts").count()).toBe(0);
    // 「发起点评」在左、「更多操作」永远在最右
    if (期望.length === 2) {
      const [左, 右] = await Promise.all([page.getByTestId("coach-topic-new").boundingBox(), page.getByTestId("rec-more-ops").boundingBox()]);
      expect(左!.x + 左!.width).toBeLessThanOrEqual(右!.x);
    }
    // 沟通卡头不再有「发起主题 / 发起点评」：只剩「隐藏接手前」（有接手前的沟通才有）和「新建沟通」
    const 卡头 = page.locator(".cd-comm .ant-card-extra");
    expect(await 卡头.getByTestId("coach-topic-new").count()).toBe(0);
    expect(await 卡头.getByRole("button", { name: /发起主题|发起点评/ }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("「更多操作 ▾」= 原「项目操作」+「客户操作」的并集，一项不丢；客户那组只剩一项、项目那组没有时各自照样分组", async () => {
  const 原项目操作 = ["新建项目", "项目转让", "项目退回公海", "删除项目"];
  const 原客户操作 = ["客户转让", "客户退回公海"];
  const 名 = (xs: string[]) => xs.filter(x => x !== "—" && !x.startsWith("#")).map(x => x.replace(/^[⊘!]+/, "").split(" ")[0]);
  const { page, errors } = await 开(1280, { 删: true });
  try {
    const 项们 = await 菜单项们(await 开菜单(page, "更多操作"));
    expect(名(项们).sort()).toEqual([...原项目操作, ...原客户操作].sort());
    expect(项们.filter(x => x.startsWith("#")).map(x => x.replace(/ · .*/, ""))).toEqual(["#项目", "#客户"]);
    await page.keyboard.press("Escape");
    // 不能转客户：客户组只剩「客户退回公海」
    await 画(page, { 删: true, 不能转: true });
    expect(名(await 菜单项们(await 开菜单(page, "更多操作")))).toEqual(["新建项目", "项目转让", "项目退回公海", "客户退回公海", "删除项目"]);
    await page.keyboard.press("Escape");
    // 客户组一项都没有：连小标题「客户」一起不出，也没有多余的分隔线
    await 画(page, { 不能转: true, 不能放: true });
    const 只项目 = await 菜单项们(await 开菜单(page, "更多操作"));
    expect(只项目.some(x => x === "#客户")).toBe(false);
    expect(只项目.filter(x => x === "—")).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("「发起点评 ▾」：小标题当前项目（节点）；写点评开原「发起主题」那只框（标题改叫写点评）；录音点评灰着、写「录音点评即将开放」、点了什么都不开", async () => {
  const { page, errors } = await 开(1366, { 点评: true });
  try {
    const 菜单 = await 开菜单(page, "发起点评");
    expect(await 菜单项们(菜单)).toEqual([expect.stringMatching(/^#项目 · 项目一.*（方案报价）$/), "写点评 打字写，和原来的「发起主题」一样", "⊘录音点评 录音点评即将开放"]);
    expect(await page.getByTestId("coach-review-voice").getAttribute("title")).toBe("录音点评即将开放");
    // 灰着的项 Playwright 点不进（CI 上 force 也报「不在视口里」）：直接派一个 click 事件，看它什么都不做
    await 菜单.getByRole("menuitem", { name: /^录音点评/ }).dispatchEvent("click");
    await page.waitForTimeout(150);
    expect(await page.locator(".ant-modal").count()).toBe(0);
    // 写点评：原来那只框，项目 / 节点 / 填写人锁定、会通知负责人
    if (!(await 菜单.isVisible())) await 开菜单(page, "发起点评");
    // 同上，这只下拉在 CI 上量出来不在视口里（只在这个用例的页面里），点击用派事件，不靠坐标
    await page.getByRole("menuitem", { name: /^写点评/ }).dispatchEvent("click");
    const 框 = page.locator(".ant-modal");
    await 框.waitFor();
    expect(await 框.locator(".ant-modal-title").innerText()).toBe("写点评");
    expect(await 框.innerText()).toMatch(/会通知\s*项目负责人 · 同事乙/);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1280, 1366])("%ipx 超长公司名：「发起点评 ▾」「更多操作 ▾」和客户名同一行、不折行、不越出页面，整页不横滚", async (w) => {
  const { page, errors } = await 开(w, { 点评: true, 公司名: "超长公司名有限责任公司".repeat(8) });
  try {
    expect(await 头按钮(page)).toEqual(["发起点评", "更多操作"]);
    const 量 = await page.evaluate(() => {
      const 名 = document.querySelector(".rec-head-id")!.getBoundingClientRect();
      const 钮 = [...document.querySelectorAll(".rec-head-acts > button")].map(b => b.getBoundingClientRect());
      const 头 = document.querySelector(".rec-head")!.getBoundingClientRect();
      return {
        同一行: 钮.every(b => b.top < 名.bottom && b.bottom > 名.top),
        折行: 钮.filter(b => b.height > 40).length,
        越框: 钮.filter(b => b.right > 头.right + 1 || b.right > document.documentElement.clientWidth).length,
        横滚: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    expect(量).toEqual({ 同一行: true, 折行: 0, 越框: 0, 横滚: false });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([390, 375])("手机 %ipx：名字一行，下面「发起点评 ▾」「更多操作 ▾」两颗各占一半、同一行，不横滚", async (w) => {
  const { page, errors } = await 开(w, { 点评: true, 公司名: "超长公司名有限责任公司".repeat(4) }, 900);
  try {
    expect(await 头按钮(page)).toEqual(["发起点评", "更多操作"]);
    const 量 = await page.evaluate(() => {
      const 名 = document.querySelector(".rec-head-id")!.getBoundingClientRect();
      const 排 = document.querySelector(".rec-head-acts")!.getBoundingClientRect();
      const 头 = document.querySelector(".rec-head")!.getBoundingClientRect();
      const [a, b] = [...document.querySelectorAll(".rec-head-acts > button")].map(x => x.getBoundingClientRect());
      return {
        在名字下面: a.top >= 名.bottom - 1, 同一行: Math.abs(a.top - b.top) <= 1, 各半: Math.abs(a.width - b.width) <= 2,
        占满: 排.width >= 头.width - 2, 左右: a.right <= b.left, 折行: [a, b].filter(x => x.height > 40).length,
        横滚: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    expect(量).toEqual({ 在名字下面: true, 同一行: true, 各半: true, 占满: true, 左右: true, 折行: 0, 横滚: false });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

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
    await expect.poll(() => 身.isVisible()).toBe(true);
    await 壳.getByRole("button", { name: "收起所有待办" }).click();
    await expect.poll(() => 身.isVisible()).toBe(false);
    const 右 = 壳.getByRole("button", { name: "展开所有待办" });
    expect(await 右.getAttribute("aria-expanded")).toBe("false");
    expect(await 壳.getByRole("button", { name: /新建待办/ }).isVisible()).toBe(true);
    await 右.click();
    await expect.poll(() => 身.isVisible()).toBe(true);
    expect(await 壳.getByRole("button", { name: "收起所有待办" }).getAttribute("aria-expanded")).toBe("true");
    // 卡点默认收着，点右半摊开
    const 卡点 = page.locator("#project-blockers");
    await 卡点.getByRole("button", { name: "展开当前卡点" }).click();
    await expect.poll(() => 卡点.locator(":scope > .ant-card > .ant-card-body").isVisible()).toBe(true);
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
    await expect.poll(() => page.locator("#project-follow > .ant-card > .ant-card-body").isVisible()).toBe(false);
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

it("手机单栏：客户名和客户按钮 → 客户联系人（D3 · M0-2 挪到页头下）→ 卡头项目切换 → 阶段 → 沟通 → 待办 → 卡点 → 项目资料 → 客户资料；不横滚", async () => {
  const { page, errors } = await 开(375, {}, 900);
  try {
    await expect.poll(() => page.locator(".rec.rec-cd").evaluate(el => el.classList.contains("rec-1col"))).toBe(true);
    const 上 = (s: string) => page.locator(s).first().evaluate(el => el.getBoundingClientRect().top);
    const 顺序 = [
      ".rec-head",
      "#cust-contacts",
      ".cd-mid > .ant-card",
      "#project-follow",
      '.cd-mid > .proj-fold:has(.split-caret[aria-label="收起所有待办"])',
      "#project-blockers",
      ".cd-side",
      ".rec-rail > .proj-fold:not(#cust-contacts)",
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

/* 11-12 用户看 3702「按钮位置没对齐」：中栏四颗连体按钮（完成节点 / 新建沟通 / 新建待办 / 新建卡点）右边缘一条竖线、同高、同字号，右半箭头同宽同图标 */
it.each([[1024, false], [1280, false], [1366, false], [1280, true], [1366, true]] as const)("%ipx 名单 %s：中栏四颗连体按钮右边缘对齐、同高同字号，右半箭头同宽同图标", async (w, 名单) => {
  const { page, errors } = await 开(w, {});
  try {
    if (名单) await page.evaluate(() => { const r = document.querySelector(".rec-page") as HTMLElement; r.style.marginLeft = "280px"; });
    const 量 = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".cd-mid .split-btn")].map(g => {
      const bs = [...g.querySelectorAll<HTMLElement>(":scope > .ant-btn, :scope > * > .ant-btn")];
      const 尾 = bs.at(-1)!;
      const r = g.getBoundingClientRect(), t = 尾.getBoundingClientRect();
      const 字 = bs.length > 1 ? getComputedStyle(bs[0]).fontSize : "";
      const svg = 尾.querySelector("svg");
      return { 名: bs[0].textContent!.trim() || 尾.getAttribute("aria-label"), 右: Math.round(r.right), 高: Math.round(r.height), 字, 尾宽: Math.round(t.width), 图: svg ? `${svg.getAttribute("viewBox")}|${Math.round(svg.getBoundingClientRect().width)}` : "" };
    }));
    expect(量.length).toBe(4);
    expect(new Set(量.map(x => x.右)).size, JSON.stringify(量)).toBe(1);
    expect(new Set(量.map(x => x.高)).size, JSON.stringify(量)).toBe(1);
    expect(new Set(量.filter(x => x.字).map(x => x.字)).size, JSON.stringify(量)).toBe(1);
    expect(new Set(量.map(x => x.尾宽)).size, JSON.stringify(量)).toBe(1);
    expect(new Set(量.map(x => x.图)).size, JSON.stringify(量)).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("卡头行首「项目」两个字和项目名同色（单项目、多项目都是），字号字重照旧", async () => {
  for (const o of [{ 单: true }, {}]) {
    const { page, errors } = await 开(1280, o);
    try {
      const [字色, 名色, 号, 重] = await page.locator(".cd-pj .cd-cap").evaluate(el => {
        const 名 = document.querySelector(".cd-pj-one .cd-pj-nm") ?? document.querySelector(".cd-pj-one");
        const s = getComputedStyle(el);
        return [s.color, getComputedStyle(名 ?? document.body).color, s.fontSize, s.fontWeight];
      });
      if (o.单) expect(字色, "单项目").toBe(名色);
      expect(字色).toBe(await page.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--ink)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }));
      expect([号, 重]).toEqual(["12px", "500"]);
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

it("沟通切「这位客户全部」：词清掉（那条时间线不归它管）、搜索框原地变淡点不了、沟通卡不挪位（dt.scope）；切回本项目搜索框回来", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 搜 = page.locator(".rec-zone .proj-search input");
    await 搜.fill("项目一");
    const 卡 = page.locator(".cd-comm");
    const 卡顶 = (await 卡.boundingBox())!.y;
    await 卡.getByRole("button", { name: "这位客户全部" }).click();
    expect(await page.locator(".rec-zone .cd-search-wrap.is-off").count()).toBe(1);
    expect(await page.locator(".rec-zone .cd-search-wrap").evaluate((el) => (el as HTMLElement).inert)).toBe(true);
    await expect.poll(() => page.locator(".rec-zone .cd-search-wrap").evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(0.6);
    expect(Math.abs((await 卡.boundingBox())!.y - 卡顶)).toBeLessThan(2);
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
    // 审查 2：从通知带 giveup=1 来、那条看不了：改地址时一并去掉 giveup（拿的是旧参数串，不去掉会把它写回地址栏）
    await 画(page, { 地址: "project=看不了的&giveup=1&focus=plan:x" });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __换?: string }).__换)).toBe("/customers/a?project=p1&focus=plan%3Ax");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("受限客户详情（只负责项目的人）：页头「仅项目」+ 只有「更多操作 ▾」（11-21 PR1 前叫「项目操作 ▾」；只有项目一组，没有新建项目、没有客户组、没有发起点评）；沟通只看本项目，没有「这位客户全部」；1024 / 1280 / 1366 不横滚", async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.route("http://cust-merge.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
    await page.goto("http://cust-merge.test/customers/a"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
    const 画R = async (o: { 删?: boolean; 公司名?: string; 空?: boolean } = {}) => {
      await page.evaluate(a => (window as unknown as { __renderR: (o: object) => void }).__renderR(a), o as object);
      await page.getByTestId("restricted-customer-detail").waitFor();
      await page.locator(".cd-comm").waitFor();
    };
    await 画R({ 删: true });
    expect(await page.locator(".rec-head").getByText("仅项目", { exact: true }).count()).toBe(1);
    expect(await 头按钮(page)).toEqual(["更多操作"]);
    expect(await 菜单项们(await 开菜单(page, "更多操作"))).toEqual([expect.stringMatching(/^#项目 · 项目一/), "项目转让", "项目退回公海", "—", "!删除项目"]);
    // 不摆「发起点评」：这页只列我负责的项目，负责人本人不能发（方案 §7）
    expect(await page.getByTestId("coach-topic-new").count()).toBe(0);
    await page.keyboard.press("Escape");
    const 卡 = page.locator(".cd-comm");
    expect(await 卡.getByRole("button", { name: "这位客户全部" }).count()).toBe(0);
    expect(await 卡.getByRole("button", { name: "本项目" }).count()).toBe(0);
    expect(await 卡.getByText(/挂在项目一.*上的沟通/).count()).toBe(1);
    // 左栏只读卡：叫「客户资料（只读）」，没给号码的那位写原因
    expect(await page.locator(".rec-rail .rec-sec-t").first().innerText()).toMatch(/^客户资料（只读）/);
    // 没有项目时摆这位的全部沟通：没填沟通方式的显示「—」，不显示「其他记录」（11-17）
    await 画R({ 空: true });
    const 全部 = page.getByTestId("restricted-follow-all");
    expect(await 全部.locator(".rcd-follow-meta > span:nth-child(2)").allInnerTexts()).toEqual(["电话沟通", "—"]);
    expect(await 全部.getByText("其他记录").count()).toBe(0);
    for (const w of [1024, 1280, 1366]) {
      await page.setViewportSize({ width: w, height: 800 });
      await 画R({ 公司名: "超长公司名字".repeat(10) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `宽 ${w}`).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("受限客户详情：最后一个项目退回公海后回客户列表、带一句过去（不落 404、不弹顶部提示）；还有别的项目就回这位客户的详情", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.route("http://cust-merge.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
    await page.goto("http://cust-merge.test/customers/a"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
    for (const [两个, 去处] of [[false, "/customers"], [true, "/customers/a"]] as const) {
      await page.evaluate(a => { const w = window as unknown as { __renderR: (o: object) => void; __去?: string }; w.__去 = undefined; w.__renderR(a); }, { 两个 });
      await page.getByTestId("restricted-customer-detail").waitFor();
      await (await 开菜单(page, "更多操作")).getByRole("menuitem", { name: /项目退回公海/ }).click();
      const 框 = page.getByRole("dialog", { name: "把项目退回公海？" });
      await 框.getByRole("button", { name: "项目退回公海" }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __去?: string }).__去), { message: `两个 ${两个}` }).toBe(去处);
      // 不弹顶部提示；回客户列表的那一下带一句过去（lib/landing-note.ts），客户列表落地后在原处说（LandingNote，见 tests/ent-landing-note.ui.test.ts）
      expect(await page.locator(".ant-message-notice").count()).toBe(0);
      const 带的 = await page.evaluate(() => JSON.parse(sessionStorage.getItem("crm:landing-note") ?? "null") as { 到: string; 话: string } | null);
      if (两个) expect(带的).toBeNull();
      else expect(带的).toMatchObject({ 到: "/customers", 话: "这位客户下已经没有你负责的项目了，已回到客户列表" });
      await page.evaluate(() => sessionStorage.removeItem("crm:landing-note"));
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* 11-20 3703 实操：左栏「客户资料」卡里号码格编辑时，号码框只剩 ~24 宽（1366 / 1024），打的号看不见。
   改成编辑态上下排、放不下就折行：1366 / 1024 / 390 / 375 号码框都 ≥ 140、十五位号整个看得见，类型、号码、去掉不互相叠、不出卡，页不横滚 */
it.each([1366, 1024, 390, 375])("号码格编辑态 %ipx：号码框看得清，类型和号码不互相挤掉，不横滚", async (w) => {
  const { page, errors } = await 开(w, { 号码: true }, 900);
  try {
    /*
      点这一行的标签进编辑，不点行中心（CI #384 只在 390 红）：行里号码后面紧跟复制键，复制键按设计拦住点击（点复制不算点这一行）；
      Linux 字体数字窄一点，390 下行中心正好落在复制键上 → 复制了、没进编辑。点标签那一格才是稳定的「点这一行」
    */
    await page.getByRole("button", { name: "编辑号码" }).first().locator(".rec-field-k").click();
    await page.getByRole("button", { name: "加一个号码" }).waitFor();
    await page.getByRole("textbox", { name: "号码" }).first().fill("+86 13912345678");
    const m = await page.evaluate(() => {
      const 块 = document.querySelector("[data-testid=customer-numbers]") as HTMLElement;
      const 卡框 = (块.closest(".ant-card") as HTMLElement).getBoundingClientRect();
      const 叠 = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      const 行们 = [...块.querySelectorAll(".cn-row")].map((行) => {
        const 类 = 行.querySelector(".cn-kind")!.getBoundingClientRect();
        const 框 = 行.querySelector("input.cn-val") as HTMLInputElement;
        const 号 = 框.getBoundingClientRect();
        const 去 = 行.querySelector("button")!.getBoundingClientRect();
        return {
          类宽: 类.width, 号宽: 号.width, 截了: 框.scrollWidth > 框.clientWidth + 1,
          互叠: 叠(类, 号) || 叠(号, 去) || 叠(类, 去),
          出卡: [类, 号, 去].some((r) => r.right > 卡框.right + 0.5 || r.left < 卡框.left - 0.5),
        };
      });
      return { 卡宽: 卡框.width, 行们, 页横滚: document.documentElement.scrollWidth - window.innerWidth };
    });
    expect(m.行们.length, `${w}`).toBe(2);
    for (const [i, r] of m.行们.entries()) {
      expect(r.号宽, `${w} 第 ${i + 1} 行号码框宽（卡宽 ${m.卡宽}）`).toBeGreaterThanOrEqual(140);
      expect(r.类宽, `${w} 第 ${i + 1} 行类型没被挤`).toBeGreaterThanOrEqual(80);
      expect(r.互叠, `${w} 第 ${i + 1} 行类型、号码、去掉不叠`).toBe(false);
      expect(r.出卡, `${w} 第 ${i + 1} 行不出卡`).toBe(false);
    }
    expect(m.行们[0].截了, `${w} 十五位号（+86 13912345678）整个看得见`).toBe(false);
    expect(m.页横滚, `${w}`).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("[3703 实操 11-21] 从通知带 ?giveup=1 跳到客户详情、这条没有放弃入口（告示块不画）：照样弹为什么不能放弃，弹后去掉 giveup、留着 project；不带参数的什么都不多", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 812 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://cust-merge.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://cust-merge.test/customers/a?project=p1&giveup=1"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  try {
    await 画(page, { 地址: "project=p1&giveup=1" });
    // p1：不在公海、没异常、客户在自己名下、没有放弃入口 → 告示块不画
    expect(await page.locator(".cd-notice").count()).toBe(0);
    await page.getByTestId("proj-giveup-cant").waitFor();
    expect(await page.getByTestId("proj-giveup-cant").innerText()).toContain("记过有效沟通");
    expect(await page.evaluate(() => (window as unknown as { __问?: string[] }).__问)).toEqual(["p1"]);
    await expect.poll(() => page.evaluate(() => location.pathname + location.search)).toBe("/customers/a?project=p1");
    expect(await page.getByTestId("proj-giveup").count()).toBe(0);
    await page.getByTestId("proj-giveup-cant-ok").click();
    await page.getByTestId("proj-giveup-cant").waitFor({ state: "hidden" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  const { page: 平, errors: 平错 } = await 开(390, { 地址: "project=p1" });
  try {
    await 平.waitForTimeout(150);
    expect(await 平.getByTestId("proj-giveup-cant").count()).toBe(0);
    expect(await 平.locator(".ant-modal").count()).toBe(0);
    expect(await 平.locator(".cd-notice").count()).toBe(0);
    expect(await 平.evaluate(() => (window as unknown as { __问?: string[] }).__问 ?? [])).toEqual([]);
    expect(平错).toEqual([]);
  } finally { await 平.close(); }
});

/* D2 · 设计语言 11-21（客户详情规范 M0 / M1-c）：真 CustomerDetail 上量骨架和页头 */
const 超长公司名 = "某某超长贸易进出口有限公司".repeat(6);

it("[D2 · M0-a K10] 1024 / 1280 / 1366：中栏、右栏各自滚——右栏滚到底中栏不动（原来项目区整块滚，中栏滚出去只剩空白）；进程卡和项目资料顶边对齐；各栏底部至少留 72（AI 球）", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 开(w, { 公司名: 超长公司名 }, 768);
    try {
      // 右栏撑高（进程变更、关联卡都展开时那样）
      await page.locator(".cd-side").evaluate(el => { const d = document.createElement("div"); d.style.height = "2400px"; d.className = "撑高"; el.append(d); });
      const 量 = () => page.evaluate(() => {
        const g = (s: string) => { const e = document.querySelector(s) as HTMLElement; const r = e.getBoundingClientRect(); return { 顶: Math.round(r.top), 高: Math.round(r.height), 滚: Math.round(e.scrollTop), 溢: e.scrollHeight - e.clientHeight, 底留: parseFloat(getComputedStyle(e).paddingBottom) }; };
        return { 区: g(".rec-zone"), 中: g(".cd-mid"), 右: g(".cd-side"), 左: g(".rec > .rec-rail"), 进程卡顶: Math.round(document.querySelector(".cd-mid > .ant-card")!.getBoundingClientRect().top), 资料卡顶: Math.round(document.querySelector(".cd-side > *")!.getBoundingClientRect().top) };
      });
      const 前 = await 量();
      expect(前.区.溢, `宽 ${w} 项目区自己不滚`).toBe(0);
      expect(前.右.溢, `宽 ${w}`).toBeGreaterThan(1000);
      expect(前.中.高, `宽 ${w} 中栏一扇窗 = 右栏一扇窗`).toBe(前.右.高);
      expect(Math.abs(前.进程卡顶 - 前.资料卡顶), `宽 ${w} 进程卡和项目资料顶边对齐（P-界面-22 ②）`).toBeLessThanOrEqual(1);
      for (const k of ["中", "右", "左"] as const) expect(前[k].底留, `宽 ${w} ${k}栏底部留白`).toBeGreaterThanOrEqual(72);
      await page.locator(".cd-side").evaluate(e => { e.scrollTop = e.scrollHeight; });
      await page.waitForTimeout(100);
      const 后 = await 量();
      expect(后.右.滚, `宽 ${w}`).toBeGreaterThan(1000);
      expect(后.中.滚, `宽 ${w} 中栏不跟着滚`).toBe(0);
      expect(后.中.顶, `宽 ${w} 中栏没被滚出去`).toBe(前.中.顶);
      expect(后.进程卡顶, `宽 ${w}`).toBe(前.进程卡顶);
      expect(后.区.滚).toBe(0);
      // 中栏自己也能滚（沟通多时），右栏不跟
      await page.locator(".cd-mid").evaluate(el => { const d = document.createElement("div"); d.style.height = "1600px"; el.append(d); el.scrollTop = 300; });
      await page.locator(".cd-side").evaluate(e => { e.scrollTop = 0; });
      await page.waitForTimeout(100);
      const 再 = await 量();
      expect(再.中.滚, `宽 ${w}`).toBe(300);
      expect(再.右.滚, `宽 ${w}`).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `宽 ${w} 不横滚`).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("[D2 · M1-c] 四个宽度 × 超长公司名：页头不撑破、头像和名字同一行；电脑上名字一行省略、按钮在同一行右端；手机（390）名字最多两行再省略、名单钮 44、下面一行两颗钮各半高 40", async () => {
  for (const w of [1024, 1280, 1366, 390]) {
    const { page, errors } = await 开(w, { 公司名: 超长公司名, 点评: true }, 844);
    try {
      const 头 = await page.evaluate(() => {
        const r = (s: string) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), 右: Math.round(b.right), 底: Math.round(b.bottom), 宽: Math.round(b.width), 高: Math.round(b.height) }; };
        const 名 = document.querySelector(".rec-head-name") as HTMLElement;
        return { 头: r(".rec-head"), 钮: r(".rec-head > .pane-toggle"), 像: r(".rec-head-av"), 名格: r(".rec-head-id"), 名: r(".rec-head-name"), 行数: Math.round(名.getBoundingClientRect().height / parseFloat(getComputedStyle(名).lineHeight)), 截了: 名.scrollHeight > 名.clientHeight + 1 || 名.scrollWidth > 名.clientWidth + 1,
          按钮们: [...document.querySelectorAll(".rec-head-acts > .ant-btn")].map(b => { const x = b.getBoundingClientRect(); return { y: Math.round(x.top), 高: Math.round(x.height), 宽: Math.round(x.width) }; }) };
      });
      expect(头.名格!.右, `宽 ${w} 名字那格不出页头`).toBeLessThanOrEqual(头.头!.右 + 1);
      expect(头.截了, `宽 ${w} 超长名字被截住（省略）`).toBe(true);
      // 头像和名字那格同一行：名字那格的上下范围盖住头像中线
      const 像中 = 头.像!.y + 头.像!.高 / 2;
      expect(像中, `宽 ${w} 头像和名字同一行`).toBeGreaterThanOrEqual(头.名格!.y);
      expect(像中, `宽 ${w}`).toBeLessThanOrEqual(头.名格!.底);
      expect(头.名格!.x, `宽 ${w} 名字在头像右边`).toBeGreaterThanOrEqual(头.像!.右);
      expect(头.按钮们.length, `宽 ${w}`).toBe(2);
      if (w >= 768) {
        expect(头.行数, `宽 ${w} 电脑上一行`).toBe(1);
        for (const b of 头.按钮们) expect(b.y, `宽 ${w} 按钮和名字同一行`).toBeLessThan(头.名格!.底);
      } else {
        expect(头.行数, "手机两行").toBe(2);
        expect(头.钮).toMatchObject({ 宽: 44, 高: 44 });
        expect(头.钮!.y + 头.钮!.高 / 2, "名单钮和头像同一行").toBeCloseTo(像中, 0);
        for (const b of 头.按钮们) { expect(b.高).toBe(40); expect(b.y).toBeGreaterThanOrEqual(头.名格!.底); }
        expect(Math.abs(头.按钮们[0].宽 - 头.按钮们[1].宽), "两颗各半").toBeLessThanOrEqual(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `宽 ${w} 不横滚`).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("[D2 · M1-c] 页头按钮悬停只铺浅底（--row-hover）、框 --field-line、字不变色，按下再深一档（--hover）", async () => {
  const { page, errors } = await 开(1366, { 点评: true });
  try {
    const 钮 = page.locator(".rec-head-acts > .ant-btn").last();
    const 底 = (v: string) => page.evaluate(v => { const s = document.createElement("span"); s.style.background = `var(${v})`; document.body.append(s); const c = getComputedStyle(s).backgroundColor; s.remove(); return c; }, v);
    const 框 = (v: string) => page.evaluate(v => { const s = document.createElement("span"); s.style.borderTop = `1px solid var(${v})`; document.body.append(s); const c = getComputedStyle(s).borderTopColor; s.remove(); return c; }, v);
    const 字前 = await 钮.evaluate(b => getComputedStyle(b).color);
    await 钮.hover(); await page.waitForTimeout(150);
    const 悬 = await 钮.evaluate(b => ({ 底: getComputedStyle(b).backgroundColor, 框: getComputedStyle(b).borderTopColor, 字: getComputedStyle(b).color }));
    expect(悬.底).toBe(await 底("--row-hover"));
    expect(悬.框).toBe(await 框("--field-line"));
    // 字照旧正文色（真页面 antd 主题 colorText = palette.ink，悬停也是 ink；这个夹具没挂主题，静止时是 antd 默认黑，所以对 --ink 比）
    expect(悬.字).toBe(await page.evaluate(() => { const s = document.createElement("span"); s.style.color = "var(--ink)"; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }));
    expect(字前).not.toBe("");
    await page.mouse.down(); await page.waitForTimeout(200);
    expect(await 钮.evaluate(b => getComputedStyle(b).backgroundColor)).toBe(await 底("--hover"));
    await page.mouse.up();
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* D3 · 设计语言 11-21（客户详情规范 M3–M5）：真 CustomerDetail 上量联系人（方案 A）、变更记录、空态、卡头动作 */
const 取色 = (page: Page, v: string, 属 = "color") => page.evaluate(([v, 属]) => { const s = document.createElement("span"); s.style.setProperty(属, `var(${v})`); document.body.append(s); const c = getComputedStyle(s).getPropertyValue(属); s.remove(); return c; }, [v, 属]);
const 展开其余 = async (page: Page) => { if (await page.locator('.rec-contact-rest-btn[aria-expanded="false"]').count()) await page.locator('.rec-contact-rest-btn[aria-expanded="false"]').click(); };

it("[D3 · M4-a 方案 A] 四个宽度 × 8 位联系人：先摆前 3 位（关键第一、浅蓝「关键」），其余「展开其余 5 位」；号码一个字不截、不横滚；编辑 /「⋯」常显；组间一条细线", async () => {
  for (const w of [390, 1024, 1280, 1366]) {
    const { page, errors } = await 开(w, { 八人: true }, 900);
    try {
      expect(await 联系人们(page), `${w}`).toEqual(["王总*", "李工", "陈经理"]);
      const 关键 = page.locator(".rec-cg").first().locator(".tag-key");
      expect(await 关键.evaluate(e => getComputedStyle(e).backgroundColor), `${w}`).toBe(await 取色(page, "--brand-bg", "background-color"));
      const 钮 = page.getByRole("button", { name: "展开其余 5 位" });
      expect(await 钮.getAttribute("aria-expanded")).toBe("false");
      await 钮.click();
      expect(await page.locator(".rec-cg").count(), `${w}`).toBe(8);
      const 量 = await page.evaluate(() => {
        const 卡 = document.querySelector("#cust-contacts")!.getBoundingClientRect();
        return {
          号码截了: [...document.querySelectorAll("#cust-contacts .copy-val-t")].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent),
          出卡: [...document.querySelectorAll("#cust-contacts .rec-cg *")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > 卡.right + 0.5; }).map(e => e.className),
          横滚: document.documentElement.scrollWidth > innerWidth + 1,
          操作看不见: [...document.querySelectorAll("#cust-contacts .rec-contact-acts")].filter(e => getComputedStyle(e).opacity !== "1" || getComputedStyle(e).visibility === "hidden").length,
          线: [...document.querySelectorAll("#cust-contacts .rec-cg")].map(e => getComputedStyle(e, "::before").height),
          长号在: document.querySelector("#cust-contacts .rec-cg")!.textContent!.includes("+86 138-0013-8000 转 1234"),
          // 号码保护一枚一行（不在「：」后折开），放不下整枚挪到下一行
          保护最高: Math.max(...[...document.querySelectorAll("#cust-contacts .rec-contact-guard")].map(t => Math.round(t.getBoundingClientRect().height))),
        };
      });
      expect(量, `${w}`).toMatchObject({ 号码截了: [], 出卡: [], 横滚: false, 操作看不见: 0, 长号在: true });
      expect(量.保护最高, `${w} 号码保护一行`).toBeLessThanOrEqual(22);
      // 卡头「客户联系人（8）」不被「＋ 新增」挤出省略号（232 宽的左栏也放得下）
      expect(await page.locator("#cust-contacts .ant-card-head-title").evaluate(e => e.scrollWidth <= e.clientWidth + 1), `${w} 卡头标题`).toBe(true);
      // 第一位没线；第二、三位有；「这位客户的其他联系人」小标题后面那位由小标题自己的线隔开
      expect(量.线.slice(0, 2), `${w}`).toEqual(["auto", "1px"]);
      // 编辑、「⋯」点击区 28，手机 44（--hit-touch，PR #401 审查）
      const 编辑 = await page.locator(".rec-cg").first().locator(".rec-contact-edit").boundingBox();
      expect(Math.round(编辑!.height), `${w}`).toBe(w < 768 ? 44 : 28);
      await page.getByRole("button", { name: "收起其余 5 位" }).click();
      expect(await page.locator(".rec-cg").count()).toBe(3);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
}, 90_000);

it("[D3 · M4-b] 没填名字的联系人：「—」淡色（--empty-fg）常规字重，头像里的「—」同色；超长名字一行省略、title 给全名；号码保护灰底 + 锁、在号码后面", async () => {
  const { page, errors } = await 开(1366, { 八人: true });
  try {
    await 展开其余(page);
    const 空名 = page.locator(".rec-contact-n.is-empty");
    expect(await 空名.innerText()).toBe("—");
    const 淡 = await 取色(page, "--empty-fg");
    expect(await 空名.evaluate(e => [getComputedStyle(e).color, getComputedStyle(e).fontWeight])).toEqual([淡, "400"]);
    expect(await page.locator(".rec-contact-av.is-empty").evaluate(e => getComputedStyle(e).color)).toBe(淡);
    const 长 = page.locator(".rec-contact-n", { hasText: "超长联系人名字超长" });
    expect(await 长.evaluate(e => [getComputedStyle(e).textOverflow, e.scrollWidth > e.clientWidth, e.getAttribute("title")])).toEqual(["ellipsis", true, "超长联系人名字".repeat(4)]);
    // 号码保护：跟在第一个号码后面那一格里，灰底（--tag-bg）、带锁
    const 保护 = page.locator(".rec-cg").first().locator(".rec-contact-guard");
    expect(await 保护.evaluate(e => !!e.closest(".rec-contact-num") && !!e.querySelector(".anticon-lock"))).toBe(true);
    expect(await 保护.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await 取色(page, "--tag-bg", "background-color"));
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("[D3 · 手机] 390：联系人整张卡挪到页头下面、项目区前面；卡里的东西不出屏、不横滚", async () => {
  const { page, errors } = await 开(390, { 八人: true }, 900);
  try {
    const [头, 联, 项] = await Promise.all([page.locator(".rec-head").boundingBox(), page.locator("#cust-contacts").boundingBox(), page.locator(".cd-mid > .ant-card").first().boundingBox()]);
    expect(联!.y).toBeGreaterThan(头!.y + 头!.height - 1);
    expect(联!.y + 联!.height).toBeLessThanOrEqual(项!.y + 1);
    expect(联!.x + 联!.width).toBeLessThanOrEqual(390);
    // 客户资料卡照旧在项目区后面
    const 资料 = await page.locator(".rec-rail > .proj-fold:not(#cust-contacts)").first().boundingBox();
    expect(资料!.y).toBeGreaterThan(项!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("[D3 · M3-a / M3-c] 历史负责人：人名只在「、」处折、单个名字不拆；手机点「变更记录」开底部面板看每次谁换的，× 关；电脑上不摆这颗键（悬停看）", async () => {
  const { page, errors } = await 开(390, { 历史: true }, 900);
  try {
    const 格 = page.locator(".rec-names");
    expect(await 格.locator(".rec-nm").allInnerTexts()).toEqual(["同事乙", "欧阳某某某某"]);
    expect(await 格.locator(".rec-nm").evaluateAll((ns: HTMLElement[]) => ns.map(n => getComputedStyle(n).whiteSpace))).toEqual(["nowrap", "nowrap"]);
    await 格.getByRole("button", { name: "变更记录" }).click();
    const 面板 = page.locator(".hist-sheet .ant-drawer-content-wrapper");
    await 面板.waitFor();
    expect(await 面板.locator(".rec-hist-row").count()).toBe(2);
    expect(await 面板.innerText()).toContain("把负责人从 欧阳某某某某 换成 同事乙");
    expect(await 面板.locator(".sheet-grab").count()).toBe(1);
    const 关 = 面板.getByRole("button", { name: "关闭负责人变更记录" });
    expect(Math.round((await 关.boundingBox())!.width)).toBe(44);
    await 关.click();
    await expect.poll(() => page.locator(".hist-sheet .ant-drawer-content-wrapper").evaluate(e => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().top < innerHeight - 1).catch(() => false)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  const 电脑 = await 开(1366, { 历史: true });
  try {
    expect(await 电脑.page.locator(".rec-names .rec-hist-btn").evaluate(e => getComputedStyle(e).display)).toBe("none");
  } finally { await 电脑.page.close(); }
});

it("[D3 · M5-a] 空态字 --text-muted、句式「还没有 X」；左栏卡头动作同一款（图标 + 字，28 高，手机 44）", async () => {
  for (const w of [1366, 390]) {
    const { page, errors } = await 开(w, {}, 900);
    try {
      const 空 = page.locator(".rec-rail .rec-empty").first();
      expect(await 空.innerText()).toMatch(/^还没有/);
      expect(await 空.evaluate(e => getComputedStyle(e).color)).toBe(await 取色(page, "--text-muted"));
      const 钮们 = await page.locator(".rec-rail .rec-mod .ant-card-extra .ant-btn").evaluateAll((bs: HTMLElement[]) => bs.map(b => [b.innerText.trim(), Math.round(b.getBoundingClientRect().height), !!b.querySelector(".anticon")]));
      expect(钮们.length, `${w}`).toBeGreaterThan(0);
      for (const [字, 高, 有图标] of 钮们) expect([字 !== "", 高, 有图标], `${w} ${字}`).toEqual([true, w < 768 ? 44 : 28, true]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("[D3] 换皮主题（tech）不动：空态照旧 --text-faint、联系人照旧第一位摊开 + 其余手风琴（没有组、没有细线）、复制键 20", async () => {
  const { page, errors } = await 开(1366, { 八人: true, 皮: "tech" });
  try {
    expect(await page.locator(".rec-rail .rec-empty").first().evaluate(e => getComputedStyle(e).color)).toBe(await 取色(page, "--text-faint"));
    // 结构按主题分开渲染（lib/use-skin.ts）：换皮主题不出 D3 的「每人一组」
    expect(await page.locator(".rec-cg").count()).toBe(0);
    expect(await page.locator(".rec-contact-fold").count()).toBe(7);
    expect(Math.round((await page.locator(".rec-contact .copy-val-b").first().boundingBox())!.width)).toBe(20);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
