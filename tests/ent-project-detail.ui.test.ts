import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* 10-27 会议：企业版项目详情两栏——左边干活的（节点、沟通、卡点），右边资料（项目、交付、项目组、提成、节点变更）；
   「记一条沟通」是主按钮；窄于 630 的容器退一栏。开关关闭时照原来一列摆、960 宽、没有提成和「记一条沟通」主按钮。
   P11 commit #3：三个竖条——应用导航 | 中栏项目名单（ProjectRoster，照客户记录页）| 项目详情，见文末「三栏」那几条 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "project-detail-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  // 教练主题（11-17）的动作：服务端那串（prisma、通知）进不了浏览器包
  stub(/coach-topic-actions$/, "const f=async()=>({ok:true});export const 发主题动作=f,回复主题动作=f,关闭主题动作=f,删主题动作=f;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>window.__习惯??null;", "async()=>null"));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\.\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", `const f=${空跑};export const 改项目节点=async(...a)=>{(window.__改节点||=[]).push(a);return window.__改节点回??{ok:true}},记完成节点被拦=async(...a)=>{(window.__被拦||=[]).push(a)},终止项目进程=async(...a)=>{(window.__终止||=[]).push(a);return{ok:true}},勾项目交付=f,删除项目=f,放回项目公海=f,领取项目=f,记项目沟通Action=async(...a)=>{(window.__记沟通||=[]).push(a);return window.__记沟通回??{ok:true,followUpId:'fx'}},判MQLAction=f,线索初判Action=f,市场复核Action=f,销售终验Action=f,总管理终判Action=f,销售认领Action=f,撤回验证Action=f,编辑项目=async(...a)=>{(window.__编辑||=[]).push(a);return window.__编辑回||{ok:true}},改项目画像Action=async(...a)=>{(window.__画像存||=[]).push(a);return{ok:true}},改项目沟通=async(...a)=>{(window.__改沟通||=[]).push(a);return{ok:true}},删项目沟通=async(...a)=>{(window.__删沟通||=[]).push(a);return{ok:true}},加项目组员=f,换项目组员角色=f,移出项目组员=f;`));
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
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ProjectDetail from '@/app/(app)/projects/[id]/ProjectDetail';import ProjectRoster from '@/components/ProjectRoster';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {项目画像项,字典定义} from '@/lib/enterprise/dict-kinds';
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
    window.__shell=(fab,x)=>root.render(包(<div className={fab?'shell has-ai-fab':'shell'}><nav className='rail' aria-label='主导航'/><ProjectRoster data={名单}/><main className='main app-content' style={{padding:'22px 26px'}}><div style={{maxWidth:1720,margin:'0 auto'}}>{x?<ProjectDetail {...详情(true).props} p={{...详情(true).props.p,...x}}/>:详情(true)}</div></main></div>));
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(企业: boolean, width = 1366, 外宽?: number, 三栏 = false, fab = false) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://proj.test/**", r => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><div id='root'${外宽 ? ` style='width:${外宽}px'` : ""}></div>` }));
  await page.goto(三栏 ? "http://proj.test/projects/p1" : "http://proj.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  if (三栏) await page.evaluate(f => (window as unknown as { __shell: (fab: boolean) => void }).__shell(f), fab);
  else await page.evaluate(e => (window as unknown as { __render: (x: boolean) => void }).__render(e), 企业);
  await page.getByText("进程变更").first().waitFor();
  return { page, errors };
}
const 卡标题 = (page: import("playwright").Page, sel: string) =>
  page.locator(`${sel} > .ant-card, ${sel} > .proj-fold > .ant-card`).evaluateAll(cs => cs.map(c => c.querySelector(":scope > .ant-card-head .ant-card-head-title")?.textContent?.trim() ?? ""));
/* U-项目-05：企业版「编辑项目」从页头挪到项目卡标题右边的小铅笔（aria-label 编辑项目） */
const 编辑钮 = (page: import("playwright").Page) => page.locator(".proj-side").getByRole("button", { name: "编辑项目" });

it("企业版：左边节点、沟通、卡点，右边项目、交付、项目组、提成、节点变更；新增沟通是主按钮，各模块的按钮回到卡上", async () => {
  const { page, errors } = await open(true);
  try {
    // U-项目-01：左栏瀑布流——当前进程（无标题）→ 沟通（带条数）→ 卡点；没给项目附件 / 回款就不摆那两块
    expect(await 卡标题(page, ".proj-main")).toEqual(["", "沟通（1）", "卡点（0）"]);
    // 设计语言 D5 · M10-c：折叠卡头带个数
    expect(await 卡标题(page, ".proj-side")).toEqual(["项目", "交付", "项目组（2）", "提成（2）", "进程变更（1）"]);
    const [主, 侧] = await Promise.all([page.locator(".proj-main").boundingBox(), page.locator(".proj-side").boundingBox()]);
    expect(侧!.x).toBeGreaterThan(主!.x + 主!.width);
    expect(Math.round(侧!.width)).toBe(320);
    // 提成预估写明按哪一套比例（10-27：内贸 / 外贸 / 不限）
    expect(await page.locator(".proj-side .ant-card").filter({ hasText: "提成" }).first().innerText()).toContain("按外贸比例");
    // 11-01 用户：「和客户页一样，仅留转让项目，退回公海。其余的放回各模块。」记一条沟通、AI 录入、发卡点、改分配回到各自卡头；
    // 「完成节点 ▼」「新增沟通」在阶段页签那一行（M-节点-04 / U-项目-06）
    const 卡上钮 = (await page.locator(".proj-main button, .proj-side button").allInnerTexts()).map(t => t.replace(/\s/g, ""));
    expect(卡上钮).toEqual(expect.arrayContaining(["新增沟通", "新建卡点", "改分配"]));
    // 11-12：「AI 录入」不再单摆在卡头，收进记一条沟通弹窗顶上的「手动录入 | AI 录入」
    expect(卡上钮).not.toContain("AI录入");
    // 11-01 会议 §5：沟通卡头右边写「新增沟通」（走弹窗），不再有「去客户页看看」
    expect(await page.getByTestId("follow-card-new").innerText()).toBe("新增沟通");
    expect(await page.locator(".proj-main a").filter({ hasText: /页看看/ }).count()).toBe(0);
    expect(卡上钮.filter(t => /^(更多|推进进程|结束当前进程)$|^下一步/.test(t))).toEqual([]);
    expect((await page.locator(".proj-stage-acts button").allInnerTexts()).map(t => t.trim())).toEqual(["完成节点", "", "新增沟通"]);
    expect(await page.locator(".proj-stage-acts button").nth(1).getAttribute("aria-label")).toBe("终止进程");
    expect(await page.locator(".proj-stage-acts .ant-btn-primary").allInnerTexts()).toEqual(["新增沟通"]);
    expect(await 页头钮(page)).toEqual(["项目转让"]);
    expect(await 编辑钮(page).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：超长项目名、客户名、组员名不横向溢出，按钮点得中", async (w) => {
  const { page } = await open(true, w);
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // 右栏里的卡片内容不能伸出卡片（右栏窄，最容易被长串撑开）
    const 伸出 = await page.locator(".proj-side .ant-card").evaluateAll(cs => cs.filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.querySelector(".ant-card-head-title")?.textContent));
    expect(伸出).toEqual([]);
    for (const name of ["新增沟通", "项目转让"]) {
      const box = await page.getByRole("button", { name }).first().boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(w);
      const 点中 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box!.x + box!.width / 2, box!.y + box!.height / 2]);
      expect(点中.replace(/\s/g, "")).toBe(name.replace(/\s/g, ""));
    }
    // 项目卡上的小铅笔是图标钮，按 aria-label 认
    const 笔 = (await 编辑钮(page).boundingBox())!;
    expect(笔.x + 笔.width).toBeLessThanOrEqual(w);
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"), [笔.x + 笔.width / 2, 笔.y + 笔.height / 2])).toBe("编辑项目");
    // 每张卡头最右的收起钮（11-01）：不出屏、点得中、不压卡头别的按钮，和卡标题同一行居中
    // 11-12 起沟通、卡点的收起并进卡头连体按钮的右半（.split-caret），其余还是独立那颗
    expect(await page.locator(".proj-fold-btn, .proj-fold .split-caret").count()).toBeGreaterThanOrEqual(7);
    for (const b of await page.locator(".proj-fold .split-caret").all()) {
      await b.scrollIntoViewIfNeeded();
      const box = (await b.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(w);
      expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.className ?? "", [box.x + box.width / 2, box.y + box.height / 2])).toContain("split-caret");
    }
    const 收钮 = await page.locator(".proj-fold-btn").all();
    for (const b of 收钮) {
      await b.scrollIntoViewIfNeeded();
      const box = (await b.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(w);
      expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.className ?? "", [box.x + box.width / 2, box.y + box.height / 2])).toContain("proj-fold-btn");
      const 位 = await b.evaluate(btn => {
        const 卡 = btn.parentElement!.querySelector(":scope > .ant-card")!;
        const 头 = 卡.querySelector(":scope > .ant-card-head")!.getBoundingClientRect();
        const 题 = 卡.querySelector(":scope > .ant-card-head .ant-card-head-title")?.getBoundingClientRect();
        const 别的 = [...卡.querySelectorAll(":scope > .ant-card-head .ant-card-extra button")].map(e => e.getBoundingClientRect());
        const me = btn.getBoundingClientRect();
        return { 居中差: Math.abs((me.top + me.bottom) / 2 - (头.top + 头.bottom) / 2), 右距: 卡.getBoundingClientRect().right - me.right, 压: 别的.some(e => e.right > me.left - 2 && e.bottom > me.top && e.top < me.bottom), 题右: 题 ? 题.right : 0, 左: me.left };
      });
      expect(位.居中差).toBeLessThanOrEqual(2);
      expect(位.右距).toBeGreaterThanOrEqual(8);
      expect(位.压).toBe(false);
      expect(位.题右).toBeLessThanOrEqual(位.左);
    }
  } finally { await page.close(); }
});

it.each([1024, 1280])("P17 %ipx：右栏关联客户 / 关联联系人跟在画像后；超长名字、选满身份角色不撑出卡片；主客户、主联系人不给解除", async (w) => {
  const { page, errors } = await open(true, w);
  try {
    await page.evaluate(() => (window as unknown as { __relate: (x: boolean) => void }).__relate(true));
    await page.getByText("关联客户（3）").waitFor();
    const 标题 = await 卡标题(page, ".proj-side");
    const 位 = (t: string) => 标题.indexOf(t);
    expect(位("关联客户（3）")).toBeGreaterThan(位("项目"));
    expect(位("关联联系人（2）")).toBe(位("关联客户（3）") + 1);
    expect(标题.findIndex(t => t.startsWith("进程变更（"))).toBeGreaterThan(位("关联联系人（2）"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const 伸出 = await page.locator(".proj-side .ant-card").evaluateAll(cs => cs.filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.querySelector(".ant-card-head-title")?.textContent));
    expect(伸出).toEqual([]);
    const 卡 = page.locator(".proj-side .ant-card").filter({ hasText: "关联客户（3）" }).first();
    const 卡框 = (await 卡.boundingBox())!;
    for (const el of await 卡.locator(".proj-rel-row, .ant-select").all()) {
      const b = (await el.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(卡框.x + 卡框.width + 1);
    }
    // 「关联」在两张卡头（11-01 页头只留转让项目 / 退回公海）
    expect(await page.locator(".proj-side").getByRole("button", { name: /^关联一/ }).count()).toBe(2);
    // 主客户不给解除；看不到的那家没链接
    expect(await page.getByRole("button", { name: /^解除和 超长客户名/ }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /^解除和 关联客户/ }).count()).toBe(2);
    expect(await 卡.locator("a", { hasText: "同事的客户" }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("E① 客户只读卡：客户名是按钮，不链客户详情；点开才取内容，弹窗只读、长名字不横滚；打不开给一句话", async () => {
  const { page, errors } = await open(true, 1024);
  try {
    const 串 = "超长公司名".repeat(30);
    const 卡 = { 客户: { name: "只读客户" + 串, shortName: null, school: 串, customerType: null, customerAttr: null, 地区: "", addrDetail: null, website: null },
      联系人: [{ name: "王联系", position: "总经理", 给联系方式: true, phone: "13700000001", email: null, wechat: null, 号码们: [{ 叫法: "手机", value: "13700000001" }] },
        { name: "李联系", position: "财务", 给联系方式: false, phone: null, email: null, wechat: null, 号码们: [] }] };
    await page.evaluate(({ 卡 }) => { const w = window as unknown as { __卡结果: unknown; __over: (x: unknown) => void }; w.__卡结果 = { ok: true, 卡 };
      w.__over({ customer: null, 客户入口: "只读卡", 客户卡名: { name: "只读客户名", school: "只读公司" } }); }, { 卡 });
    const 名 = page.getByRole("button", { name: "只读客户名" });
    await 名.waitFor();
    expect(await page.locator('a[href^="/customers/"]').filter({ hasText: "只读客户名" }).count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __开卡?: unknown[] }).__开卡?.length ?? 0)).toBe(0);
    await 名.click();
    const 弹 = page.getByTestId("customer-readonly-card");
    await 弹.waitFor();
    const 字 = await 弹.innerText();
    expect(字).toContain("13700000001");
    expect(字).toContain("联系方式不显示");
    expect(await page.evaluate(() => (window as unknown as { __开卡: unknown[][] }).__开卡[0])).toEqual(["p1"]);
    expect(await 弹.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "关闭" }).click();
    await page.evaluate(() => { (window as unknown as { __卡结果: unknown }).__卡结果 = { ok: false, error: "这张客户卡现在打不开了" }; });
    await 名.click();
    await page.getByText("这张客户卡现在打不开了").waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("E① 入口是文字：有名字没链接，也没有按钮", async () => {
  const { page } = await open(true, 1280);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ customer: { id: "c9", name: "只露名字客户", school: null }, 客户入口: "文字", 客户卡名: null }));
    await page.getByText("只露名字客户").first().waitFor();
    expect(await page.locator('a[href="/customers/c9"]').count()).toBe(0);
    expect(await page.getByRole("button", { name: "只露名字客户" }).count()).toBe(0);
  } finally { await page.close(); }
});

it("超时未跟进自动转过来、客户还在原负责人名下（11-17 规则 3 的例外）：页顶黄条「该客户在 XXX 名下」；没有这一格不摆", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ 客户在谁名下: "原负责人老张" }));
    const 条 = page.getByTestId("proj-customer-held");
    await 条.waitFor();
    expect(await 条.getByText("该客户在 原负责人老张 名下", { exact: true }).isVisible()).toBe(true);
    expect(await 条.innerText()).toContain("别两个人同时跟同一位客户");
    // 不横出页面
    expect(await 条.evaluate((el) => el.getBoundingClientRect().right <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({}));
    await page.getByText("超长客户名", { exact: false }).first().waitFor();
    expect(await page.getByTestId("proj-customer-held").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("P17 只读：关联卡只列文字，没有下拉、没有关联 / 解除按钮", async () => {
  const { page } = await open(true, 1280);
  try {
    await page.evaluate(() => (window as unknown as { __relate: (x: boolean) => void }).__relate(false));
    await page.getByText("关联客户（3）").waitFor();
    const 两卡 = page.locator(".proj-side .ant-card").filter({ hasText: /关联(客户|联系人)（/ });
    expect(await 两卡.count()).toBe(2);
    expect(await 两卡.locator(".ant-select").count()).toBe(0);
    expect(await 两卡.getByRole("button", { name: /关联一|解除和/ }).count()).toBe(0);
    expect(await 两卡.first().innerText()).toContain("监理方、设计方、引荐方");
  } finally { await page.close(); }
});

it("企业版 P6：项目卡有已立项、项目来源（跟客户来源时注明）；11-12 起卡头只有「新增沟通」，弹窗顶上切「手动录入 | AI 录入」，默认手动、记住上次、切换不丢已填，AI 只预填不写", async () => {
  const { page, errors } = await open(true);
  try {
    const 项目卡 = await page.locator(".proj-side .ant-card").filter({ hasText: "项目来源" }).first().innerText();
    expect(项目卡).toContain("28 天");
    expect(项目卡).toMatch(/同.+来源/);
    expect(await page.getByRole("button", { name: "AI 录入" }).count()).toBe(0);
    await page.evaluate(() => localStorage.removeItem("daedalus.follow.mode"));
    await page.getByTestId("follow-card-new").click();
    const 切 = page.locator(".follow-mode .ant-segmented");
    await 切.waitFor();
    const 选中 = () => 切.locator(".ant-segmented-item-selected").innerText();
    // 默认手动：没有原话框；「更多」里不再有 AI
    expect(await 选中()).toBe("手动录入");
    expect(await page.getByRole("textbox", { name: "沟通原话" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /更多：/ }).innerText()).not.toMatch(/AI/);
    // 手填了一段，切到 AI：原话框出来、光标落在那，手填的还在
    await page.getByRole("textbox", { name: "沟通内容" }).fill("手填的内容");
    await 切.getByText("AI 录入").click();
    const 原话 = page.getByRole("textbox", { name: "沟通原话" });
    await 原话.waitFor();
    await expect.poll(() => 原话.evaluate(e => e === document.activeElement)).toBe(true);
    expect(await page.getByRole("textbox", { name: "沟通内容" }).inputValue()).toBe("手填的内容");
    await page.getByRole("button", { name: /AI 解析填表/ }).click();
    await page.getByText("先把沟通过程随手写几句").waitFor();
    await 原话.fill("刚和王经理通了电话，下周三再聊报价");
    await page.getByRole("button", { name: /AI 解析填表/ }).click();
    await page.getByText("未启用").waitFor();
    // 「保存」照旧要下一步计划：D4 起保存一直能点，AI 没填出东西点了在「下一步计划」格下报红、不交（只预填、不写库）
    await page.getByRole("dialog").getByRole("button", { name: /^保\s*存$/ }).click();
    await page.getByRole("dialog").locator('[data-fk="下一步计划"] .fm-err').waitFor();
    expect(await page.getByRole("dialog").locator('[data-fk="下一步计划"] .fm-err').innerText()).toBe("请写下一步计划");
    expect(await page.evaluate(() => Reflect.get(window, "__记沟通"))).toBeFalsy();
    // 切回手动：原话框收起，手填的还在
    await 切.getByText("手动录入").click();
    await 原话.waitFor({ state: "detached" });
    expect(await page.getByRole("textbox", { name: "沟通内容" }).inputValue()).toBe("手填的内容");
    await 切.getByText("AI 录入").click();
    await page.getByRole("button", { name: /取\s*消/ }).click();
    await page.getByRole("textbox", { name: "沟通原话" }).waitFor({ state: "detached" });
    // 再开：记得上次选的是 AI
    expect(await page.evaluate(() => localStorage.getItem("daedalus.follow.mode"))).toBe("AI");
    await page.getByTestId("follow-card-new").click();
    await page.getByRole("textbox", { name: "沟通原话" }).waitFor();
    expect(await 选中()).toBe("AI 录入");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("没 AI 权限（模型没配）：记一条沟通弹窗里没有「手动录入 | AI 录入」切换，直接手填", async () => {
  const { page, errors } = await 覆盖(1280, { 我是负责人: true, 能记沟通: true, aiEnabled: false });
  try {
    await page.evaluate(() => localStorage.setItem("daedalus.follow.mode", "AI"));
    await page.getByTestId("follow-card-new").click();
    await page.getByRole("textbox", { name: "沟通内容" }).waitFor();
    expect(await page.locator(".follow-mode").count()).toBe(0);
    expect(await page.getByRole("textbox", { name: "沟通原话" }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("10-31 改版 R4 + 11-01 会议：项目卡定金在合同前；空着一律写「—」（浅灰、悬停写未填哪格）；0 算填了", async () => {
  const { page, errors } = await open(true);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({
      成交钱: { contractAmount: null, contractCurrency: null, depositAmount: 0, depositCurrency: "USD", dealDemand: null }, expectedDealAt: null, 项目来源: null }));
    const 卡 = page.locator(".proj-side .ant-card").filter({ hasText: "定金金额" }).first();
    await 卡.locator('[data-empty="合同金额"]').waitFor();
    const 字 = await 卡.innerText();
    expect(字.indexOf("定金金额")).toBeLessThan(字.indexOf("合同金额"));
    expect(字).toMatch(/定金金额\s*US\$\s*0\b/);
    expect(await 卡.locator('[data-empty="定金金额"]').count()).toBe(0);
    for (const 名 of ["合同金额", "需求描述", "预计成交日期", "项目来源"]) {
      const 格 = 卡.locator(`[data-empty="${名}"]`);
      expect(await 格.innerText()).toBe("—");
      expect(await 格.getAttribute("title")).toBe(`未填：${名}`);
    }
    expect(字).toMatch(/合同金额\s*—/);
    expect(字).not.toMatch(/待填写|待选择|没填/);
    const 色 = await 卡.locator('[data-empty="合同金额"]').evaluate(e => getComputedStyle(e).color);
    // 空值「—」全站一个色 --empty-fg（D1 · 设计语言 11-21，D02；原来 faint）
    const 空色 = await page.evaluate(() => { const s = document.createElement("span"); s.style.color = "var(--empty-fg)"; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; });
    expect(色).toBe(空色);
    // 项目金额落库默认 0、分不出没填和填了 0：0 也写 —，不写 ¥ 0
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({ amount: 0, 成交钱: { contractAmount: null, contractCurrency: null, depositAmount: null, depositCurrency: null, dealDemand: null } }));
    await 卡.locator('[data-empty="金额"]').waitFor();
    expect(await 卡.innerText()).toMatch(/(^|\n)金额\s*—/);
    expect(await 卡.innerText()).not.toMatch(/¥\s*0\b/);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("10-31 必填 + 11-01 会议：这个进程配了必填、还没填的项目金额 / 预计成交也写「—」，悬停说是必填；没配必填的空格写 —、悬停「未填」", async () => {
  const { page, errors } = await open(true);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({
      成交钱: { contractAmount: null, contractCurrency: null, depositAmount: null, depositCurrency: null, dealDemand: null }, expectedDealAt: null, 项目来源: null,
      必填: { 配了: ["金额", "预计成交日期"], 还差: ["金额", "预计成交日期"] } }));
    const 卡 = page.locator(".proj-side .ant-card").filter({ hasText: "定金金额" }).first();
    await 卡.locator("[data-required]").first().waitFor();
    expect(await 卡.locator("[data-required]").evaluateAll(es => es.map(e => e.getAttribute("data-empty")))).toEqual(["金额", "预计成交日期"]);
    expect(await 卡.locator('[data-empty="金额"]').innerText()).toBe("—");
    expect(await 卡.locator('[data-empty="金额"]').getAttribute("title")).toBe("必填：金额，填齐后自动往前推");
    const 字 = await 卡.innerText();
    expect(字).not.toMatch(/占位确认|待填写|待选择/);
    // 合同金额、定金这几格不在必填清单里（必填的「金额」是项目金额那一格），写 — 但不标必填
    for (const 名 of ["合同金额", "定金金额", "需求描述", "项目来源"]) {
      const 格 = 卡.locator(`[data-empty="${名}"]`);
      expect(await 格.innerText()).toBe("—");
      expect(await 格.getAttribute("data-required")).toBeNull();
    }
    const 空色 = await page.evaluate(() => { const s = document.createElement("span"); s.style.color = "var(--empty-fg)"; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; });
    expect(await 卡.locator("[data-required]").first().evaluate(e => getComputedStyle(e).color)).toBe(空色);
    // 填上了就照常显示（__over 每次从底稿起，成交钱要再带上）
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({ 成交钱: { contractAmount: null, contractCurrency: null, depositAmount: null, depositCurrency: null, dealDemand: null }, 项目来源: null, expectedDealAt: "2026-12-01", 必填: { 配了: ["金额", "预计成交日期"], 还差: ["金额"] } }));
    await 卡.getByText("2026-12-01").waitFor();
    expect(await 卡.locator("[data-required]").count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("迁移 101：项目卡有合同状态、痛点标注（多行），左栏合同附件后面有「项目方案」附件格；编辑框能改这两格、交上去", async () => {
  const { page, errors } = await open(true);
  try {
    await page.route("http://proj.test/api/attachments**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ 附件: [] }) }));
    const 钱 = { contractAmount: null, contractCurrency: null, depositAmount: null, depositCurrency: null, dealDemand: null };
    const 附 = { 合同: 0, 方案: 0, 其它: 0, 只读: false };
    // 老项目：合同状态、痛点标注都空着，都写「—」（11-04 用户：空值统一「—」）
    await page.evaluate(v => (window as unknown as { __over: (x: object) => void }).__over(v), { 成交钱: 钱, 项目附件: 附, 项目新字段: { painPoints: null, contractStatus: null } });
    const 卡 = page.locator(".proj-side .ant-card").filter({ hasText: "合同状态" }).first();
    await 卡.waitFor();
    let 字 = await 卡.innerText();
    expect(await 卡.locator('[data-empty="合同状态"]').innerText()).toBe("—");
    expect(await 卡.locator('[data-empty="痛点标注"]').innerText()).toBe("—");
    expect(字.indexOf("合同金额")).toBeLessThan(字.indexOf("合同状态"));
    expect(字.indexOf("成交需求")).toBeLessThan(字.indexOf("痛点标注"));
    // F-项目-18：附件合成左栏一块「项目附件」，项目方案在前、合同附件紧跟（F-042 方案在上，合同格提示「放上面」指它），再是验收报告（M-必填-11），最后是沟通上的附件
    expect(await 卡标题(page, ".proj-main")).toContain("项目附件（0）");
    // 设计语言 D5 · M12：每格小标题一行带「上传」，格名在 .att-h-t
    expect(await page.locator(".proj-main .proj-att-h .att-h-t, .proj-main .proj-att-h:not(.att-h-row)").allInnerTexts()).toEqual(["项目方案（0）", "合同附件（0）", "验收报告（0）", "其它附件（0）", "沟通附件（0）"]);
    // 填了：一行显示（换行压成空格，放不下「…」），悬停浮层用 data-tip 里的原文、保住分段（11-04 用户：待定第 1 点按优化来）
    await page.evaluate(v => (window as unknown as { __over: (x: object) => void }).__over(v), { 成交钱: 钱, 项目附件: 附, 项目新字段: { painPoints: "交期总拖\n售后慢", contractStatus: "待我方确认" } });
    await 卡.getByText("待我方确认").waitFor();
    字 = await 卡.innerText();
    expect(字).toMatch(/痛点标注\s*交期总拖 售后慢/);
    expect(await 卡.locator(".proj-one[data-tip]").filter({ hasText: "交期总拖" }).getAttribute("data-tip")).toBe("交期总拖\n售后慢");
    // 编辑框：两格都在，改了交上去
    await 编辑钮(page).click();
    const 框 = page.locator(".ant-modal-container");
    const 痛点 = 框.getByRole("textbox", { name: "痛点标注" });
    await 痛点.waitFor();
    expect(await 痛点.inputValue()).toBe("交期总拖\n售后慢");
    await 痛点.fill("  交期总拖  ");
    await 框.getByRole("combobox", { name: "合同状态" }).click();
    const 下拉 = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
    // 下拉是点开后才渲染的、还带进场动画，CI 机器慢时立刻读会是空的（等到「已终止」出现再读也空过一次）：轮询到对上为止
    await expect.poll(() => 下拉.allInnerTexts(), { timeout: 10_000 }).toEqual(["—", "起草中", "待对方确认", "待我方确认", "对方修改中", "我方修改中", "已生效", "已终止"]);
    await 下拉.filter({ hasText: "已生效" }).click();
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await page.waitForFunction(() => ((window as unknown as { __编辑?: unknown[] }).__编辑 ?? []).length > 0);
    const 交 = await page.evaluate(() => ((window as unknown as { __编辑: [string, Record<string, unknown>][] }).__编辑).at(-1)![1]);
    expect(交).toMatchObject({ painPoints: "交期总拖", contractStatus: "已生效" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const 宽 of [390, 1024, 1280, 1366]) {
  it(`${宽}px 迁移 154（客户 11-19）：交付卡里有备货状态、物流状态、物流单号，长值不溢出；就地改交到各自的列；不在订单阶段不摆`, async () => {
    const { page, errors } = await open(true, 宽);
    try {
      const 长单号 = "SF1234567890,".repeat(7);
      await page.evaluate(v => (window as unknown as { __over: (x: object) => void }).__over(v), {
        备货物流: { 备货状态: null, 物流状态: { 值: "客户已签收（超长的自定义物流状态名）", 选项: ["待发货", "运输中", "客户已签收（超长的自定义物流状态名）"] }, 物流单号: 长单号 },
        必填: { 配了: ["备货状态"], 还差: ["备货状态"] },
      });
      const 卡 = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: /^交付$/ }) }).first();
      await 卡.locator(".proj-stock-rows").waitFor();
      const 字 = await 卡.innerText();
      expect(字.indexOf("备货状态")).toBeLessThan(字.indexOf("物流状态"));
      expect(字.indexOf("物流单号")).toBeLessThan(字.indexOf("尾款结清"));
      // 缺着的必填写「—」、悬停说是必填
      expect(await 卡.locator('[data-empty="备货状态"]').getAttribute("data-required")).toBe("");
      const 溢 = await 卡.evaluate((c) => {
        const r = c.getBoundingClientRect();
        // 值格（.proj-inline-val）自己裁掉、打省略号，里头的字不算出界；量行、键、值格、笔
        const 出 = [...c.querySelectorAll(".proj-stock-rows > div, .proj-stock-rows > div > *, .proj-stock-rows .proj-inline-val, .proj-stock-rows .proj-inline-pen")].filter((e) => { const x = e.getBoundingClientRect(); return x.width > 0 && (x.right > r.right + 1 || x.left < r.left - 1); }).map((e) => `${e.tagName}.${e.className}:${e.textContent?.slice(0, 20)}`);
        const 单号格 = [...c.querySelectorAll(".proj-stock-rows .proj-inline-val")].find((e) => e.textContent?.startsWith("SF"))!;
        return { 出, 横滚: document.documentElement.scrollWidth > innerWidth, 单号裁了: 单号格.scrollWidth > 单号格.clientWidth, 悬停全文: 单号格.querySelector("[title]")?.getAttribute("title")?.length };
      });
      expect(溢).toEqual({ 出: [], 横滚: false, 单号裁了: true, 悬停全文: 长单号.length });
      // 就地改：备货状态选一项，交 stockStatus
      await 卡.getByRole("button", { name: "改备货状态", exact: true }).click();
      await 卡.getByRole("combobox", { name: "备货状态" }).waitFor();
      const 下拉 = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
      await expect.poll(() => 下拉.allInnerTexts(), { timeout: 10_000 }).toEqual(["—", "未生产", "生产中", "已备货"]);
      await 下拉.filter({ hasText: "生产中" }).click();
      await page.waitForFunction(() => ((window as unknown as { __编辑?: unknown[] }).__编辑 ?? []).length > 0);
      expect(await page.evaluate(() => ((window as unknown as { __编辑: [string, Record<string, unknown>][] }).__编辑).at(-1))).toEqual(["p1", { stockStatus: "生产中" }]);
      // 线索阶段：没有交付卡，这三格也不摆
      await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({ phase: "线索", node: "潜客培育", 备货物流: { 备货状态: null, 物流状态: { 值: null, 选项: ["待发货"] }, 物流单号: null } }));
      await expect.poll(() => page.locator(".proj-stock-rows").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);
}

for (const 宽 of [390, 1024, 1280, 1366]) {
  it(`${宽}px 交付结清只在尾款结算（客户 11-19 定稿，跟节点推进开关一起生效）：开关开着停在别的订单节点交付卡不摆按钮、写清先推到尾款结算；到了尾款结算两勾齐才能点；开关关着中间节点照旧能点；不溢出`, async () => {
    const { page, errors } = await open(true, 宽);
    try {
      const 卡 = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: /^交付$/ }) }).first();
      const 钮 = 卡.getByRole("button", { name: "交付结清" });
      for (const node of ["生产备货", "交付验收"]) {
        await page.evaluate(v => (window as unknown as { __over: (x: object) => void }).__over(v), { phase: "订单", node, balanceSettled: true, acceptancePassed: true, 交付只在尾款: true });
        await expect.poll(() => 卡.innerText()).toContain("「交付结清」只能在「尾款结算」这一步点，先把进程推到「尾款结算」");
        expect(await 钮.count()).toBe(0);
      }
      await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({ phase: "订单", node: "尾款结算", balanceSettled: true, acceptancePassed: true, 交付只在尾款: true }));
      await 钮.waitFor();
      expect(await 钮.isDisabled()).toBe(false);
      expect(await 卡.innerText()).toContain("可以点交付结清");
      const 溢 = await 卡.evaluate((c) => {
        const r = c.getBoundingClientRect();
        return { 出: [...c.querySelectorAll("*")].filter((e) => { const x = e.getBoundingClientRect(); return x.width > 0 && (x.right > r.right + 1 || x.left < r.left - 1); }).length, 横滚: document.documentElement.scrollWidth > innerWidth };
      });
      expect(溢).toEqual({ 出: 0, 横滚: false });
      // 尾款结算上缺勾：按钮在、灰着，写还差哪样
      await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({ phase: "订单", node: "尾款结算", balanceSettled: false, acceptancePassed: true, 交付只在尾款: true }));
      await expect.poll(() => 钮.isDisabled()).toBe(true);
      expect(await 卡.innerText()).toContain("尾款结清");
      // 开关关着（交付只在尾款 = false）：停在安装实施照旧摆按钮、能点
      await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({ phase: "订单", node: "安装实施", balanceSettled: true, acceptancePassed: true, 交付只在尾款: false }));
      await expect.poll(() => 卡.innerText()).toContain("可以点交付结清");
      expect(await 钮.isDisabled()).toBe(false);
      expect(await 卡.innerText()).not.toContain("只能在「尾款结算」");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);
}

it("必填齐了、下一格换阶段：当前进程卡写「必填齐了，点「完成节点」进商机」；同阶段照旧", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({ phase: "线索", node: "线索推进", 必填: { 配了: ["金额"], 还差: [] } }));
    await page.getByText("必填齐了，点「完成节点」进商机").waitFor();
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({ phase: "商机", node: "首款到账", 必填: { 配了: ["金额"], 还差: [] } }));
    await page.getByText("必填齐了，点「完成节点」进订单").waitFor();
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({ phase: "商机", node: "痛点挖掘", 必填: { 配了: ["金额"], 还差: [] } }));
    await page.getByText("这个节点的必填都齐了，可以点「完成节点」往前推").waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("「完成节点」灰在不给推：必填齐了的说法写明该谁点（上级 / 销售管理或总管理 / 负责人），不叫他点；灰因是等复核时不写该谁点", async () => {
  const { page, errors } = await open(true, 1280);
  const 上级推 = "往前推进程要由你的直属上级来推";
  try {
    await page.evaluate((x) => (window as unknown as { __over: (x: object) => void }).__over({ phase: "线索", node: "线索推进", 必填: { 配了: ["金额"], 还差: [] }, 不给推: x }), 上级推);
    await page.getByText("必填齐了，进商机要上级点「完成节点」").waitFor();
    expect(await page.getByText("必填齐了，点「完成节点」进商机").count()).toBe(0);
    await page.evaluate((x) => (window as unknown as { __over: (x: object) => void }).__over({ phase: "商机", node: "首款到账", 必填: { 配了: ["金额"], 还差: [] }, 不给推: x }), 上级推);
    await page.getByText("必填齐了，进订单要上级点「完成节点」").waitFor();
    expect(await page.getByText("必填齐了，点「完成节点」进订单").count()).toBe(0);
    await page.evaluate((x) => (window as unknown as { __over: (x: object) => void }).__over({ phase: "商机", node: "痛点挖掘", 必填: { 配了: ["金额"], 还差: [] }, 不给推: x }), 上级推);
    await page.getByText("这个节点的必填都齐了，往前推要上级点「完成节点」").waitFor();
    expect(await page.getByText("这个节点的必填都齐了，可以点「完成节点」往前推").count()).toBe(0);
    // 需求补全期：上级是销售账号也推不了，写销售管理或总管理（load.ts 不给推谁能推）
    const 补全期 = "需求状态补全期：只有销售管理、总管理能往前推进程，沟通照常记";
    await page.evaluate((x) => (window as unknown as { __over: (x: object) => void }).__over({ phase: "线索", node: "线索推进", 必填: { 配了: ["金额"], 还差: [] }, 不给推: x, 不给推谁能推: "销售管理或总管理" }), 补全期);
    await page.getByText("必填齐了，进商机要销售管理或总管理点「完成节点」").waitFor();
    expect(await page.getByText("必填齐了，进商机要上级点「完成节点」").count()).toBe(0);
    // 负责人可推下的组员：只有负责人能推（11-01 C2：上级只看、只转让），写负责人
    await page.evaluate((x) => (window as unknown as { __over: (x: object) => void }).__over({ phase: "商机", node: "首款到账", 必填: { 配了: ["金额"], 还差: [] }, 不给推: x, 不给推谁能推: "负责人" }), "只有负责人能往前推进程");
    await page.getByText("必填齐了，进订单要负责人点「完成节点」").waitFor();
    // 等复核先拦下（灰因不是不给推）：上级也推不了，不写该谁点，只说齐了
    await page.evaluate((x) => (window as unknown as { __over: (x: object) => void }).__over({ phase: "线索", node: "线索推进", 必填: { 配了: ["金额"], 还差: [] }, 不给推: x, 不给推谁能推: "上级",
      线索验证: { 判定: "初验无效", 待: "市场复核", 无效原因: null, 复核结果: null, 最终结果: null, 终验: null, 初判即终判: false, 叫法: "初验无效", 我能: null, 痕: [] } }), 上级推);
    await page.getByText("这个节点的必填都齐了", { exact: true }).waitFor();
    expect(await page.getByText("要上级点「完成节点」").count()).toBe(0);
    expect(await page.getByText("点「完成节点」进商机").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("仅上级推下停在已齐的节点（存一下就推）：当前进程卡写「已经填齐：改任一项（项目资料、画像都算，值没变不算）保存、或记一条沟通，就会自动推到下一步」；别的情况照旧", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({ phase: "订单", node: "物流运输", 必填: { 配了: ["物流单号"], 还差: [], 存一下就推: true } }));
    await page.getByText("已经填齐：改任一项（项目资料、画像都算，值没变不算）保存、或记一条沟通，就会自动推到下一步").waitFor();
    expect(await page.getByText("这个节点的必填都齐了，可以点「完成节点」往前推").count()).toBe(0);
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({ phase: "订单", node: "物流运输", 必填: { 配了: ["物流单号"], 还差: [] } }));
    await page.getByText("这个节点的必填都齐了，可以点「完成节点」往前推").waitFor();
    expect(await page.getByText("已经填齐：改任一项（项目资料、画像都算，值没变不算）保存、或记一条沟通，就会自动推到下一步").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

for (const 宽 of [390, 1366]) {
  it(`${宽}px 迁移 154 编辑项目框：订单阶段有三格；只改物流单号只交 trackingNo（停用了还存着的物流状态不带上）；没交的刷新后带回草稿`, async () => {
    const { page, errors } = await open(true, 宽);
    try {
      const 货 = { 备货状态: "生产中", 物流状态: { 值: "已停用的状态", 选项: ["待发货", "已签收", "已停用的状态"] }, 物流单号: "SF1" };
      const 摆 = () => page.evaluate(v => (window as unknown as { __over: (x: object) => void }).__over({ 备货物流: v }), 货);
      await 摆();
      await 编辑钮(page).click();
      const 框 = page.locator(".ant-modal-container");
      const 单号 = 框.getByRole("textbox", { name: "物流单号" });
      await 单号.waitFor();
      expect(await 框.getByRole("combobox", { name: "备货状态" }).count()).toBe(1);
      expect(await 框.getByRole("combobox", { name: "物流状态" }).count()).toBe(1);
      expect(await 框.locator(".ant-select").filter({ has: page.getByRole("combobox", { name: "物流状态" }) }).innerText()).toContain("已停用的状态");
      expect(await 单号.inputValue()).toBe("SF1");
      expect(await 框.evaluate(c => c.scrollWidth <= c.clientWidth + 1)).toBe(true);
      // 打了字没交：草稿留着，刷新后重开带回（物流单号是改过的那格，另两格照库里的）
      await 单号.fill("SF1, SF2");
      await page.reload();
      await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
      await 摆();
      await 编辑钮(page).click();
      await 单号.waitFor();
      await expect.poll(() => 单号.inputValue()).toBe("SF1, SF2");
      await 框.getByRole("button", { name: /保\s*存/ }).click();
      await page.waitForFunction(() => ((window as unknown as { __编辑?: unknown[] }).__编辑 ?? []).length > 0);
      const [id, 交] = await page.evaluate(() => ((window as unknown as { __编辑: [string, Record<string, unknown>][] }).__编辑).at(-1)!);
      expect(id).toBe("p1");
      expect(交.trackingNo).toBe("SF1, SF2");
      expect(Object.keys(交).filter(k => ["stockStatus", "logisticsStatus", "trackingNo"].includes(k))).toEqual(["trackingNo"]);
      // 存上了草稿清掉：再开框是库里的值
      // 「已保存」对勾放完（SaveButton 成了留 1.4 秒）才关框、清草稿
      await 框.waitFor({ state: "hidden", timeout: 5000 });
      await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(k => k.includes("编辑项目:p1"))), { timeout: 5000 }).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);
}

it("编辑项目框：金额 / 定金金额敲了认不出的字（NaN），草稿里换回原值；刷新后带回不把金额清成 0 / 空，改过的合同金额照带回（审查 11-20）", async () => {
  const { page, errors } = await open(true);
  try {
    const 钱 = { contractAmount: 80000, contractCurrency: "CNY", depositAmount: 20000, depositCurrency: "CNY", dealDemand: null };
    const 摆 = () => page.evaluate(v => (window as unknown as { __over: (x: object) => void }).__over({ 成交钱: v }), 钱);
    await 摆();
    await 编辑钮(page).click();
    const 框 = page.locator(".ant-modal-container");
    const 金额框 = 框.getByRole("spinbutton", { name: "金额", exact: true });
    const 定金框 = 框.getByRole("spinbutton", { name: "定金金额" });
    const 合同框 = 框.getByRole("spinbutton", { name: "合同金额" });
    await 金额框.waitFor();
    await 金额框.fill("约5万");
    await 定金框.fill("约2万");
    await 合同框.fill("9万");
    // 认不出的两格挡住保存
    await expect.poll(() => 框.getByRole("button", { name: /保\s*存/ }).isDisabled()).toBe(true);
    const 稿们 = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.includes("编辑项目:p1")).map(k => localStorage.getItem(k)!));
    await expect.poll(async () => (await 稿们()).length).toBe(1);
    const [稿] = await 稿们();
    // 草稿里没有 null 金额（NaN 被 JSON 写成 null 带回就把金额清了）
    expect(稿).toContain("90000");
    expect(稿).not.toMatch(/"(amount|depositAmount)":null/);
    // 刷新
    await page.reload();
    await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
    await 摆();
    await 编辑钮(page).click();
    await 合同框.waitFor();
    await expect.poll(() => 合同框.inputValue()).toBe("90,000");
    expect(await 金额框.inputValue()).toBe("1,234,567.89");
    expect(await 定金框.inputValue()).toBe("20,000");
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await page.waitForFunction(() => ((window as unknown as { __编辑?: unknown[] }).__编辑 ?? []).length > 0);
    const 交 = await page.evaluate(() => ((window as unknown as { __编辑: [string, Record<string, unknown>][] }).__编辑).at(-1)![1]);
    expect(交).toMatchObject({ amount: 1234567.89, depositAmount: 20000, contractAmount: 90000 });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("迁移 101：没给项目新字段（不是企业版 / 藏了）就不摆这两行、编辑框也没有", async () => {
  const { page, errors } = await open(true);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({
      成交钱: { contractAmount: null, contractCurrency: null, depositAmount: null, depositCurrency: null, dealDemand: null }, 项目新字段: { contractStatus: "已生效" } }));
    const 卡 = page.locator(".proj-side .ant-card").filter({ hasText: "定金金额" }).first();
    await 卡.getByText("已生效").waitFor();
    expect(await 卡.innerText()).not.toContain("痛点标注");
    await 编辑钮(page).click();
    const 框 = page.locator(".ant-modal-container");
    await 框.getByRole("combobox", { name: "合同状态" }).waitFor();
    expect(await 框.getByRole("textbox", { name: "痛点标注" }).count()).toBe(0);
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({
      成交钱: { contractAmount: null, contractCurrency: null, depositAmount: null, depositCurrency: null, dealDemand: null } }));
    await 卡.getByText("已生效").waitFor({ state: "detached" });
    const 字 = await 卡.innerText();
    expect(字).not.toContain("合同状态");
    expect(字).not.toContain("痛点标注");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// 16a（11-11）：客户、项目详情一起回全站六档（原来大一号 26 / 18 / 16 / 16 / 14，和列表页不是一套）
it("10-31 改版 R7（16a 回六档）：和客户详情同一套字阶——标题 22、卡片标题 15、值 14 正文色、字段名 13 灰、辅助 13 灰、待填 14 浅灰；0 照正文色", async () => {
  const { page, errors } = await open(true);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({
      成交钱: { contractAmount: null, contractCurrency: null, depositAmount: 0, depositCurrency: "USD", dealDemand: null } }));
    const 卡 = page.locator(".proj-side .ant-card").filter({ hasText: "定金金额" }).first();
    await 卡.waitFor();
    const 色 = (v: string) => page.evaluate(v => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.querySelector(".proj-wrap")!.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }, v);
    const 样 = (l: import("playwright").Locator) => l.evaluate(e => { const c = getComputedStyle(e); return { 字: c.fontSize, 色: c.color }; });
    const [墨, 灰, 浅] = [await 色("--ink"), await 色("--text-muted"), await 色("--text-faint")];
    expect(await 样(page.locator(".proj-wrap .page-head h1"))).toEqual({ 字: "22px", 色: 墨 });
    expect(await 样(卡.locator(".ant-card-head-title"))).toEqual({ 字: "15px", 色: 墨 });
    expect(await 样(卡.getByText("定金金额", { exact: true }))).toEqual({ 字: "13px", 色: 灰 });
    const 零 = 卡.locator("div").filter({ hasText: /^定金金额/ }).last();
    expect(await 零.evaluate(e => { const c = getComputedStyle(e); return { 字: c.fontSize, 色: c.color }; })).toEqual({ 字: "14px", 色: 墨 });
    expect(await 样(卡.locator('[data-empty="合同金额"]'))).toEqual({ 字: "14px", 色: await 色("--empty-fg") });
    expect(await 色("--empty-fg")).not.toBe(浅);
    // 「阶段 / 进程」两格企业版不显示了（F-项目-19），.proj-where-label 只在有回收日时出现，这里不再量
    // D4 · M7-a 起沟通条目头是一行灰字（谁 · 方式 · 发起 … 时间），时间换成列表那一套（今天 13:13 / 11 月 18 日）
    const 辅 = page.locator(".proj-main .proj-fu-t").first();
    expect(await 样(辅)).toEqual({ 字: "13px", 色: 灰 });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// 11-04 用户改了规矩：「尽量所有信息都在一行显示完整」「一行显示不下的用... 但是悬浮要做好，鼠标移上去可以看完整。」
// 所以超长项目名不再折行，改成一行 + 省略号；页面照旧不许横滚
it("10-31 改版 R7（11-04 改一行）：超长项目名、窄容器下字号放大后不横滚，放不下的一行带省略号", async () => {
  const { page, errors } = await open(true, 1024);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({ name: "超长的项目名字没有空格".repeat(8) }));
    await page.getByText("超长的项目名字没有空格超长").first().waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const 溢 = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".proj-wrap .page-head h1, .proj-wrap .ant-card-head-title")]
      .filter(e => e.scrollWidth > e.clientWidth + 1)
      .filter(e => { const s = getComputedStyle(e); return !(s.textOverflow === "ellipsis" && s.whiteSpace === "nowrap"); })
      .map(e => e.className + " | " + e.innerText.slice(0, 12)));
    expect(溢).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("容器窄于 630（开着 AI 侧栏）：退成一栏，干活的在上", async () => {
  const { page } = await open(true, 1366, 600);
  try {
    const [主, 侧] = await Promise.all([page.locator(".proj-main").boundingBox(), page.locator(".proj-side").boundingBox()]);
    expect(侧!.y).toBeGreaterThan(主!.y + 主!.height - 1);
    expect(Math.abs(侧!.width - 主!.width)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await page.close(); }
});

it("开关关闭：照原来一列摆、960 宽，没有两栏；没有提成卡、没有「记一条沟通」主按钮", async () => {
  const { page, errors } = await open(false);
  try {
    expect(await page.locator(".proj-2col, .proj-wrap").count()).toBe(0);
    expect(await page.locator("#root [style*=\"max-width\"]").first().evaluate(d => getComputedStyle(d).maxWidth)).toBe("960px");
    expect(await page.getByRole("button", { name: "记一条沟通" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "AI 录入" }).count()).toBe(0);
    expect(await page.getByText("项目来源").count()).toBe(0);
    expect(await page.getByText("提成", { exact: true }).count()).toBe(0);
    expect(await page.locator(".ant-card-head-title").allTextContents()).toEqual(["项目", "交付", "项目组（1）", "进程变更（1）", "沟通"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("P11 定稿 -2 版 %ipx：项目卡有级别（F-客户-01 起只显示字母不带星）、区域、地址（长地址折行不撑卡）；编辑框里有项目级别、所在地四格、详细地址，不横向溢出", async (w) => {
  const { page, errors } = await open(true, w);
  try {
    const 卡 = page.locator(".proj-side .ant-card").filter({ hasText: "项目来源" }).first();
    const 字 = await 卡.innerText();
    expect(字).not.toMatch(/[★☆]/);
    expect(字).toContain("A 重点");
    expect(字).toMatch(/区域\s*深圳市/);
    expect(字).toContain("广东省 深圳市");
    expect(await 卡.evaluate(c => c.scrollWidth <= c.clientWidth + 1)).toBe(true);
    // 级别在金额前面
    expect(字.indexOf("级别")).toBeLessThan(字.indexOf("金额"));
    // 企业版「编辑项目」是项目卡标题右边一个小铅笔（U-项目-05），页头不再摆
    expect(await 卡.locator(".ant-card-extra button").evaluateAll(bs => bs.map(b => b.getAttribute("aria-label")))).toEqual(["编辑项目"]);
    await 编辑钮(page).click();
    const 框 = page.locator(".ant-modal-container"); // 这版 antd 的弹框外壳叫 container（没有 .ant-modal-content）
    await 框.getByText("项目级别").waitFor();
    for (const 名 of ["国家/地区", "省", "市", "区县", "详细地址"]) expect(await 框.getByLabel(名, { exact: true }).count()).toBeGreaterThan(0);
    expect(await 框.getByRole("textbox", { name: "详细地址" }).inputValue()).toContain("科技园");
    // 四格每格都在框里、不重叠出框
    const 框盒 = (await 框.boundingBox())!;
    for (const 名 of ["省", "市", "区县"]) {
      const b = (await 框.getByRole("textbox", { name: 名, exact: true }).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(框盒.x);
      expect(b.x + b.width).toBeLessThanOrEqual(框盒.x + 框盒.width);
      expect(b.width).toBeGreaterThanOrEqual(90);
    }
    expect(await 框.evaluate(c => c.scrollWidth <= c.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // 改成国外：省、区县两格收起来，只留城市
    const 国家 = 框.getByRole("combobox", { name: "国家/地区" });
    await 国家.fill("美国");
    await 框.getByRole("textbox", { name: "省", exact: true }).waitFor({ state: "detached" });
    expect(await 框.getByRole("textbox", { name: "区县", exact: true }).count()).toBe(0);
    expect(await 框.getByRole("textbox", { name: "市", exact: true }).getAttribute("placeholder")).toContain("城市");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

const 不伸出 = (page: import("playwright").Page, sel: string) =>
  page.locator(sel).evaluateAll(es => es.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => `${e.className}:${e.scrollWidth}>${e.clientWidth}`));

// 10-30 交互方案 P2：1366 及以下项目名单默认收进抽屉（lib/roster.ts 项目名单门槛），三栏从 1367 起
it.each([1367, 1440])("三栏 %ipx：应用导航 | 项目名单 | 详情三个竖条，详情里主区 + 右栏 280；超长项目名、客户名不横向溢出", async (w) => {
  const { page, errors } = await open(true, w, undefined, true);
  try {
    const [导航, 名单, 主, 主区, 侧] = await Promise.all(["nav.rail", ".pane-roster", "main.main", ".proj-main", ".proj-side"].map(s => page.locator(s).boundingBox()));
    expect(Math.round(名单!.width)).toBe(220);
    expect(名单!.x).toBeGreaterThanOrEqual(导航!.x + 导航!.width - 1);
    expect(主!.x).toBeGreaterThanOrEqual(名单!.x + 名单!.width - 1);
    expect(主区!.x).toBeGreaterThan(名单!.x + 名单!.width);
    expect(侧!.x).toBeGreaterThan(主区!.x + 主区!.width);
    expect(Math.round(侧!.width)).toBe(280);
    expect(侧!.x + 侧!.width).toBeLessThanOrEqual(w);
    // 名单顶上：项目 N、表格视图、收起中栏；页签 全部 / 本周要跟；搜索框
    expect(await page.locator(".pane-roster .pane-t").innerText()).toMatch(/项目\s*5/);
    expect(await page.locator(".pane-roster a[aria-label='项目表格']").getAttribute("href")).toBe("/projects");
    expect(await page.locator(".pane-roster").getByRole("button", { name: "隐藏项目列表" }).count()).toBe(1);
    expect(await page.locator(".pane-roster [role=tab]").allInnerTexts()).toEqual(["全部", "本周要跟"]);
    expect(await page.getByRole("textbox", { name: "搜索项目" }).getAttribute("placeholder")).toBe("搜项目名、客户、最近一句");
    // 名单摊开时，详情页头那颗「显示项目列表」不出现（同一个开关不摆两颗）；原来那条 184px 小列表没了
    expect(await page.getByRole("button", { name: "显示项目列表" }).count()).toBe(0);
    expect(await page.locator(".proj-shell, .proj-nav").count()).toBe(0);
    // 不搜时按当前阶段分组，三大阶段的顺序，空的归「未填写」排最后，一个都不少
    expect((await page.locator(".roster-sec").allInnerTexts()).map(t => t.replace("▾", "").replace(/\s+/g, " ").trim())).toEqual(["线索 1", "商机 2", "订单 1", "未填写 1"]);
    expect(await page.locator(".roster-row").count()).toBe(5);
    // 当前项目高亮、点得中；右边写当前进程（有结局写结局）
    const 当前 = page.locator(".roster-row.on");
    expect(await 当前.count()).toBe(1);
    expect(await 当前.getAttribute("href")).toBe("/projects/p1");
    expect(await 当前.locator(".roster-stage").innerText()).toContain("生产备货");
    expect(await page.locator(".roster-row[href='/projects/p3'] .roster-stage").innerText()).toBe("输单");
    const b = (await 当前.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(名单!.x + 名单!.width + 1);
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest(".roster-row")?.getAttribute("href"), [b.x + b.width / 2, b.y + b.height / 2])).toBe("/projects/p1");
    // 溢出：整页、名单、每一行、详情的两栏、右栏每张卡
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await 不伸出(page, ".pane-roster, .pane-roster .pane-rows, .roster-row, .roster-m, main.main, .proj-main, .proj-side, .proj-side .ant-card")).toEqual([]);
    // 组头能折叠，折了那组的行收起来，别的组不动
    await page.locator(".roster-sec").filter({ hasText: "商机" }).click();
    expect(await page.locator(".roster-row").count()).toBe(3);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("三栏 %ipx：名单收成抽屉，页头最左边「显示项目列表」打开；抽屉里不横向溢出", async (w) => {
  const { page, errors } = await open(true, w, undefined, true);
  try {
    expect(await page.locator(".pane-roster").count()).toBe(0);
    const 开 = page.getByRole("button", { name: "显示项目列表" });
    expect(await 开.count()).toBe(1);
    // 开关在页头最左边、在正文里点得中
    const [开盒, 主区] = await Promise.all([开.boundingBox(), page.locator(".proj-main").boundingBox()]);
    expect(开盒!.x).toBeLessThanOrEqual(主区!.x + 4);
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"), [开盒!.x + 开盒!.width / 2, 开盒!.y + 开盒!.height / 2])).toBe("显示项目列表");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await 不伸出(page, "main.main, .proj-main, .proj-side, .proj-side .ant-card")).toEqual([]);
    await 开.click();
    const 抽屉 = page.locator(".pane-drawer .roster-row.on");
    await 抽屉.waitFor();
    expect(await page.locator(".pane-drawer .roster-row").count()).toBe(5);
    expect(await 不伸出(page, ".pane-drawer .pane-rows, .pane-drawer .roster-row, .pane-drawer .roster-m")).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// 10-31 改版 R3：整页不滚、页头不动，两栏各自滚；只有右栏露滚动条。窄到一栏时那一栏整个滚；手机宽还是整页滚
it.each([1440, 1280, 1024])("三栏 %ipx：整页不滚，主区、右栏各自滚，滚一栏另一栏和页头不动；主区不露滚动条", async (w) => {
  const { page, errors } = await open(true, w, undefined, true);
  try {
    await page.setViewportSize({ width: w, height: 520 });
    const 量 = () => page.evaluate(() => {
      const 主 = document.querySelector(".proj-main") as HTMLElement, 侧 = document.querySelector(".proj-side") as HTMLElement;
      return { 页滚: document.documentElement.scrollHeight - window.innerHeight, 主顶: 主.scrollTop, 侧顶: 侧.scrollTop, 头: document.querySelector(".proj-head")!.getBoundingClientRect().top,
        主溢: 主.scrollHeight - 主.clientHeight, 侧溢: 侧.scrollHeight - 侧.clientHeight, 主底: 主.getBoundingClientRect().bottom, 侧底: 侧.getBoundingClientRect().bottom,
        主条: getComputedStyle(主).scrollbarWidth, 侧条: getComputedStyle(侧).scrollbarWidth, 主滚: getComputedStyle(主).overflowY, 侧滚: getComputedStyle(侧).overflowY };
    });
    const 起 = await 量();
    expect(起.页滚).toBeLessThanOrEqual(0);
    expect([起.主滚, 起.侧滚]).toEqual(["auto", "auto"]);
    expect(起.主溢).toBeGreaterThan(0);
    expect(起.侧溢).toBeGreaterThan(0);
    expect(起.主条).toBe("none");
    expect(起.侧条).not.toBe("none");
    // 两栏底边都在窗口里（不被裁、不顶出去）
    expect(起.主底).toBeLessThanOrEqual(520);
    expect(起.侧底).toBeLessThanOrEqual(520);
    await page.locator(".proj-side").evaluate(e => { e.scrollTop = 200; });
    const 滚侧 = await 量();
    expect(滚侧.侧顶).toBeGreaterThan(0);
    expect([滚侧.主顶, 滚侧.头, 滚侧.页滚]).toEqual([0, 起.头, 起.页滚]);
    await page.locator(".proj-main").evaluate(e => { e.scrollTop = 200; });
    const 滚主 = await 量();
    expect(滚主.主顶).toBeGreaterThan(0);
    expect([滚主.侧顶, 滚主.头]).toEqual([滚侧.侧顶, 起.头]);
    // 客户页「跟进」跳过来的落点 #project-follow 还能滚到眼前
    await page.locator(".proj-main").evaluate(e => { e.scrollTop = 0; });
    await page.locator("#project-follow").evaluate(e => { (e.parentElement as HTMLElement).scrollTop = 9999; e.scrollIntoView(); });
    const 落点 = (await page.locator("#project-follow").boundingBox())!;
    expect(落点.y).toBeGreaterThanOrEqual(0);
    expect(落点.y).toBeLessThan(520);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("三栏 800px（退成一栏）：整页不滚，那一栏整个滚、页头不动；390 手机宽还是整页滚", async () => {
  const { page, errors } = await open(true, 800, undefined, true);
  try {
    await page.setViewportSize({ width: 800, height: 520 });
    const 栏 = await page.evaluate(() => getComputedStyle(document.querySelector(".proj-2col")!).gridTemplateColumns.split(" ").length);
    expect(栏).toBe(1);
    const 头 = (await page.locator(".proj-head").boundingBox())!.y;
    expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
    await page.locator(".proj-2col").evaluate(e => { e.scrollTop = 300; });
    expect(await page.locator(".proj-2col").evaluate(e => e.scrollTop)).toBeGreaterThan(0);
    expect((await page.locator(".proj-head").boundingBox())!.y).toBe(头);
    await page.setViewportSize({ width: 390, height: 700 });
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".proj-2col")!).overflowY)).toBe("visible");
    expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* 10-31 用户：「现在就是一开始就要往下滑才能看到。我要整个页面本来就有显示。」——真机 shell 带 has-ai-fab，正文底下给浮标让的 88 把两栏顶短。
   详情页不让：两栏铺到窗口底（只留正文原本的 22），滚到底最后一张卡停在浮标上面 */
it.each([1024, 1280, 1366, 1680])("带 AI 浮标 %ipx：两栏铺到窗口底，整页、横向都不滚；滚到底最后一张卡在浮标上面", async (w) => {
  const { page, errors } = await open(true, w, undefined, true, true);
  try {
    await page.setViewportSize({ width: w, height: 760 });
    const 起 = await page.evaluate(() => ({ 页滚: document.documentElement.scrollHeight - window.innerHeight, 横滚: document.documentElement.scrollWidth - window.innerWidth,
      主底: document.querySelector(".proj-main")!.getBoundingClientRect().bottom, 侧底: document.querySelector(".proj-side")!.getBoundingClientRect().bottom }));
    expect(起.页滚).toBeLessThanOrEqual(0);
    expect(起.横滚).toBeLessThanOrEqual(0);
    expect(起.主底).toBeGreaterThanOrEqual(760 - 24);
    expect(起.侧底).toBeGreaterThanOrEqual(760 - 24);
    for (const s of [".proj-main", ".proj-side"]) {
      const 留 = await page.locator(s).evaluate(e => { e.scrollTop = e.scrollHeight; return e.getBoundingClientRect().bottom - e.lastElementChild!.getBoundingClientRect().bottom; });
      expect(留, s).toBeGreaterThanOrEqual(60);
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

async function 覆盖(width: number, x: Record<string, unknown>) {
  const { page, errors } = await open(true, width);
  await page.evaluate(v => (window as unknown as { __over: (x: unknown) => void }).__over(v), x);
  await page.getByText("进程变更").first().waitFor().catch(() => { throw new Error(errors.join("\n") || "没渲染出来"); });
  return { page, errors };
}

// 9f（X-78）：线索验证中不参与超时回收，回收日那格写「验证中，不回收」，不写日期
it("验证中的线索：回收日写「验证中，不回收」；不在验证中照写日期", async () => {
  const { page, errors } = await 覆盖(1280, { 回收日: "2026-12-01", 验证不收: true });
  try {
    expect(await page.getByTestId("proj-recycle-verifying").innerText()).toBe("验证中，不回收");
    expect(await page.locator(".proj-where-label").count()).toBe(1);
    expect(await page.locator(".proj-where-label").locator("..").innerText()).not.toContain("回公海");
    await page.evaluate(v => (window as unknown as { __over: (x: unknown) => void }).__over(v), { 回收日: "2026-12-01" });
    await page.locator(".proj-where-label").waitFor();
    expect(await page.getByTestId("proj-recycle-verifying").count()).toBe(0);
    expect(await page.locator(".proj-where-label").locator("..").innerText()).toContain("回公海");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// 11-02 项目详情标清项目负责人、项目创建人：页头写各一次，负责人空着写「暂无」；项目卡不再摆一遍
it.each<[string, Record<string, unknown>, string]>([
  ["两个不同的人", { ownerName: "负责人乙", creatorName: "创建人丙" }, "项目负责人：负责人乙 · 项目创建人：创建人丙 · 创建于 "],
  ["负责人空着", { ownerId: "", ownerName: "", creatorName: "创建人丙" }, "项目负责人：— · 项目创建人：创建人丙 · 创建于 "],
  ["创建人是停用占位账号，照实写", { ownerName: "负责人乙", creatorName: "（无负责人）" }, "项目负责人：负责人乙 · 项目创建人：（无负责人） · 创建于 "],
  ["公海里，系统收回：ownerName 是原负责人，不算负责人", { pooled: true, ownerId: "", ownerName: "负责人乙", creatorName: "创建人丙", 进公海: { 方式: "超时", 谁: "系统" } }, "项目负责人：—（在公海里，原负责人 负责人乙 · 超时没跟进，系统自动收回） · 项目创建人：创建人丙 · 创建于 "],
  ["公海里，查不到原负责人", { pooled: true, ownerId: "", ownerName: "", creatorName: "创建人丙" }, "项目负责人：—（在公海里） · 项目创建人：创建人丙 · 创建于 "],
])("页头标清项目负责人、项目创建人：%s", async (_, x, 开头) => {
  const { page, errors } = await 覆盖(1280, x);
  try {
    expect(await page.locator(".proj-head .page-head p").innerText()).toContain(开头);
    // 项目卡只剩「历史」，负责人不写第二遍；空的也不写「没人」
    expect(await page.getByText("负责人", { exact: true }).count()).toBe(0);
    expect(await page.locator(".proj-main").innerText()).not.toContain("没人");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// 11-20 c2 实操：管理员看别人退回公海的项目，提示条写「是你放回去的」——原来领不了又没给原因的一律这么说。只对真放回的那位说
it.each<[string, Record<string, unknown>, string]>([
  ["别人放回、我的账号领不了（如系统管理员没设业务角色）", { 放回的是我: false, 进公海: { 方式: "手动", 谁: "销售乙" } }, "你的账号不能领公海项目，等能领的同事领取"],
  ["没给放回的是我（老数据）当不是", { 进公海: { 方式: "手动", 谁: "销售乙" } }, "你的账号不能领公海项目，等能领的同事领取"],
  ["真是我放回的", { 放回的是我: true, 进公海: { 方式: "手动", 谁: "组长甲" } }, "是你放回去的，等同事领取"],
  ["我是原负责人、领不回", { 领取不给: "原负责人不能领回", 放回的是我: true }, "你是原负责人，原负责人不能领回，等同事领取"],
  ["已结束的项目：照原因说，不说「你是原负责人」", { 领取不给: "这个项目已经结束（输单），不能单独领取", 放回的是我: false }, "这个项目已经结束（输单），不能单独领取"],
  ["能领", { 能领取: true }, "领取了你就是负责人，可以接着推进程"],
])("公海提示条按实际情况说：%s", async (_, x, 话) => {
  const { page, errors } = await 覆盖(1280, { pooled: true, ownerId: "", ownerName: "销售乙", 能领取: false, 领取不给: null, ...x });
  try {
    const 条 = page.locator(".ant-alert").filter({ hasText: "这个项目在线索公海里" });
    expect((await 条.locator(".ant-alert-description").innerText()).trim()).toBe(话);
    if (!x.放回的是我) expect(await 条.innerText()).not.toContain("你放回");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("%ipx：超长负责人、创建人名字在页头折行，不横向伸出，也不压住按钮", async (宽) => {
  const 长名 = "超长名字" + "Y".repeat(300); // 这里没有外壳，页头有整屏宽：90 个不够宽，去掉折行规则也量不出来
  const { page, errors } = await 覆盖(宽, { ownerName: 长名, creatorName: 长名 + "丙" });
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await 不伸出(page, ".proj-head .page-head p")).toEqual([]);
    const 行 = page.locator(".proj-head .page-head p");
    expect(await 行.innerText()).toContain(长名 + "丙");
    const 框 = (await 行.boundingBox())!;
    expect(框.x + 框.width).toBeLessThanOrEqual(宽);
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("p")?.textContent?.startsWith("项目负责人：") ?? false, [框.x + 框.width / 2, 框.y + 框.height / 2])).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const 宽 of [1280, 1024]) {
  it(`${宽}px：每条沟通有「…」，修改 / 删除菜单不出屏；修改弹窗带上原内容；删除先在这条下面出确认条（dt.talkdel）`, async () => {
    const { page, errors } = await 覆盖(宽, { 可改沟通: true, 可删沟通: true, followUps: [{ id: "f1", type: "PHONE", content: "沟通内容" + "X".repeat(90), occurredAt: "2026-10-03T00:00:00.000Z", who: "组长甲", node: "生产备货", code: "FUL0001", 提醒: null, 版本: "2026-10-03T00:00:00.000Z" }] });
    try {
      const 点 = page.getByRole("button", { name: "这条沟通的更多操作" });
      expect(await 点.count()).toBe(1);
      expect(await 不伸出(page, ".proj-main")).toEqual([]);
      await 点.click();
      const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
      await 菜单.waitFor();
      expect((await 菜单.locator(".ant-dropdown-menu-item").allInnerTexts()).map(t => t.trim())).toEqual(["新建卡点", "修改", "删除"]);
      const 盒 = (await 菜单.boundingBox())!;
      expect(盒.x).toBeGreaterThanOrEqual(0);
      expect(盒.x + 盒.width).toBeLessThanOrEqual(宽);
      await 菜单.getByText("修改").click();
      const 窗 = page.getByRole("dialog").filter({ hasText: "修改这条沟通" });
      await 窗.waitFor();
      expect(await 窗.getByRole("textbox").last().inputValue()).toContain("沟通内容");
      await 窗.getByRole("button", { name: "取 消" }).or(窗.getByRole("button", { name: "取消" })).first().click();
      await 窗.waitFor({ state: "hidden" });
      await 点.click();
      await page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu").getByText("删除").click();
      // 原型 dt.talkdel：确认条长在这一条下面，写清进回收站 30 天、谁能恢复（和回收站权限口径一致）
      const 问 = page.getByRole("group", { name: "确认删除这条沟通" });
      await 问.waitFor();
      expect(await 问.innerText()).toContain("删了进回收站 30 天");
      expect(await 问.innerText()).toContain("系统管理员或回收站副手能恢复");
      const 问盒 = (await 问.boundingBox())!;
      const 行盒 = (await page.locator("#follow-f1").boundingBox())!;
      expect(问盒.y).toBeGreaterThanOrEqual(行盒.y);
      expect(问盒.y + 问盒.height).toBeLessThanOrEqual(行盒.y + 行盒.height + 1);
      expect(问盒.x + 问盒.width).toBeLessThanOrEqual(宽);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // 「取消」先拿焦点（#402 复审：多按一下回车不误删）；取消 = 收起、没删
      expect(await 问.getByRole("button", { name: /取\s*消/ }).evaluate((b) => b === document.activeElement)).toBe(true);
      await 问.getByRole("button", { name: /取\s*消/ }).click();
      await 问.waitFor({ state: "hidden" });
      expect(await page.evaluate(() => (Reflect.get(window, "__删沟通") as unknown[] | undefined)?.length ?? 0)).toBe(0);
      // 再点删除 → Esc 也收起
      await 点.click();
      await page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu").getByText("删除").click();
      await 问.waitFor();
      await page.keyboard.press("Escape");
      await 问.waitFor({ state: "hidden" });
      // 确认删除：调一次删项目沟通，条收起、这一条原地收走（不弹顶部提示）
      await 点.click();
      await page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu").getByText("删除").click();
      await 问.getByRole("button", { name: "确认删除" }).click();
      await page.waitForFunction(() => ((Reflect.get(window, "__删沟通") as unknown[] | undefined)?.length ?? 0) === 1);
      expect(await page.evaluate(() => (Reflect.get(window, "__删沟通") as unknown[][])[0][1])).toBe("f1");
      await 问.waitFor({ state: "hidden" });
      expect(await page.locator("#follow-f1").getAttribute("class")).toContain("pd-follow-leave");
      expect(await page.locator(".ant-message-notice").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

/* 11-19 客户：沟通提交后 30 分钟内记录人本人能改。界面按服务端给的 本人可改到 出「修改（HH:mm 前可改）」，到点收起；改过的标「已修改」 */
const 本人行 = (id: string, 到: number, x: Record<string, unknown> = {}) => ({ id, type: "PHONE", content: "沟通内容" + "长".repeat(400) + "X".repeat(200), occurredAt: "2026-10-03T00:00:00.000Z", who: "组长甲" + "名".repeat(40), node: "生产备货", code: null, 提醒: null, 版本: "2026-10-03T00:00:00.000Z", 我记的: true, 本人可改到: new Date(到).toISOString(), ...x });
const 菜单项 = async (page: import("playwright").Page, n: number) => {
  await page.getByRole("button", { name: "这条沟通的更多操作" }).nth(n).click();
  const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
  await 菜单.waitFor();
  const 项 = (await 菜单.locator(".ant-dropdown-menu-item").allInnerTexts()).map(t => t.trim());
  await page.keyboard.press("Escape");
  await 菜单.waitFor({ state: "hidden" });
  return 项;
};
for (const 宽 of [1024, 1280, 1366]) {
  it(`${宽}px：本人 30 分钟内的那条「…」里有「修改（HH:mm 前可改）」，过了时限的没有；「已修改」小字、超长内容不横滚`, async () => {
    const 到 = Date.now() + 10 * 60_000;
    const { page, errors } = await 覆盖(宽, { 可改沟通: false, 可删沟通: false, followUps: [本人行("f1", 到, { 已修改: true }), 本人行("f2", Date.now() - 60_000)] });
    try {
      const 时 = new Date(到);
      const 写法 = `修改（${String(时.getHours()).padStart(2, "0")}:${String(时.getMinutes()).padStart(2, "0")} 前可改）`;
      await page.waitForFunction(() => document.querySelectorAll("[data-testid=follow-edited]").length === 1);
      expect(await 菜单项(page, 0)).toEqual(["新建卡点", 写法]);
      expect(await 菜单项(page, 1)).toEqual(["新建卡点"]);
      expect(await page.locator("#follow-f1").getByTestId("follow-edited").innerText()).toBe("已修改");
      expect(await page.locator("#follow-f2").getByTestId("follow-edited").count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await 不伸出(page, ".proj-main")).toEqual([]);
      const 小字 = (await page.locator("#follow-f1").getByTestId("follow-edited").boundingBox())!;
      expect(小字.x + 小字.width).toBeLessThanOrEqual(宽);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("本人限时改：到点「修改」自己收起；修改框带下一步两格（最近一条），交上去带下一步", async () => {
  const 快到 = Date.now() + 6000;
  const { page, errors } = await 覆盖(1280, { 可改沟通: false, 可删沟通: false, 要下一步: true, followUps: [本人行("f1", Date.now() + 10 * 60_000, { content: "短内容", 下一步: { 文字: "周五前发报价单", 时间: "2099-01-02" } }), 本人行("f2", 快到, { content: "快到点的" })] });
  try {
    await page.waitForFunction(() => document.querySelectorAll("[aria-label=这条沟通的更多操作]").length === 2);
    expect((await 菜单项(page, 1)).some(t => t.startsWith("修改（"))).toBe(true);
    // 到点不用刷新，「修改」自己收起
    await page.waitForTimeout(Math.max(0, 快到 - Date.now()) + 700);
    expect(await 菜单项(page, 1)).toEqual(["新建卡点"]);
    await page.getByRole("button", { name: "这条沟通的更多操作" }).first().click();
    await page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu").getByText(/^修改（/).click();
    const 窗 = page.getByRole("dialog").filter({ hasText: "修改这条沟通" });
    await 窗.waitFor();
    expect(await 窗.getByLabel("下一步计划").inputValue()).toBe("周五前发报价单");
    expect(await 窗.innerText()).toContain("改了会同步到项目上的下一步");
    await 窗.getByLabel("下一步计划").fill("改成周四打电话");
    await 窗.getByRole("button", { name: /保\s*存/ }).click();
    await page.waitForFunction(() => ((Reflect.get(window, "__改沟通") as unknown[] | undefined)?.length ?? 0) === 1);
    const 交 = await page.evaluate(() => (Reflect.get(window, "__改沟通") as unknown[][])[0]);
    expect(交[1]).toBe("f1");
    expect(交[2]).toMatchObject({ content: "短内容", 下一步: "改成周四打电话", 下一步时间: "2099-01-02" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("本人限时改：不是最近一条（没给下一步）的修改框不出下一步两格，交上去也不带", async () => {
  const { page, errors } = await 覆盖(1280, { 可改沟通: false, 可删沟通: false, followUps: [本人行("f1", Date.now() + 10 * 60_000, { content: "老一条" })] });
  try {
    await page.waitForFunction(() => !!document.querySelector("[aria-label=这条沟通的更多操作]"));
    await page.getByRole("button", { name: "这条沟通的更多操作" }).first().click();
    await page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu").getByText(/^修改（/).click();
    const 窗 = page.getByRole("dialog").filter({ hasText: "修改这条沟通" });
    await 窗.waitFor();
    expect(await 窗.getByLabel("下一步计划").count()).toBe(0);
    await 窗.getByRole("button", { name: /保\s*存/ }).click();
    await page.waitForFunction(() => ((Reflect.get(window, "__改沟通") as unknown[] | undefined)?.length ?? 0) === 1);
    expect(await page.evaluate(() => (Reflect.get(window, "__改沟通") as unknown[][])[0][2])).not.toHaveProperty("下一步");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("本人限时改（审核中-1 / 低-2）：下一步两格人没动就不交下一步、不逼填时间；沟通时间没动原样交回 ISO（带秒不截）", async () => {
  const { page, errors } = await 覆盖(1280, { 可改沟通: false, 可删沟通: false, 要下一步: true, followUps: [本人行("f1", Date.now() + 10 * 60_000, { content: "短内容", occurredAt: "2026-10-03T00:00:42.000Z", 下一步: { 文字: "周五前发报价单", 时间: null } })] });
  try {
    await page.waitForFunction(() => !!document.querySelector("[aria-label=这条沟通的更多操作]"));
    await page.getByRole("button", { name: "这条沟通的更多操作" }).first().click();
    await page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu").getByText(/^修改（/).click();
    const 窗 = page.getByRole("dialog").filter({ hasText: "修改这条沟通" });
    await 窗.waitFor();
    expect(await 窗.getByLabel("下一步计划").inputValue()).toBe("周五前发报价单");
    await 窗.getByLabel("沟通内容").fill("只改内容");
    // 下一步时间空着、要下一步开着：人没动下一步，照样能存
    expect(await 窗.getByRole("button", { name: /保\s*存/ }).isDisabled()).toBe(false);
    await 窗.getByRole("button", { name: /保\s*存/ }).click();
    await page.waitForFunction(() => ((Reflect.get(window, "__改沟通") as unknown[] | undefined)?.length ?? 0) === 1);
    const 交 = await page.evaluate(() => (Reflect.get(window, "__改沟通") as unknown[][])[0][2] as Record<string, unknown>);
    expect(交).not.toHaveProperty("下一步");
    expect(交).not.toHaveProperty("下一步时间");
    expect(交).toMatchObject({ content: "只改内容", occurredAt: "2026-10-03T00:00:42.000Z" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("本人限时改（低-1）：按服务器钟算——本机钟快了 20 分钟，服务器说还能改就照样出「修改」", async () => {
  const 服务器 = Date.now() - 20 * 60_000;
  const { page, errors } = await 覆盖(1280, { 可改沟通: false, 可删沟通: false, 服务器现在: new Date(服务器).toISOString(), followUps: [本人行("f1", 服务器 + 10 * 60_000)] });
  try {
    await page.waitForFunction(() => !!document.querySelector("[aria-label=这条沟通的更多操作]"));
    await page.waitForTimeout(300);
    expect((await 菜单项(page, 0)).some(t => t.startsWith("修改（"))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("本人限时改（低-1）：弹窗开着到点，框里说一句、草稿清掉、保存灰掉", async () => {
  const 快到 = Date.now() + 5000;
  const { page, errors } = await 覆盖(1280, { 可改沟通: false, 可删沟通: false, followUps: [本人行("f1", 快到, { content: "快到点的" })] });
  try {
    await page.waitForFunction(() => !!document.querySelector("[aria-label=这条沟通的更多操作]"));
    await page.getByRole("button", { name: "这条沟通的更多操作" }).first().click();
    await page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu").getByText(/^修改（/).click();
    const 窗 = page.getByRole("dialog").filter({ hasText: "修改这条沟通" });
    await 窗.waitFor();
    await 窗.getByLabel("沟通内容").fill("打了一半的字");
    await page.waitForTimeout(Math.max(0, 快到 - Date.now()) + 800);
    expect(await 窗.innerText()).toContain("已经超过提交后 30 分钟，这条不能再改了");
    expect(await 窗.getByRole("button", { name: /保\s*存/ }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes("改项目沟通:f1")).length)).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("没有改沟通的权限：「…」里只剩新建卡点（10-30 从行上收进来，11-12 由发卡点改名）", async () => {
  const { page, errors } = await 覆盖(1280, { 可改沟通: false });
  try {
    await page.getByRole("button", { name: "这条沟通的更多操作" }).first().click();
    const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
    await 菜单.waitFor();
    expect(new Set((await 菜单.locator(".ant-dropdown-menu-item").allInnerTexts()).map(t => t.trim()))).toEqual(new Set(["新建卡点"]));
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("下一步：有文字写文字、有时间跟在后面；老数据只有时间就只摆时间；记一条沟通要写下一步计划", async () => {
  const { page, errors } = await 覆盖(1280, { nextStepText: "周五前发报价单给对方采购", nextStepAt: "2026-11-01" });
  try {
    const 行 = page.locator(".proj-side").getByText("下一步", { exact: true }).locator("..");
    expect((await 行.innerText()).replace(/\s+/g, " ")).toContain("周五前发报价单给对方采购 · 2026-11-01");
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ nextStepText: null, nextStepAt: "2026-11-01" }));
    await page.waitForFunction(() => !document.body.innerText.includes("周五前发报价单"));
    expect((await 行.innerText()).replace(/\s+/g, " ")).toContain("下一步 2026-11-01");
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ nextStepText: "只写了一句", nextStepAt: null }));
    await page.getByText("只写了一句").waitFor();
    await page.getByTestId("follow-card-new").click();
    const 窗 = page.getByRole("dialog");
    await 窗.getByLabel("下一步计划").waitFor();
    expect(await 窗.getByLabel("下一步计划").getAttribute("maxlength")).toBe("100");
    // dt.follow（P-界面-34）：下一步时间默认 3 天后，「3 天后」快捷亮着，可改
    const 三天后 = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
    expect(await 窗.getByLabel("下一步时间").inputValue()).toBe(三天后);
    expect(await 窗.getByRole("button", { name: "3 天后" }).getAttribute("aria-pressed")).toBe("true");
    const 明天 = 窗.getByRole("button", { name: /^明\s*天$/ });
    await 明天.click();
    expect(await 明天.getAttribute("aria-pressed")).toBe("true");
    expect(await 窗.getByRole("button", { name: "3 天后" }).getAttribute("aria-pressed")).toBe("false");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("组员记沟通（11-19 客户答复）：记一条沟通框不摆下一步计划、下一步时间，不写也能交；1024 / 1280 / 1366 框不横溢", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 覆盖(w, { 能记沟通: true, 组员记沟通: true, 要下一步: true, nextStepText: "负责人定的" });
    try {
      await page.getByTestId("follow-card-new").click();
      const 窗 = page.getByRole("dialog");
      await 窗.getByText("沟通内容").first().waitFor();
      expect(await 窗.getByLabel("下一步计划").count()).toBe(0);
      expect(await 窗.getByLabel("下一步时间").count()).toBe(0);
      const 宽 = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(宽[0]).toBeLessThanOrEqual(宽[1]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it.each([375, 1024, 1280, 1366])("新建沟通的卡点（11-19）%ipx：默认「暂无卡点」只摆类型一格；选了类型出影响和阻碍原因、没有标题和卡在哪儿；没选原因点「保存」在原因格下写「请选阻碍原因」、不交；能打字新增；框不横溢", async (w) => {
  const { page, errors } = await 覆盖(w, { 能记沟通: true });
  try {
    await page.getByTestId("follow-card-new").click();
    const 窗 = page.getByRole("dialog");
    const 类型 = 窗.getByRole("combobox", { name: "卡点类型" });
    await 类型.waitFor();
    expect(await 窗.locator(".follow-blocker").innerText()).toContain("暂无卡点");
    // 暂无卡点：不带出影响、原因（不留卡点标识）；标题、卡在哪儿任何时候都没有
    expect(await 窗.getByRole("combobox", { name: "卡点影响" }).count()).toBe(0);
    expect(await 窗.getByRole("combobox", { name: "阻碍原因" }).count()).toBe(0);
    for (const l of ["卡点标题", "卡点描述"]) expect(await 窗.getByLabel(l).count()).toBe(0);
    await 窗.getByLabel("沟通内容").fill("聊了报价");
    await 窗.getByLabel("下一步计划").fill("周五前发报价单");
    const 记下 = 窗.getByRole("button", { name: /^保\s*存$/ });
    expect(await 记下.isDisabled()).toBe(false);
    await 类型.click();
    await page.locator(".ant-select-item-option").filter({ hasText: "中度卡点" }).click();
    const 影响 = 窗.getByRole("combobox", { name: "卡点影响" });
    const 原因 = 窗.getByRole("combobox", { name: "阻碍原因" });
    await 原因.waitFor();
    expect(await 影响.count()).toBe(1);
    // 影响照旧默认（占位写默认值）
    expect(await 窗.locator(".follow-blocker").innerText()).toContain("默认短期不影响");
    for (const l of ["卡点标题", "卡点描述"]) expect(await 窗.getByLabel(l).count()).toBe(0);
    // 没选原因：D4 起「保存」照样能点；点了在原因格下写「请选阻碍原因」、原因格标红、焦点落过去，不交
    expect(await 记下.isDisabled()).toBe(false);
    expect(await 窗.locator(".ant-modal-footer").innerText()).not.toContain("请选阻碍原因");
    await 记下.click();
    await 窗.locator('[data-fk="卡点原因"] .fm-err').waitFor();
    expect(await 窗.locator('[data-fk="卡点原因"] .fm-err').innerText()).toBe("请选阻碍原因");
    expect(await 窗.locator('[data-fk="卡点原因"] .ant-select-status-error').count()).toBe(1);
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-fk="卡点原因"]'))).toBe(true);
    expect(await page.evaluate(() => Reflect.get(window, "__记沟通"))).toBeFalsy();
    // 框不横溢、卡点那几格不出框
    const 宽 = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(宽[0]).toBeLessThanOrEqual(宽[1]);
    const 框 = (await 窗.boundingBox())!;
    const 格们 = await 窗.locator(".follow-blocker").evaluate((el) => [...el.querySelectorAll(":scope > div > .ant-select, :scope .follow-blocker-row > .ant-select, :scope > div > div > .ant-select")].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }));
    expect(格们.length).toBe(3);
    for (const [左, 右] of 格们) {
      expect(左).toBeGreaterThanOrEqual(框.x - 1);
      expect(右).toBeLessThanOrEqual(框.x + 框.width + 1);
    }
    expect(await 窗.locator(".follow-blocker").evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    // 选一个 + 打字新增一个（纯空格不算）
    await 原因.click();
    await page.locator(".ant-select-item-option").filter({ hasText: "价格" }).click();
    await page.keyboard.type("   ");
    await page.keyboard.press("Enter");
    await page.keyboard.type("自填一条原因");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    // 选上了红字当场消失
    expect(await 窗.locator(".fm-err").count()).toBe(0);
    await 记下.click();
    await page.waitForFunction(() => Reflect.get(window, "__记沟通"));
    const 交 = await page.evaluate(() => (Reflect.get(window, "__记沟通") as unknown[][])[0][2]);
    expect(交).toEqual({ type: "中度卡点", impact: null, reasons: ["价格", "自填一条原因"] });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("记一条沟通的卡点（11-19）：选了类型、挑了原因再换回「暂无卡点」，影响、原因收起并清空，记下时交的是暂无（不生成）", async () => {
  const { page, errors } = await 覆盖(1280, { 能记沟通: true });
  try {
    await page.getByTestId("follow-card-new").click();
    const 窗 = page.getByRole("dialog");
    const 类型 = 窗.getByRole("combobox", { name: "卡点类型" });
    await 类型.waitFor();
    await 类型.click();
    await page.locator(".ant-select-item-option").filter({ hasText: "重要卡点" }).click();
    const 原因 = 窗.getByRole("combobox", { name: "阻碍原因" });
    await 原因.click();
    await page.locator(".ant-select-item-option").filter({ hasText: "价格" }).click();
    await page.keyboard.press("Escape");
    await 类型.click();
    await page.locator(".ant-select-item-option").filter({ hasText: "暂无卡点" }).click();
    expect(await 原因.count()).toBe(0);
    expect(await 窗.getByRole("combobox", { name: "卡点影响" }).count()).toBe(0);
    // 换回暂无时原因一起清掉：再选类型，原因是空的、「记下」又灰着
    await 类型.click();
    await page.locator(".ant-select-item-option").filter({ hasText: "轻度卡点" }).click();
    await 原因.waitFor();
    expect(await 窗.locator(".follow-blocker .ant-select-selection-item").filter({ hasText: "价格" }).count()).toBe(0);
    await 类型.click();
    await page.locator(".ant-select-item-option").filter({ hasText: "暂无卡点" }).click();
    await 窗.getByLabel("沟通内容").fill("聊了报价");
    await 窗.getByLabel("下一步计划").fill("周五前发报价单");
    await 窗.getByRole("button", { name: /^保\s*存$/ }).click();
    await page.waitForFunction(() => Reflect.get(window, "__记沟通"));
    expect(await page.evaluate(() => (Reflect.get(window, "__记沟通") as unknown[][])[0][2])).toMatchObject({ type: "暂无卡点" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* 10-31 改版 R6：企业版页头把这一页能做的事摆成具名按钮，要填的进弹窗；卡上原入口照旧 */
const 页头钮 = (page: import("playwright").Page, 类 = "") =>
  page.locator(`.page-head-a button${类}`).evaluateAll(bs => bs.map(b => b.textContent!.replace(/\s/g, "")));

it("R6 页头：只留项目转让 / 项目退回公海（11-12 改名），没有「更多」；⌘N 落到节点卡的「新增沟通」；企业版没有删除项目", async () => {
  const { page, errors } = await 覆盖(1280, { 可改沟通: true });
  try {
    // 11-01 用户：「和客户页一样，仅留转让项目，退回公海。其余的放回各模块。」；
    // 编辑项目在项目卡上（U-项目-05），企业版项目不能删（服务端早就拦，这里入口也去掉）
    const 钮 = await 页头钮(page);
    expect(钮[0]).toBe("项目转让");
    expect(钮.every(t => t === "项目转让" || t === "项目退回公海")).toBe(true);
    expect(await page.getByRole("button", { name: "项目的更多操作" }).count()).toBe(0);
    expect(await page.locator(".page-head-a .ant-btn-primary").count()).toBe(0);
    expect(await page.evaluate(() => (document.querySelector(".page-head-a button.ant-btn-primary:not([disabled])") ?? document.querySelector("button[data-cmd-new]:not([disabled])"))?.textContent?.replace(/\s/g, ""))).toBe("新增沟通");
    expect(await page.getByRole("button", { name: "删除项目" }).count()).toBe(0);
    expect(await page.getByText("删除这个项目？").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("项目退回公海（11-12 改名）：确认框叫「把项目退回公海？」，写明只退这个项目、客户不动", async () => {
  const { page, errors } = await 覆盖(1280, { 能放公海: true });
  try {
    await page.locator(".page-head-a").getByRole("button", { name: "项目退回公海" }).click();
    const 窗 = page.getByRole("dialog").filter({ hasText: "把项目退回公海？" });
    await 窗.waitFor();
    expect(await 窗.innerText()).toMatch(/只退这个项目/);
    expect(await 窗.innerText()).toContain("客户和客户负责人不动");
    expect(await 窗.getByRole("button", { name: /项目退回公海/ }).count()).toBe(1);
    expect(await page.getByText("放回线索公海？").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("R6 页头跟着权限：公海里能领的只剩「领取」；退回公海等复核时灰着说原因", async () => {
  const { page, errors } = await 覆盖(1280, { pooled: true, 能领取: true, 能放公海: false, 提成: null });
  try {
    expect(await 页头钮(page, ".ant-btn-primary")).toEqual(["领取"]);
    // 公海里的项目谁都改不了（可改 = 能改 && !pooled）：转让、退回都不摆；记沟通那几样在卡上
    expect(await 页头钮(page)).toEqual(["领取"]);
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ 能放公海: true, 提成: null, 线索验证: { 判定: "初验无效", 待: "市场复核", 无效原因: null, 复核结果: null, 最终结果: null, 终验: null, 初判即终判: false, 叫法: "初验无效", 我能: null, 痕: [] } }));
    await page.waitForFunction(() => document.querySelector(".page-head-a")?.textContent?.includes("项目退回公海"));
    expect(await page.locator(".page-head-a").getByRole("button", { name: "项目退回公海" }).isDisabled()).toBe(true);
    // 11-01：项目卡上「线索验证」一行带当前结果，点开弹窗就是整个验证操作
    expect(await page.getByTestId("lead-verify-result").innerText()).toBe("初验无效");
    // 11-01 会议 §6：结果是纯字，不套 Tag 框
    expect(await page.getByTestId("lead-verify-row").locator(".ant-tag").count()).toBe(0);
    expect(await page.getByTestId("lead-verify-result").evaluate(e => e.tagName)).toBe("SPAN");
    expect(await page.getByTestId("lead-verify-nudge").count()).toBe(0);
    await page.getByTestId("lead-verify-row").click();
    const 窗 = page.getByRole("dialog").filter({ hasText: "线索验证" });
    await 窗.waitFor();
    expect(await 窗.getByTestId("lead-verify-pending").innerText()).toBe("等管理员复核");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("R6 弹窗：完成节点、改进程、改分配都能打开，标题带项目名；项目组卡上有「邀请」；「管理沟通」入口去掉了（M-权限-09）", async () => {
  const { page, errors } = await 覆盖(1280, { 可改沟通: true });
  try {
    const 头 = page.locator(".page-head-a");
    const 开 = async (按钮: string, 标题: string) => {
      await page.locator(".proj-side").getByRole("button", { name: 按钮 }).click();
      const 窗 = page.getByRole("dialog").filter({ hasText: 标题 });
      await 窗.waitFor();
      return 窗;
    };
    // 完成节点在阶段页签那一行；dt.stage（PR7b）起必填齐了一步推、不开框（框里的内容见 R5 线索那条）
    await page.locator(".proj-stage-acts").getByRole("button", { name: "完成节点" }).click();
    await expect.poll(() => 改节点记录(page)).toContain("物流运输");
    expect(await page.getByRole("dialog").filter({ hasText: "完成节点 · " }).count()).toBe(0);
    // 11-01 会议 §13：▼ 里删掉「改到别的进程」，只剩终止
    await page.getByRole("button", { name: "终止进程" }).click();
    await page.getByRole("menuitem").first().waitFor();
    expect(await page.getByRole("menuitem", { name: /改到别的进程/ }).count()).toBe(0);
    expect((await page.getByRole("menuitem").allInnerTexts()).some(t => t.includes("终止"))).toBe(true);
    await page.keyboard.press("Escape");
    await page.getByRole("menuitem").first().waitFor({ state: "hidden" });
    expect(await page.locator(".proj-side .ant-card").filter({ hasText: "项目组" }).getByRole("button", { name: /^邀\s*请$/ }).count()).toBe(1);
    const 窗 = await 开("改分配", "改提成分配");
    await 窗.getByRole("button", { name: /取\s*消/ }).click();
    await 窗.waitFor({ state: "hidden" });
    expect(await 头.getByRole("button", { name: "管理沟通" }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("11-01 会议 §13：节点图标前留一点间隔；D4（用户 11-21 定）「完成节点」浅绿底深绿字、右半「终止进程」白底；灰着整颗看得出灰", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    const 间隔 = await page.locator(".proj-stage-node .proj-stage-mark").first().evaluate(e => parseFloat(getComputedStyle(e).marginInlineStart));
    expect(间隔).toBeGreaterThanOrEqual(4);
    const 色 = (v: string) => page.evaluate(v => { const s = document.createElement("span"); s.style.color = v; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }, v);
    const 钮 = page.locator(".proj-stage-acts").getByRole("button", { name: "完成节点" });
    expect(await 钮.isDisabled()).toBe(false);
    const [底, 字] = await 钮.evaluate(e => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]);
    expect(底).toBe(await 色("var(--success-bg)"));
    expect(字).toBe(await 色("var(--success-text)"));
    // 一屏只留「新增沟通」一颗蓝实心：完成节点不是实心
    expect(await page.locator(".proj-stage-acts .ant-btn-primary").allInnerTexts()).toEqual(["新增沟通"]);
    expect(await page.getByRole("button", { name: "终止进程" }).evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await 色("var(--panel)"));
    // 看别的阶段时灰掉：工作台灰底、次要字，悬停照旧写原因
    await page.locator(".proj-stage-tab").filter({ hasText: "线索" }).first().click();
    await page.waitForFunction(() => (document.querySelector(".proj-stage-acts .proj-done-btn") as HTMLButtonElement | null)?.disabled === true);
    const 灰钮 = page.locator(".proj-stage-acts .proj-done-btn").first();
    const [灰底, 灰字] = await 灰钮.evaluate(e => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]);
    expect(灰底).toBe(await 色("var(--workbench)"));
    expect(灰字).toBe(await 色("var(--text-muted)"));
    await page.locator(".proj-stage-acts .proj-stage-tip").first().hover();
    await page.locator(".ant-tooltip").filter({ hasText: /\S/ }).first().waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* 10-31 改版 R5：节点卡里三个阶段页签 + 「完成节点 ▼」「新增沟通」（M-节点-04）。节点按字典来，能去哪照 去处们 那一套。
   F-项目-19：页签不挂「当前阶段」，不在的阶段字灰着（is-away）；A-12：线索末尾「已转商机」、商机末尾「商机赢单」、订单末尾「交付结清」（11-01） */
const 阶段签 = (page: import("playwright").Page) =>
  page.locator(".proj-stage-tab").evaluateAll(ts => ts.map(t => `${t.getAttribute("aria-selected") === "true" ? "*" : ""}${t.textContent}`));
const 节点们 = (page: import("playwright").Page) =>
  page.locator(".proj-stage-node").evaluateAll(ns => ns.map(n => `${n.className.replace(/.*is-/, "")}:${n.querySelector(".proj-stage-name")!.textContent}${n.querySelector("svg") ? "✓" : ""}`));
const 改节点记录 = (page: import("playwright").Page) => page.evaluate(() => JSON.stringify((window as unknown as { __改节点?: unknown[] }).__改节点 ?? []));

it("R5 阶段页签：三个页签、默认选所在阶段；进程按字典列，走过的打勾、当前的标「当前」；看别的阶段只能看", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    expect(await page.locator(".proj-main .ant-progress").count()).toBe(0);
    expect(await 阶段签(page)).toEqual(["线索", "商机", "*订单"]);
    expect(await page.locator(".proj-stage-tab.is-away").count()).toBe(2);
    // 11-01 答复 #7：订单末尾也挂「交付结清」，没交付不打勾
    expect(await page.locator(".proj-stage-exit.is-todo").innerText()).toBe("交付结清");
    expect(await 节点们(page)).toEqual(["cur:生产备货", "todo:物流运输", "todo:安装实施", "todo:交付验收", "todo:尾款结算"]);
    expect(await page.locator(".proj-stage-node[aria-current=step]").innerText()).toContain("当前");
    // 「完成节点 ▼」「新增沟通」摆在页签那一行右边
    expect((await page.locator(".proj-stage-acts button").allInnerTexts()).map(t => t.trim())).toEqual(["完成节点", "", "新增沟通"]);
    await page.getByRole("tab", { name: "商机" }).click();
    expect(await 阶段签(page)).toEqual(["线索", "*商机", "订单"]);
    expect(await 节点们(page)).toEqual(["痛点挖掘", "方案敲定", "成交推进", "合同审批", "签订合同", "首款到账"].map(n => `done:${n}✓`));
    expect(await page.locator(".proj-stage-exit.is-done").innerText()).toBe("商机赢单");
    expect(await page.locator(".proj-stage-exit svg").count()).toBe(1);
    expect(await page.locator(".proj-stage-note").innerText()).toBe("「商机」阶段已经走完，只能看，不能改");
    // 键盘：Home 到线索，End 回订单
    await page.getByRole("tab", { name: "商机" }).press("Home");
    expect((await 阶段签(page))[0]).toBe("*线索");
    expect(await page.locator(".proj-stage-exit.is-done").innerText()).toBe("已转商机");
    await page.keyboard.press("End");
    expect((await 阶段签(page))[2]).toBe("*订单");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("订单");
    // 推进到下一阶段，页签跟着回到新的所在阶段
    await page.getByRole("tab", { name: "线索" }).click();
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ phase: "商机", node: "合同审批" }));
    await page.waitForFunction(() => document.querySelector(".proj-stage-tab.is-on")?.textContent?.startsWith("商机"));
    expect(await 节点们(page)).toEqual(["done:痛点挖掘✓", "done:方案敲定✓", "done:成交推进✓", "cur:合同审批", "todo:签订合同", "todo:首款到账"]);
    expect(await page.locator(".proj-stage-exit.is-todo").innerText()).toBe("商机赢单");
    await page.getByRole("tab", { name: "订单" }).click();
    expect(await page.locator(".proj-stage-note").innerText()).toBe("还没到「订单」阶段，只能看，不能改");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("R5 完成节点 / 终止进程（M-节点-04/05）：必填齐了一步推一个节点、不开框（dt.stage，给撤销）；终止先确认，订单落到异常框、走终止项目进程", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    await page.locator(".proj-stage-acts").getByRole("button", { name: "完成节点" }).click();
    await expect.poll(() => 改节点记录(page)).toContain("物流运输");
    expect(await page.getByRole("dialog").filter({ hasText: "完成节点 · " }).count()).toBe(0);
    // 终止：▼ → 终止进程（写着落到哪）→ 确认 → 订单进异常框；这一步还没改节点
    await page.evaluate(() => { (window as unknown as { __改节点: unknown[] }).__改节点 = []; });
    await page.getByRole("button", { name: "终止进程" }).click();
    const 项 = page.getByRole("menuitem", { name: /终止进程/ });
    expect(await 项.innerText()).toContain("落到「异常状态」");
    await 项.click();
    const 问 = page.getByRole("dialog").filter({ hasText: "终止进程？" });
    await 问.waitFor();
    await 问.getByRole("button", { name: /继\s*续/ }).click();
    await page.getByRole("dialog").filter({ hasText: "终止进程：进异常状态" }).waitFor();
    expect(await 改节点记录(page)).toBe("[]");
    expect(await page.evaluate(() => JSON.stringify((window as unknown as { __终止?: unknown[] }).__终止 ?? []))).toBe("[]");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("R5 线索（M-节点-05/09）：完成节点一次一个节点；最后一个节点完成写「已转商机，进到 商机·痛点挖掘」；终止落到线索流失；缺必填列出来", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    // dt.stage 起没缺必填一步推、不开框：这里给一项还差，看框里写推到哪
    const 框字 = async () => {
      await page.locator(".proj-stage-acts").getByRole("button", { name: "完成节点" }).click();
      const 窗 = page.getByRole("dialog").filter({ hasText: "完成节点 · " });
      await 窗.waitFor();
      const 字 = (await 窗.innerText()).replace(/\s+/g, " ");
      await 窗.getByRole("button", { name: /取\s*消|去补齐/ }).click();
      await 窗.waitFor({ state: "hidden" });
      return 字;
    };
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ phase: "线索", node: "潜客培育", 必填: { 配了: ["金额"], 还差: ["金额"] } }));
    await page.waitForFunction(() => document.querySelector(".proj-stage-tab.is-on")?.textContent?.startsWith("线索"));
    expect(await page.locator(".proj-stage-exit.is-todo").innerText()).toBe("已转商机");
    expect(await 框字()).toContain("下一节点：线索验证");
    // 必填拦截记录（11-23）：还差必填、补填框弹出 = 记一次被拦（交项目 id，服务端自己算还差）
    expect(await page.evaluate(() => (window as unknown as { __被拦?: unknown[][] }).__被拦?.length ?? 0)).toBe(1);
    await page.getByRole("button", { name: "终止进程" }).click();
    expect(await page.getByRole("menuitem", { name: /终止进程/ }).innerText()).toContain("落到「线索流失」");
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ phase: "线索", node: "线索推进", 必填: { 配了: ["金额"], 还差: ["金额"] } }));
    await page.waitForFunction(() => document.querySelector(".proj-stage-node.is-cur")?.textContent?.startsWith("线索推进"));
    expect(await 框字()).toContain("已转商机，进到 商机·痛点挖掘");
    // 销售缺必填：框里列出来，没有推进按钮
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ phase: "线索", node: "线索推进", 必填: { 配了: ["金额"], 还差: ["金额"] } }));
    await page.locator(".proj-stage-acts").getByRole("button", { name: "完成节点" }).click();
    const 窗 = page.getByRole("dialog").filter({ hasText: "完成节点 · " });
    await 窗.waitFor();
    expect(await 窗.locator(".proj-miss-list li").count()).toBe(1);
    expect(await 窗.getByRole("button", { name: /确认推进|仍要推进/ }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1280, 1024])("dt.stage %ipx：缺必填点完成节点，补填框长在按钮下面（不盖整页的弹窗），焦点进框，Esc / 取消收起", async (w) => {
  const { page, errors } = await open(true, w);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ phase: "线索", node: "潜客培育", 必填: { 配了: ["金额"], 还差: ["金额"] } }));
    await page.waitForFunction(() => document.querySelector(".proj-stage-tab.is-on")?.textContent?.startsWith("线索"));
    const 钮 = page.locator(".proj-stage-acts").getByRole("button", { name: "完成节点" });
    expect(await 钮.getAttribute("aria-haspopup")).toBe("dialog");
    await 钮.click();
    const 窗 = page.getByRole("dialog").filter({ hasText: "完成节点 · " });
    await 窗.waitFor();
    expect(await 钮.getAttribute("aria-expanded")).toBe("true");
    // 锚在按钮上：不是遮整页的模态框
    expect(await 窗.getAttribute("aria-modal")).not.toBe("true");
    const 钮盒 = (await 钮.boundingBox())!, 窗盒 = (await 窗.boundingBox())!;
    expect(窗盒.y).toBeGreaterThanOrEqual(钮盒.y + 钮盒.height - 1);
    expect(窗盒.y - (钮盒.y + 钮盒.height)).toBeLessThan(40);
    expect(窗盒.x).toBeGreaterThanOrEqual(0);
    expect(窗盒.x + 窗盒.width).toBeLessThanOrEqual(w);
    expect(窗盒.x + 窗盒.width).toBeGreaterThan(钮盒.x);
    await page.waitForFunction(() => !!document.activeElement?.closest("[role=dialog]")?.textContent?.includes("完成节点 · "));
    await page.keyboard.press("Escape");
    await 窗.waitFor({ state: "hidden" });
    expect(await 钮.getAttribute("aria-expanded")).toBe("false");
    await 钮.click();
    await 窗.waitFor();
    await 窗.getByRole("button", { name: /取\s*消|去补齐/ }).click();
    await 窗.waitFor({ state: "hidden" });
    expect(await 改节点记录(page)).toBe("[]");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("R5 有结局 / 不能改进程：有结局换成「改回进程」、没有完成节点；不能改进程时节点卡写原因、只剩新增沟通", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ result: "异常状态", exceptionReason: "客户暂停" }));
    await page.locator(".proj-stage-node.is-cur .ant-tag").waitFor();
    expect(await page.getByRole("button", { name: "完成节点" }).count()).toBe(0);
    expect(await page.locator(".proj-stage-acts").getByRole("button", { name: "改回进程" }).count()).toBe(1);
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ result: "交付结清" }));
    await page.waitForFunction(() => document.querySelectorAll(".proj-stage-node.is-done").length === 5);
    expect(await page.locator(".proj-stage-exit.is-done").innerText()).toBe("交付结清");
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ 能改节点: false }));
    await page.waitForFunction(() => ![...document.querySelectorAll(".proj-stage-acts button")].some(b => b.textContent === "改回进程"));
    expect((await page.locator(".proj-stage-acts button").allInnerTexts()).map(t => t.trim())).toEqual(["新增沟通"]);
    expect(await page.locator(".proj-main").getByRole("button", { name: /^下一步/ }).count()).toBe(0);
    // 11-01 权限只认业务角色：企业版文案不再提老板 / 主管
    expect(await page.locator(".proj-main").innerText()).toContain("只有项目负责人能改，其他人只能看");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 800])("R5 %ipx：页签不横向溢出；进程是分段滑块、一排自己横滚，当前那格滚到看得见；当前进程橙点呼吸，减少动态效果时不动", async (w) => {
  const { page, errors } = await open(true, w);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ phase: "商机", node: "合同审批", name: "长".repeat(40) }));
    await page.waitForFunction(() => document.querySelector(".proj-stage-node.is-cur")?.textContent?.startsWith("合同审批"));
    // 10-31 用户：进程不用一屏摆全、能左右移——这一排本来就比卡宽（每块定宽），所以只量外面那两层不伸出，这一排改成量「自己横滚」
    const 伸出 = await page.locator(".proj-stages, .proj-stage-tabs").evaluateAll(es => es.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className));
    expect(伸出).toEqual([]);
    const 排 = page.locator(".proj-stage-nodes");
    expect(await 排.evaluate(e => getComputedStyle(e).overflowX)).toBe("auto");
    // 11-12 分段滑块：每格等宽、不小于最小宽度（放不下就横滚，不挤扁）
    const 宽们 = await page.locator(".proj-stage-node").evaluateAll(ns => ns.map(n => Math.round(n.getBoundingClientRect().width)));
    expect(new Set(宽们).size).toBe(1);
    expect(宽们[0]).toBeGreaterThanOrEqual(136);
    // 打开时「当前」那块整个露在这一排可见范围里
    const 露 = await 排.evaluate(ol => {
      const a = ol.getBoundingClientRect(), b = ol.querySelector("[aria-current=step]")!.getBoundingClientRect();
      return b.left >= a.left - 1 && b.right <= a.right + 1;
    });
    expect(露).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const 动画 = () => page.locator(".proj-stage-node.is-cur .proj-stage-mark").evaluate(e => getComputedStyle(e).animationName);
    expect(await 动画()).toBe("proj-stage-breath");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await 动画()).toBe("none");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("R6 关联：页头没有关联入口，关联客户 / 关联联系人卡头各自有「关联」（11-01 放回各模块）", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    await page.evaluate(() => (window as unknown as { __relate: (x: boolean) => void }).__relate(true));
    await page.getByText("关联客户（3）").waitFor();
    expect(await page.locator(".page-head-a").getByRole("button", { name: /关联/ }).count()).toBe(0);
    expect(await page.locator(".proj-side").getByRole("button", { name: "关联一家客户" }).count()).toBe(1);
    expect(await page.locator(".proj-side").getByRole("button", { name: "关联一位联系人" }).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 800])("R6 %ipx：页头按钮折行不出屏、标题不被挤没；每个按钮点得中", async (w) => {
  const { page, errors } = await 覆盖(w, { 可改沟通: true });
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const 题 = (await page.locator(".proj-wrap .page-head h1").boundingBox())!;
    expect(题.width).toBeGreaterThan(w / 4);
    for (const b of await page.locator(".page-head-a button").all()) {
      const box = (await b.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(w);
      const 点中 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box.x + box.width / 2, box.y + box.height / 2]);
      expect(点中).toBe(await b.textContent());
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* 10-31：画像各项、需求状态、关联里的角色 / 立场没填时写灰字（只是显示）；11-04 用户：灰字统一改「—」，单选、多选下拉第一项都是「—」，选了回到没填 */
const 画像卡 = (page: import("playwright").Page) => page.locator(".ant-card").filter({ has: page.locator(".proj-profile") }).first();
async function 开画像(能改: boolean) {
  const { page, errors } = await open(true);
  await page.evaluate(x => (window as unknown as { __画像: (x: boolean) => void }).__画像(x), 能改);
  await 画像卡(page).waitFor();
  return { page, errors };
}
it("画像只读：十二项都在、按序；空的（含需求类型、需求状态）写灰字「—」；关联里空的角色 / 立场 / 身份也写「—」；页上不再出现「暂未确认」", async () => {
  const { page, errors } = await 开画像(false);
  try {
    const 卡 = 画像卡(page);
    expect(await 卡.locator(".proj-profile-key").allInnerTexts()).toEqual(["预算能力", "价格感知", "决策链路", "需求状态", "需求类型", "采购周期", "产品匹配", "价值认同", "决策触达", "竞品信息", "部署条件", "场地现状"]);
    // 只读：每行就是名字 + 一段字（没有笔、没有下拉）
    const 值 = await 卡.locator(".proj-profile-row > :nth-child(2)").allInnerTexts();
    expect(值).toEqual(["预算充足", "—", "—", "—", "—", "半年", "—", "—", "—", "无竞品·我方独家", "—", "—"]);
    // 灰字：和正文色不一样
    const [灰, 正] = await Promise.all([卡.locator(".unconfirmed").first().evaluate(e => getComputedStyle(e).color), 卡.locator(".proj-profile-row > :nth-child(2)").first().evaluate(e => getComputedStyle(e).color)]);
    expect(灰).not.toBe(正);
    // 关联只读：王总没角色、没立场；同事的客户没身份
    const 关联卡 = page.locator(".proj-side .ant-card").filter({ hasText: /关联(客户|联系人)（/ });
    expect(await 关联卡.locator(".unconfirmed").count()).toBeGreaterThanOrEqual(3);
    expect(await page.getByText("暂未确认").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
it("画像能改（看 → 点了改）：单选、多选下拉第一项「—」，选了就存空、回到没填；空着再选「—」不存", async () => {
  const { page, errors } = await 开画像(true);
  try {
    const 卡 = 画像卡(page);
    const 行 = (名: string) => 卡.locator(".proj-profile-row").filter({ has: page.locator(".proj-profile-key", { hasText: new RegExp(`^${名}$`) }) });
    const 项 = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
    const 收起 = () => page.waitForFunction(() => ![...document.querySelectorAll(".ant-select-dropdown")].some(e => (e as HTMLElement).offsetParent && !e.className.includes("hidden")));
    const 存了几次 = () => page.evaluate(() => ((window as unknown as { __画像存?: unknown[] }).__画像存 ?? []).length);
    // 采购周期（半年）：点一行展开下拉，第一项「—」，选了存 null、回到「—」
    await 行("采购周期").locator(".proj-inline").click();
    await 项.first().waitFor();
    // 下拉还在展开动画里时 :visible 偶尔一项都抓不到（CI 负载高时拿到过 []），轮询到稳
    await expect.poll(async () => (await 项.allInnerTexts()).slice(0, 6)).toEqual(["—", "一年", "半年", "三月", "次月", "本月成交"]);
    await 项.first().click();
    await expect.poll(存了几次).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __画像存: unknown[][] }).__画像存[0])).toEqual(["p1", { purchaseCycle: null }]);
    await expect.poll(() => 行("采购周期").locator(".proj-inline-val").innerText()).toBe("—");
    // 已经空着的场地现状再选「—」：不存
    await 收起();
    await 行("场地现状").locator(".proj-inline").click();
    await 项.first().waitFor();
    await expect.poll(async () => (await 项.allInnerTexts())[0]).toBe("—");
    await 项.first().click();
    await page.waitForTimeout(200);
    expect(await 存了几次()).toBe(1);
    await page.keyboard.press("Escape");
    await 收起();
    // 多选「需求类型」（11-04）：第一项也是「—」
    await 行("需求类型").locator(".proj-inline").click();
    await expect.poll(async () => (await 项.allInnerTexts())[0]).toBe("—");
    await page.keyboard.press("Escape");
    await 收起();
    // 关联能改：立场下拉占位「—」、第一项「—」
    const 立场 = page.getByRole("combobox", { name: /姓名暂未核实 的项目立场$/ });
    expect(await 立场.count()).toBe(1);
    expect(await 立场.locator("xpath=ancestor::*[contains(@class,'ant-select')][1]").locator(".ant-select-placeholder").innerText()).toBe("—");
    await 立场.click();
    expect(await page.locator(".ant-select-dropdown:visible .ant-select-item-option").first().innerText()).toBe("—");
    await page.keyboard.press("Escape");
    await 收起();
    // 关联多选：张三的角色选满了，勾第一项「—」= 全清空、存 roles: []
    const 角色 = page.getByRole("combobox", { name: /张先生 的项目角色$/ });
    await 角色.click();
    const 角色项 = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
    await expect.poll(async () => (await 角色项.allInnerTexts())[0]).toBe("—");
    // 下拉带进场动画、多选打开时还会滚到已选项：等动画收完再点，不然会点到第二项（11-04 本机 3 次挂 1 次）
    await page.waitForFunction(() => { const d = [...document.querySelectorAll(".ant-select-dropdown")].filter(e => (e as HTMLElement).offsetParent && !e.className.includes("hidden")); return d.length === 1 && !/(appear|enter)/.test(d[0].className); });
    await 角色项.first().click();
    await page.waitForFunction(() => ((window as unknown as { __角色存?: unknown[] }).__角色存 ?? []).length === 1);
    expect(await page.evaluate(() => (window as unknown as { __角色存: unknown[][] }).__角色存[0])).toEqual(["p1", "k1", { roles: [] }]);
    await page.keyboard.press("Escape");
    await 收起();
    // 客户身份同理：第一家选满四个身份，勾「—」= 存 []
    const 身份 = page.getByRole("combobox", { name: /的项目身份$/ }).first();
    await 身份.click();
    const 身份项 = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
    await expect.poll(async () => (await 身份项.allInnerTexts())[0]).toBe("—");
    // 下拉带进场动画、多选打开时还会滚到已选项：等动画收完再点，不然会点到第二项（11-04 本机 3 次挂 1 次）
    await page.waitForFunction(() => { const d = [...document.querySelectorAll(".ant-select-dropdown")].filter(e => (e as HTMLElement).offsetParent && !e.className.includes("hidden")); return d.length === 1 && !/(appear|enter)/.test(d[0].className); });
    await 身份项.first().click();
    await page.waitForFunction(() => ((window as unknown as { __身份存?: unknown[] }).__身份存 ?? []).length === 1);
    expect(await page.evaluate(() => (window as unknown as { __身份存: unknown[][] }).__身份存[0])).toEqual(["p1", "c1", []]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* 10-31 会议 1.0（U-项目-01/04/07、F-项目-18）：左栏瀑布流、可收的沟通 / 卡点、顶部搜索、附件合一块、转让改确认框 */
const 沟通两条 = [
  { id: "f1", type: "PHONE", content: "约了下周三现场看样", occurredAt: "2026-10-03T00:00:00.000Z", who: "组长甲", node: "生产备货", code: "FUL0001", 提醒: null },
  { id: "f2", type: "PHONE", content: "对方要重新报价", occurredAt: "2026-10-05T00:00:00.000Z", who: "组员丙", node: "生产备货", code: "FUL0002", 提醒: null,
    附件: [{ id: "a1", name: "通话录音.mp3", mime: "audio/mpeg", size: 2048, width: null, height: null, createdAt: "2026-10-05T00:00:00.000Z", 有文件: true }] },
];
const 头 = (page: import("playwright").Page, id: string) => page.locator(`#${id} > .proj-fold-btn, #${id} > .ant-card > .ant-card-head .split-caret`);

it("U-项目-01/04：沟通默认摊开、卡点默认收起，点卡头最右的钮开合；搜索框有词时两块都摊开、只列对得上的", async () => {
  const { page, errors } = await 覆盖(1280, { followUps: 沟通两条 });
  try {
    expect(await 头(page, "project-follow").getAttribute("aria-expanded")).toBe("true");
    expect(await 头(page, "project-blockers").getAttribute("aria-expanded")).toBe("false");
    expect(await page.locator("#project-blockers-body").isVisible()).toBe(false);
    await 头(page, "project-blockers").click();
    expect(await 头(page, "project-blockers").getAttribute("aria-expanded")).toBe("true");
    expect(await page.locator("#project-blockers-body").isVisible()).toBe(true);
    await 头(page, "project-follow").click();
    // dt.fold（PR7b）：收起有一段高度过渡，收完才藏
    await expect.poll(() => page.locator("#project-follow-body").isVisible()).toBe(false);
    // 搜索框在当前进程下面、沟通上面
    const 框 = page.getByRole("textbox", { name: "搜这个项目的沟通、卡点" });
    const [进程盒, 搜盒, 沟通盒] = await Promise.all([page.locator(".proj-main > .ant-card").first().boundingBox(), 框.boundingBox(), page.locator("#project-follow").boundingBox()]);
    expect(搜盒!.y).toBeGreaterThan(进程盒!.y);
    expect(沟通盒!.y).toBeGreaterThan(搜盒!.y);
    await 框.fill("报价");
    await page.getByText("沟通（搜到 1）").waitFor();
    expect(await page.locator(".proj-follow-row").count()).toBe(1);
    expect(await page.locator(".proj-follow-row").innerText()).toContain("对方要重新报价");
    expect(await 头(page, "project-follow").isDisabled()).toBe(true);
    expect(await 头(page, "project-follow").getAttribute("aria-expanded")).toBe("true");
    // 两个词都得对上；谁记的、附件名也算
    await 框.fill("组长甲 看样");
    await page.getByText("沟通（搜到 1）").waitFor();
    expect(await page.locator(".proj-follow-row").innerText()).toContain("约了下周三现场看样");
    await 框.fill("录音");
    await page.waitForFunction(() => document.querySelector(".proj-follow-row")?.textContent?.includes("对方要重新报价"));
    await 框.fill("没有这个词");
    await page.getByText("没有对得上「没有这个词」的沟通").waitFor();
    expect(await page.getByText("卡点（搜到 0）").count()).toBe(1);
    await 框.fill("");
    await page.getByText("沟通（2）").waitFor();
    // 清了词回到原来的开合：沟通刚才收起了
    expect(await 头(page, "project-follow").getAttribute("aria-expanded")).toBe("false");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("F-项目-18：项目附件合一块，最后一格收沟通上的附件、写明来自哪条沟通；点来源跳回那条沟通（收着就摊开）", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    await page.route("http://proj.test/api/attachments**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ 附件: [] }) }));
    await page.evaluate(v => (window as unknown as { __over: (x: object) => void }).__over(v), { followUps: 沟通两条, 项目附件: { 合同: 1, 方案: 0, 其它: 2, 只读: false } });
    const 块 = page.getByTestId("project-attachments");
    await 块.waitFor();
    // 三格的个数以接口拿回来的为准（这里接口回空），沟通附件从沟通上收过来：合计 = 0 + 0 + 0 + 1
    await page.getByText("项目附件（1）").waitFor();
    expect((await 卡标题(page, ".proj-main")).slice(0, 4)).toEqual(["", "沟通（2）", "卡点（0）", "项目附件（1）"]);
    expect(await 块.locator(".proj-att-h .att-h-t, .proj-att-h:not(.att-h-row)").allInnerTexts()).toEqual(["项目方案（0）", "合同附件（0）", "验收报告（0）", "其它附件（0）", "沟通附件（1）"]);
    const 组 = 块.getByTestId("follow-att-group");
    expect(await 组.count()).toBe(1);
    const 字 = await 组.innerText();
    expect(字).toContain("来自沟通：");
    expect(字).toContain("组员丙");
    expect(字).toContain("对方要重新报价");
    expect(字).toContain("通话录音.mp3");
    // 这里只看、下载：没有传、删
    expect(await 组.getByRole("button", { name: /删掉/ }).count()).toBe(0);
    // 不横向溢出
    expect(await 块.evaluate(c => c.scrollWidth <= c.clientWidth + 1)).toBe(true);
    await 头(page, "project-follow").click();
    expect(await 头(page, "project-follow").getAttribute("aria-expanded")).toBe("false");
    await 组.locator(".proj-att-link").click();
    await page.waitForFunction(() => document.querySelector("#project-follow > .proj-fold-btn, #project-follow > .ant-card > .ant-card-head .split-caret")?.getAttribute("aria-expanded") === "true");
    await page.locator("#follow-f2").waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

describe("F-042：项目方案、合同附件分两格各带提示；点黄框里的附件类必填定位到那一格", () => {
  const 缺附件 = { 必填: { 配了: ["项目方案", "合同附件", "项目级别"], 还差: ["项目方案", "合同附件", "项目级别"] }, 项目附件: { 合同: 0, 方案: 0, 其它: 0, 只读: false } };
  const 方案提示 = "节点要求的方案放这里", 合同提示 = "放合同、补充协议；方案放上一格";
  const 进视口 = (page: import("playwright").Page, sel: string) => page.evaluate((sel) => { const r = document.querySelector(sel)!.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }, sel);

  it.each([["now", 1366], ["now", 390], ["ledger", 1280]] as const)("%s %ipx：两格各自一个框、小标题下一句提示（一行），方案在上；点「项目方案」「合同附件」各落到自己那一格亮一圈，不开完成节点框", async (皮, w) => {
    const { page, errors } = await open(true, w);
    try {
      await page.route("http://proj.test/api/attachments**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ 附件: [] }) }));
      if (皮 !== "now") await page.evaluate(s => { document.documentElement.dataset.skin = s; }, 皮);
      await page.evaluate(v => (window as unknown as { __over: (x: object) => void }).__over(v), 缺附件);
      const 块 = page.getByTestId("project-attachments");
      await 块.waitFor();
      const 方案格 = 块.locator("[data-att-cell='方案']"), 合同格 = 块.locator("[data-att-cell='合同']");
      // 两格单独框起来，其余格照旧
      expect(await 块.locator("section.proj-att-sec.is-box").evaluateAll(xs => xs.map(x => x.getAttribute("aria-label")))).toEqual(["项目方案", "合同附件"]);
      expect(await 方案格.evaluate(e => getComputedStyle(e).borderTopStyle)).toBe("solid");
      expect(await 方案格.locator(".proj-att-tip").innerText()).toBe(方案提示);
      expect(await 合同格.locator(".proj-att-tip").innerText()).toBe(合同提示);
      expect(await 块.locator(".proj-att-tip").count()).toBe(2);
      // 提示在小标题下面；一行，放不下省略（悬停看全文靠全站 TruncTip）
      for (const 格 of [方案格, 合同格]) {
        const 题 = (await 格.locator(".proj-att-h").boundingBox())!, 示 = (await 格.locator(".proj-att-tip").boundingBox())!;
        expect(示.y).toBeGreaterThanOrEqual(题.y + 题.height - 1);
        expect(await 格.locator(".proj-att-tip").evaluate(e => [getComputedStyle(e).whiteSpace, getComputedStyle(e).textOverflow])).toEqual(["nowrap", "ellipsis"]);
      }
      expect((await 方案格.boundingBox())!.y).toBeLessThan((await 合同格.boundingBox())!.y);
      expect(await 块.evaluate(c => c.scrollWidth <= c.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (皮 === "now") {
        // 黄框：先把附件卡收起，点「项目方案」→ 卡摊开、滚到方案格、亮一圈；完成节点框不开
        await 头(page, "project-attachments-fold").click();
        expect(await 头(page, "project-attachments-fold").getAttribute("aria-expanded")).toBe("false");
        const 黄框 = page.getByTestId("node-required-miss");
        await 黄框.getByRole("button", { name: "项目方案" }).click();
        await page.waitForSelector("[data-att-cell='方案'].rec-tl-item-flash");
        expect(await 头(page, "project-attachments-fold").getAttribute("aria-expanded")).toBe("true");
        await expect.poll(() => 进视口(page, "[data-att-cell='方案']")).toBe(true);
        expect(await page.locator(".pd-fill-pop").count()).toBe(0);
        expect(await 合同格.evaluate(e => e.classList.contains("rec-tl-item-flash"))).toBe(false);
        // 亮一圈只动阴影：动画名是 rec-ring，不动尺寸
        expect(await 方案格.evaluate(e => getComputedStyle(e).animationName)).toBe("rec-ring");
        await page.waitForSelector("[data-att-cell='方案']:not(.rec-tl-item-flash)", { timeout: 3000 });
        await 黄框.getByRole("button", { name: "合同附件" }).click();
        await page.waitForSelector("[data-att-cell='合同'].rec-tl-item-flash");
        await expect.poll(() => 进视口(page, "[data-att-cell='合同']")).toBe(true);
        // 非附件类照旧：开完成节点框、落到那一格
        await 黄框.getByRole("button", { name: "项目级别" }).click();
        await page.locator(".pd-fill-pop [data-required='项目级别']").waitFor();
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("减弱动态：点「项目方案」直接跳到那一格（不滑），照样亮一圈", async () => {
    const { page, errors } = await open(true, 1366);
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.route("http://proj.test/api/attachments**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ 附件: [] }) }));
      await page.evaluate(v => (window as unknown as { __over: (x: object) => void }).__over(v), 缺附件);
      await page.getByTestId("project-attachments").waitFor();
      await page.evaluate(() => {
        const 原 = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (this: Element, o?: boolean | ScrollIntoViewOptions) { (window as unknown as { __滚: unknown[] }).__滚 = [...((window as unknown as { __滚?: unknown[] }).__滚 ?? []), typeof o === "object" ? o.behavior : o]; return 原.call(this, o); };
      });
      await page.getByTestId("node-required-miss").getByRole("button", { name: "项目方案" }).click();
      await page.waitForSelector("[data-att-cell='方案'].rec-tl-item-flash");
      expect(await page.evaluate(() => (window as unknown as { __滚?: unknown[] }).__滚)).toEqual(["auto"]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
});

it("U-项目-07：转让先选人、再点「确认转让」才交；框里写明转了不能撤销，交完没有撤销条", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    await page.evaluate(() => (window as unknown as { __转: () => void }).__转());
    await page.locator(".page-head-a").getByRole("button", { name: "项目转让" }).click();
    const 窗 = page.getByRole("dialog").filter({ hasText: "项目转让" });
    await 窗.waitFor();
    const 确认 = 窗.getByRole("button", { name: /确认转让/ });
    expect(await 确认.isDisabled()).toBe(true);
    await 窗.getByRole("combobox", { name: "转给谁" }).click();
    const 下拉 = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
    // 下拉刚点开、展开动画中 :visible 的快照可能是空的：轮询到选项出来再比
    await expect.poll(() => 下拉.allInnerTexts()).toEqual(["接手乙"]);
    await 下拉.first().click();
    expect(await 窗.innerText()).toContain("确认转给 接手乙？");
    expect(await 窗.innerText()).toContain("不能撤销");
    // 选了人还没交
    expect(await page.evaluate(() => ((window as unknown as { __编辑?: unknown[] }).__编辑 ?? []).length)).toBe(0);
    await 确认.click();
    await page.waitForFunction(() => ((window as unknown as { __编辑?: unknown[] }).__编辑 ?? []).length > 0);
    const 交 = await page.evaluate(() => ((window as unknown as { __编辑: [string, Record<string, unknown>][] }).__编辑).at(-1)!);
    expect(交[0]).toBe("p1");
    expect(交[1]).toMatchObject({ ownerId: "u3" });
    await 窗.waitFor({ state: "hidden" });
    expect(await page.getByRole("button", { name: /撤\s*销/ }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("g.save：转让没交成，原因留在「项目转让」框里（不弹顶部提示），框不关", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    await page.evaluate(() => { Reflect.set(window, "__编辑回", { ok: false, error: "接手的人已停用，转不了" }); (window as unknown as { __转: () => void }).__转(); });
    await page.locator(".page-head-a").getByRole("button", { name: "项目转让" }).click();
    const 窗 = page.getByRole("dialog").filter({ hasText: "项目转让" });
    await 窗.waitFor();
    await 窗.getByRole("combobox", { name: "转给谁" }).click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option").first().click();
    await 窗.getByRole("button", { name: /确认转让/ }).click();
    await 窗.getByRole("alert").filter({ hasText: "接手的人已停用，转不了" }).waitFor();
    expect(await 窗.isVisible()).toBe(true);
    expect(await page.locator(".ant-message").count()).toBe(0);
    expect(await page.locator(".pd-note").count()).toBe(0);
    // 再交成了：框关、原因不留
    await page.evaluate(() => Reflect.set(window, "__编辑回", { ok: true }));
    await 窗.getByRole("button", { name: /确认转让/ }).click();
    await 窗.waitFor({ state: "hidden" });
    expect(errors).toEqual([]);
  } finally { await page.evaluate(() => Reflect.deleteProperty(window, "__编辑回")).catch(() => {}); await page.close(); }
});

it("分段滑块：当前格正文色加粗橙点、白浮片垫在下面，走过的次要字绿勾，没到的最浅字；出口在槽外；两头小箭头只在那边还有格时出现，点了往那边滚", async () => {
  const { page, errors } = await open(true, 1024);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ phase: "商机", node: "合同审批" }));
    await page.waitForFunction(() => document.querySelector(".proj-stage-node.is-cur")?.textContent?.startsWith("合同审批"));
    const 色 = (v: string) => page.evaluate(x => { const s = document.createElement("span"); s.style.color = x; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }, v);
    const 字 = (sel: string) => page.locator(sel).first().evaluate(e => getComputedStyle(e).color);
    expect(await 字(".proj-stage-node.is-cur")).toBe(await 色("var(--ink)"));
    expect(await page.locator(".proj-stage-node.is-cur").evaluate(e => getComputedStyle(e).fontWeight)).toBe("600");
    expect(await page.locator(".proj-stage-node.is-cur .proj-stage-mark").evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await 色("var(--warning)"));
    expect(await 字(".proj-stage-node.is-todo")).toBe(await 色("var(--text-faint)"));
    expect(await 字(".proj-stage-node.is-done")).toBe(await 色("var(--text-muted)"));
    expect(await 字(".proj-stage-node.is-done .proj-stage-mark")).toBe(await 色("var(--success)"));
    expect(await page.locator(".proj-stage-node.is-done svg").count()).toBe(3);
    // 读屏照旧知道哪格是当前（aria-current + 看不见的「当前」）；屏上不再写「当前」两个字
    expect(await page.locator(".proj-stage-node[aria-current=step]").count()).toBe(1);
    expect(await page.locator(".proj-stage-node[aria-current=step] .sr-only").innerText()).toContain("当前");
    // 浮片正垫在当前格下面
    const 对齐 = await page.evaluate(() => {
      const 片 = document.querySelector(".proj-stage-thumb") as HTMLElement, 格 = document.querySelector(".proj-stage-node.is-cur") as HTMLElement;
      return { on: 片.dataset.on, l: Math.round(片.offsetLeft - 格.offsetLeft), w: Math.round(片.offsetWidth - 格.offsetWidth) };
    });
    expect(对齐).toEqual({ on: "1", l: 0, w: 0 });
    // 格与格并排不重叠；出口不在槽里，是槽外单独一颗
    const 盒们 = await page.locator(".proj-stage-node").evaluateAll(ns => ns.map(n => n.getBoundingClientRect()).map(r => ({ l: r.left, r: r.right })));
    for (let i = 1; i < 盒们.length; i++) expect(盒们[i].l).toBeGreaterThanOrEqual(盒们[i - 1].r - 0.5);
    expect(await page.locator(".proj-stage-nodes .proj-stage-exit").count()).toBe(0);
    expect(await page.locator(".proj-stage-strip > .proj-stage-exit").innerText()).toBe("商机赢单");
    // 当前在中间，两头都还有块：两个小箭头都在；点右边往右滚
    const 排 = page.locator(".proj-stage-nodes");
    await page.getByRole("button", { name: "往右看节点" }).waitFor();
    expect(await page.getByRole("button", { name: "往左看节点" }).count()).toBe(1);
    const 前 = await 排.evaluate(e => e.scrollLeft);
    await page.getByRole("button", { name: "往右看节点" }).click();
    await page.waitForFunction(x => document.querySelector(".proj-stage-nodes")!.scrollLeft > x + 50, 前);
    // 滚到最右：右箭头收起来
    await 排.evaluate(e => { e.scrollLeft = e.scrollWidth; });
    await page.getByRole("button", { name: "往右看节点" }).waitFor({ state: "detached" });
    // 换到订单页签：没有当前格，从头摆、左箭头收起来，浮片藏起来
    await page.locator(".proj-stage-tab").filter({ hasText: "订单" }).click();
    await page.getByRole("button", { name: "往左看节点" }).waitFor({ state: "detached" });
    expect(await 排.evaluate(e => e.scrollLeft)).toBe(0);
    expect(await page.locator(".proj-stage-thumb").evaluate(e => (e as HTMLElement).dataset.on)).toBe("0");
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".proj-stage-thumb")!).opacity === "0");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* 11-04 用户截图：「线索 商机 订单」那排下面一条横滑块、右边一条竖滑块，节点排下面也一条。
   页签负 1px 下边距把页签排撑高 1px，overflow-x:auto 连带竖向也能滚 → 先出竖条、竖条吃宽再出横条。
   playwright 默认藏滚动条，这里按样式和尺寸量：两排都不许竖着滚、都不画滚动条（节点排靠两头小箭头和触控板横滑） */
it("页签排、节点排都不出滚动条：页签不竖着溢出，两排都不画滚动条", async () => {
  for (const 宽 of [1024, 1280, 1366]) {
    const { page, errors } = await open(true, 宽);
    try {
      for (const sel of [".proj-stage-tabs", ".proj-stage-nodes"]) {
        const 量 = await page.locator(sel).evaluate(e => {
          const s = getComputedStyle(e), 条 = getComputedStyle(e, "::-webkit-scrollbar");
          return { 竖: s.overflowY, 条宽: s.scrollbarWidth, 画条: 条.display };
        });
        expect({ 宽, sel, ...量 }).toEqual({ 宽, sel, 竖: "hidden", 条宽: "none", 画条: "none" });
      }
      expect(await page.locator(".proj-stage-nodes").evaluate(e => getComputedStyle(e).overflowX)).toBe("auto");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

/* 11-02 用户：「当前项目负责人可以选择不看之前的项目沟通……通过一个按钮可以做选择」 */
describe("沟通卡头：隐藏接手前", () => {
  const 一条 = (id: string, content: string, 接手前: boolean) => ({ id, type: "PHONE", content, occurredAt: "2026-10-03T00:00:00.000Z", who: "组长甲", node: "生产备货", code: "FUL0001", 提醒: null, 版本: "2026-10-03T00:00:00.000Z", 接手前 });
  const 两条 = [一条("f1", "上一任记的沟通", true), 一条("f2", "接手以后记的沟通", false)];

  it("负责人默认看全部；点一下只藏接手前的、数字跟着变，再点恢复", async () => {
    const { page, errors } = await 覆盖(1280, { 我是负责人: true, followUps: 两条 });
    try {
      const 钮 = page.getByTestId("follow-hide-before");
      expect(await 钮.innerText()).toBe("隐藏接手前");
      expect(await 钮.getAttribute("aria-pressed")).toBe("false");
      expect((await 卡标题(page, ".proj-main"))[1]).toBe("沟通（2）");
      expect(await page.getByText("上一任记的沟通").count()).toBe(1);

      await 钮.click();
      expect(await 钮.innerText()).toBe("显示全部");
      expect(await 钮.getAttribute("aria-pressed")).toBe("true");
      expect((await 卡标题(page, ".proj-main"))[1]).toBe("沟通（1）");
      expect(await page.getByText("上一任记的沟通").count()).toBe(0);
      expect(await page.getByText("接手以后记的沟通").count()).toBe(1);

      await 钮.click();
      expect((await 卡标题(page, ".proj-main"))[1]).toBe("沟通（2）");
      expect(await page.getByText("上一任记的沟通").count()).toBe(1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("全是接手前的：藏了以后写清楚还有几条被藏，不是「还没有沟通」", async () => {
    const { page, errors } = await 覆盖(1280, { 我是负责人: true, followUps: [两条[0]] });
    try {
      await page.getByTestId("follow-hide-before").click();
      expect((await 卡标题(page, ".proj-main"))[1]).toBe("沟通（0）");
      expect(await page.getByText("接手后还没有沟通；接手前的 1 条已隐藏").count()).toBe(1);
      expect(await page.getByText("还没有挂在这个项目上的沟通").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("非负责人、项目在公海、没有接手前的沟通：都没有这颗按钮", async () => {
    for (const x of [
      { 我是负责人: false, followUps: 两条 },
      { 我是负责人: true, pooled: true, followUps: 两条 },
      { 我是负责人: true, followUps: [两条[1]] },
    ]) {
      const { page, errors } = await 覆盖(1280, x);
      try {
        expect(await page.getByTestId("follow-hide-before").count(), JSON.stringify(x)).toBe(0);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }
  });

  it.each([800, 1024, 1280])("%ipx：两颗按钮（隐藏接手前、新增沟通连体）都摆着，标题不被挤断，横向不伸出", async (宽) => {
    const { page, errors } = await 覆盖(宽, { 我是负责人: true, 能记沟通: true, aiEnabled: true, followUps: 两条 });
    try {
      const 钮 = page.getByTestId("follow-hide-before");
      await 钮.waitFor();
      expect(await page.getByTestId("follow-card-new").count()).toBe(1);
      expect(await page.getByRole("button", { name: /AI 录入/ }).count()).toBe(0);
      expect(await 不伸出(page, ".proj-main")).toEqual([]);
      const 标题 = await 钮.evaluate(e => {
        const t = e.closest(".ant-card-head")!.querySelector(".ant-card-head-title") as HTMLElement;
        return { 完整: t.scrollWidth <= t.clientWidth, 文字: t.textContent };
      });
      expect(标题).toEqual({ 完整: true, 文字: "沟通（2）" });
      // 折叠按钮（ProjectFold）摆在卡头最右，这几颗不能压上去
      const 压 = await 钮.evaluate(e => {
        // 11-12 起收起是连体按钮的右半（.split-caret）；同一颗连体里的左半挨着它不算压
        const 钮 = e.closest(".proj-fold")!.querySelector(".proj-fold-btn, .split-caret")!;
        const f = 钮.getBoundingClientRect();
        const 同组 = 钮.closest(".split-btn");
        return [...e.closest(".proj-follow-acts")!.querySelectorAll("button")].filter(b => b !== 钮 && (!同组 || !同组.contains(b))).filter(b => { const r = b.getBoundingClientRect(); return r.right > f.left && r.left < f.right && r.bottom > f.top && r.top < f.bottom; }).length;
      });
      expect(压).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
});

/* 11-11 用户（客户详情「沟通记录模块设最长长度、整页给待办留位置，多的在模块内上下移动」，项目详情同样）：
   30 条沟通时，三档笔记本窗口下首屏看得到「卡点」卡头；沟通卡身在卡内滚，卡头不动；两栏第一张卡同一条顶线 */
for (const [w, h] of [[1366, 768], [1280, 720], [1440, 900]] as const) {
  it(`${w}×${h} 30 条沟通：沟通卡身限高卡内滚，卡点卡头在首屏，两栏顶线齐`, async () => {
    const page = await browser.newPage({ viewport: { width: w, height: h } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    try {
      await page.route("http://proj.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
      await page.goto("http://proj.test/projects/p1"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
      const 多 = Array.from({ length: 30 }, (_, i) => ({ id: "f" + i, type: "PHONE", content: "沟通内容，谈了交期和价格。".repeat(3), occurredAt: "2026-10-03T00:00:00.000Z", who: "组长甲", node: "生产备货", code: "FUL" + i, 提醒: null }));
      await page.evaluate(x => (window as unknown as { __shell: (fab: boolean, x: unknown) => void }).__shell(false, x), { followUps: 多 });
      await page.getByText("进程变更").first().waitFor();
      const 量 = () => page.evaluate(() => {
        const 主 = document.querySelector(".proj-main") as HTMLElement, 侧 = document.querySelector(".proj-side") as HTMLElement;
        const 身 = document.getElementById("project-follow-body") as HTMLElement;
        const 卡点头 = document.querySelector("#project-blockers .ant-card-head, #project-blockers") as HTMLElement;
        const 首 = (e: HTMLElement) => (e.querySelector(":scope > .ant-card, :scope > .proj-fold, :scope > *") as HTMLElement).getBoundingClientRect().top;
        return { 身滚: getComputedStyle(身).overflowY, 身溢: 身.scrollHeight - 身.clientHeight, 身顶: 身.scrollTop, 主顶: 主.scrollTop,
          沟通头: (身.closest(".ant-card")!.querySelector(".ant-card-head") as HTMLElement).getBoundingClientRect().top,
          卡点底: 卡点头.getBoundingClientRect().bottom, 主底: Math.min(主.getBoundingClientRect().bottom, window.innerHeight),
          顶线: [首(主), 首(侧)].map(Math.round), 横滚: document.documentElement.scrollWidth - window.innerWidth };
      });
      const 起 = await 量();
      expect(起.横滚).toBeLessThanOrEqual(0);
      expect(起.身滚).toBe("auto");
      expect(起.身溢).toBeGreaterThan(0);
      expect(起.卡点底).toBeLessThanOrEqual(起.主底);
      expect(起.顶线[0]).toBe(起.顶线[1]);
      await page.locator("#project-follow-body").evaluate(e => { e.scrollTop = 300; });
      const 滚 = await 量();
      expect(滚.身顶).toBeGreaterThan(0);
      expect([滚.沟通头, 滚.主顶]).toEqual([起.沟通头, 起.主顶]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

/*
 * 项目页头排版（CI 红：owner-first-batch 375 宽「文字溢出」、排版闸门 1024 宽 AI 栏常驻「伸出 4px」）：
 * 按钮改名变长后把标题区挤到比星还窄。判定照 e2e 两处的口径：
 *   文字溢出 = scrollWidth > clientWidth + 1 且 overflow-x 是 visible、不是 inline（owner-first-batch 的 量）；
 *   伸出 = 子元素（非 absolute / fixed，中间没有裁切层）的右边超出它的盒子 1px 以上（e2e/layout-audit.ts 的 伸出的子）
 */
async function 量页头(page: import("playwright").Page) {
  return page.locator(".proj-head").evaluate((根) => {
    const 名 = (el: Element) => `${el.tagName}.${el.className || ""}:${(el.textContent ?? "").slice(0, 12)}`;
    const 文字溢出: string[] = [], 伸出: string[] = [];
    const 全部 = [根, ...根.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().width >= 1);
    for (const el of 全部) {
      const cs = getComputedStyle(el);
      if (el !== 根 && el.scrollWidth > el.clientWidth + 1 && cs.overflowX === "visible" && cs.display !== "inline") 文字溢出.push(名(el));
      if (cs.display === "inline" || cs.display === "contents") continue;
      const r = el.getBoundingClientRect();
      for (const c of el.querySelectorAll("*")) {
        const ccs = getComputedStyle(c);
        if (ccs.position === "absolute" || ccs.position === "fixed" || ccs.display === "none") continue;
        // 负外边距故意往外探的不算（同 layout-audit：从 c 到 el 每层探出去的减掉）；中间隔着裁切层的不算
        let 裁 = false, 探右 = 0, 探左 = 0;
        for (let e: Element | null = c; e && e !== el; e = e.parentElement) {
          const ms = getComputedStyle(e);
          if (e !== c && ms.overflowX !== "visible") { 裁 = true; break; }
          探右 += Math.max(0, -parseFloat(ms.marginRight) || 0); 探左 += Math.max(0, -parseFloat(ms.marginLeft) || 0);
        }
        if (裁) continue;
        const cr = c.getBoundingClientRect();
        if (cr.width >= 1 && (cr.right - 探右 > r.right + 1 || r.left - cr.left - 探左 > 1)) { 伸出.push(`${名(el)} ⊃ ${名(c)}`); break; }
      }
    }
    const h1 = 根.querySelector("h1")!;
    const 标题 = getComputedStyle(h1);
    return { 文字溢出, 伸出, 标题一行: 标题.whiteSpace === "nowrap" && 标题.textOverflow === "ellipsis" && h1.getBoundingClientRect().height < 40 };
  });
}
it.each([
  { 宽: 1024, 外宽: 372, label: "1024 宽 AI 栏常驻（正文约 372）" },
  { 宽: 375, 外宽: undefined, label: "375 宽手机" },
  { 宽: 1024, 外宽: undefined, label: "1024 宽" },
  // 真页面上标题区还要让出名单开关、页边距，按钮组 211 宽时标题区只剩二十来 px：用更窄的正文把这种情况挤出来
  { 宽: 1024, 外宽: 300, label: "1024 宽正文 300" },
  { 宽: 375, 外宽: 250, label: "375 宽正文 250" },
])("项目页头 $label：超长项目名、超长负责人名，两枚按钮都在，没有元素伸出 / 文字溢出，标题一行省略", async ({ 宽, 外宽 }) => {
  const { page, errors } = await open(true, 宽, 外宽);
  try {
    await page.evaluate(() => (window as unknown as { __头: () => void }).__头());
    await page.locator(".page-head-a").getByRole("button", { name: "项目退回公海" }).waitFor();
    expect(await 页头钮(page)).toEqual(["项目转让", "项目退回公海"]);
    const r = await 量页头(page);
    expect(r.文字溢出, "文字溢出").toEqual([]);
    expect(r.伸出, "伸出").toEqual([]);
    expect(r.标题一行).toBe(true);
    // 按钮整枚可见、没被压窄折成两行
    const 钮高 = await page.locator(".page-head-a button").evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
    expect(钮高.every((h) => h <= 40)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

const 窗变量 = (page: import("playwright").Page, k: string) => page.evaluate((k) => JSON.stringify(Reflect.get(window, k) ?? []), k);
const 盖 = (page: import("playwright").Page, x: unknown) => page.evaluate((x) => (window as unknown as { __over: (x: unknown) => void }).__over(x), x);

it("dt.invalid：线索终止 = 判无效，一个后果框（不再先问「终止进程？」）；原因点选、不选判不了；取消不生效；确认带原因走终止项目进程", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    await 盖(page, { phase: "线索", node: "潜客培育", 原因选项: { 回收: [], 无效: ["需求不存在", "重复线索", "其他"] } });
    await page.waitForFunction(() => document.querySelector(".proj-stage-tab.is-on")?.textContent?.startsWith("线索"));
    const 开 = async () => {
      await page.getByRole("button", { name: "终止进程" }).click();
      await page.getByRole("menuitem", { name: /终止进程/ }).click();
      const 框 = page.getByRole("dialog").filter({ hasText: /判「.*」无效/ });
      await 框.waitFor();
      return 框;
    };
    const 框 = await 开();
    expect(await page.getByRole("dialog").filter({ hasText: "终止进程？" }).count()).toBe(0);
    expect(await 框.innerText()).toContain("到此结束");
    expect(await 框.innerText()).toContain("改回进程");
    const 判 = 框.getByRole("button", { name: /^判无效$/ });
    expect(await 判.isDisabled()).toBe(true);
    await 框.getByRole("button", { name: /^取\s*消$/ }).click();
    await 框.waitFor({ state: "hidden" });
    expect(await 窗变量(page, "__终止")).toBe("[]");
    const 框2 = await 开();
    await 框2.getByRole("radio", { name: "其他" }).click();
    expect(await 框2.getByRole("button", { name: /^判无效$/ }).isDisabled()).toBe(true);
    await 框2.getByRole("radio", { name: "需求不存在" }).click();
    await 框2.getByRole("button", { name: /^判无效$/ }).click();
    await 框2.waitFor({ state: "hidden" });
    const 终止 = JSON.parse(await 窗变量(page, "__终止")) as [string, { 无效原因?: string }][];
    expect(终止).toHaveLength(1);
    expect(终止[0][1].无效原因).toBe("需求不存在");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("dt.stage：必填齐了完成节点一步推（不开框），推完底部撤销条，撤销 = 改回原来的节点；还差必填开框就地补齐", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    // 必填齐了（没配）：一步推，不开框
    // 服务端回推之前在哪、下一步是什么（11-20 审查：撤销回到这次推之前，不按页面上可能过时的那份；被清掉的下一步一起带回）
    await page.evaluate(() => Reflect.set(window, "__改节点回", { ok: true, 变了: true, 原: { phase: "线索", node: "潜客培育", result: null, 下一步文字: "推之前的下一步", 下一步时间: null } }));
    await page.locator(".proj-stage-acts").getByRole("button", { name: "完成节点" }).click();
    expect(await page.getByRole("dialog").filter({ hasText: "完成节点 · " }).count()).toBe(0);
    const 条 = page.locator("#undo-host");
    await expect.poll(() => 条.innerText().catch(() => "")).toContain("已推进到");
    await 条.getByRole("button", { name: /撤销/ }).click();
    await expect.poll(async () => (JSON.parse(await 窗变量(page, "__改节点")) as unknown[]).length).toBe(2);
    const 两次 = JSON.parse(await 窗变量(page, "__改节点")) as [string, { node: string }, unknown, unknown][];
    expect(两次[1][1]).toEqual({ phase: "线索", node: "潜客培育", result: null });
    expect(两次[1][1].node).not.toBe(两次[0][1].node);
    // 撤销带「期望现在在哪」= 刚推到的那一格（被人改过就不撤），和被清掉的下一步
    expect(两次[1][3]).toEqual({ 期望在: 两次[0][1], 下一步: { 文字: "推之前的下一步", 时间: null } });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("完成节点跨阶段（线索推进→痛点挖掘、首款到账→生产备货）：先确认（待客户定 A），企业版退不回上一阶段，不给撤销条，只写就地回执", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    for (const [phase, node, 到阶段] of [["线索", "线索推进", "商机"], ["商机", "首款到账", "订单"]] as const) {
      await page.evaluate(() => { (window as unknown as { __改节点: unknown[] }).__改节点 = []; });
      await page.evaluate((x) => (window as unknown as { __over: (x: unknown) => void }).__over(x), { phase, node, 必填: null });
      await page.waitForFunction((n) => document.querySelector(".proj-stage-node.is-cur")?.textContent?.startsWith(n), node);
      await page.locator(".proj-stage-acts").getByRole("button", { name: "完成节点" }).click();
      // [待客户定 A] 跨阶段先确认：取消不推；确认了才推
      const 问 = page.getByRole("dialog").filter({ hasText: "推过去就回不了上一阶段，确定？" });
      await 问.waitFor();
      expect(await 问.innerText()).toContain(`进了${到阶段}就不能再退回${phase}`);
      await 问.getByRole("button", { name: /取\s*消/ }).click();
      await 问.waitFor({ state: "hidden" });
      expect(await 窗变量(page, "__改节点")).toBe("[]");
      await page.locator(".proj-stage-acts").getByRole("button", { name: "完成节点" }).click();
      await 问.waitFor();
      await 问.getByRole("button", { name: `进${到阶段}` }).click();
      await expect.poll(async () => (JSON.parse(await 窗变量(page, "__改节点")) as [string, { phase: string }][]).map((x) => x[1].phase)).toEqual([到阶段]);
      await expect.poll(() => page.locator(".pd-note").innerText().catch(() => "")).toContain(`进到 ${到阶段}`);
      expect(await page.locator("#undo-host").getByRole("button", { name: /撤销/ }).count()).toBe(0);
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("手机 390 / 360 宽：「完成节点」补填框不出屏（贴左右各 8px）；1024 / 1280 / 1366 照旧挂在按钮右下", async () => {
  for (const w of [360, 390, 1024, 1280, 1366]) {
    const { page, errors } = await open(true, w);
    try {
      await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ 必填: { 配了: ["金额"], 还差: ["金额"] } }));
      const 钮 = page.locator(".proj-stage-acts").getByRole("button", { name: "完成节点" });
      await 钮.click();
      const 框 = page.locator(".pd-fill-pop");
      await 框.locator(".pd-fill-pop-body").waitFor();
      await page.waitForTimeout(350);
      const [框位, 钮位] = await Promise.all([框.evaluate((e) => e.getBoundingClientRect().toJSON()), 钮.evaluate((e) => e.getBoundingClientRect().toJSON())]) as DOMRect[];
      expect(框位.left, `宽 ${w}`).toBeGreaterThanOrEqual(0);
      expect(框位.right, `宽 ${w}`).toBeLessThanOrEqual(w);
      if (w < 768) {
        expect(Math.round(框位.left), `宽 ${w}`).toBe(8);
        expect(Math.round(框位.right), `宽 ${w}`).toBe(w - 8);
      } else {
        // 宽屏照旧：右边和按钮右边对齐（右下对齐，箭头关着），框在按钮下面
        expect(Math.abs(框位.right - 钮位.right), `宽 ${w}`).toBeLessThanOrEqual(1);
      }
      expect(框位.top, `宽 ${w}`).toBeGreaterThanOrEqual(钮位.bottom);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

// 11-20 c2 实操：375 宽「完成节点」补填框底下那排按钮比屏幕低约 6px，要滚一下才看得到。缺得多（框长到最高）、几种手机高度都要整排在屏里；
// 飞书 / 微信内置浏览器去掉标题栏后更矮（375×623），iPhone SE（375×667），常见全面屏（375×812、390×844）
it.each([[375, 623], [375, 667], [375, 812], [390, 844], [360, 640], [1024, 680], [1366, 680]])("%i×%i：补填框缺得多时底下按钮整排在屏里，不用滚页面", async (w, h) => {
  const { page, errors } = await open(true, w);
  try {
    await page.setViewportSize({ width: w, height: h });
    const 缺 = ["金额", "预计成交日期", "项目方案", "客户等级", "主联系人", "需求描述", "项目名称", "项目来源", "项目所在地", "项目级别", "项目标签", "合同已生效"];
    await page.evaluate((x) => (window as unknown as { __over: (x: unknown) => void }).__over(x), { phase: "商机", node: "方案敲定", 必填: { 配了: 缺, 还差: 缺 } });
    const 钮 = page.locator(".proj-stage-acts").getByRole("button", { name: "完成节点" });
    await 钮.scrollIntoViewIfNeeded();
    await 钮.click();
    const 框 = page.locator(".pd-fill-pop");
    await 框.locator(".pd-fill-pop-body").waitFor();
    await page.waitForTimeout(400);
    const 量 = () => page.evaluate(() => {
      const 框 = document.querySelector(".pd-fill-pop .ant-popover-container, .pd-fill-pop .ant-popover-inner")!.getBoundingClientRect();
      const 排 = document.querySelector(".pd-fill-pop .proj-fill-foot")!.getBoundingClientRect();
      const 取消 = [...document.querySelectorAll<HTMLElement>(".pd-fill-pop .proj-fill-foot button")].map((b) => b.getBoundingClientRect());
      const 底 = Math.max(...取消.map((r) => r.bottom));
      const 中 = 取消[0] ? document.elementFromPoint(取消[0].left + 取消[0].width / 2, 取消[0].top + 取消[0].height / 2)?.closest(".proj-fill-foot") != null : false;
      return { 框底: 框.bottom, 排底: 排.bottom, 钮底: 底, 屏高: window.innerHeight, 点得到: 中, 框顶: 框.top };
    });
    const m = await 量();
    expect(m.钮底, JSON.stringify(m)).toBeLessThanOrEqual(m.屏高);
    expect(m.框底, JSON.stringify(m)).toBeLessThanOrEqual(m.屏高);
    expect(m.框顶, JSON.stringify(m)).toBeGreaterThanOrEqual(0);
    expect(m.点得到, JSON.stringify(m)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("dt.pay：删回款是后果框，写明哪一笔和删后的合计；取消不生效；服务端挡了原因留在框里", async () => {
  for (const w of [1024, 1366]) {
    const { page, errors } = await open(true, w);
    try {
      await 盖(page, { 回款们: [{ id: "r1", paidAt: "2026-11-15", currency: "USD", amount: 30000, createdAt: "2026-11-15T00:00:00.000Z", userName: "张敏" }, { id: "r2", paidAt: "2026-11-01", currency: "USD", amount: 20000, createdAt: "2026-11-01T00:00:00.000Z", userName: "张敏" }] });
      const 卡 = page.locator("#project-payments-fold, .ant-card").filter({ hasText: /回款（2）/ }).first();
      await 卡.waitFor();
      await 卡.getByRole("button", { name: /^删\s*除$/ }).first().click();
      const 框 = page.getByRole("dialog").filter({ hasText: "删掉这笔回款" });
      await 框.waitFor();
      expect(await 框.innerText()).toContain("30,000");
      expect(await 框.innerText()).toContain("找不回");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `宽 ${w}`).toBe(true);
      await 框.getByRole("button", { name: /^取\s*消$/ }).click();
      await 框.waitFor({ state: "hidden" });
      expect(await 窗变量(page, "__删回款")).toBe("[]");
      await page.evaluate(() => Reflect.set(window, "__删回款回", { ok: false, error: "金额字段锁着，改不了" }));
      await 卡.getByRole("button", { name: /^删\s*除$/ }).first().click();
      await 框.waitFor();
      await 框.getByRole("button", { name: /^删掉这笔回款$/ }).click();
      await expect.poll(() => 框.getByRole("alert").innerText()).toContain("金额字段锁着");
      expect(await 框.isVisible()).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("dt.fold：点过收起 / 展开才放高度过渡（首屏不动）；收着卡身不占高度；减弱动态直接到位", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    const 壳 = page.locator(".proj-fold").filter({ has: page.locator(".proj-fold-btn") }).first();
    expect(await 壳.getAttribute("class")).not.toContain("fold-anim");
    await 壳.locator(".proj-fold-btn").click();
    expect(await 壳.getAttribute("class")).toContain("fold-anim");
    expect(await 壳.getAttribute("class")).toContain("is-closed");
    const 过渡 = await 壳.locator(":scope > .ant-card > .ant-card-body").evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(过渡).toContain("height");
    await expect.poll(() => 壳.locator(":scope > .ant-card > .ant-card-body").evaluate((el) => el.getBoundingClientRect().height)).toBe(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await 壳.locator(":scope > .ant-card > .ant-card-body").evaluate((el) => getComputedStyle(el).transitionDuration.split(",").every((x) => parseFloat(x) < 0.02))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("教练主题（11-17）：没关的钉在沟通卡身最上面、在沟通记录前；独立项目页卡头有「发起点评 ▾」（11-21 教练点评改版 PR1，原「发起主题」）；1024 / 1280 / 1366 卡头不横滚、按钮点得中", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await open(true, w);
    try {
      await page.evaluate(() => (window as unknown as { __主题: () => void }).__主题());
      await page.getByTestId("coach-topics").waitFor();
      // 主题块在沟通卡身里、排在第一条沟通前面
      const 序 = await page.locator("#project-follow-body").evaluate((body) => {
        const 主题 = body.querySelector("[data-testid=coach-topics]");
        const 沟通 = body.querySelector(".proj-follow-row");
        return { 在里面: !!主题, 在前: !!主题 && !!沟通 && !!(主题.compareDocumentPosition(沟通) & Node.DOCUMENT_POSITION_FOLLOWING) };
      });
      expect(序).toEqual({ 在里面: true, 在前: true });
      const 钮 = page.getByTestId("coach-topic-new");
      expect(await 钮.count()).toBe(1);
      expect((await 钮.innerText()).replace(/\s+/g, "")).toBe("发起点评");
      const 卡头 = await 钮.evaluate((el) => {
        const head = el.closest(".ant-card-head") as HTMLElement;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { 横滚: head.scrollWidth > head.clientWidth + 1, 点得中: !!hit && (hit === el || el.contains(hit)) };
      });
      expect([w, 卡头]).toEqual([w, { 横滚: false, 点得中: true }]);
      const 条 = await page.locator(".cth-item").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect([w, 条]).toEqual([w, true]);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  }
});

/* 11-18 历史沟通分析回填的项目：项目卡多一行「数据来源」标签「历史分析」；正常建的不摆这一行。三种 Windows 宽度不横撑 */
it("数据来源：历史分析的项目摆标签、正常的不摆；1024 / 1280 / 1366 都不横撑", async () => {
  for (const width of [1024, 1280, 1366]) {
    const { page, errors } = await open(true, width, undefined, true);
    try {
      expect(await page.getByTestId("project-data-source-row").count()).toBe(0);
      await page.evaluate(() => (window as unknown as { __shell: (fab: boolean, x: object) => void }).__shell(false, { 数据来源: "历史分析" }));
      const 行 = page.getByTestId("project-data-source-row");
      await 行.waitFor();
      expect((await 行.innerText()).replace(/\s/g, "")).toBe("数据来源历史分析");
      const 量 = await 行.evaluate((el) => ({ 行宽: el.scrollWidth, 框宽: el.clientWidth, 页宽: document.documentElement.scrollWidth, 窗: window.innerWidth }));
      expect(量.行宽).toBeLessThanOrEqual(量.框宽);
      expect(量.页宽).toBeLessThanOrEqual(量.窗);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  }
});

/* F-017（员工反馈）：销售点「完成节点」推不过线索验证，提示「还要填：需求（需求状态）」却找不到在哪填。
   口径（客户 11-19 第 31a 题）：节点推进关着时只有「线索验证」仍要填需求状态，其余节点不出补填提示 →
   提示只在下一步要越过线索验证时出、写明在「项目画像」选「需求状态」、带「去填」（收起的先展开再滚过去）；
   「前两节点要沟通」开着且线索验证上还没沟通（load.ts 线索验证缺沟通）才写「并在线索验证记一条沟通」 */
describe("F-017 推过线索验证的补填提示", () => {
  type 窗 = { __线索: (x: object, 能改?: boolean) => void; __滚到?: string[] };
  const 只差需求 = { phase: "线索", node: "线索验证", 有效沟通差: ["需求（需求状态）"] };
  const 开 = async (x: object, width = 1366, 能改 = true) => {
    const { page, errors } = await open(true, width);
    await page.evaluate(([x, 能改]) => (window as unknown as 窗).__线索(x as object, 能改 as boolean), [x, 能改] as const);
    await page.locator("#project-profile-fold").waitFor();
    return { page, errors };
  };
  const 提示 = (page: import("playwright").Page) => page.getByTestId("lead-gate-hint");
  const 灰因 = (page: import("playwright").Page) => page.locator(".proj-stage-why");

  it("停在线索验证、只差需求状态：写明在「项目画像」选，灰按钮的话也指位置；「去填」把收起的画像卡展开并滚过去", async () => {
    const { page, errors } = await 开(只差需求);
    try {
      // 设计语言 D4 · M6-a：合成一块「还差 N 项」+ 缺项小块（保留括号别名），点小块直接去填（原来一句话 +「去填」）
      expect(await 提示(page).locator(".proj-miss-t").innerText()).toBe("要推过线索验证还差 1 项");
      expect(await 提示(page).locator(".proj-miss-chip").allInnerTexts()).toEqual(["需求（需求状态）"]);
      expect(await 提示(page).locator(".proj-miss-help").innerText()).toBe("点一项直接去填；「暂无」「-」这类占位不算填了");
      expect(await 灰因(page).innerText()).toBe("线索验证合格要先填好「线索验证」的必填项：还差需求状态（在「项目画像」里选）");
      expect(await page.locator(".proj-stage-acts button").first().isDisabled()).toBe(true);
      // 必填拦截记录（11-23）：灰按钮样子不变，点它 = 被拦一次（点击落到外层 span，交项目 id）
      await page.locator(".proj-stage-acts .proj-stage-tip").first().click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __被拦?: unknown[][] }).__被拦?.length ?? 0)).toBe(1);
      // 两处画像卡同一个落点：独立页右栏这张挂着 id
      expect(await page.locator(".proj-side #project-profile-fold").count()).toBe(1);
      // 先收起画像卡，再点「去填」：展开、滚到它（记下 scrollIntoView 滚的是谁）
      await page.locator("#project-profile-fold > .proj-fold-btn").click();
      await page.locator("#project-profile-fold.is-closed").waitFor();
      await page.evaluate(() => {
        const 原 = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (this: Element, o?: boolean | ScrollIntoViewOptions) { ((window as unknown as 窗).__滚到 ||= []).push(this.id); return 原.call(this, o); };
      });
      await 提示(page).getByRole("button", { name: "需求（需求状态）" }).click();
      await page.waitForFunction(() => !document.getElementById("project-profile-fold")!.classList.contains("is-closed"));
      await page.waitForFunction(() => ((window as unknown as 窗).__滚到 ?? []).includes("project-profile-fold"));
      await expect.poll(() => page.getByRole("combobox", { name: "需求状态" }).isVisible()).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("潜客培育（往下推到线索验证不拦）：不出补填提示，灰按钮也不提需求", async () => {
    const { page, errors } = await 开({ ...只差需求, node: "潜客培育" });
    try {
      expect(await 提示(page).count()).toBe(0);
      expect(await page.getByText("要推过线索验证").count()).toBe(0);
      expect(await 灰因(page).count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("「前两节点要沟通」开着、线索验证上还没沟通：提示和灰按钮都写「并在线索验证记一条沟通」；开关关着（不给这一项）不写", async () => {
    const 开着 = await 开({ ...只差需求, 线索验证缺沟通: true });
    try {
      expect(await 提示(开着.page).locator(".proj-miss-help").innerText()).toBe("点一项直接去填；「暂无」「-」这类占位不算填了，并在「线索验证」记一条沟通");
      expect(await 灰因(开着.page).innerText()).toContain("（在「项目画像」里选），并在「线索验证」记一条沟通");
      expect(开着.errors).toEqual([]);
    } finally { await 开着.page.close(); }
    const 关着 = await 开(只差需求);
    try {
      expect(await 提示(关着.page).innerText()).not.toContain("沟通");
      expect(await 灰因(关着.page).innerText()).not.toContain("记一条沟通");
    } finally { await 关着.page.close(); }
  });

  it("线索验证配了几项必填（含需求）：照列各项、补一句需求状态在哪选；看得到改不了的人不摆「去填」", async () => {
    const { page, errors } = await 开({ ...只差需求, 有效沟通差: ["所属联系人", "国家", "需求（需求状态）"] }, 1366, false);
    try {
      expect(await 提示(page).locator(".proj-miss-t").innerText()).toBe("要推过线索验证还差 3 项");
      expect(await 提示(page).locator(".proj-miss-chip").allInnerTexts()).toEqual(["所属联系人", "国家", "需求（需求状态）"]);
      expect(await 提示(page).locator(".proj-miss-help").innerText()).toBe("需求状态在「项目画像」里选；「暂无」「-」这类占位不算填了");
      // 改不了的人：小块只是字，不是按钮
      expect(await 提示(page).getByRole("button").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it.each([1024, 1280, 1366, 390])("%ipx（Windows 三档 + 手机）超长项目名：提示折行不撑宽，缺项小块点得中", async (w) => {
    const { page, errors } = await 开({ ...只差需求, 线索验证缺沟通: true }, w);
    try {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await 提示(page).evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      const 卡 = 提示(page).locator("xpath=ancestor::div[contains(@class,'ant-card')][1]");
      expect(await 卡.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      const 钮 = 提示(page).getByRole("button", { name: "需求（需求状态）" });
      await 钮.scrollIntoViewIfNeeded();
      const 框 = (await 钮.boundingBox())!;
      expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[data-testid=lead-gate-hint] .proj-miss-chip"), [框.x + 框.width / 2, 框.y + 框.height / 2])).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
});

/*
  11-20：记一条沟通顺带按必填把节点推了一格（画像早就齐了，这次记沟通才推，#370）——原来回执一条盖一条，推到哪那句被盖掉、界面上一个字没有。
  现在：能改节点 → 底部撤销条说推到哪，点撤销 = 改回记之前的节点（P-界面-40 推进节点可撤销）；改不了节点 → 写进回执。375 / 1366 都量
*/
it.each([375, 1366])("记一条沟通顺带自动推了一格（11-20）%ipx：撤销条说推到哪、点撤销改回原节点；撤销条不横溢", async (w) => {
  const { page, errors } = await 覆盖(w, { 能记沟通: true });
  try {
    // 服务端回这次推之前的节点和下一步（推前）：撤销按它回去，不按页面上那份（11-20 审查）
    await page.evaluate(() => Reflect.set(window, "__记沟通回", { ok: true, followUpId: "fx", 自动推到: ["物流运输"], 推前: { phase: "订单", node: "生产备货", 下一步文字: "周五前发货", 下一步时间: null } }));
    await page.getByTestId("follow-card-new").click();
    const 窗 = page.getByRole("dialog");
    await 窗.getByLabel("沟通内容").fill("聊了发货安排");
    await 窗.getByLabel("下一步计划").fill("周五前发货");
    await 窗.getByRole("button", { name: /^保\s*存$/ }).click();
    const 条 = page.locator(".undo-bar");
    await 条.waitFor();
    expect(await 条.innerText()).toContain("必填齐了，自动推进到 物流运输");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const 框 = (await 条.boundingBox())!;
    expect(框.x).toBeGreaterThanOrEqual(0);
    expect(框.x + 框.width).toBeLessThanOrEqual(w + 1);
    await 条.getByRole("button", { name: "撤销" }).click();
    await page.waitForFunction(() => Reflect.get(window, "__改节点"));
    expect(await page.evaluate(() => (Reflect.get(window, "__改节点") as unknown[][])[0])).toEqual(["p1", { phase: "订单", node: "生产备货", result: null }, null, { 期望在: { phase: "订单", node: "物流运输", result: null }, 下一步: { 文字: "周五前发货", 时间: null } }]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("记一条沟通顺带自动推了一格、我改不了节点（11-20）：不给撤销条，推到哪写进底部回执", async () => {
  const { page, errors } = await 覆盖(1280, { 能记沟通: true, 能改节点: false });
  try {
    await page.evaluate(() => Reflect.set(window, "__记沟通回", { ok: true, followUpId: "fx", 自动推到: ["物流运输"] }));
    await page.getByTestId("follow-card-new").click();
    const 窗 = page.getByRole("dialog");
    await 窗.getByLabel("沟通内容").fill("聊了发货安排");
    await 窗.getByLabel("下一步计划").fill("周五前发货");
    await 窗.getByRole("button", { name: /^保\s*存$/ }).click();
    await page.getByText("已记下这条沟通；必填齐了，自动推进到 物流运输").waitFor();
    expect(await page.locator(".undo-bar").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("项目来源：项目没选、客户有来源但我看不到客户（name 空）：写「随客户来源」，不写待填、不露渠道名（11-20 总控判定：只露有无）", async () => {
  const { page, errors } = await 覆盖(1280, { 项目来源: { name: "", 跟客户: true } });
  try {
    const 卡 = page.locator(".proj-side .ant-card").filter({ hasText: "项目来源" }).first();
    await 卡.getByText("随客户来源").waitFor();
    const 行 = await 卡.getByText("项目来源", { exact: true }).locator("..").innerText();
    expect(行).toContain("随客户来源");
    expect(行).not.toContain("待填");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/*
  设计语言 D4（规范 M6–M9，11-21）：缺项小块、完成节点浅绿、节点条渐隐、沟通条目一行灰字、⋮ 删除前分隔线 + 原地确认 3 秒自收、
  只读收起钮白底、搜着时卡点空态。四个宽度都量不横滚
*/
describe("设计语言 D4：进程卡、沟通、卡点", () => {
  const 缺两项 = { phase: "线索", node: "潜客培育", 必填: { 配了: ["项目级别", "需求描述"], 还差: ["项目级别", "需求描述"] }, 有效沟通差: ["需求描述（成交需求）"] };

  it.each([1024, 1280, 1366, 390])("%ipx：两段必填提示合成一块「还差 N 项」+ 缺项小块（括号别名、判有效的打 •）；点一块开完成节点框、焦点落在那一格", async (w) => {
    const { page, errors } = await 覆盖(w, 缺两项);
    try {
      const 块 = page.getByTestId("node-required-miss");
      await 块.waitFor();
      expect(await 块.locator(".proj-miss-t").innerText()).toBe("完成这个节点还差 2 项");
      expect(await 块.locator(".proj-miss-chip").allInnerTexts()).toEqual(["项目级别", "需求描述（成交需求）"]);
      // 判有效也要的那一项打 •，说明里写几项
      expect(await 块.locator(".proj-miss-chip").nth(1).locator(".proj-miss-dot").count()).toBe(1);
      expect(await 块.locator(".proj-miss-chip").nth(0).locator(".proj-miss-dot").count()).toBe(0);
      expect(await 块.locator(".proj-miss-help").innerText()).toBe("带 • 的 1 项也是判「有效」要的；点一项直接去填；「暂无」「-」这类占位不算填了");
      // 原来那句「这个节点还差必填：…」不再单出一段
      expect(await page.getByText("这个节点还差必填").count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await 块.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      await 块.getByRole("button", { name: "项目级别" }).click();
      await page.locator(".pd-fill-pop [data-required='项目级别']").waitFor();
      await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-required]")?.getAttribute("data-required") ?? null)).toBe("项目级别");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("#402 实操：完成节点框里排在后面的窗外项（国家）也落到那一行，不停在第一格「所属联系人」", async () => {
    const { page, errors } = await 覆盖(1366, { phase: "线索", node: "潜客培育", 必填: { 配了: ["主联系人", "国家"], 还差: ["主联系人", "国家"] } });
    try {
      const 块 = page.getByTestId("node-required-miss");
      await 块.waitFor();
      await 块.getByRole("button", { name: /^国家/ }).click();
      await page.locator(".pd-fill-pop [data-required='国家']").waitFor();
      await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-required]")?.getAttribute("data-required") ?? null)).toBe("国家");
      // 再等一会儿也不被抢回第一格
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.activeElement?.closest("[data-required]")?.getAttribute("data-required") ?? null)).toBe("国家");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("完成节点浅绿、只留一颗蓝实心；节点条放不下时那一头渐隐（--edge-fade）；结局钮写全不省略", async () => {
    const { page, errors } = await 覆盖(1024, { 能记沟通: true });
    try {
      const 条 = page.locator(".proj-stage-nodes");
      const 类 = await 条.getAttribute("class");
      const 能滚 = await 条.evaluate(e => ({ 左: e.scrollLeft > 1, 右: e.scrollLeft + e.clientWidth < e.scrollWidth - 1 }));
      expect(类?.includes("fade-r")).toBe(能滚.右);
      expect(类?.includes("fade-l")).toBe(能滚.左);
      if (能滚.左 || 能滚.右) expect(await 条.evaluate(e => getComputedStyle(e).maskImage || getComputedStyle(e).webkitMaskImage)).toContain("linear-gradient");
      const 出口 = page.locator(".proj-stage-exit .proj-stage-name");
      if (await 出口.count()) expect(await 出口.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      const 色 = (v: string) => page.evaluate(v => { const s = document.createElement("span"); s.style.color = v; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }, v);
      expect(await page.locator(".proj-stage-acts .ant-btn-primary").allInnerTexts()).toEqual(["新增沟通"]);
      expect(await page.locator(".proj-stage-acts .proj-done-btn:not(.split-caret)").evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await 色("var(--success-bg)"));
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("沟通条目：开头方式图标（没写方式的也不是「···」），谁 · 方式 · 发起一行灰字，阶段一块，时间同列表（悬停看完整时刻）", async () => {
    const 今天 = new Date(); 今天.setHours(9, 5, 0, 0);
    const { page, errors } = await 覆盖(1280, { followUps: [
      { id: "f1", type: "PHONE", method: "手机通话", initiator: "我方发起", content: "打了电话", occurredAt: 今天.toISOString(), who: "组长甲", node: "生产备货", code: "FUL0001", 提醒: null, 版本: "v" },
      { id: "f2", type: "OTHER", method: null, initiator: null, content: "没写方式", occurredAt: "2025-03-04T02:00:00.000Z", who: "组长甲", node: "生产备货", code: "FUL0002", 提醒: null, 版本: "v" },
    ] });
    try {
      const 头 = page.locator(".proj-fu-m");
      expect((await 头.nth(0).innerText()).replace(/\s+/g, " ")).toBe("组长甲 · 手机通话 · 我方发起 生产备货 今天 09:05");
      expect((await 头.nth(1).innerText()).replace(/\s+/g, " ")).toBe("组长甲 · 其他方式 生产备货 2025 年 3 月 4 日");
      expect(await 头.nth(1).locator(".proj-fu-i .anticon-ellipsis").count()).toBe(0);
      expect(await 头.nth(1).locator(".proj-fu-i .anticon").count()).toBe(1);
      expect(await 头.nth(0).locator(".proj-fu-t").getAttribute("title")).toMatch(/\d{4}-\d{2}-\d{2} 09:05/);
      // 阶段只留一块（发起不再是标签）
      expect(await 头.nth(0).locator(".ant-tag").allInnerTexts()).toEqual(["生产备货"]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it.each([1024, 1280, 390])("#402 实操 %ipx：沟通条目头一行字多（带提醒）时，时间和 ⋮ 不折到第二行，左边那段自己折行让位", async (w) => {
    const { page, errors } = await 覆盖(w, { 可改沟通: true, 可删沟通: true, followUps: [{ id: "f1", type: "PHONE", method: "手机通话", initiator: "我方发起", content: "跟进", occurredAt: "2026-10-03T02:00:00.000Z", who: "冯某某某", node: "潜客培育", code: "FUL0001", 提醒: { 级别: "拿捏", 文字: "下一步 11-24" }, 版本: "v" }] });
    try {
      const 头 = page.locator(".proj-fu-m").first();
      const 上 = (sel: string) => 头.locator(sel).first().evaluate(e => e.getBoundingClientRect().top);
      const 左顶 = await 上(".proj-fu-l");
      const 头盒 = (await 头.boundingBox())!;
      for (const sel of [".proj-fu-t", ".proj-fu-kb"]) {
        // 都在第一行（顶和左段第一行齐，差不过 4px）、不出头这一行的右边
        expect(Math.abs((await 上(sel)) - 左顶), sel).toBeLessThanOrEqual(4);
        const 盒 = (await 头.locator(sel).first().boundingBox())!;
        expect(盒.x + 盒.width).toBeLessThanOrEqual(头盒.x + 头盒.width + 1);
      }
      expect(await 头.locator(".proj-fu-t").evaluate(e => e.getClientRects().length)).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("⋮ 里「删除」前一道分隔线；原地确认 3 秒没动自己收起，鼠标停在条上不收", async () => {
    const { page, errors } = await 覆盖(1280, { 可改沟通: true, 可删沟通: true, followUps: [{ id: "f1", type: "PHONE", content: "沟通内容", occurredAt: "2026-10-03T00:00:00.000Z", who: "组长甲", node: "生产备货", code: "FUL0001", 提醒: null, 版本: "v" }] });
    try {
      const 开删 = async () => {
        await page.getByRole("button", { name: "这条沟通的更多操作" }).click();
        const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
        await 菜单.waitFor();
        return 菜单;
      };
      const 菜单 = await 开删();
      expect(await 菜单.evaluate(m => [...m.children].map(c => c.classList.contains("ant-dropdown-menu-item-divider") ? "—" : (c.textContent ?? "").trim()))).toEqual(["新建卡点", "修改", "—", "删除"]);
      await 菜单.getByText("删除").click();
      const 问 = page.getByRole("group", { name: "确认删除这条沟通" });
      await 问.waitFor();
      await page.mouse.move(2, 2);
      await 问.waitFor({ state: "detached", timeout: 4500 });
      // 再开一次，鼠标停在条上：过了 3 秒还在；移开再数 3 秒收起
      await (await 开删()).getByText("删除").click();
      await 问.waitFor();
      await 问.hover();
      await page.waitForTimeout(3400);
      expect(await 问.count()).toBe(1);
      await page.mouse.move(2, 2);
      await 问.waitFor({ state: "detached", timeout: 4500 });
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);

  it("只读（不能记沟通）：沟通卡头只剩的收起钮白底，不是蓝实心；悬停写「收起 / 展开」", async () => {
    const { page, errors } = await 覆盖(1280, { 能记沟通: false });
    try {
      const 钮 = page.locator("#project-follow .split-solo .split-caret");
      await 钮.waitFor();
      const 色 = (v: string) => page.evaluate(v => { const s = document.createElement("span"); s.style.color = v; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }, v);
      expect(await 钮.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await 色("var(--panel)"));
      await 钮.hover();
      await page.locator(".ant-tooltip").filter({ hasText: /^(收起|展开)$/ }).first().waitFor();
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  /*
    PR #402 审查：缺项小块点了都要有反应。完成节点框开不了（这里 能改节点 = false）时按 填法表 落：右栏那一格进编辑、画像卡、线索验证框、
    新建沟通框；落不了的（客户资料在别页、附件卡不在这页）资料卡底部就地写「在哪里填」
  */
  const 各路 = { phase: "线索", node: "潜客培育", 能改节点: false, 客户入口: "文字",
    必填: { 配了: ["项目级别", "项目所在地", "需求", "线索验证结果", "国家", "来源", "本节点沟通", "合同附件"], 还差: ["项目级别", "项目所在地", "需求", "线索验证结果", "国家", "来源", "本节点沟通", "合同附件"] },
    线索验证: { 判定: null, 待: null, 无效原因: null, 复核结果: null, 最终结果: null, 终验: null, 初判即终判: false, 叫法: null, 我能: null, 痕: [] } };
  it.each([1366, 390])("%ipx：完成节点框开不了时，每块都有落点——右栏那一格、画像卡、线索验证框、新建沟通框；国家、合同附件写明在哪填", async (w) => {
    const { page, errors } = await open(true, w);
    try {
      await page.evaluate(x => (window as unknown as { __线索: (x: object) => void }).__线索(x), 各路 as object);
      const 块 = page.getByTestId("node-required-miss");
      await 块.waitFor();
      const 点 = (名: string) => 块.getByRole("button", { name: 名, exact: true }).click();
      // 右栏那一格进编辑
      await 点("项目级别");
      await page.locator('[data-inline-field="级别"] .ant-select').waitFor();
      await page.keyboard.press("Escape");
      // 项目所在地 → 右栏「区域」那一格进编辑（#402 复审）
      await 块.getByRole("button", { name: /^项目所在地/ }).click();
      await page.locator('.proj-inline-edit[data-inline-field="区域"]').waitFor();
      await page.keyboard.press("Escape");
      // 画像卡
      await page.locator("#project-profile-fold > .proj-fold-btn").click();
      await page.locator("#project-profile-fold.is-closed").waitFor();
      await 点("需求（需求状态）");
      await page.waitForFunction(() => !document.getElementById("project-profile-fold")!.classList.contains("is-closed"));
      // 线索验证框
      await 点("线索验证结果");
      const 验证框 = page.locator(".ant-modal").filter({ hasText: "线索验证" }).last();
      await 验证框.waitFor();
      await 验证框.locator(".ant-modal-close").click();
      await 验证框.waitFor({ state: "hidden" });
      // 本节点沟通 → 新建沟通框
      await 点("当前进程沟通");
      const 沟通框 = page.locator(".follow-modal .ant-modal");
      await 沟通框.waitFor();
      expect(await 沟通框.locator(".ant-modal-title").innerText()).toBe("新建沟通");
      await 沟通框.locator(".ant-modal-close").click();
      await 沟通框.waitFor({ state: "hidden" });
      // 客户资料在客户页（这里客户名只是字）、附件卡不在这页：就地写在哪填
      await 点("国家");
      await page.getByText("「国家」：国家 / 地区记在客户资料上").waitFor();
      // 企业版客户页没有「来源」那一格：就地说，不跳页（#402 复审）
      await 块.getByRole("button", { name: /^来源/ }).click();
      await page.getByText("客户来源在建客户时选定（渠道或渠道触点），建好后不能改；空着的请联系系统管理员", { exact: false }).waitFor();
      await 点("合同附件");
      await page.getByText("「合同附件」：要传文件，在「项目附件」的合同附件里传").waitFor();
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);

  it("删除确认条：键盘进来（焦点在条里）等 4 秒还在；Esc 收起后焦点回到这一条的 ⋮；鼠标点开到点自己收，焦点也回 ⋮", async () => {
    const { page, errors } = await 覆盖(1280, { 可改沟通: true, 可删沟通: true, followUps: [{ id: "f1", type: "PHONE", content: "沟通内容", occurredAt: "2026-10-03T00:00:00.000Z", who: "组长甲", node: "生产备货", code: "FUL0001", 提醒: null, 版本: "v" }] });
    try {
      const 点点 = page.getByRole("button", { name: "这条沟通的更多操作" });
      const 问 = page.getByRole("group", { name: "确认删除这条沟通" });
      const 焦点是点点 = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      // 开出确认条（焦点先在「取消」），再用键盘 Tab 到条里的「确认删除」（键盘焦点在条里 = 停表）
      const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
      await 点点.click();
      await 菜单.waitFor();
      await 菜单.getByText("删除").click();
      await 问.waitFor();
      await page.keyboard.press("Tab");
      expect(await 问.evaluate(e => e.contains(document.activeElement) && document.activeElement!.matches(":focus-visible"))).toBe(true);
      expect(await 问.getByRole("button", { name: "确认删除" }).evaluate((b) => b === document.activeElement)).toBe(true);
      await page.waitForTimeout(4000);
      expect(await 问.count()).toBe(1);
      await page.keyboard.press("Escape");
      await 问.waitFor({ state: "detached" });
      await expect.poll(焦点是点点).toBe("这条沟通的更多操作");
      // 鼠标点开：3 秒到点自己收，焦点回 ⋮ 不掉到 body
      await 点点.click();
      await 菜单.waitFor();
      await 菜单.getByText("删除").click();
      await 问.waitFor();
      await page.mouse.move(2, 2);
      await 问.waitFor({ state: "detached", timeout: 4500 });
      await expect.poll(焦点是点点).toBe("这条沟通的更多操作");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);

  it("#402 复审：全程键盘 Tab 到 ⋮ → 回车 → 进菜单 → 方向键选「删除」→ 回车，只开出确认条（焦点在「取消」），等 4 秒还在，什么都没删", async () => {
    const { page, errors } = await 覆盖(1280, { 可改沟通: true, 可删沟通: true, followUps: [{ id: "f1", type: "PHONE", content: "沟通内容", occurredAt: "2026-10-03T00:00:00.000Z", who: "组长甲", node: "生产备货", code: "FUL0001", 提醒: null, 版本: "v" }] });
    try {
      const 点点 = page.getByRole("button", { name: "这条沟通的更多操作" });
      const 问 = page.getByRole("group", { name: "确认删除这条沟通" });
      const 删了几次 = () => page.evaluate(() => (Reflect.get(window, "__删沟通") as unknown[] | undefined)?.length ?? 0);
      // Tab 到 ⋮：先落在它前一个能聚焦的地方，再按一下 Tab
      await 点点.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      expect(await 点点.evaluate((b) => b === document.activeElement && b.matches(":focus-visible"))).toBe(true);
      await page.keyboard.press("Enter");
      const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
      await 菜单.waitFor();
      // Tab 进菜单，方向键走到「删除」
      await page.keyboard.press("Tab");
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("ArrowDown");
        // rc-menu 下一帧才把焦点挪到高亮那一项
        await page.waitForTimeout(100);
        if ((await page.evaluate(() => document.activeElement?.textContent ?? "")) === "删除") break;
      }
      expect(await page.evaluate(() => document.activeElement?.closest(".ant-dropdown-menu-item-danger")?.textContent)).toBe("删除");
      await page.keyboard.press("Enter");
      await 问.waitFor();
      expect(await 问.getByRole("button", { name: /取\s*消/ }).evaluate((b) => b === document.activeElement)).toBe(true);
      expect(await 删了几次()).toBe(0);
      await page.waitForTimeout(4000);
      expect(await 问.count()).toBe(1);
      expect(await 删了几次()).toBe(0);
      expect(await page.locator("#follow-f1").count()).toBe(1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);

  it("搜着时卡点一条没有也写「没有对得上…的卡点」，不说「还没有卡点」", async () => {
    const { page, errors } = await 覆盖(1280, {});
    try {
      await page.getByRole("textbox", { name: "搜这个项目的沟通、卡点" }).fill("找不到的词");
      await page.getByText("没有对得上「找不到的词」的卡点").waitFor();
      expect(await page.getByText("还没有卡点").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
});
