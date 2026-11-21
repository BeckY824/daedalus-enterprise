import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* D4 · 设计语言 11-21：进程卡、沟通、待办、卡点的结构和文案改动只在现状主题出，换皮主题保持 D4 之前（用户 11-21「主题不动」，lib/use-skin.ts）。
   打包和桩照 ent-project-detail.ui.test.ts（同一个 ProjectDetail），这里在账本、科技主题下量 D4 之前的样子，现状主题对照一遍 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "d4-skins-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  // 教练主题（11-17）的动作：服务端那串（prisma、通知）进不了浏览器包
  stub(/coach-topic-actions$/, "const f=async()=>({ok:true});export const 发主题动作=f,回复主题动作=f,关闭主题动作=f,删主题动作=f;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>window.__习惯??null;", "async()=>null"));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\.\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", `const f=${空跑};export const 改项目节点=async(...a)=>{(window.__改节点||=[]).push(a);return window.__改节点回??{ok:true}},终止项目进程=async(...a)=>{(window.__终止||=[]).push(a);return{ok:true}},勾项目交付=f,删除项目=f,放回项目公海=f,领取项目=f,记项目沟通Action=async(...a)=>{(window.__记沟通||=[]).push(a);return window.__记沟通回??{ok:true,followUpId:'fx'}},判MQLAction=f,线索初判Action=f,市场复核Action=f,销售终验Action=f,总管理终判Action=f,销售认领Action=f,撤回验证Action=f,编辑项目=async(...a)=>{(window.__编辑||=[]).push(a);return window.__编辑回||{ok:true}},改项目画像Action=async(...a)=>{(window.__画像存||=[]).push(a);return{ok:true}},改项目沟通=async(...a)=>{(window.__改沟通||=[]).push(a);return{ok:true}},删项目沟通=async(...a)=>{(window.__删沟通||=[]).push(a);return{ok:true}},加项目组员=f,换项目组员角色=f,移出项目组员=f;`));
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

type 皮 = "now" | "ledger" | "tech";
async function 开(skin: 皮, x: Record<string, unknown>, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://d4skins.test/**", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html data-skin="${skin}" data-paper="tone" data-mode="light"><meta charset='utf-8'><div id='root'></div></html>` }));
  await page.goto("http://d4skins.test");
  for (const f of ["globals.css", "skins/shared.css", "skins/ledger.css", "skins/tech.css"]) await page.addStyleTag({ path: path.resolve("src/app", f) });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(v => (window as unknown as { __over: (x: unknown) => void }).__over(v), x);
  await page.getByText("进程变更").first().waitFor().catch(() => { throw new Error(errors.join("\n") || "没渲染出来"); });
  return { page, errors };
}
const 缺两项 = { phase: "线索", node: "潜客培育", 必填: { 配了: ["项目级别", "需求描述"], 还差: ["项目级别", "需求描述"] }, 有效沟通差: ["需求描述（成交需求）"] };
const 一条沟通 = { 可改沟通: true, 可删沟通: true, followUps: [{ id: "f1", type: "PHONE", method: "手机通话", initiator: "我方发起", content: "沟通内容", occurredAt: "2026-10-03T02:00:00.000Z", who: "组长甲", node: "生产备货", code: "FUL0001", 提醒: null, 版本: "v" }] };
const 菜单项 = async (page: import("playwright").Page) => {
  await page.getByRole("button", { name: "这条沟通的更多操作" }).click();
  const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
  await 菜单.waitFor();
  return 菜单;
};
const 菜单字 = (菜单: import("playwright").Locator) => 菜单.evaluate(m => [...m.children].map(c => c.classList.contains("ant-dropdown-menu-item-divider") ? "—" : (c.textContent ?? "").trim()));

for (const skin of ["ledger", "tech"] as const)
  describe(`${skin}：D4 之前的样子`, () => {
    it("进程卡：必填还是一段灰字「这个节点还差必填：…」，没有「还差 N 项」缺项小块", async () => {
      const { page, errors } = await 开(skin, 缺两项);
      try {
        expect(await page.locator(".proj-miss").count()).toBe(0);
        expect(await page.getByText(/^这个节点还差必填：项目级别、/).count()).toBe(1);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    });

    it("沟通条目：方式小块 + 发起 / 阶段两个标签，「谁 · 完整时刻」；⋮ 里没有分隔线；删除确认条不会 3 秒自己收起", async () => {
      const { page, errors } = await 开(skin, 一条沟通);
      try {
        const 行 = page.locator(".proj-follow-row").first();
        expect(await 行.locator(".proj-fu-m").count()).toBe(0);
        expect(await 行.locator(".ant-tag").allInnerTexts()).toEqual(expect.arrayContaining(["我方发起", "生产备货"]));
        expect(await 行.innerText()).toMatch(/组长甲 · 2026-10-03 \d{2}:\d{2}/);
        const 菜单 = await 菜单项(page);
        expect(await 菜单字(菜单)).toEqual(["新建卡点", "修改", "删除"]);
        await 菜单.getByText("删除").click();
        const 问 = page.getByRole("group", { name: "确认删除这条沟通" });
        await 问.waitFor();
        await page.mouse.move(2, 2);
        await page.waitForTimeout(3500);
        expect(await 问.count()).toBe(1);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }, 30_000);

    it("新增沟通框：标题「记一条沟通」、提交键「记下」没填好灰着、原因写在键旁边；标签「名 *」，没有 * 在前的标签", async () => {
      const { page, errors } = await 开(skin, {});
      try {
        await page.getByTestId("follow-card-new").click();
        const 框 = page.locator(".follow-modal .ant-modal");
        await 框.waitFor();
        expect(await 框.locator(".ant-modal-title").innerText()).toBe("记一条沟通");
        const 记下 = 框.getByRole("button", { name: /^记\s*下$/ });
        expect(await 记下.isDisabled()).toBe(true);
        expect(await 框.getByText("请填写这次沟通的内容").count()).toBe(1);
        expect(await 框.locator(".fm-label, .fm-help").count()).toBe(0);
        expect(await 框.getByText("沟通内容 *", { exact: true }).count()).toBe(1);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    });

    it("新建卡点框：提交键「发布」没选原因灰着，没有标签；收起钮是浏览器自带 title；搜着、一条卡点都没有写「还没有卡点」", async () => {
      const { page, errors } = await 开(skin, 一条沟通);
      try {
        expect(await page.locator("#project-follow .split-caret").first().getAttribute("title")).toMatch(/^(收起|展开)$/);
        await page.getByRole("textbox", { name: "搜这个项目的沟通、卡点" }).fill("找不到的词");
        await page.getByText("还没有卡点").waitFor();
        await page.getByRole("textbox", { name: "搜这个项目的沟通、卡点" }).fill("");
        await (await 菜单项(page)).getByText("新建卡点").click();
        const 框 = page.locator(".blocker-modal .ant-modal");
        await 框.waitFor();
        expect(await 框.getByRole("button", { name: /^发\s*布$/ }).isDisabled()).toBe(true);
        expect(await 框.locator(".fm-label").count()).toBe(0);
        expect(await 框.getByRole("combobox", { name: "阻碍原因" }).count()).toBe(1);
        expect(await 框.getByText("阻碍原因（必填，可多选；没有合适的可以直接打字新增）").count()).toBe(1);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    });
  });

it("现状主题对照：缺项小块、「新建沟通」框「保存」一直能点、⋮ 有分隔线、卡点框「保存」", async () => {
  const { page, errors } = await 开("now", { ...缺两项, ...一条沟通 });
  try {
    expect(await page.getByTestId("node-required-miss").count()).toBe(1);
    expect(await page.getByText(/^这个节点还差必填：/).count()).toBe(0);
    expect(await page.locator(".proj-fu-m").count()).toBe(1);
    const 菜单 = await 菜单项(page);
    expect(await 菜单字(菜单)).toEqual(["新建卡点", "修改", "—", "删除"]);
    await 菜单.getByText("新建卡点").click();
    const 卡框 = page.locator(".blocker-modal .ant-modal");
    await 卡框.waitFor();
    expect(await 卡框.getByRole("button", { name: /^保\s*存$/ }).isDisabled()).toBe(false);
    expect(await 卡框.locator(".fm-label").count()).toBeGreaterThan(0);
    await 卡框.getByRole("button", { name: /取\s*消/ }).click();
    await page.getByTestId("follow-card-new").click();
    const 框 = page.locator(".follow-modal .ant-modal");
    await 框.waitFor();
    expect(await 框.locator(".ant-modal-title").innerText()).toBe("新建沟通");
    expect(await 框.locator(".ant-modal-footer .ant-btn-primary").isDisabled()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30_000);
