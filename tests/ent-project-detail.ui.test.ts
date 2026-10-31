import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* 10-27 会议：企业版项目详情两栏——左边干活的（节点、沟通、卡点），右边资料（项目、交付、项目组、提成、节点变更）；
   「记一条沟通」是主按钮；窄于 630 的容器退一栏。开关关闭时照原来一列摆、960 宽、没有提成和「记一条沟通」主按钮。
   P11 commit #3：三个竖条——应用导航 | 中栏项目名单（ProjectRoster，照客户记录页）| 项目详情，见文末「三栏」那几条 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "project-detail-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;");
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\.\/actions$/, `const f=${空跑};export const 改项目节点=f,勾项目交付=f,删除项目=f,放回项目公海=f,领取项目=f,记项目沟通Action=f,判MQLAction=f,线索初判Action=f,市场复核Action=f,销售终验Action=f,总管理终判Action=f,销售认领Action=f,编辑项目=f,改项目画像Action=f,改项目沟通=f,删项目沟通=f,撤销删项目沟通=f,加项目组员=f,换项目组员角色=f,移出项目组员=f;`);
  stub(/^\.\.\/commission-actions$/, `const f=${空跑};export const 存项目底价=f,存提成分配=f,更正实际提成=f;`);
  stub(/^\.\.\/payment-actions$/, `const f=${空跑};export const 记回款=f,删回款=f;`);
  stub(/^\.\/blocker-actions$/, `const f=${空跑};export const 发布卡点Action=f,指认卡点Action=f,认领卡点Action=f,接受卡点Action=f,转让卡点Action=f,返回卡点Action=f,改卡点进度Action=f,解决卡点Action=f,卡点可选的人Action=async()=>[];`);
  stub(/customers\/\[id\]\/ai$/, `export const parseFollowUpDraft=async()=>({ok:false,error:"未启用"});`);
  stub(/^\.\.\/relate-actions$/, `const f=${空跑};export const 加关联客户Action=f,改客户身份Action=f,解除关联客户Action=f,加关联联系人Action=f,改联系人角色立场Action=f,解除关联联系人Action=f,搜项目联系人=async()=>[];`);
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[];");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ProjectDetail from '@/app/(app)/projects/[id]/ProjectDetail';import ProjectRoster from '@/components/ProjectRoster';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 长='超长项目名字'.repeat(8), 串='X'.repeat(90);
    const 基={id:'p1',name:长,remark:null,amount:1234567.89,currency:'CNY',customer:{id:'c1',name:'超长客户名'+串,school:'某某超长公司名有限公司'.repeat(4)},contact:{id:'k1',name:'张三',position:'采购总监兼华东大区负责人'},
      来源线索:{name:'线索'+串,convertedAt:'2026-10-01'},原因选项:{回收:[],无效:[]},ownerId:'qa',ownerName:'组长甲',creatorName:'组长甲',createdAt:'2026-10-01T00:00:00.000Z',historyOwners:['乙','丙'],
      phase:'订单',node:'生产备货',result:null,exceptionReason:null,exceptionCategory:null,pooled:false,能放公海:false,能领取:false,领取不给:null,进公海:null,出口叫法:{},有效沟通:1,
      nextStepAt:'2026-11-01',回收日:null,expectedDealAt:'2026-12-01',要下一步:true,必填:null,不给推:null,能改节点:true,
      balanceSettled:false,balanceSettledBy:null,balanceSettledAt:null,acceptancePassed:false,acceptancePassedBy:null,acceptancePassedAt:null,
      logs:[{id:'l1',at:'2026-10-02T00:00:00.000Z',who:'组长甲',from:{phase:'商机',node:'首款支付'},to:{phase:'订单',node:'生产备货'},reason:'原因'+串,category:null,kind:'node',transfer:null}],
      followUps:[{id:'f1',type:'PHONE',content:'沟通内容'+串,occurredAt:'2026-10-03T00:00:00.000Z',who:'组长甲',node:'生产备货',code:'FUL0001',提醒:null}],
      members:[{id:'m1',userId:'u2',name:'组员'+串,roleId:null,inviteStatus:'JOINED'}],删前清点:{留痕:1,组员:1,沟通:1}};
    const 提成={币种:'CNY',成交金额:1234567.89,项目底价:1000000,比例:{底价比例:2,溢价比例:30},范围:'外贸',预估:{成交金额:1234567.89,项目底价:1000000,项目溢价:234567.89,底价提成:20000,溢价提成:70370.37,合计:90370.37},实际:null,
      每人:[{userId:'qa',比例:60,金额:54222.22,组长:true,name:'组长甲'},{userId:'u2',比例:40,金额:36148.15,组长:false,name:'组员'+串}],能改:true,能填底价:true,能更正:false,组员:[{userId:'u2',name:'组员'+串}],分配:{u2:40}};
    const 详情=(企业)=><ProjectDetail p={{...基,企业版:企业,能记沟通:企业,提成:企业?提成:null,...(企业?{项目来源:{name:'渠道'+串,跟客户:true},channelId:null,已立项天数:28,渠道们:[],aiEnabled:true,level:'A',所在地:{addrCountry:'中国',addrProvince:'广东省',addrCity:'深圳市'+'市'.repeat(30),addrDistrict:'南山区',location:'科技园'+串}}:{})}} 能改={true} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={企业?{们:[],能发:true,默认:{},人们:[]}:null}/>;
    const 包=(x)=><ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>{x}</BusinessProvider></App></ConfigProvider>;
    window.__render=(企业)=>root.render(包(详情(企业)));
    /* 10-29 沟通「…」→ 修改 / 删除；下一步 = 一句话 + 可选时间 */
    window.__over=(x)=>root.render(包(<ProjectDetail p={{...详情(true).props.p,...x}} 能改={true} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={{们:[],能发:true,默认:{},人们:[]}}/>));
    /* P17 关联客户 / 联系人：超长客户名、超长联系人显名、选满身份，挂在右栏 */
    const 关联={客户们:[{customerId:'c1',名:'超长客户名'+串,全称:'某某超长公司名有限公司'.repeat(4),身份:['业主方','总包方','分包方','投资方'],主:true,看得到:true},
      {customerId:'c2',名:'关联客户'+串,全称:'',身份:['监理方','设计方','引荐方'],主:false,看得到:true},{customerId:'c3',名:'同事的客户 #ABC123',全称:'',身份:[],主:false,看得到:false}],
      联系人们:[{contactId:'k1',名:'超长客户名'+串+'|张先生',姓名:'张三',customerId:'c1',角色:['决策人','审批人','影响人','使用人','经办人'],立场:'盟友',主:true,看得到:true},
      {contactId:'k2',名:'关联客户'+串+'|🔥姓名暂未核实',姓名:'王总',customerId:'c2',角色:[],立场:null,主:false,看得到:true}],
      选项:{身份:['业主方','总包方','分包方','投资方','垫资方','运营方','引荐方','监理方','设计方'],角色:['决策人','审批人','影响人','使用人','经办人'],立场:['待定','中立','对手','线人','军师','盟友']},上限:30};
    window.__relate=(能改)=>root.render(包(<ProjectDetail p={{...详情(true).props.p,关联}} 能改={能改} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={{们:[],能发:true,默认:{},人们:[]}}/>));
    /* 三栏：照 AppShell 桌面那套 .shell > nav.rail + 中栏 + main.main.app-content > 换页那层 div。名单故意按 订单 → 线索 → 空 → 商机 给，组头得照三大阶段排 */
    const 行=(id,name,阶段,进程,x)=>({id,name,阶段,进程,结局:null,pooled:false,customerName:'超长客户名'+串,lastType:'PHONE',lastAt:'2026-10-20T00:00:00.000Z',lastNote:'最近一句'+串,nextAt:null,...x});
    const 名单={取到上限:false,rows:[行('p1',长,'订单','生产备货'+'备'.repeat(20)),行('p2','线索项目'+串,'线索','初次接触'),行('p5','没填阶段的项目',null,null,{lastAt:null,lastNote:null}),行('p3',串,'商机','方案报价',{pooled:true,结局:'输单'}),行('p4','商机二','商机','首款支付',{nextAt:'2026-10-01'})]};
    window.__shell=()=>root.render(包(<div className='shell'><nav className='rail' aria-label='主导航'/><ProjectRoster data={名单}/><main className='main app-content' style={{padding:'22px 26px'}}><div style={{maxWidth:1720,margin:'0 auto'}}>{详情(true)}</div></main></div>));
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(企业: boolean, width = 1366, 外宽?: number, 三栏 = false) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://proj.test/**", r => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><div id='root'${外宽 ? ` style='width:${外宽}px'` : ""}></div>` }));
  await page.goto(三栏 ? "http://proj.test/projects/p1" : "http://proj.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  if (三栏) await page.evaluate(() => (window as unknown as { __shell: () => void }).__shell());
  else await page.evaluate(e => (window as unknown as { __render: (x: boolean) => void }).__render(e), 企业);
  await page.getByText("进程变更").first().waitFor();
  return { page, errors };
}
const 卡标题 = (page: import("playwright").Page, sel: string) =>
  page.locator(`${sel} > .ant-card`).evaluateAll(cs => cs.map(c => c.querySelector(":scope > .ant-card-head .ant-card-head-title")?.textContent?.trim() ?? ""));

it("企业版：左边节点、沟通、卡点，右边项目、交付、项目组、提成、节点变更；记一条沟通是主按钮", async () => {
  const { page, errors } = await open(true);
  try {
    expect(await 卡标题(page, ".proj-main")).toEqual(["", "沟通", "卡点（0）"]);
    expect(await 卡标题(page, ".proj-side")).toEqual(["项目", "交付", "项目组", "提成", "进程变更"]);
    const 记 = page.locator(".page-head-a").getByRole("button", { name: "记一条沟通" });
    expect(await 记.getAttribute("class")).toContain("ant-btn-primary");
    const [主, 侧] = await Promise.all([page.locator(".proj-main").boundingBox(), page.locator(".proj-side").boundingBox()]);
    expect(侧!.x).toBeGreaterThan(主!.x + 主!.width);
    expect(Math.round(侧!.width)).toBe(320);
    // 提成预估写明按哪一套比例（10-27：内贸 / 外贸 / 不限）
    expect(await page.locator(".proj-side > .ant-card").filter({ hasText: "提成" }).first().innerText()).toContain("按外贸比例");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：超长项目名、客户名、组员名不横向溢出，按钮点得中", async (w) => {
  const { page } = await open(true, w);
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // 右栏里的卡片内容不能伸出卡片（右栏窄，最容易被长串撑开）
    const 伸出 = await page.locator(".proj-side > .ant-card").evaluateAll(cs => cs.filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.querySelector(".ant-card-head-title")?.textContent));
    expect(伸出).toEqual([]);
    for (const name of ["记一条沟通", "AI 录入", "编辑项目"]) {
      const box = await page.getByRole("button", { name }).first().boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(w);
      const 点中 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box!.x + box!.width / 2, box!.y + box!.height / 2]);
      expect(点中.replace(/\s/g, "")).toBe(name.replace(/\s/g, ""));
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
    expect(位("进程变更")).toBeGreaterThan(位("关联联系人（2）"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const 伸出 = await page.locator(".proj-side > .ant-card").evaluateAll(cs => cs.filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.querySelector(".ant-card-head-title")?.textContent));
    expect(伸出).toEqual([]);
    const 卡 = page.locator(".proj-side > .ant-card").filter({ hasText: "关联客户（3）" }).first();
    const 卡框 = (await 卡.boundingBox())!;
    for (const el of await 卡.locator(".proj-rel-row, .ant-select").all()) {
      const b = (await el.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(卡框.x + 卡框.width + 1);
    }
    // 主客户不给解除；看不到的那家没链接
    expect(await page.getByRole("button", { name: /^解除和 超长客户名/ }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /^解除和 关联客户/ }).count()).toBe(2);
    expect(await 卡.locator("a", { hasText: "同事的客户" }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("P17 只读：关联卡只列文字，没有下拉、没有关联 / 解除按钮", async () => {
  const { page } = await open(true, 1280);
  try {
    await page.evaluate(() => (window as unknown as { __relate: (x: boolean) => void }).__relate(false));
    await page.getByText("关联客户（3）").waitFor();
    const 两卡 = page.locator(".proj-side > .ant-card").filter({ hasText: /关联(客户|联系人)（/ });
    expect(await 两卡.count()).toBe(2);
    expect(await 两卡.locator(".ant-select").count()).toBe(0);
    expect(await 两卡.getByRole("button", { name: /关联一|解除和/ }).count()).toBe(0);
    expect(await 两卡.first().innerText()).toContain("监理方、设计方、引荐方");
  } finally { await page.close(); }
});

it("企业版 P6：项目卡有已立项、项目来源（跟客户来源时注明）；「AI 录入」打开记一条、AI 那格先摆出来，只预填不写", async () => {
  const { page, errors } = await open(true);
  try {
    const 项目卡 = await page.locator(".proj-side > .ant-card").filter({ hasText: "项目来源" }).first().innerText();
    expect(项目卡).toContain("28 天");
    expect(项目卡).toMatch(/同.+来源/);
    await page.getByRole("button", { name: "AI 录入" }).first().click();
    const 原话 = page.getByRole("textbox", { name: "沟通原话" });
    await 原话.waitFor();
    expect(await 原话.evaluate(e => e === document.activeElement)).toBe(true);
    await page.getByRole("button", { name: /AI 解析填表/ }).click();
    await page.getByText("先把沟通过程随手写几句").waitFor();
    await 原话.fill("刚和王经理通了电话，下周三再聊报价");
    await page.getByRole("button", { name: /AI 解析填表/ }).click();
    await page.getByText("未启用").waitFor();
    // 「记下」照旧要内容、要选是否明确回复，AI 没填出东西就点不了
    expect(await page.getByRole("button", { name: "记 下" }).or(page.getByRole("button", { name: "记下" })).first().isDisabled()).toBe(true);
    await page.getByRole("button", { name: /取\s*消/ }).click();
    await 原话.waitFor({ state: "detached" });
    // 手填入口：AI 那格收着，只给一个「用 AI 从原话预填」
    await page.getByRole("button", { name: "记一条沟通" }).first().click();
    await page.getByRole("button", { name: "用 AI 从原话预填" }).waitFor();
    expect(await page.getByRole("textbox", { name: "沟通原话" }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("10-31 改版 R4：项目卡定金在合同前；空着写「待填写X / 待选择X」（浅灰）；0 算填了", async () => {
  const { page, errors } = await open(true);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({
      成交钱: { contractAmount: null, contractCurrency: null, depositAmount: 0, depositCurrency: "USD", dealDemand: null }, expectedDealAt: null, 项目来源: null }));
    const 卡 = page.locator(".proj-side > .ant-card").filter({ hasText: "定金金额" }).first();
    await 卡.waitFor();
    const 字 = await 卡.innerText();
    expect(字.indexOf("定金金额")).toBeLessThan(字.indexOf("合同金额"));
    expect(字).toMatch(/定金金额\s*US\$\s*0\b/);
    expect(字).not.toContain("待填写定金金额");
    for (const 话 of ["待填写合同金额", "待填写成交需求", "待选择预计成交日期", "待选择项目来源"]) expect(字).toContain(话);
    expect(字).not.toContain("没填");
    const 色 = await 卡.getByText("待填写合同金额").evaluate(e => getComputedStyle(e).color);
    const 浅 = await page.evaluate(() => { const s = document.createElement("span"); s.style.color = "var(--text-faint)"; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; });
    expect(色).toBe(浅);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("10-31 改版 R7：和客户详情同一套字阶——标题 26、卡片标题 18、值 16 正文色、字段名 16 灰、辅助 14 灰、待填 16 浅灰；0 照正文色", async () => {
  const { page, errors } = await open(true);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({
      成交钱: { contractAmount: null, contractCurrency: null, depositAmount: 0, depositCurrency: "USD", dealDemand: null } }));
    const 卡 = page.locator(".proj-side > .ant-card").filter({ hasText: "定金金额" }).first();
    await 卡.waitFor();
    const 色 = (v: string) => page.evaluate(v => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.querySelector(".proj-wrap")!.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }, v);
    const 样 = (l: import("playwright").Locator) => l.evaluate(e => { const c = getComputedStyle(e); return { 字: c.fontSize, 色: c.color }; });
    const [墨, 灰, 浅] = [await 色("--ink"), await 色("--text-muted"), await 色("--text-faint")];
    expect(await 样(page.locator(".proj-wrap .page-head h1"))).toEqual({ 字: "26px", 色: 墨 });
    expect(await 样(卡.locator(".ant-card-head-title"))).toEqual({ 字: "18px", 色: 墨 });
    expect(await 样(卡.getByText("定金金额", { exact: true }))).toEqual({ 字: "16px", 色: 灰 });
    const 零 = 卡.locator("div").filter({ hasText: /^定金金额/ }).last();
    expect(await 零.evaluate(e => { const c = getComputedStyle(e); return { 字: c.fontSize, 色: c.color }; })).toEqual({ 字: "16px", 色: 墨 });
    expect(await 样(卡.getByText("待填写合同金额"))).toEqual({ 字: "16px", 色: 浅 });
    expect(await 样(page.locator(".proj-wrap .proj-where-label").first())).toEqual({ 字: "16px", 色: 灰 });
    const 辅 = page.locator(".proj-main .ant-card span").filter({ hasText: / · \d{4}-\d{2}-\d{2}/ }).first();
    expect(await 样(辅)).toEqual({ 字: "14px", 色: 灰 });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("10-31 改版 R7：超长项目名、窄容器下字号放大后不横滚、不截字", async () => {
  const { page, errors } = await open(true, 1024);
  try {
    await page.evaluate(() => (window as unknown as { __over: (x: object) => void }).__over({ name: "超长的项目名字没有空格".repeat(8) }));
    await page.getByText("超长的项目名字没有空格超长").first().waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const 溢 = await page.evaluate(() => [...document.querySelectorAll(".proj-wrap .page-head h1, .proj-wrap .ant-card-head-title")].filter(e => e.scrollWidth > e.clientWidth + 1).length);
    expect(溢).toBe(0);
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
    expect(await page.locator(".ant-card-head-title").allTextContents()).toEqual(["项目", "交付", "项目组", "进程变更", "沟通"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("P11 定稿 -2 版 %ipx：项目卡有级别星、区域、地址（长地址折行不撑卡）；编辑框里有项目级别、所在地四格、详细地址，不横向溢出", async (w) => {
  const { page, errors } = await open(true, w);
  try {
    const 卡 = page.locator(".proj-side > .ant-card").filter({ hasText: "项目来源" }).first();
    const 字 = await 卡.innerText();
    expect(字).toContain("★★★☆");
    expect(字).toContain("A 重点");
    expect(字).toMatch(/区域\s*深圳市/);
    expect(字).toContain("广东省 深圳市");
    expect(await 卡.evaluate(c => c.scrollWidth <= c.clientWidth + 1)).toBe(true);
    // 级别在金额前面
    expect(字.indexOf("级别")).toBeLessThan(字.indexOf("金额"));
    await 卡.locator(".ant-card-extra button").click(); // antd 两字按钮中间会插空格（「编 辑」），按卡头的按钮点
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
    expect(await 不伸出(page, ".pane-roster, .pane-roster .pane-rows, .roster-row, .roster-m, main.main, .proj-main, .proj-side, .proj-side > .ant-card")).toEqual([]);
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
    expect(await 不伸出(page, "main.main, .proj-main, .proj-side, .proj-side > .ant-card")).toEqual([]);
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

async function 覆盖(width: number, x: Record<string, unknown>) {
  const { page, errors } = await open(true, width);
  await page.evaluate(v => (window as unknown as { __over: (x: unknown) => void }).__over(v), x);
  await page.getByText("进程变更").first().waitFor().catch(() => { throw new Error(errors.join("\n") || "没渲染出来"); });
  return { page, errors };
}

for (const 宽 of [1280, 1024]) {
  it(`${宽}px：每条沟通有「…」，修改 / 删除菜单不出屏；修改弹窗带上原内容；删除先就地确认`, async () => {
    const { page, errors } = await 覆盖(宽, { 可改沟通: true, followUps: [{ id: "f1", type: "PHONE", content: "沟通内容" + "X".repeat(90), occurredAt: "2026-10-03T00:00:00.000Z", who: "组长甲", node: "生产备货", code: "FUL0001", 提醒: null, 版本: "2026-10-03T00:00:00.000Z" }] });
    try {
      const 点 = page.getByRole("button", { name: "这条沟通的更多操作" });
      expect(await 点.count()).toBe(1);
      expect(await 不伸出(page, ".proj-main")).toEqual([]);
      await 点.click();
      const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
      await 菜单.waitFor();
      expect((await 菜单.locator(".ant-dropdown-menu-item").allInnerTexts()).map(t => t.trim())).toEqual(["发卡点", "修改", "删除"]);
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
      const 问 = page.locator(".inlc-ask");
      await 问.waitFor();
      expect(await 问.innerText()).toContain("回收站");
      const 问盒 = (await 问.boundingBox())!;
      expect(问盒.x + 问盒.width).toBeLessThanOrEqual(宽);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("没有改沟通的权限：「…」里只剩发卡点（10-30 发卡点从行上收进来）", async () => {
  const { page, errors } = await 覆盖(1280, { 可改沟通: false });
  try {
    await page.getByRole("button", { name: "这条沟通的更多操作" }).first().click();
    const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
    await 菜单.waitFor();
    expect(new Set((await 菜单.locator(".ant-dropdown-menu-item").allInnerTexts()).map(t => t.trim()))).toEqual(new Set(["发卡点"]));
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("下一步：有文字写文字、有时间跟在后面；老数据只有时间就只摆时间；记一条沟通要写下一步做什么", async () => {
  const { page, errors } = await 覆盖(1280, { nextStepText: "周五前发报价单给对方采购", nextStepAt: "2026-11-01" });
  try {
    const 行 = page.locator(".proj-side").getByText("下一步", { exact: true }).locator("..");
    expect((await 行.innerText()).replace(/\s+/g, " ")).toContain("周五前发报价单给对方采购 · 2026-11-01");
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ nextStepText: null, nextStepAt: "2026-11-01" }));
    await page.waitForFunction(() => !document.body.innerText.includes("周五前发报价单"));
    expect((await 行.innerText()).replace(/\s+/g, " ")).toContain("下一步 2026-11-01");
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ nextStepText: "只写了一句", nextStepAt: null }));
    await page.getByText("只写了一句").waitFor();
    await page.getByRole("button", { name: "记一条沟通" }).first().click();
    const 窗 = page.getByRole("dialog");
    await 窗.getByLabel("下一步做什么").waitFor();
    expect(await 窗.getByLabel("下一步做什么").getAttribute("maxlength")).toBe("100");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/* 10-31 改版 R6：企业版页头把这一页能做的事摆成具名按钮，要填的进弹窗；卡上原入口照旧 */
const 页头钮 = (page: import("playwright").Page, 类 = "") =>
  page.locator(`.page-head-a button${类}`).evaluateAll(bs => bs.map(b => b.textContent!.replace(/\s/g, "")));

it("R6 页头：具名按钮按设计排，没有「更多」；记一条沟通是唯一主按钮，⌘N 找到的就是它；删除是收着的危险文字钮", async () => {
  const { page, errors } = await 覆盖(1280, { 可改沟通: true });
  try {
    expect(await 页头钮(page)).toEqual(["记一条沟通", "AI录入", "编辑项目", "转给…", "推进进程", "发卡点", "邀请成员", "改分配", "管理沟通", "删除项目"]);
    expect(await page.getByRole("button", { name: "项目的更多操作" }).count()).toBe(0);
    expect(await page.locator(".page-head-a .ant-btn-primary").allTextContents()).toEqual(["记一条沟通"]);
    expect(await page.evaluate(() => document.querySelector(".page-head-a button.ant-btn-primary:not([disabled])")?.textContent)).toBe("记一条沟通");
    const 删 = page.locator(".page-head-a").getByRole("button", { name: "删除项目" });
    expect(await 删.getAttribute("class")).toMatch(/ant-btn-text.*ant-btn-dangerous|ant-btn-dangerous.*ant-btn-text|ant-btn-color-dangerous.*ant-btn-variant-text|ant-btn-variant-text/);
    await 删.click();
    await page.getByRole("dialog").filter({ hasText: "删除这个项目？" }).waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("R6 页头跟着权限：公海里能领的主按钮是「领取」；只读的人只剩记沟通那几样；放回公海等复核时灰着说原因", async () => {
  const { page, errors } = await 覆盖(1280, { pooled: true, 能领取: true, 能放公海: false, 提成: null });
  try {
    expect(await 页头钮(page, ".ant-btn-primary")).toEqual(["领取"]);
    // 公海里的项目谁都改不了（可改 = 能改 && !pooled）：编辑、推进、邀请…都不摆；沟通行上还能发卡点，所以管理沟通在
    expect(await 页头钮(page)).toEqual(["领取", "记一条沟通", "AI录入", "发卡点", "管理沟通", "删除项目"]);
    await page.evaluate(() => (window as unknown as { __over: (x: unknown) => void }).__over({ 能放公海: true, 提成: null, 线索验证: { 判定: "有效", 待: "市场复核", 无效原因: null, 复核结果: null, 最终结果: null, 我能: null, 痕: [] } }));
    await page.waitForFunction(() => document.querySelector(".page-head-a")?.textContent?.includes("放回公海"));
    expect(await page.locator(".page-head-a").getByRole("button", { name: "放回公海" }).isDisabled()).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("R6 弹窗：推进进程、项目组成员、改分配、管理沟通都能打开，标题带项目名；管理沟通里修改换到修改框", async () => {
  const { page, errors } = await 覆盖(1280, { 可改沟通: true });
  try {
    const 头 = page.locator(".page-head-a");
    const 开 = async (按钮: string, 标题: string) => {
      await 头.getByRole("button", { name: 按钮 }).click();
      const 窗 = page.getByRole("dialog").filter({ hasText: 标题 });
      await 窗.waitFor();
      return 窗;
    };
    const 关 = async (窗: import("playwright").Locator) => {
      await 窗.getByRole("button", { name: /Close|关闭/ }).first().click();
      await 窗.waitFor({ state: "hidden" });
    };
    let 窗 = await 开("推进进程", "推进进程 · 超长项目名字");
    expect(await 窗.innerText()).toContain("订单 · 生产备货");
    expect(await 窗.getByRole("button", { name: /^下一步：/ }).count()).toBe(1);
    await 关(窗);
    窗 = await 开("邀请成员", "项目组成员 · ");
    expect(await 窗.innerText()).toContain("组员");
    await 关(窗);
    窗 = await 开("改分配", "改提成分配");
    await 窗.getByRole("button", { name: /取\s*消/ }).click();
    await 窗.waitFor({ state: "hidden" });
    窗 = await 开("管理沟通", "管理沟通 · ");
    expect(await 窗.innerText()).toContain("沟通内容");
    await 窗.getByRole("button", { name: /^修\s*改$/ }).first().click();
    await page.getByRole("dialog").filter({ hasText: "修改这条沟通" }).waitFor();
    expect(await page.getByRole("dialog").filter({ hasText: "管理沟通 · " }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("R6 关联：页头「关联客户」打开就是加客户那一格，「管理关联」两格都在", async () => {
  const { page, errors } = await open(true, 1280);
  try {
    await page.evaluate(() => (window as unknown as { __relate: (x: boolean) => void }).__relate(true));
    await page.getByText("关联客户（3）").waitFor();
    await page.locator(".page-head-a").getByRole("button", { name: "关联客户" }).click();
    const 窗 = page.getByRole("dialog").filter({ hasText: "关联客户 · " });
    await 窗.waitFor();
    expect(await 窗.getByText("关联联系人（").count()).toBe(0);
    await 窗.getByRole("button", { name: /Close|关闭/ }).first().click();
    await 窗.waitFor({ state: "hidden" });
    await page.locator(".page-head-a").getByRole("button", { name: "管理关联" }).click();
    const 管 = page.getByRole("dialog").filter({ hasText: "管理关联 · " });
    await 管.waitFor();
    expect(await 管.getByText("关联客户（3）").count()).toBe(1);
    expect(await 管.getByText(/关联联系人（2）/).count()).toBe(1);
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
