import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* 卡片改进 · 第一阶段（11-23，原型-卡片改进-20261123「改后」；用户 11-23 定最终外观：现状主题、白页面底 + 白卡）：客户详情三栏在真浏览器里量。
   真 CustomerDetail（RecordView + ProjectZone + 嵌入版 ProjectDetail）+ 真 InlineField + lib/theme + globals.css，只桩掉服务端动作（桩照 ent-cust-detail-merge）。钉的是：
   三栏卡头同一条顶线、都 48；进程卡把项目切换那一行做成卡头（右「完成节点」连体钮、不能收起）；标题 15 · 600、计数 13 灰；
   字段名 13 灰、值 14 主字色、三栏值起点都离卡左 92、超过 5 字的字段名一行省略；收起钮 32 纯图标、触屏点击区 44；
   「本项目 / 这位客户全部」在沟通卡身第一行、高 32、触屏 44；右栏多行字段改的时候标签在上、框占满一行；
   外观只剩一套（11-23 删了换皮主题和底色开关），这些就是默认样子；暗黑跟着 token；项目详情独立页共用的卡一起变、不坏 */
let browser: Browser, bundle: string;
const 空跑 = "async()=>({ok:true})";
const plugin: Plugin = { name: "card-refine", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  // 教练主题（11-17）的动作：服务端那串（prisma、通知）进不了浏览器包
  stub(/coach-topic-actions$/, "const f=async()=>({ok:true});export const 发主题动作=f,回复主题动作=f,关闭主题动作=f,删主题动作=f;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>window.__习惯??null;", "async()=>null"));
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
    export const saveCustomerNumbers=async()=>({ok:true}),patchCustomer=async()=>({ok:true});export const 转走项目预览of=async()=>({项目数:0,项目:[]}),deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=f;
    export const 项目沟通须知=async()=>({ok:true,能记:false}),记项目沟通Action=async()=>({ok:true,followUpId:'f1'});
    export const 编辑项目=f,改项目沟通=f,改项目节点=f,记完成节点被拦=f,终止项目进程=f,勾项目交付=f,删除项目=f,放回项目公海=(...a)=>window.__挂起?new Promise(()=>{}):f(...a),领取项目=f,判MQLAction=f,线索初判Action=f,市场复核Action=f,销售终验Action=f,总管理终判Action=f,销售认领Action=f,撤回验证Action=f,改项目画像Action=f,删项目沟通=f,加项目组员=f,换项目组员角色=f,移出项目组员=f;`);
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
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';import {themeConfig} from '@/lib/theme';
    import CustomerDetail from '@/app/(app)/customers/[id]/CustomerDetail';import ProjectDetail from '@/app/(app)/projects/[id]/ProjectDetail';import {项目画像项,字典定义} from '@/lib/enterprise/dict-kinds';import RestrictedCustomerDetail from '@/app/(app)/customers/[id]/RestrictedCustomerDetail';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
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
    // 项目详情独立页（共用 ProjectFold / ProjectDetail）：同一个项目，摆在 AppShell 那层壳里
    window.__renderP=()=>flushSync(()=>root.render(<ConfigProvider locale={zhCN} theme={themeConfig}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><div className='shell rail-mini'>{innerWidth>=768&&<nav className='rail' aria-label='主导航'/>}<main className='main app-content' style={{padding:'22px 26px'}}><div>
      <ProjectDetail {...当前of({...项目们.p1,画像:{项们:项目画像项.map(x=>({键:x.键,名:字典定义[x.种类].名,多选:x.多选,选项:[...字典定义[x.种类].默认]})),值:{}}})}/>
    </div></main></div></BusinessProvider></App></ConfigProvider>));
    window.__render=(o={})=>{
      window.__sp=o.地址||'';window.__换=undefined;
      const 签=o.空?[]:o.多?(o.末?[...多页签.slice(1),多页签[0]]:多页签):o.单?[页签们[0]]:页签们;
      const 当前=o.空?null:当前of(项目们[o.选||'p1'],!o.只读);
      if(当前&&o.只读) 当前.p={...当前.p,能记沟通:false,能放公海:false,能转让:false,能改节点:false,能删:false,关联:当前.p.关联};
      if(当前&&o.删) 当前.p={...当前.p,能删:true};
      // D4 审查：缺项小块各条落点——项目上的覆盖（必填、线索验证等）+ 画像卡
      if(当前&&o.项目改) 当前.p={...当前.p,...o.项目改,...(o.项目改.带画像?{画像:{项们:项目画像项.map(x=>({键:x.键,名:字典定义[x.种类].名,多选:x.多选,选项:[...字典定义[x.种类].默认]})),值:{}}}:{})};
      // 卡片改进第三阶段：右栏其余卡（回款、交付、项目组、提成、关联客户 / 联系人）都有内容（进程变更 11-24 挪进客户名下的「历史变更」弹窗）
      if(当前&&o.全) 当前.p={...当前.p,phase:'订单',node:'尾款结算',
        备货物流:{备货状态:'已备货',物流状态:{值:'运输中',选项:['运输中','已签收']},物流单号:'SF1234567890'},
        回款们:[{id:'pay1',paidAt:'2026-11-15',currency:'CNY',amount:300000,userId:'qa',createdAt:'2026-11-15T02:00:00.000Z'},{id:'pay2',paidAt:'2026-10-28',currency:'CNY',amount:124500,userId:'qa',createdAt:'2026-10-28T02:00:00.000Z'}],
        members:[{id:'m1',userId:'u2',name:'同事乙',roleId:null,inviteStatus:'JOINED'}],
        提成:{币种:'CNY',成交金额:860000,项目底价:600000,比例:{底价比例:2,溢价比例:30},范围:'不限',单设:null,预估:{成交金额:860000,项目底价:600000,项目溢价:260000,底价提成:12000,溢价提成:78000,合计:90000},实际:null,
          每人:[{userId:'qa',比例:80,金额:72000,组长:true,name:'QA'},{userId:'u2',比例:20,金额:18000,组长:false,name:'同事乙'}],能改:true,能填底价:true,能更正:false,组员:[{userId:'u2',name:'同事乙'}],分配:{u2:20}},
        logs:[{id:'l1',at:'2026-11-01T02:00:00.000Z',who:'QA',from:{phase:'商机',node:'方案报价',result:null},to:{phase:'订单',node:'尾款结算',result:null},reason:null,category:null,kind:'node',transfer:null}],
        关联:{...当前.p.关联,客户们:[{customerId:'a',名:'客户A',全称:'客户A',身份:['最终用户'],主:true,看得到:true,能进详情:true},{customerId:'b',名:'客户B'+长,全称:'',身份:['渠道商','代理商'],主:false,看得到:true,能进详情:true}]}};
      if(当前&&o.领不了) 当前.p={...当前.p,能领取:false,领取不给:'你是原负责人，不能领回'};
      // 教练点评改版 PR1：当前项目的教练主题（能发 = 服务端按 P-教练-11/12/13 算好的），按角色给；只读管理员看得到主题但不能发
      if(当前&&o.点评!==undefined) 当前.教练主题={们:[],能发:o.点评,填写人:{id:'qa',name:'QA',身份:'销售教练'},负责人:{id:'u2',name:'同事乙'},项目名:当前.p.name,当前节点:'方案报价',待回复数:0,冻结:false};
      flushSync(()=>root.render(<ConfigProvider locale={zhCN} theme={themeConfig}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><div className='shell rail-mini'>{innerWidth>=768&&<nav className='rail' aria-label='主导航'/>}{innerWidth>=1214&&名单}<main className='main app-content' style={{padding:'22px 26px'}}><div>
        <CustomerDetail customer={{id:'a',extra:null,name:o.公司名||'客户A',phone:'13800138000',school:null,grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z',pool:null}}
          contacts={o.八人?八人:contacts} {...(o.历史?{换负责人记录:换负责人}:{})} contracts={[]} tasks={[{id:'t1',title:'周五带合同上门',dueAt:'2026-11-13T02:00:00.000Z',done:false}]} plan={null}
          users={[{id:'qa',name:'QA',email:'qa@x'},{id:'u2',name:'同事乙',email:'b@x'}]} channels={[]} aiEnabled={false} followUps={客户沟通} followUpsHasMore={false}
          项目们={签.map(t=>({id:t.id,name:t.name,phase:'商机',node:t.节点,result:null,pooledAt:null,amount:0,currency:'CNY'}))} 参与项目们={[]} 关联们={[]} 旺旺们={[]}
          跟进去处={[{id:'p1',名:'项目一',主:true,结束:false,说明:null,下一步:null,下一步文字:null}]} 待办计划={[]} 能放公海 新建项目={{节点们:['线索验证'],要下一步:false}}
          只读={o.只读?'全':false} {...(o.不能转?{能转让客户:false}:{})} {...(o.不能放?{能放公海:false}:{})}
          三态条={o.提醒?{状态:'沉睡',文字:'满 90 天没有有效沟通，也可以用右上角「客户操作」转让或退回公海',悬停:'满 90 天没有有效沟通',旁注:null,按钮们:[{动作:'继续持有',字:'我还在跟',说明:'顺延 30 天',要理由:false,主:true}]}:null}
          项目数据={o.无区?null:{customerId:'a',页签们:签,锁数:o.锁数??0,当前}}
          {...(o.号码?{号码种类:[{名:'手机',kind:'phone',active:true},{名:'座机',kind:'landline',active:true},{名:'WhatsApp',kind:'whatsapp',active:true}],客户号码们:[{kind:'landline',value:'010-66001234'},{kind:'whatsapp',value:'+44 20 7946 0958'}]}:{})}/>
      </div></main></div></BusinessProvider></App></ConfigProvider>));
    };
    // 受限客户详情（只负责项目的人）：同一套项目区 + 嵌入版 ProjectDetail，左栏客户只读卡
    window.__renderR=(o={})=>{
      window.__sp='';
      const 当前=当前of({...项目们.p1,name:'项目一'+长,能删:!!o.删},true);
      flushSync(()=>root.render(<ConfigProvider locale={zhCN} theme={themeConfig}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><div className='shell rail-mini'>{innerWidth>=768&&<nav className='rail' aria-label='主导航'/>}<main className='main app-content' style={{padding:'22px 26px'}}><div>
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

type 参 = { 无区?: boolean; 全?: boolean; 项目页?: boolean; 单?: boolean; 多?: boolean; 空?: boolean; 只读?: boolean; 公司名?: string; 暗?: boolean };
async function 开(width: number, o: 参 = {}, height = 900) {
  const 手机 = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: 手机 });
  const page = await ctx.newPage(); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const 属 = ` data-mode="${o.暗 ? "dark" : "light"}"`;
  await page.route("http://card-refine.test/**", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html${属}><meta charset='utf-8'><style>body{margin:0;background:var(--page-bg)}</style><div id='root'></div></html>` }));
  await page.goto("http://card-refine.test/customers/a");
  // 和 layout.tsx 同序：globals → antd-dark → dark（dark.css 只在 data-mode="dark" 下生效，浅色也挂上无妨）
  for (const f of ["globals.css", "antd-dark.css", "dark.css"]) await page.addStyleTag({ path: path.resolve("src/app", f) });
  await page.addScriptTag({ content: bundle });
  if (o.项目页) { await page.evaluate(() => (window as unknown as { __renderP: () => void }).__renderP()); await page.locator(".proj-wrap").first().waitFor(); }
  else { await page.evaluate(a => (window as unknown as { __render: (o: object) => void }).__render(a), o as object); await page.locator(o.无区 ? ".rec-col-blocks" : ".rec-zone").first().waitFor(); }
  await page.waitForTimeout(300);
  return { page, errors, close: () => ctx.close() };
}


/** 一个 CSS 变量在页面上的计算值（拿一个临时元素量） */
const 量变量 = (page: Page, v: string, 属 = "color") => page.evaluate(([v, 属]) => { const s = document.createElement("span"); s.style.setProperty(属, `var(${v})`); document.body.append(s); const c = getComputedStyle(s).getPropertyValue(属); s.remove(); return c; }, [v, 属]);
const 框 = async (l: import("playwright").Locator) => { const b = (await l.boundingBox())!; return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
/** 三栏各自第一张卡的卡头：左栏客户资料、中栏进程卡（项目切换那一行）、右栏项目资料 */
const 三卡头 = (page: Page) => Promise.all([
  框(page.locator(".rec-rail-blocks > .proj-fold > .ant-card > .ant-card-head").first()),
  框(page.locator(".cd-proc .proj-stage-bar.has-head")),
  框(page.locator(".cd-side > .proj-fold > .ant-card > .ant-card-head").first()),
]);
/** 字段值离所在卡左边多少（左栏客户资料、右栏项目资料） */
const 值起点 = (page: Page, sel: string) => page.locator(sel).evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().x - e.closest(".ant-card")!.getBoundingClientRect().x)));
const 字 = (page: Page, sel: string) => page.locator(sel).first().evaluate(e => { const s = getComputedStyle(e); return { 号: s.fontSize, 重: s.fontWeight, 色: s.color }; });

it("三栏（1024 / 1280 / 1366）：卡头同一条顶线、都 48；卡四边 1px --field-line、圆角 10、淡影；卡距 12；没有横向滚动", async () => {
  for (const [w, o] of [[1024, {}], [1280, {}], [1366, { 单: true }]] as const) {
    const { page, errors, close } = await 开(w, o);
    try {
      const [左, 中, 右] = await 三卡头(page);
      expect([中.y, 右.y], `宽 ${w}：三张卡头顶边同一条线`).toEqual([左.y, 左.y]);
      expect([左.h, 中.h, 右.h], `宽 ${w}`).toEqual([48, 48, 48]);
      const 头高 = await page.locator(".rec-page .proj-fold > .ant-card > .ant-card-head").evaluateAll(es => [...new Set(es.map(e => Math.round(e.getBoundingClientRect().height)))]);
      expect(头高, `宽 ${w}：所有卡头（开着、收着、连体）都 48`).toEqual([48]);
      const 线 = await 量变量(page, "--field-line", "border-top-color");
      const 影 = "rgba(0, 0, 0, 0.04) 0px 1px 2px 0px";
      const 卡们 = await page.locator(".rec-page :is(.proj-fold > .ant-card, .ant-card.cd-proc)").evaluateAll(es => es.map(e => { const s = getComputedStyle(e); return `${s.borderTopWidth} ${s.borderTopColor} ${s.borderBottomColor} ${s.borderTopLeftRadius} ${s.boxShadow}`; }));
      expect(new Set(卡们), `宽 ${w}`).toEqual(new Set([`1px ${线} ${线} 10px ${影}`]));
      // 卡距 12：左栏上下两张、中栏进程卡和搜索框、栏与栏
      const 左卡 = page.locator(".rec-rail-blocks > .proj-fold");
      const [a, b] = await Promise.all([框(左卡.nth(0)), 框(左卡.nth(1))]);
      expect(b.y - (a.y + a.h), `宽 ${w}：左栏卡距`).toBe(12);
      const [rail, zone] = await Promise.all([框(page.locator(".rec-rail-blocks > .proj-fold").first()), 框(page.locator(".cd-proc"))]);
      expect(zone.x - (rail.x + rail.w), `宽 ${w}：左栏和项目区`).toBe(12);
      // 中栏、右栏各自滚，栏壳左右多留了画焦点圈的边：量两栏里的卡
      const [mid, side] = await Promise.all([框(page.locator(".cd-proc")), 框(page.locator(".cd-side > .proj-fold").first())]);
      expect(side.x - (mid.x + mid.w), `宽 ${w}：中栏和右栏`).toBe(12);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

it("进程卡卡头：单项目「项目」13 灰 + 项目名 15 · 600 一行省略 + 阶段小标签，右边「完成节点」连体钮离卡右 16；多项目是一排胶囊；进程卡没有收起钮", async () => {
  for (const 单 of [true, false]) {
    const { page, errors, close } = await 开(1280, { 单 });
    try {
      const 头 = page.locator(".cd-proc .proj-stage-bar.has-head");
      const 卡 = await 框(page.locator(".cd-proc"));
      expect(await 字(page, ".cd-proc .cd-cap")).toEqual({ 号: "13px", 重: "400", 色: await 量变量(page, "--text-muted") });
      if (单) {
        const 名 = 头.locator(".cd-pj-one > .cd-pj-nm");
        expect(await 字(page, ".cd-proc .cd-pj-one > .cd-pj-nm")).toEqual({ 号: "15px", 重: "600", 色: await 量变量(page, "--ink") });
        expect(await 名.evaluate(e => getComputedStyle(e).whiteSpace + " " + (e.scrollWidth > e.clientWidth)), "超长项目名一行省略").toBe("nowrap true");
        // 和左右两张卡头标题同一档
        expect(await 字(page, ".rec-rail .ant-card-head-title")).toMatchObject({ 号: "15px", 重: "600" });
        const 签 = 头.locator(".cd-pj-tag");
        expect(await 签.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await 量变量(page, "--tag-bg", "background-color"));
        expect((await 框(签)).h).toBe(22);
      } else {
        expect(await 头.getByRole("tablist", { name: "这位客户的项目" }).getByRole("tab").count()).toBeGreaterThan(0);
      }
      const 钮 = await 框(头.locator(".proj-stage-acts .split-btn"));
      expect(卡.x + 卡.w - 1 - (钮.x + 钮.w), "完成节点离卡右 16").toBe(16);
      const 头框 = await 框(头);
      expect(Math.abs(钮.y + 钮.h / 2 - (头框.y + 头框.h / 2)), "完成节点在卡头里竖向居中").toBeLessThanOrEqual(1);
      expect(await 头.locator(".proj-stage-acts").getByRole("button", { name: "完成节点" }).count()).toBe(1);
      expect(await page.locator(".cd-proc").evaluate(e => !!e.closest(".proj-fold")), "进程卡不能收起").toBe(false);
      expect(await page.locator(".cd-proc .proj-fold-btn, .cd-proc .split-caret[aria-expanded]").count()).toBe(0);
      // 卡头下一条 --field-line（内阴影画的），节点条在卡头下面
      expect(await 头.evaluate(e => getComputedStyle(e).boxShadow)).toContain(await 量变量(page, "--field-line"));
      expect((await 框(page.locator(".cd-proc .proj-stage-panel"))).y).toBeGreaterThanOrEqual(头框.y + 头框.h + 8);
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

it("字号与对齐：卡头标题 15 · 600、计数 13 · 400 灰；字段名 13 灰、值 14 主字色；三栏值都离卡左 92；超过 5 字的字段名一行省略", async () => {
  const { page, errors, close } = await 开(1280);
  try {
    const 灰 = await 量变量(page, "--count-fg"), 墨 = await 量变量(page, "--ink"), 淡 = await 量变量(page, "--text-muted");
    for (const 卡 of ["客户联系人", "沟通记录", "所有待办", "项目组"]) {
      const 题 = page.locator(".ant-card-head-title").filter({ hasText: 卡 }).first();
      expect(await 题.textContent(), `${卡}：标题文字照旧连成一串`).toMatch(new RegExp(`^${卡}（\\d+）$`));
      expect(await 题.locator(".mod-t-n").evaluate(e => { const s = getComputedStyle(e); return `${s.fontSize}/${s.fontWeight}`; }), 卡).toBe("15px/600");
      expect(await 题.locator(".mod-cnt").evaluate(e => { const s = getComputedStyle(e); return { 号: s.fontSize, 重: s.fontWeight, 色: s.color }; }), 卡).toEqual({ 号: "13px", 重: "400", 色: 灰 });
    }
    expect(await 字(page, ".rec-rail .rec-field-k")).toEqual({ 号: "13px", 重: "400", 色: 淡 });
    expect(await 字(page, ".rec-rail .rec-field-v")).toEqual({ 号: "14px", 重: "400", 色: 墨 });
    expect(await 字(page, ".cd-side .proj-info-k")).toEqual({ 号: "13px", 重: "400", 色: 淡 });
    // 值起点：卡外框左边 + 1px 边 + 16 + 标签 68 + 隔 8（带复制键的电话整行展开，不算）
    const 左 = await 值起点(page, ".rec-rail .rec-field:not(:has(.copy-val)) > .rec-field-v");
    const 右 = await 值起点(page, ".cd-side .proj-info .proj-info-row > .proj-info-k + *");
    expect(左.length).toBeGreaterThan(2);
    expect(右.length).toBeGreaterThan(5);
    expect(new Set([...左, ...右])).toEqual(new Set([93]));
    // 行高 32
    // 行高 32（纯文字的行；客户那行带 28 的公司头像，撑到 36）
    expect(new Set(await page.locator(".cd-side .proj-info-row:is([data-testid=project-owner-row], [data-testid=project-creator-row], [data-testid=project-created-row])").evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().height))))).toEqual(new Set([32]));
    expect(await page.locator(".rec-rail .rec-field").first().evaluate(e => Math.round(e.getBoundingClientRect().height))).toBe(32);
    // 字典改名后出现 6 个字的字段名：一行、省略号，不挤值
    for (const sel of [".rec-rail .rec-field-k", ".cd-side .proj-info-k"]) {
      const k = page.locator(sel).first();
      const 前 = await 框(k);
      const r = await k.evaluate(e => { e.textContent = "现场部署条件说明"; return { 截: e.scrollWidth > e.clientWidth, 省: getComputedStyle(e).textOverflow, 高: Math.round(e.getBoundingClientRect().height) }; });
      expect(r, sel).toEqual({ 截: true, 省: "ellipsis", 高: 前.h });
    }
    expect(errors).toEqual([]);
  } finally { await close(); }
});

it("收起钮：卡头最右 32 纯图标（无框、无底），悬停才出 --hover 浅底；连体的（新建 ＋ 收起）照旧；手机点击区 44", async () => {
  for (const w of [1280, 390]) {
    const { page, errors, close } = await 开(w);
    try {
      const 钮 = page.locator(".rec-rail-blocks > .proj-fold > .proj-fold-btn").first();
      const 头 = await 框(page.locator(".rec-rail-blocks > .proj-fold > .ant-card > .ant-card-head").first());
      const b = await 框(钮);
      expect([b.w, b.h], `宽 ${w}`).toEqual([32, 32]);
      expect(b.y + b.h / 2, "卡头里竖向居中").toBe(头.y + 头.h / 2);
      expect(头.x + 头.w - (b.x + b.w), "离卡头右边 8").toBe(8);
      expect(await 钮.evaluate(e => { const s = getComputedStyle(e); return `${s.borderTopWidth} ${s.backgroundColor}`; })).toBe("0px rgba(0, 0, 0, 0)");
      if (w === 390) {
        // 触屏：按钮四边往外各 6 也点得到（44）
        await 钮.scrollIntoViewIfNeeded();
        const 中 = await 钮.evaluate(e => { const r = e.getBoundingClientRect(); const 到 = (x: number, y: number) => document.elementFromPoint(x, y)?.closest(".proj-fold-btn") === e; return [到(r.left - 5, r.top + r.height / 2), 到(r.left + r.width / 2, r.top - 5), 到(r.left + r.width / 2, r.bottom + 5)]; });
        expect(中).toEqual([true, true, true]);
        // 点击区只往左、上、下伸，右边不出钮：往右伸会撑大钮的 scrollWidth（E2E「受限客户详情 375 文字溢出」那把尺，PR #437 红过）
        expect(await page.locator(".proj-fold > .proj-fold-btn").evaluateAll(es => es.filter(e => e.scrollWidth > e.clientWidth + 1).length), "收起钮自身横向溢出").toBe(0);
      } else {
        await 钮.hover(); await page.waitForTimeout(250);
        expect(await 钮.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await 量变量(page, "--hover", "background-color"));
      }
      // 中栏沟通 / 待办 / 卡点照旧是连体钮（右半收起）
      expect(await page.locator(".cd-mid .proj-fold.has-split .split-btn .split-caret[aria-expanded]").count()).toBe(3);
      expect(await page.locator(".cd-mid .proj-fold-btn").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

it("「本项目 / 这位客户全部」在沟通卡身第一行、高 32，手机点击区 44；沟通卡头一行 48；切过去照样换内容", async () => {
  for (const w of [1280, 390]) {
    const { page, errors, close } = await 开(w);
    try {
      const 卡 = page.locator(".cd-comm");
      expect(await 卡.locator(".ant-card-head .cd-seg").count(), "卡头里不再有").toBe(0);
      const 段 = 卡.locator(".ant-card-body > .cd-comm-bar:first-child > .cd-seg");
      expect((await 框(段)).h, `宽 ${w}`).toBe(32);
      expect((await 框(卡.locator(".ant-card-head"))).h).toBe(48);
      if (w === 390) {
        await 段.scrollIntoViewIfNeeded();
        const 中 = await 段.locator("button").first().evaluate(e => { const r = e.getBoundingClientRect(); const 到 = (y: number) => document.elementFromPoint(r.left + r.width / 2, y) === e; return [到(r.top - 7), 到(r.bottom + 7)]; });
        expect(中, "上下各外扩 8：44").toEqual([true, true]);
      }
      await 段.getByRole("button", { name: "这位客户全部" }).click();
      await expect.poll(() => 段.getByRole("button", { name: "这位客户全部" }).getAttribute("aria-pressed")).toBe("true");
      expect(await 卡.locator(".ant-card-head-title").textContent()).toBe("沟通记录（5）");
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

it("右栏多行字段改的时候：标签在上一行，输入框占满卡宽（同客户侧 .cn-editing）；右栏卡头只写「项目资料」", async () => {
  const { page, errors, close } = await 开(1280);
  try {
    expect(await page.locator(".cd-side .proj-info > .ant-card-head .ant-card-head-title").innerText()).toBe("项目资料");
    await page.locator(".cd-side").getByRole("button", { name: "改备注" }).click();
    const 行 = page.locator(".cd-side .proj-info-row:has(> .proj-inline-edit)");
    const [k, 框框, 整行] = await Promise.all([框(行.locator("> .proj-info-k")), 框(行.locator("textarea")), 框(行)]);
    expect(框框.y, "标签在上").toBeGreaterThanOrEqual(k.y + k.h);
    expect(Math.abs(框框.x - k.x)).toBeLessThanOrEqual(1);
    expect(整行.x + 整行.w - 8 - (框框.x + 框框.w), "框占满一行").toBeLessThanOrEqual(1);
    expect(框框.w).toBeGreaterThan(190);
    expect(errors).toEqual([]);
  } finally { await close(); }
});

it("手机 390：进程卡卡头照 M6 ⑦ 两行（项目切换占满一行、完成节点下一行靠右），没有横向滚动", async () => {
  for (const 单 of [true, false]) {
    const { page, errors, close } = await 开(390, { 单 });
    try {
      const 头 = page.locator(".cd-proc .proj-stage-bar.has-head");
      const [切, 钮] = await Promise.all([框(头.locator(".proj-stage-head")), 框(头.locator(".proj-stage-acts"))]);
      expect(钮.y).toBeGreaterThanOrEqual(切.y + 切.h);
      if (!单) expect(await 头.locator(".cd-pj-pills > .cd-pj-pill.on").evaluate(e => e.getBoundingClientRect().width), "选中的胶囊不被挤成一两个字").toBeGreaterThan(100);
      // 卡头条 -16 伸到卡边，伸进 .proj-stages 自己的内边距，不伸出它（E2E 受限客户详情 375「自身溢出」，PR #437 红过）
      expect(await page.locator(".cd-proc .proj-stages").evaluate(e => e.scrollWidth - e.clientWidth), ".proj-stages 自身横向溢出").toBeLessThanOrEqual(1);
      const [卡框, 条框] = await Promise.all([框(page.locator(".cd-proc")), 框(头)]);
      expect([条框.x, 条框.x + 条框.w], "卡头条照旧通到卡边（卡框 1px 以内）").toEqual([卡框.x + 1, 卡框.x + 卡框.w - 1]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

it("暗黑（现状）：卡边是暗黑的 --field-line、影 .30；计数灰跟着 token", async () => {
  const { page, errors, close } = await 开(1280, { 暗: true });
  try {
    const 线 = await 量变量(page, "--field-line", "border-top-color");
    expect(线).toBe("rgb(58, 63, 72)");
    const s = await page.locator(".rec-rail-blocks > .proj-fold > .ant-card").first().evaluate(e => { const c = getComputedStyle(e); return { 线: c.borderTopColor, 影: c.boxShadow, 底: c.backgroundColor }; });
    expect(s.线).toBe(线);
    expect(s.影).toContain("0.3");
    expect(s.底).toBe(await 量变量(page, "--panel", "background-color"));
    expect(await 字(page, ".mod-cnt")).toMatchObject({ 色: await 量变量(page, "--count-fg") });
    expect(errors).toEqual([]);
  } finally { await close(); }
});


it("项目详情独立页（共用 ProjectFold / ProjectDetail）：卡头 48、收起钮 32、计数灰、资料值离卡左 92，1280 / 390 不横滚", async () => {
  for (const w of [1280, 390]) {
    const { page, errors, close } = await 开(w, { 项目页: true });
    try {
      expect(new Set(await page.locator(".proj-wrap .proj-fold > .ant-card > .ant-card-head").evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().height)))), `宽 ${w}`).toEqual(new Set([48]));
      expect((await 框(page.locator(".proj-wrap .proj-fold > .proj-fold-btn").first())).w).toBe(32);
      expect(await 字(page, ".proj-wrap .mod-cnt")).toMatchObject({ 号: "13px", 重: "400" });
      expect(new Set(await 值起点(page, ".proj-side .proj-info-row > .proj-info-k + *"))).toEqual(new Set([93]));
      expect(new Set(await 值起点(page, ".proj-side .proj-profile-row > .proj-profile-key + *"))).toEqual(new Set([93]));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});


/* ---------- 第三阶段（11-23）：右栏其余卡、没有项目区的客户页、多行字段的字数 ---------- */
/** 右栏收着的卡全打开（钮在 AI 球底下也点得到：直接 click()） */
const 全展开 = (page: Page) => page.locator(".cd-side .proj-fold-btn[aria-expanded=false]").evaluateAll(es => es.forEach(e => (e as HTMLElement).click()));
/** 每个标签后面那一段（元素或文字）离所在卡左边多少 */
const 标签后起点 = (page: Page, sel: string) => page.locator(sel).evaluateAll(es => es.map(k => {
  const 下 = k.nextSibling!; const r = document.createRange(); r.selectNode(下);
  return Math.round(r.getBoundingClientRect().x - k.closest(".ant-card")!.getBoundingClientRect().x);
}));

it("右栏其余卡（1280 / 390）对齐到 68 / 92：回款「当前回款」、交付三行、项目组组长和组员（名字左边缘 = 字段名左边缘）、提成各行、关联客户 / 联系人；字段名 13 灰；底价框不被挤截；不横滚", async () => {
  for (const w of [1280, 390]) {
    const { page, errors, close } = await 开(w, { 全: true, 单: true }, 2400);
    try {
      await 全展开(page); await page.waitForTimeout(300);
      const 灰 = await 量变量(page, "--text-muted");
      const 起点: Record<string, number[]> = {
        当前回款: await 标签后起点(page, ".cd-side .pd-pay-sum > .proj-info-k"),
        交付: await 标签后起点(page, ".cd-side .proj-stock-rows .proj-info-row > .proj-info-k"),
        // 项目底价那一行在 1280 右栏放不下，整组落到下一行，不算
        提成: await 标签后起点(page, ".cd-side .pd-cm-row:not(:has(> .ant-space-compact)) > .pd-cm-k"),
        关联: await 标签后起点(page, ".cd-side .proj-rel-field > .proj-rel-key"),
      };
      for (const [k, v] of Object.entries(起点)) {
        expect(v.length, `${k}：有行`).toBeGreaterThan(0);
        expect(new Set(v), `宽 ${w}：${k} 值离卡左 92（+1 卡边）`).toEqual(new Set([93]));
      }
      expect(起点.交付.length).toBe(3);
      expect(起点.关联.length).toBeGreaterThanOrEqual(5);
      for (const sel of [".cd-side .pd-cm-k", ".cd-side .proj-rel-key", ".cd-side .pd-pay-sum > .proj-info-k"])
        expect(await 字(page, sel), sel).toEqual({ 号: "13px", 重: "400", 色: 灰 });
      // 项目组（11-23 改排版）：组长、组员同一种行，名字从字段名那一列的左边起（和「当前回款」等字段名同一个左边缘），名字不截
      const 离卡左 = (sel: string) => page.locator(sel).evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().x - e.closest(".ant-card")!.getBoundingClientRect().x)));
      const 字段名左 = await 离卡左(".cd-side .pd-pay-sum > .proj-info-k");
      const 组名左 = await 离卡左(".cd-side .pd-team-row .pd-team-name");
      expect(组名左.length, `宽 ${w}`).toBeGreaterThan(0);
      expect(new Set(组名左), `宽 ${w}`).toEqual(new Set(字段名左));
      expect(await page.locator(".cd-side .pd-team-name").evaluateAll(es => es.filter(e => e.scrollWidth > e.clientWidth + 1).length), `宽 ${w}`).toBe(0);
      // 项目底价：数字不被挤截，框不出卡
      const 底价 = page.locator(".cd-side .pd-cm-row input[aria-label=项目底价]");
      expect(await 底价.evaluate(e => (e as HTMLInputElement).scrollWidth <= (e as HTMLInputElement).clientWidth), `宽 ${w}`).toBe(true);
      const 提成卡 = await 框(page.locator(".cd-side .proj-fold > .ant-card:has(input[aria-label=项目底价])"));
      const 存 = await 框(page.locator(".cd-side .pd-cm-row:has(input[aria-label=项目底价])").getByRole("button", { name: /保\s*存/ }));
      expect(存.x + 存.w, `宽 ${w}：保存钮在卡里`).toBeLessThanOrEqual(提成卡.x + 提成卡.w - 16);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

it("编辑多行字段：「0 / 500」字数单独一行靠右，不压「⌘↵ 或点别处保存」那行提示", async () => {
  for (const w of [1280, 390]) {
    const { page, errors, close } = await 开(w);
    try {
      await page.locator(".cd-side").getByRole("button", { name: "改备注" }).click();
      const 行 = page.locator(".cd-side .proj-inline-edit");
      const [框框, 数, 提示] = await Promise.all([框(行.locator("textarea")), 框(行.locator(".ant-input-data-count")), 框(行.locator(".proj-inline-hint"))]);
      expect(await 行.locator(".ant-input-data-count").innerText()).toBe("0 / 500");
      expect(数.y, `宽 ${w}：字数在框下面`).toBeGreaterThanOrEqual(框框.y + 框框.h);
      expect(提示.y, `宽 ${w}：提示在字数下面一行`).toBeGreaterThanOrEqual(数.y + 数.h);
      expect(Math.abs(数.x + 数.w - (框框.x + 框框.w)), "靠右").toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

it("没有项目区的客户页（.rec-col-blocks）：卡四边 --field-line、卡头 48、卡距和栏距 12；390 不横滚", async () => {
  for (const w of [1280, 390]) {
    const { page, errors, close } = await 开(w, { 无区: true });
    try {
      const 线 = await 量变量(page, "--field-line", "border-top-color");
      const 卡 = page.locator(".rec-col-blocks > .proj-fold");
      expect(await 卡.count()).toBeGreaterThanOrEqual(2);
      expect(new Set(await 卡.locator("> .ant-card").evaluateAll(es => es.map(e => getComputedStyle(e).borderTopColor)))).toEqual(new Set([线]));
      expect(new Set(await 卡.locator("> .ant-card > .ant-card-head").evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().height))))).toEqual(new Set([48]));
      const a = await 框(卡.nth(0));
      expect(await 卡.nth(1).evaluate(e => getComputedStyle(e).marginTop + "|" + (e.getBoundingClientRect().top - e.previousElementSibling!.getBoundingClientRect().bottom)), `宽 ${w}：卡距`).toBe("12px|12");
      if (w === 1280) {
        const 左 = await 框(page.locator(".rec-rail-blocks > .proj-fold").first());
        expect(a.x - (左.x + 左.w), "左栏和中栏").toBe(12);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await close(); }
  }
});

