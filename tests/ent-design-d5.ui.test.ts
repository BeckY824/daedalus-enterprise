import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* D5 · 设计语言 11-21（规范 M10–M12）：项目资料、画像、附件、折叠卡计数、金额不截断、加载骨架、找不到按句断行。
   打包和桩照 ent-design-d4.ui.test.ts（同一个 ProjectDetail），另带加载页和 StatePage */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "d5-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  // 教练主题（11-17）的动作：服务端那串（prisma、通知）进不了浏览器包
  stub(/coach-topic-actions$/, "const f=async()=>({ok:true});export const 发主题动作=f,回复主题动作=f,关闭主题动作=f,删主题动作=f;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>['对方发起','第三方'];export const 我常用的沟通方式=async()=>window.__习惯??null;", "async()=>null"));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\.\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", `const f=${空跑};export const 改项目节点=async(...a)=>{(window.__改节点||=[]).push(a);return window.__改节点回??{ok:true}},终止项目进程=async(...a)=>{(window.__终止||=[]).push(a);return{ok:true}},勾项目交付=f,勾项目已开票=f,删除项目=f,放回项目公海=f,领取项目=f,记项目沟通Action=async(...a)=>{(window.__记沟通||=[]).push(a);return window.__记沟通回??{ok:true,followUpId:'fx'}},判MQLAction=f,线索初判Action=f,市场复核Action=f,销售终验Action=f,总管理终判Action=f,销售认领Action=f,撤回验证Action=f,编辑项目=async(...a)=>{(window.__编辑||=[]).push(a);return window.__编辑回||{ok:true}},改项目画像Action=async(...a)=>{(window.__画像存||=[]).push(a);return{ok:true}},改项目沟通=async(...a)=>{(window.__改沟通||=[]).push(a);return{ok:true}},删项目沟通=async(...a)=>{(window.__删沟通||=[]).push(a);return{ok:true}},加项目组员=f,换项目组员角色=f,移出项目组员=f;`));
  stub(/^\.\.\/commission-actions$/, `const f=${空跑};export const 存项目底价=f,存提成分配=f,更正实际提成=f;`);
  // 定时分配（11-17）改 / 取消 / 现在分：服务端那串（prisma、通知）进不了浏览器包
  stub(/(^|\/)schedule-actions$/, 补全动作桩("src/app/(app)/leads/schedule-actions.ts", `const f=${空跑};export const 改定时分配=f,取消定时分配=f,定时分配现在分=f;`));
  stub(/^\.\.\/payment-actions$/, `const f=${空跑};export const 记回款=async(...a)=>{(window.__记回款||=[]).push(a);return window.__记回款回??{ok:true}},删回款=async(...a)=>{(window.__删回款||=[]).push(a);return window.__删回款回??{ok:true}};`);
  stub(/readonly-card-actions$/, 补全动作桩("src/app/(app)/projects/[id]/readonly-card-actions.ts", "export const 打开客户只读卡Action=async(...a)=>{(window.__开卡||=[]).push(a);return window.__卡结果??{ok:false,error:'打不开'}};"));
  stub(/giveup-actions$/, 补全动作桩("src/app/(app)/projects/[id]/giveup-actions.ts", ""));
  stub(/^\.\/blocker-actions$/, `const f=${空跑};export const 发布卡点Action=f,认领卡点Action=f,完成卡点Action=f,删卡点Action=f,存卡点默认Action=f,存卡点角色开关Action=f,新增原因Action=f,改原因名Action=f,改原因状态Action=f,删原因Action=f,合并原因Action=f;`);
  stub(/customers\/\[id\]\/ai$/, `export const parseFollowUpDraft=async()=>({ok:false,error:"未启用"});`);
  stub(/^\.\.\/relate-actions$/, `const f=${空跑};export const 加关联客户Action=f,改客户身份Action=async(...a)=>{(window.__身份存||=[]).push(a);return{ok:true}},解除关联客户Action=f,加关联联系人Action=f,改联系人角色立场Action=async(...a)=>{(window.__角色存||=[]).push(a);return{ok:true}},解除关联联系人Action=f,搜项目联系人=async()=>[];`);
  stub(/^\.\.\/\.\.\/favorites$/, `export const 切换项目收藏=async()=>({ok:true,收藏了:true});`);
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[];");
  // 待办框（客户页「新建待办」、跟进计划页「改待办」同一个 TaskForm）的 ./actions：只认 TaskForm 引的那一个，别的 ./actions 照旧
  b.onResolve({ filter: /^\.\/actions$/ }, a => (/TaskForm\.tsx$/.test(a.importer) ? { path: a.path, namespace: "fixture", pluginData: "export const saveTask=async(...a)=>{(window.__存待办||=[]).push(a);return{ok:true}};" } : undefined));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ProjectDetail from '@/app/(app)/projects/[id]/ProjectDetail';import CustomerLoading from '@/components/CustomerDetailSkeleton';import StatePage from '@/components/StatePage';import TaskForm from '@/app/(app)/customers/[id]/TaskForm';import ProjectRoster from '@/components/ProjectRoster';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {项目画像项,字典定义} from '@/lib/enterprise/dict-kinds';
    const root=createRoot(document.getElementById('root'));
    const 长='超长项目名字'.repeat(8), 串='X'.repeat(90);
    /* 11-01 权限只认业务角色：「项目转让」按 能转让 给（总管理 / 上级），fixture 里看的人能转让 */
    const 基={id:'p1',name:长,remark:null,amount:1234567.89,currency:'CNY',customer:{id:'c1',name:'超长客户名'+串,school:'某某超长公司名有限公司'.repeat(4)},contact:{id:'k1',name:'张三',position:'采购总监兼华东大区负责人'},
      来源线索:{name:'线索'+串,convertedAt:'2026-10-01'},原因选项:{回收:[],无效:[]},ownerId:'qa',ownerName:'组长甲',creatorName:'组长甲',createdAt:'2026-10-01T00:00:00.000Z',historyOwners:['乙','丙'],
      phase:'订单',node:'生产备货',result:null,exceptionReason:null,exceptionCategory:null,pooled:false,能放公海:false,能领取:false,领取不给:null,进公海:null,出口叫法:{},有效沟通差:[],
      nextStepAt:'2026-11-01',回收日:null,expectedDealAt:'2026-12-01',要下一步:true,必填:null,不给推:null,能改节点:true,能转让:true,
      balanceSettled:false,balanceSettledBy:null,balanceSettledAt:null,acceptancePassed:false,acceptancePassedBy:null,acceptancePassedAt:null,
      logs:[{id:'l1',at:'2026-10-02T00:00:00.000Z',who:'组长甲',from:{phase:'商机',node:'首款支付'},to:{phase:'订单',node:'生产备货'},reason:'原因'+串,category:null,kind:'node',transfer:null}],
      followUps:[{id:'f1',type:'PHONE',content:'沟通内容'+串,occurredAt:'2026-10-03T00:00:00.000Z',who:'组长甲',node:'生产备货',code:'FUL0001',提醒:null}],
      members:[{id:'m1',userId:'u2',name:'组员'+串,roleId:null,inviteStatus:'JOINED'}],删前清点:{留痕:1,组员:1,沟通:1}};
    const 提成={币种:'CNY',成交金额:1234567.89,项目底价:1000000,比例:{底价比例:2,溢价比例:30},范围:'外贸',预估:{成交金额:1234567.89,项目底价:1000000,项目溢价:234567.89,底价提成:20000,溢价提成:70370.37,合计:90370.37},实际:null,
      每人:[{userId:'qa',比例:60,金额:54222.22,组长:true,name:'组长甲'},{userId:'u2',比例:40,金额:36148.15,组长:false,name:'组员'+串}],能改:true,能填底价:true,能更正:false,组员:[{userId:'u2',name:'组员'+串}],分配:{u2:40}};
    const 详情=(企业)=><ProjectDetail p={{...基,企业版:企业,能记沟通:企业,提成:企业?提成:null,...(企业?{项目来源:{name:'渠道'+串,跟客户:true},channelId:null,已立项天数:28,渠道们:[],aiEnabled:true,level:'A',所在地:{addrCountry:'中国',addrProvince:'广东省',addrCity:'深圳市'+'市'.repeat(30),addrDistrict:'南山区',location:'科技园'+串}}:{})}} 能改={true} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={企业?{们:[],能发:true,默认:{默认类型:'中度卡点',默认影响:'短期不影响'},原因们:['价格']}:null}/>;
    const 包=(x)=><ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>{x}</BusinessProvider></App></ConfigProvider>;
    window.__render=(企业)=>root.render(包(详情(企业)));
    /* 待办框：record 空 = 客户页「新建待办」，给了 = 跟进计划页「改待办」 */
    window.__待办框=(record)=>root.render(包(<TaskForm open onClose={()=>{}} onSaved={()=>{}} customerId='c1' record={record}/>));
    /* 10-29 沟通「…」→ 修改 / 删除；下一步 = 一句话 + 可选时间 */
    window.__over=(x)=>root.render(包(<ProjectDetail p={{...详情(true).props.p,...x}} 能改={true} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={{们:[],能发:true,默认:{默认类型:'中度卡点',默认影响:'短期不影响'},原因们:['价格']}}/>));
    /* U-项目-07 转让：候选里有接手的人（第一个是自己） */
    window.__转=()=>root.render(包(<ProjectDetail p={详情(true).props.p} 能改={true} 候选={[{id:'qa',name:'组长甲',email:'qa@x.test'},{id:'u3',name:'接手乙',email:'u3@x.test'}]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={{们:[],能发:true,默认:{默认类型:'中度卡点',默认影响:'短期不影响'},原因们:['价格']}}/>));
    /* 页头排版（11-12 改名后「项目转让」「项目退回公海」变长）：两枚按钮都在、超长负责人 / 创建人名 */
    window.__头=()=>root.render(包(<ProjectDetail p={{...详情(true).props.p,能放公海:true,ownerName:'负责人'+串,creatorName:'创建人'+串}} 能改={true} 候选={[{id:'qa',name:'组长甲',email:'qa@x.test'},{id:'u3',name:'接手乙',email:'u3@x.test'}]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={{们:[],能发:true,默认:{默认类型:'中度卡点',默认影响:'短期不影响'},原因们:['价格']}}/>));
    /* P17 关联客户 / 联系人：超长客户名、超长联系人显名、选满身份，挂在右栏 */
    const 关联={客户们:[{customerId:'c1',名:'超长客户名'+串,全称:'某某超长公司名有限公司'.repeat(4),身份:['业主方','总包方','分包方','投资方'],主:true,看得到:true},
      {customerId:'c2',名:'关联客户'+串,全称:'',身份:['监理方','设计方','引荐方'],主:false,看得到:true,能进详情:true},{customerId:'c3',名:'同事的客户 #ABC123',全称:'',身份:[],主:false,看得到:false}],
      联系人们:[{contactId:'k1',名:'超长客户名'+串+'|张先生',姓名:'张三',customerId:'c1',角色:['决策人','审批人','影响人','使用人','经办人'],立场:'盟友',主:true,看得到:true},
      {contactId:'k2',名:'关联客户'+串+'|🔥姓名暂未核实',姓名:'王总',customerId:'c2',角色:[],立场:null,主:false,看得到:true}],
      选项:{身份:['业主方','总包方','分包方','投资方','垫资方','运营方','引荐方','监理方','设计方'],角色:['决策人','审批人','影响人','使用人','经办人'],立场:['中立','对手','线人','军师','盟友']},上限:30};
    window.__relate=(能改)=>root.render(包(<ProjectDetail p={{...详情(true).props.p,关联}} 能改={能改} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={{们:[],能发:true,默认:{默认类型:'中度卡点',默认影响:'短期不影响'},原因们:['价格']}}/>));
    /* 10-31 画像十二项（后七项新加）、空的写灰字（11-04 起「—」）；单选、多选下拉第一项「—」。和 P17 关联一起摆，看关联里空的角色 / 立场 */
    const 画像={项们:项目画像项.map(x=>({键:x.键,名:字典定义[x.种类].名,多选:x.多选,选项:[...字典定义[x.种类].默认]})),
      值:{budgetLevel:'预算充足',priceSense:null,decisionChain:null,demandStatus:null,productNeeds:[],purchaseCycle:'半年',productFit:null,valueFit:null,decisionReach:null,competitor:'无竞品·我方独家',deployFit:null,siteStatus:null}};
    const 主题条=(id,status)=>({id,node:'线索验证',title:'主题'+串,body:'内容'+串,status,createdAt:'2026-11-17T02:00:00.000Z',closedAt:null,作者:{id:'c1',name:'教练'+串,身份:'销售教练'},关的人:null,回复们:[],能回:true,能关:true,能删:false});
    window.__主题=()=>root.render(包(<ProjectDetail {...详情(true).props} 教练主题={{们:[主题条('t1','待回复')],能发:true,填写人:{id:'c1',name:'教练',身份:'销售教练'},负责人:{id:'u1',name:'负责人'},项目名:'项目',当前节点:'线索验证',待回复数:1,冻结:false}}/>));
    window.__画像=(能改)=>root.render(包(<ProjectDetail p={{...详情(true).props.p,关联,画像}} 能改={能改} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={{们:[],能发:true,默认:{默认类型:'中度卡点',默认影响:'短期不影响'},原因们:['价格']}}/>));
    /* F-017：线索阶段推过线索验证的补填提示（x 给阶段、进程、有效沟通差、线索验证缺沟通），带画像卡 */
    window.__线索=(x,能改=true)=>root.render(包(<ProjectDetail p={{...详情(true).props.p,画像,...x}} 能改={能改} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={{们:[],能发:true,默认:{默认类型:'中度卡点',默认影响:'短期不影响'},原因们:['价格']}}/>));
    /* 三栏：照 AppShell 桌面那套 .shell > nav.rail + 中栏 + main.main.app-content > 换页那层 div。名单故意按 订单 → 线索 → 空 → 商机 给，组头得照三大阶段排 */
    const 行=(id,name,阶段,进程,x)=>({id,name,阶段,进程,结局:null,pooled:false,customerName:'超长客户名'+串,lastType:'PHONE',lastAt:'2026-10-20T00:00:00.000Z',lastNote:'最近一句'+串,nextAt:null,...x});
    const 名单={取到上限:false,rows:[行('p1',长,'订单','生产备货'+'备'.repeat(20)),行('p2','线索项目'+串,'线索','初次接触'),行('p5','没填阶段的项目',null,null,{lastAt:null,lastNote:null}),行('p3',串,'商机','方案报价',{pooled:true,结局:'输单'}),行('p4','商机二','商机','首款支付',{nextAt:'2026-10-01'})]};
    /* D5：画像、附件、回款、提成、组员、无名联系人一起摆；x 盖 p，能改 = 能不能改项目 */
    window.__d5=(x,能改=true)=>root.render(包(<ProjectDetail p={{...详情(true).props.p,画像,项目附件:{合同:0,方案:0,验收报告:0,其它:0,只读:!能改},沟通附件:[],...x}} 能改={能改} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={{们:[],能发:true,默认:{默认类型:'中度卡点',默认影响:'短期不影响'},原因们:['价格']}}/>));
    window.__加载=()=>root.render(<CustomerLoading/>);
    window.__找不到=()=>root.render(包(<StatePage 标题="没有找到这条记录" 说明="这条记录可能已删除、暂不可见，或链接中的编号不正确。回客户列表按名字搜一下。" 动作={{label:'回客户列表',href:'/customers'}}/>));
    window.__shell=(fab,x)=>root.render(包(<div className={fab?'shell has-ai-fab':'shell'}><nav className='rail' aria-label='主导航'/><ProjectRoster data={名单}/><main className='main app-content' style={{padding:'22px 26px'}}><div style={{maxWidth:1720,margin:'0 auto'}}>{x?<ProjectDetail {...详情(true).props} p={{...详情(true).props.p,...x}}/>:详情(true)}</div></main></div>));
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function 开(x: Record<string, unknown> = {}, o: { width?: number; 能改?: boolean; 画?: "d5" | "加载" | "找不到" } = {}) {
  const page = await browser.newPage({ viewport: { width: o.width ?? 1366, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://d5.test/**", r => r.fulfill({ contentType: "text/html", body: "<!doctype html><html data-mode='light'><meta charset='utf-8'><div id='root'></div></html>" }));
  // 附件列表：空的（AttachmentsPanel 进来就读一遍）；传（POST）一律回「没传上」，测试里不真传
  await page.route("http://d5.test/api/attachments**", r => r.request().method() === "POST"
    ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "测试里不真传" }) })
    : r.fulfill({ contentType: "application/json", body: JSON.stringify({ 附件: [] }) }));
  await page.goto("http://d5.test");
  for (const f of ["globals.css", "antd-dark.css", "dark.css"]) await page.addStyleTag({ path: path.resolve("src/app", f) });
  await page.addScriptTag({ content: bundle });
  const 画 = o.画 ?? "d5";
  if (画 === "d5") {
    await page.evaluate(([v, 能改]) => (window as unknown as { __d5: (x: unknown, b: boolean) => void }).__d5(v, 能改), [x, o.能改 ?? true] as const);
    await page.getByText("进程变更").first().waitFor().catch(() => { throw new Error(errors.join("\n") || "没渲染出来"); });
  } else await page.evaluate(k => (window as unknown as Record<string, () => void>)[k](), 画 === "加载" ? "__加载" : "__找不到");
  return { page, errors };
}
/** 算出来的颜色串：拿 token 画一个临时 span 量 */
const 色 = (page: import("playwright").Page, v: string) => page.evaluate(v => { const s = document.createElement("span"); s.style.color = v; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }, v);
const 无名联系人 = { contact: { id: "k1", name: "", position: "采购" } };
const 两币回款 = { 成交钱: { contractAmount: null, contractCurrency: null, depositAmount: null, depositCurrency: null, dealDemand: null }, 回款们: [
  { id: "r1", paidAt: "2026-10-01", currency: "CNY", amount: 12800000, userId: null, createdAt: "2026-10-01T00:00:00.000Z" },
  { id: "r2", paidAt: "2026-10-02", currency: "USD", amount: 1500000, userId: null, createdAt: "2026-10-02T00:00:00.000Z" },
  // 第三、四种币：右栏里一定折成两三行（3704 实操：标签要和第一行顶对齐）。
  // 只三种币时 390 宽差 3px 才折（Mac 字体），CI 的 Linux 字体一行放得下、没折（PR #437 单测 6/8 红），加第四种拉开余量
  { id: "r3", paidAt: "2026-10-03", currency: "EUR", amount: 2300000, userId: null, createdAt: "2026-10-03T00:00:00.000Z" },
  { id: "r4", paidAt: "2026-10-04", currency: "GBP", amount: 9870000, userId: null, createdAt: "2026-10-04T00:00:00.000Z" },
] };

describe("D5 新样子", () => {
  it("项目资料：行距 32（卡片改进 11-23 原型，原 34）、悬停整行浅底 + 行尾铅笔；无名联系人的「—」和别的空值同色；卡头图标点击区 28", async () => {
    const { page, errors } = await 开(无名联系人);
    try {
      const 卡 = page.locator(".proj-info");
      await 卡.waitFor();
      const 行 = 卡.locator(".proj-info-row").filter({ has: page.locator('[data-inline-field="级别"]') });
      expect((await 行.boundingBox())!.height).toBeGreaterThanOrEqual(32);
      // #403 审查：样式只管资料行（.proj-info-row），行与行之间不再靠 !important 压行内 marginBottom
      expect(await 行.evaluate(e => [getComputedStyle(e).marginBottom, getComputedStyle(e).marginLeft, e.getAttribute("style")?.includes("margin") ?? false])).toEqual(["0px", "-8px", false]);
      await 行.hover();
      expect(await 行.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await 色(page, "var(--row-hover)"));
      const 笔 = 行.locator(".proj-inline-pen");
      expect(await 笔.evaluate(e => getComputedStyle(e).opacity)).toBe("1");
      // 铅笔在行尾：右边贴着这一行的内边距
      const 行盒 = (await 行.boundingBox())!, 笔盒 = (await 笔.boundingBox())!;
      expect(行盒.x + 行盒.width - (笔盒.x + 笔盒.width)).toBeLessThanOrEqual(10);
      // 联系人名字没填：「—」用 --empty-fg，不是墨色
      const 联系人 = 卡.locator('[data-inline-field="联系人"] .proj-inline-val');
      expect((await 联系人.innerText()).replace(/\s+/g, " ")).toBe("— · 采购");
      expect(await 联系人.locator("span[title='没填姓名']").evaluate(e => getComputedStyle(e).color)).toBe(await 色(page, "var(--empty-fg)"));
      // 卡头编辑笔点击区 ≥ 28
      const 头笔 = (await 卡.getByRole("button", { name: "编辑项目" }).boundingBox())!;
      expect(Math.min(头笔.width, 头笔.height)).toBeGreaterThanOrEqual(28);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("改级别时标签和下拉顶对齐；下拉里的「—」选项用 --empty-fg", async () => {
    const { page, errors } = await 开();
    try {
      const 行 = page.locator(".proj-info-row").filter({ has: page.locator('[data-inline-field="级别"]') });
      await 行.locator(".proj-inline-pen").click({ force: true });
      const 框 = 行.locator(".proj-inline-edit .ant-select");
      await 框.waitFor();
      const 签 = (await 行.locator("> span").first().boundingBox())!, 控 = (await 框.boundingBox())!;
      expect(Math.abs(签.y - 控.y)).toBeLessThanOrEqual(2);
      const 空项 = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title='—'] .ant-select-item-option-content").first();
      await 空项.waitFor();
      expect(await 空项.evaluate(e => getComputedStyle(e).color)).toBe(await 色(page, "var(--empty-fg)"));
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  for (const w of [1024, 1280, 1366, 390])
    it(`${w}px：多币种长金额「¥ 12,800,000 · $ 1,500,000」不出省略号、每段数字不拆`, async () => {
      const { page, errors } = await 开(两币回款, { width: w });
      try {
        const 钱 = page.locator(".proj-info-row").filter({ hasText: /^当前回款/ }).locator(".proj-money");
        await 钱.waitFor();
        expect((await 钱.innerText()).replace(/\s+/g, " ")).toMatch(/12,800,000 · .*1,500,000/);
        for (const 段 of await 钱.locator(".proj-money-seg").all()) {
          expect(await 段.evaluate(e => e.getClientRects().length)).toBe(1);
          expect(await 段.evaluate(e => getComputedStyle(e).textOverflow)).not.toBe("ellipsis");
        }
        // 整格不被截：内容没有比格子宽
        expect(await 钱.evaluate(e => e.scrollWidth <= e.clientWidth + 1 || getComputedStyle(e).display === "inline")).toBe(true);
        // 3704 实操：金额折成两三行时「当前回款」标签和第一行顶对齐（不垂直居中）——比的是两个盒子的顶，不看字体高
        const 键盒 = (await 钱.evaluate(e => e.parentElement!.firstElementChild!.getBoundingClientRect().height));
        expect((await 钱.boundingBox())!.height, "四种币要折成多行").toBeGreaterThan(键盒 * 1.5);
        expect(await 钱.evaluate(e => Math.abs(e.parentElement!.firstElementChild!.getBoundingClientRect().top - e.getBoundingClientRect().top))).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        // 一段自己都放不下一行（排版闸门：右栏 300 宽、Linux 字体下「US$ 12,345,678.90」伸出 8px）：只在符号和数字之间折，
        // 数字不拆（每段最多两行）、不伸出资料行。把这行压到只比最长那段的数字宽一点来量
        const 窄 = await 钱.evaluate(e => {
          const 行 = e.closest(".proj-info-row") as HTMLElement, 键 = 行.firstElementChild as HTMLElement;
          const 段们 = Array.from(e.querySelectorAll<HTMLElement>(".proj-money-seg"));
          const 量 = document.createElement("span"); 量.style.whiteSpace = "nowrap"; 量.style.position = "absolute"; e.appendChild(量);
          const 数宽 = Math.max(...段们.map(s => { 量.textContent = s.textContent!.split(" ").pop()!; return 量.getBoundingClientRect().width; }));
          const 段宽 = Math.max(...段们.map(s => { 量.textContent = s.textContent!; return 量.getBoundingClientRect().width; }));
          量.remove();
          const 行边 = parseFloat(getComputedStyle(行).paddingLeft) + parseFloat(getComputedStyle(行).paddingRight) + 键.getBoundingClientRect().width + parseFloat(getComputedStyle(行).columnGap);
          行.style.width = `${Math.ceil(行边 + 数宽 + 4)}px`; 行.style.flex = "none";
          const 右 = 行.getBoundingClientRect().right - parseFloat(getComputedStyle(行).paddingRight);
          return { 数宽, 段宽, 段们: 段们.map(s => ({ 高: Math.round(s.getBoundingClientRect().height), 出: Math.round(s.getBoundingClientRect().right - 右) })), 行高: parseFloat(getComputedStyle(e).lineHeight) };
        });
        expect(窄.段宽, "压窄后最长那段一行放不下（不然这段量不到折行）").toBeGreaterThan(窄.数宽 + 4);
        for (const d of 窄.段们) {
          expect(d.高, "数字不拆：一段最多两行（符号一行、数字一行）").toBeLessThanOrEqual(窄.行高 * 2 + 1);
          expect(d.出, "不伸出资料行").toBeLessThanOrEqual(1);
        }
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    });

  for (const 能改 of [false, true])
    it(`375px · 画像看态不横向溢出（${能改 ? "能改" : "只读，同受限客户详情"}）：E2E「受限客户详情排版」那把尺——没有元素 scrollWidth 超过 clientWidth、也不出卡`, async () => {
      const { page, errors } = await 开({}, { width: 375, 能改 });
      try {
        const 卡 = page.locator(".ant-card").filter({ has: page.locator(".proj-profile.is-look") });
        await 卡.waitFor();
        const r = await 卡.evaluate((根) => {
          const 框 = 根.getBoundingClientRect();
          const 出卡: string[] = [], 自身溢出: string[] = [];
          for (const el of [根, ...根.querySelectorAll<HTMLElement>("*")]) {
            const b = el.getBoundingClientRect();
            if (!b.width) continue;
            const 名 = `${el.tagName}.${el.className}:${(el.textContent ?? "").slice(0, 16)}`;
            if (b.right > 框.right + 1 || b.left < 框.left - 1) 出卡.push(名);
            const 样 = getComputedStyle(el);
            if (el.scrollWidth > el.clientWidth + 1 && 样.overflowX === "visible" && 样.display !== "inline") 自身溢出.push(名);
          }
          return { 出卡, 自身溢出 };
        });
        expect(r).toEqual({ 出卡: [], 自身溢出: [] });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    });

  it("画像：平时一行字（没填「—」），卡头「已填 N / 12」；点一行展开下拉，选了就存；多选的下拉占位也是「—」", async () => {
    const { page, errors } = await 开();
    try {
      const 卡 = page.locator(".ant-card").filter({ has: page.locator(".proj-profile") });
      await 卡.waitFor();
      expect(await 卡.locator(".proj-profile").getAttribute("class")).toContain("is-look");
      expect(await 卡.locator(".ant-select").count()).toBe(0);
      expect(await 卡.getByTestId("profile-count").innerText()).toBe("已填 3 / 12");
      // 点一行（单选）：直接展开下拉，选第一项就存
      const 行 = 卡.locator(".proj-profile-row").nth(1);
      const 名 = await 行.locator(".proj-profile-key").innerText();
      await 行.locator(".proj-inline").click();
      const 菜单 = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
      await 菜单.waitFor();
      await 菜单.locator(".ant-select-item-option").nth(1).click();
      await expect.poll(() => page.evaluate(() => (Reflect.get(window, "__画像存") as unknown[] | undefined)?.length ?? 0)).toBe(1);
      expect(await 卡.locator(".proj-profile-row").nth(1).locator(".ant-select").count()).toBe(0);
      expect(名.length).toBeGreaterThan(0);
      // 多选那一行（产品需求）：展开后占位「—」，色同空值
      const 多 = 卡.locator(".proj-profile-row").filter({ has: page.locator("[data-inline-field]") }).filter({ hasText: /需求类型/ }).first();
      await 多.locator(".proj-inline").click();
      const 占位 = 多.locator(".ant-select-placeholder");
      await 占位.waitFor();
      expect(await 占位.innerText()).toBe("—");
      expect(await 占位.evaluate(e => getComputedStyle(e).color)).toBe(await 色(page, "var(--empty-fg)"));
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("只读看画像：没有笔、没有下拉，值照写", async () => {
    const { page, errors } = await 开({}, { 能改: false });
    try {
      const 卡 = page.locator(".ant-card").filter({ has: page.locator(".proj-profile") });
      await 卡.waitFor();
      expect(await 卡.locator(".proj-inline-pen").count()).toBe(0);
      expect(await 卡.locator(".ant-select").count()).toBe(0);
      expect(await 卡.innerText()).toContain("预算充足");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("项目附件：「单个最多 20 MB」整卡一次，「上传」在各格小标题右边，空态「还没有附件」；拖文件进一格就开始传", async () => {
    const { page, errors } = await 开();
    try {
      const 卡 = page.getByTestId("project-attachments");
      await 卡.waitFor();
      expect(await 卡.getByText(/单个最多/).count()).toBe(1);
      const 格 = 卡.locator("section[aria-label='合同附件']");
      const 头 = 格.locator(".att-h-row");
      expect((await 头.innerText()).replace(/\s+/g, "")).toBe("合同附件（0）上传");
      const 题盒 = (await 头.locator(".att-h-t").boundingBox())!, 钮盒 = (await 头.getByRole("button", { name: /上传/ }).boundingBox())!;
      expect(钮盒.x).toBeGreaterThan(题盒.x);
      expect(Math.abs(钮盒.y + 钮盒.height / 2 - (题盒.y + 题盒.height / 2))).toBeLessThanOrEqual(4);
      await 格.getByText("还没有附件", { exact: true }).waitFor();
      // 拖进来：和点选同一个「传一个」，上传进度行出现
      await 格.locator(".att-panel").evaluate((el) => {
        const dt = new DataTransfer();
        dt.items.add(new File(["x"], "拖进来.txt", { type: "text/plain" }));
        el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
        el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      });
      await 格.locator(".att-up-row").filter({ hasText: "拖进来.txt" }).waitFor();
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("折叠的卡都写条数：项目组、提成、进程变更", async () => {
    const { page, errors } = await 开();
    try {
      for (const 题 of [/^项目组（2）$/, /^提成（2）$/, /^进程变更（1）$/]) expect(await page.locator(".ant-card-head-title").filter({ hasText: 题 }).count(), String(题)).toBe(1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("只能看的人：项目资料里没挂联系人也摆一行「—」", async () => {
    const { page, errors } = await 开({ contact: null }, { 能改: false });
    try {
      const 行 = page.locator(".proj-info-row").filter({ hasText: /^联系人/ });
      expect((await 行.innerText()).replace(/\s+/g, "")).toBe("联系人—");
      expect(await 行.locator("[data-empty='联系人']").evaluate(e => getComputedStyle(e).color)).toBe(await 色(page, "var(--empty-fg)"));
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("加载：同形骨架（页头 + 三栏卡），--skel-delay 后才出；减弱动态下灰条不扫光", async () => {
    const { page, errors } = await 开({}, { 画: "加载" });
    try {
      const 骨 = page.getByTestId("customer-skeleton");
      await 骨.waitFor();
      expect(await page.locator(".cd-ld-old").count()).toBe(0);
      expect(await 骨.locator(".cd-skel-col").count()).toBe(3);
      expect(await 骨.evaluate(e => getComputedStyle(e).animationDelay)).toBe("0.18s");
      expect(await 骨.locator(".skel-bar").first().evaluate(e => getComputedStyle(e).animationName)).toBe("skel-sweep");
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await 骨.locator(".skel-bar").first().evaluate(e => getComputedStyle(e).animationName)).toBe("none");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  /* #403 实操：骨架栏数要和真页面一致。容器宽取 3704 上量到的（1366 → 1038、1024 → 916、390 → 358：窗口减去左边导航 / 名单 / 页边），
     真页面按同一宽度摆一份只带类名的空架子（.rec-page.ui-v2 > .rec.rec-cd > 左栏 + .rec-zone > .cd-zb > 中栏 + 右栏），用的是同一份 globals.css */
  for (const [窗, 宽] of [[1366, 1038], [1024, 916], [390, 358]] as const)
    it(`${窗}px（容器 ${宽}）：加载骨架和真页面的栏数一样`, async () => {
      const { page, errors } = await 开({}, { 画: "加载", width: 窗 });
      try {
        await page.getByTestId("customer-skeleton").waitFor();
        const r = await page.evaluate((w) => {
          const 根 = document.getElementById("root")!;
          根.style.width = `${w}px`;
          const 真 = document.createElement("div");
          真.style.width = `${w}px`;
          真.innerHTML = `<div class="rec-page ui-v2"><div class="rec rec-cd"><div class="rec-rail"><div>左</div></div><section class="rec-zone"><div class="cd-zb"><div class="cd-mid"><div>中</div></div><div class="cd-side"><div>右</div></div></div></section></div></div>`;
          document.body.append(真);
          const 栏数 = (els: Element[]) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size;
          return {
            骨架: 栏数([...document.querySelectorAll(".cd-skel-col")]),
            真页面: 栏数([...真.querySelectorAll(".rec-rail, .cd-mid, .cd-side")]),
          };
        }, 宽);
        expect(r.骨架).toBe(r.真页面);
        expect(r.骨架).toBe(窗 === 390 ? 1 : 3);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    });

  it("390 找不到：说明一句一行，「不正确」不拆到两行", async () => {
    const { page, errors } = await 开({}, { 画: "找不到", width: 390 });
    try {
      const 句 = page.locator(".sp-sent");
      await 句.first().waitFor();
      expect(await 句.count()).toBe(2);
      // 第二句另起一行
      const [一, 二] = [(await 句.nth(0).boundingBox())!, (await 句.nth(1).boundingBox())!];
      expect(二.y).toBeGreaterThanOrEqual(一.y + 一.height - 1);
      // 「正」「确」两个字在同一行
      const 同行 = await 句.nth(0).evaluate((el) => {
        const t = el.firstChild as Text; const i = t.data.indexOf("正确");
        const 量 = (k: number) => { const r = document.createRange(); r.setStart(t, k); r.setEnd(t, k + 1); return r.getBoundingClientRect().top; };
        return Math.abs(量(i) - 量(i + 1)) < 2;
      });
      expect(同行).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
});
