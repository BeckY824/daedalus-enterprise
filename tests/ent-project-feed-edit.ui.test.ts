import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
/* 11-02 项目详情瀑布流：卡片就地改 + 新传附件马上出现。
   钉的是：没权限、切换视图中 DOM 里没入口；只交改的那一格；失败留在编辑态、输入不丢、写原因；Esc 放弃；回车不重复存；
   乐观显示、props 回来听服务端；中文输入法选字的回车不提交；
   FollowAttachments / AttachmentsPanel：传完不用刷新、传着不能重复点、失败状态恢复、一批只 refresh 一次、prop 后到也进得来；
   1024 / 1280 / 1366 超长内容编辑态不溢出 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "project-feed-edit-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  // 沟通撤销（A7-1）：FollowUndo 用 @/ 路径引客户页 actions
  stub(/^@\/app\/\(app\)\/customers\/\[id\]\/actions$/, "export const 撤销刚记的沟通=async()=>({ok:true});");
  const 空跑 = "async()=>({ok:true})";
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷新=(window.__刷新||0)+1;},push(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\.\/actions$/, `const f=${空跑};
    const 记=(名)=>async(...a)=>{(window[名]||=[]).push(a);const 结果=window.__下次结果;if(window.__慢)await new Promise(r=>setTimeout(r,window.__慢));if(结果==='抛')throw new Error('网络断了');return 结果||{ok:true}};
    export const 编辑项目=记('__编辑'),改项目沟通=记('__改沟通'),改项目节点=f,终止项目进程=f,勾项目交付=f,删除项目=f,放回项目公海=f,领取项目=f,记项目沟通Action=f,判MQLAction=f,线索初判Action=f,市场复核Action=f,销售终验Action=f,总管理终判Action=f,销售认领Action=f,改项目画像Action=f,删项目沟通=f,撤销删项目沟通=f,加项目组员=f,换项目组员角色=f,移出项目组员=f;`);
  stub(/^\.\.\/commission-actions$/, `const f=${空跑};export const 存项目底价=f,存提成分配=f,更正实际提成=f;`);
  stub(/^\.\.\/payment-actions$/, `const f=${空跑};export const 记回款=f,删回款=f;`);
  stub(/readonly-card-actions$/, "export const 打开客户只读卡Action=async(...a)=>{(window.__开卡||=[]).push(a);return window.__卡结果??{ok:false,error:'打不开'}};");
  stub(/^\.\/blocker-actions$/, `const f=${空跑};export const 发布卡点Action=f,认领卡点Action=f,完成卡点Action=f,删卡点Action=f,存卡点默认Action=f,存卡点角色开关Action=f,新增原因Action=f,改原因名Action=f,改原因状态Action=f,删原因Action=f,合并原因Action=f,我的卡点Action=async()=>[];`);
  stub(/customers\/\[id\]\/ai$/, `export const parseFollowUpDraft=async()=>({ok:false,error:"未启用"});`);
  stub(/^\.\.\/relate-actions$/, `const f=${空跑};export const 加关联客户Action=f,改客户身份Action=f,解除关联客户Action=f,加关联联系人Action=f,改联系人角色立场Action=f,解除关联联系人Action=f,搜项目联系人=async()=>[];`);
  stub(/^\.\.\/\.\.\/favorites$/, `export const 切换项目收藏=async()=>({ok:true,收藏了:true});`);
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[];");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ProjectDetail from '@/app/(app)/projects/[id]/ProjectDetail';import FollowAttachments from '@/components/FollowAttachments';import AttachmentsPanel from '@/components/AttachmentsPanel';
    import {切换视图Provider} from '@/components/ViewAsContext';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 长='超长项目名字'.repeat(8), 串='X'.repeat(300), 字='很长的一段正文没有换行'.repeat(40);
    const 成交钱={dealDemand:'需求'+字,contractAmount:1234567.89,contractCurrency:'USD',depositAmount:1000,depositCurrency:'CNY'};
    const 基={id:'p1',name:长,remark:'备注'+字,amount:1234567.89,currency:'CNY',customer:{id:'c1',name:'超长客户名'+串,school:'某某超长公司名有限公司'.repeat(4)},contact:{id:'k1',name:'张三',position:'采购总监'},
      来源线索:null,原因选项:{回收:[],无效:[]},ownerId:'qa',ownerName:'组长甲',creatorName:'组长甲',createdAt:'2026-10-01T00:00:00.000Z',historyOwners:[],
      phase:'商机',node:'方案报价',result:null,exceptionReason:null,exceptionCategory:null,pooled:false,能放公海:false,能领取:false,领取不给:null,进公海:null,出口叫法:{},有效沟通差:[],
      nextStepAt:'2026-11-01',回收日:null,expectedDealAt:'2026-12-01',要下一步:true,必填:null,不给推:null,能改节点:true,能转让:true,
      balanceSettled:false,balanceSettledBy:null,balanceSettledAt:null,acceptancePassed:false,acceptancePassedBy:null,acceptancePassedAt:null,logs:[],
      followUps:[{id:'f1',type:'PHONE',method:null,initiator:null,content:'沟通内容'+字,occurredAt:'2026-10-03T02:00:00.000Z',who:'组长甲',node:'方案报价',code:'FUL0001',提醒:null,版本:'v1',我记的:true,附件:[]}],
      members:[],删前清点:{留痕:0,组员:0,沟通:1},企业版:true,能记沟通:true,可改沟通:true,可删沟通:true,提成:null,level:'A',成交钱,项目新字段:{painPoints:'痛点'+字,contractStatus:'起草中'},所在地:{addrCountry:'中国',addrProvince:'广东省',addrCity:'深圳市',addrDistrict:'南山区',location:''},项目来源:{name:'渠道',跟客户:true},channelId:null,已立项天数:3,渠道们:[],aiEnabled:false};
    const 包=(x)=><ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>{x}</BusinessProvider></App></ConfigProvider>;
    window.__详情=(x,能改=true)=>root.render(包(<ProjectDetail p={{...基,...x}} 能改={能改} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={null}/>));
    window.__视图详情=(x)=>root.render(包(<切换视图Provider value={true}><ProjectDetail p={{...基,...x}} 能改={true} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={null}/></切换视图Provider>));
    const 附=(id,mime='application/pdf')=>({id,name:id+'.pdf',mime,size:10,有文件:true,createdAt:'2026-10-01'});
    window.__附=附;
    window.__沟通附件=(附件,能传=true)=>root.render(包(<FollowAttachments followUpId='f1' 附件={附件} 能传={能传} 能删 on变了={()=>{window.__变了=(window.__变了||0)+1;}}/>));
    window.__面板=()=>root.render(包(<AttachmentsPanel 归属={{projectId:'p1'}} 分类='合同' 紧凑 on变了={()=>{window.__变了=(window.__变了||0)+1;}}/>));
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 窗 = Window & Record<string, unknown> & { __详情: (x?: object, 能改?: boolean) => void; __视图详情: (x?: object) => void; __沟通附件: (a: object[], 能传?: boolean) => void; __面板: () => void; __附: (id: string) => object };
async function 开(w = 1280) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://proj.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://proj.test/projects/p1"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  return { page, errors };
}
const 详情 = async (page: Page, x: object = {}, 能改 = true) => {
  await page.evaluate(([a, b]) => (window as unknown as 窗).__详情(a as object, b as boolean), [x, 能改] as const);
  await page.getByText("进程变更").first().waitFor();
};
const 格 = (page: Page, 名: string) => page.locator(`[data-inline-field="${名}"]`);
const 笔 = (page: Page, 名: string) => page.getByRole("button", { name: `改${名}`, exact: true });
const 编辑记录 = (page: Page) => page.evaluate(() => (window as unknown as 窗).__编辑 as unknown[][] | undefined);
const 全部入口 = ["级别", "金额", "定金金额", "合同金额", "合同状态", "需求描述", "痛点标注", "预计成交", "备注", "沟通内容"];

it("能改的人：项目卡各格、沟通正文都有入口；项目卡右上那颗编辑项目还在", async () => {
  const { page, errors } = await 开();
  try {
    await 详情(page);
    for (const 名 of 全部入口) expect(await 笔(page, 名).count(), 名).toBe(1);
    expect(await page.locator(".proj-side").getByRole("button", { name: "编辑项目" }).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("没权限：只读角色、公海、不是企业版，DOM 里都没有就地改的入口，值照样看得到", async () => {
  const { page } = await 开();
  try {
    await 详情(page, { 可改沟通: false, 可删沟通: false, 能记沟通: false }, false);
    expect(await page.locator(".proj-inline-pen, .proj-inline, .proj-inline-edit").count()).toBe(0);
    expect(await page.locator(".proj-side").innerText()).toContain("起草中");
    // 没权限时点值不进入编辑
    await page.getByText("起草中").click();
    expect(await page.locator(".proj-inline-edit").count()).toBe(0);
    await 详情(page, { pooled: true, 可改沟通: false, 能记沟通: false });
    expect(await page.locator(".proj-inline-pen").count()).toBe(0);
    await 详情(page, { 企业版: false, 能记沟通: false, 可改沟通: false });
    expect(await page.locator(".proj-inline-pen").count()).toBe(0);
  } finally { await page.close(); }
});

it("切换视图中：能改的人也没有就地改入口，值照样看得到", async () => {
  const { page } = await 开();
  try {
    await page.evaluate(() => (window as unknown as 窗).__视图详情({}));
    await page.getByText("进程变更").first().waitFor();
    expect(await page.locator(".proj-inline-pen, .proj-inline, .proj-inline-edit").count()).toBe(0);
    expect(await page.locator(".proj-side").innerText()).toContain("起草中");
  } finally { await page.close(); }
});

it("字段权限只能看的格没入口，别的格还在", async () => {
  const { page } = await 开();
  try {
    await 详情(page, { 只能看字段: ["商机金额", "痛点标注"] });
    for (const 名 of ["金额", "定金金额", "合同金额", "需求描述", "痛点标注"]) expect(await 笔(page, 名).count(), 名).toBe(0);
    for (const 名 of ["级别", "合同状态", "预计成交", "备注", "沟通内容"]) expect(await 笔(page, 名).count(), 名).toBe(1);
  } finally { await page.close(); }
});

it("改备注：不跳页；⌘↵ 存；只交这一格；存完马上显示新值，焦点回到笔上", async () => {
  const { page } = await 开();
  try {
    await 详情(page);
    const url = page.url();
    await 笔(page, "备注").click();
    const 框 = page.getByRole("textbox", { name: "备注" });
    await 框.fill("  新的备注  ");
    await 框.press("Control+Enter");
    await page.getByText("新的备注").waitFor();
    expect(page.url()).toBe(url);
    expect(await 编辑记录(page)).toEqual([["p1", { remark: "新的备注" }]]);
    expect(await 格(page, "备注").innerText()).toBe("新的备注");
    expect(await 框.count()).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("改备注");
    expect(await page.evaluate(() => (window as unknown as 窗).__刷新)).toBe(1);
    // refresh 带回新 props：听服务端
    await 详情(page, { remark: "服务端规整后的" });
    await 格(page, "备注").getByText("服务端规整后的").waitFor();
    expect(await page.getByText("新的备注").count()).toBe(0);
  } finally { await page.close(); }
});

it("保存失败：留在编辑态、输入不丢、行内写原因；再存成功后错误消失", async () => {
  const { page } = await 开();
  try {
    await 详情(page);
    await page.evaluate(() => { (window as unknown as 窗).__下次结果 = { ok: false, error: "字段权限：只能看" }; });
    await 笔(page, "需求描述").click();
    const 框 = page.getByRole("textbox", { name: "需求描述" });
    await 框.fill("我打了很多字");
    await 格(page, "需求描述").getByRole("button", { name: /保\s*存/ }).click();
    await 格(page, "需求描述").getByRole("alert").getByText("字段权限：只能看").waitFor();
    expect(await 框.inputValue()).toBe("我打了很多字");
    // 抛错（断网）也一样
    await page.evaluate(() => { (window as unknown as 窗).__下次结果 = "抛"; });
    await 格(page, "需求描述").getByRole("button", { name: /保\s*存/ }).click();
    await 格(page, "需求描述").getByRole("alert").getByText("没存上，请稍后再试").waitFor();
    expect(await 框.inputValue()).toBe("我打了很多字");
    await page.evaluate(() => { (window as unknown as 窗).__下次结果 = null; });
    await 格(page, "需求描述").getByRole("button", { name: /保\s*存/ }).click();
    await page.getByText("我打了很多字").waitFor();
    expect(await 格(page, "需求描述").getByRole("alert").count()).toBe(0);
  } finally { await page.close(); }
});

it("Esc 放弃、取消：不存；再打开是原值；没改就保存不发请求", async () => {
  const { page } = await 开();
  try {
    await 详情(page, { remark: "原备注" });
    await 笔(page, "备注").click();
    const 框 = page.getByRole("textbox", { name: "备注" });
    await 框.fill("不要了");
    await 框.press("Escape");
    expect(await 框.count()).toBe(0);
    expect(await 格(page, "备注").innerText()).toContain("原备注");
    await 笔(page, "备注").click();
    expect(await 框.inputValue()).toBe("原备注");
    await 格(page, "备注").getByRole("button", { name: /保\s*存/ }).click();
    expect(await 框.count()).toBe(0);
    expect(await 编辑记录(page)).toBeUndefined();
  } finally { await page.close(); }
});

it("多行框里普通回车是换行、不提交；存着时连按不重复存", async () => {
  const { page } = await 开();
  try {
    await 详情(page);
    await page.evaluate(() => { (window as unknown as 窗).__慢 = 150; });
    await 笔(page, "备注").click();
    const 框 = page.getByRole("textbox", { name: "备注" });
    await 框.fill("第一行");
    await 框.press("Enter");
    expect(await 框.count()).toBe(1);
    expect(await 编辑记录(page)).toBeUndefined();
    await 框.type("第二行");
    await page.evaluate(() => {
      const t = document.querySelector('[data-inline-field="备注"] textarea')!;
      for (let i = 0; i < 3; i++) t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });
    await page.getByText("第二行").waitFor();
    expect(await 编辑记录(page)).toEqual([["p1", { remark: "第一行\n第二行" }]]);
  } finally { await page.close(); }
});

it("中文输入法选字时的回车、Esc 不算（金额这种单行回车存的格子也不提交）", async () => {
  const { page } = await 开();
  try {
    await 详情(page);
    await 笔(page, "金额").click();
    const 框 = page.getByRole("spinbutton", { name: "金额", exact: true });
    await 框.fill("77");
    await 框.evaluate((el) => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }));
    });
    expect(await 框.count()).toBe(1);
    expect(await 编辑记录(page)).toBeUndefined();
    await 框.press("Enter");
    await 格(page, "金额").getByText(/77/).waitFor();
    expect(await 编辑记录(page)).toEqual([["p1", { amount: 77, currency: "CNY" }]]);
  } finally { await page.close(); }
});

it("下拉：选了就存；级别能清空", async () => {
  const { page } = await 开();
  try {
    await 详情(page);
    await 笔(page, "合同状态").click();
    await page.locator(".ant-select-dropdown").getByText("已生效", { exact: true }).click();
    await 格(page, "合同状态").getByText("已生效").waitFor();
    expect(await 编辑记录(page)).toEqual([["p1", { contractStatus: "已生效" }]]);
    await 笔(page, "级别").click();
    await 格(page, "级别").hover();
    await 格(page, "级别").locator(".ant-select-clear").click();
    await page.waitForFunction(() => ((window as unknown as 窗).__编辑 as unknown[]).length === 2);
    expect((await 编辑记录(page))![1]).toEqual(["p1", { level: null }]);
  } finally { await page.close(); }
});

it("合同状态：下拉第一项是「—」，选了交 null、格里写「—」（11-04 用户：空值统一「—」、能回到「—」）", async () => {
  const { page } = await 开();
  try {
    await 详情(page);
    await 笔(page, "合同状态").click();
    await page.locator(".ant-select-dropdown").getByText("已生效", { exact: true }).click();
    await 格(page, "合同状态").getByText("已生效").waitFor();
    await 笔(page, "合同状态").click();
    const 项 = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
    await expect.poll(() => 项.first().innerText(), { timeout: 10_000 }).toBe("—");
    await 项.first().click();
    await page.waitForFunction(() => ((window as unknown as 窗).__编辑 as unknown[]).length === 2);
    expect((await 编辑记录(page))![1]).toEqual(["p1", { contractStatus: null }]);
    await 格(page, "合同状态").locator('[data-empty="合同状态"]').waitFor();
  } finally { await page.close(); }
});

it("沟通正文：只交正文 + 原样的类型时间 + 版本；空的挡；失败（版本冲突）留草稿，也刷新拿新版本", async () => {
  const { page } = await 开();
  try {
    await 详情(page);
    await 笔(page, "沟通内容").click();
    const 框 = page.getByRole("textbox", { name: "沟通内容" });
    await 框.fill("   ");
    await 框.press("Control+Enter");
    await 格(page, "沟通内容").getByRole("alert").getByText("请填写这次沟通的内容").waitFor();
    await page.evaluate(() => { (window as unknown as 窗).__下次结果 = { ok: false, error: "别人刚改过，刷新后再改" }; });
    await 框.fill("新正文");
    await 框.press("Control+Enter");
    await 格(page, "沟通内容").getByRole("alert").getByText("别人刚改过").waitFor();
    expect(await 框.inputValue()).toBe("新正文");
    expect(await page.evaluate(() => (window as unknown as 窗).__刷新)).toBe(1);
    const 交 = await page.evaluate(() => (window as unknown as 窗).__改沟通 as [string, string, Record<string, unknown>][]);
    expect(交[0][0]).toBe("p1");
    expect(交[0][1]).toBe("f1");
    expect(交[0][2]).toMatchObject({ type: "PHONE", content: "新正文", 版本: "v1" });
    expect(交[0][2].occurredAt).toMatch(/^2026-10-03 \d\d:\d\d/);
    // 刷新带回新版本：草稿还在，再存带新版本
    await page.evaluate(() => { (window as unknown as 窗).__下次结果 = null; });
    await page.evaluate(() => (window as unknown as 窗).__详情({ followUps: [{ id: "f1", type: "PHONE", method: null, initiator: null, content: "别人改的", occurredAt: "2026-10-03T02:00:00.000Z", who: "组长甲", node: "方案报价", code: "FUL0001", 提醒: null, 版本: "v2", 我记的: true, 附件: [] }] }));
    expect(await 框.inputValue()).toBe("新正文");
    await 框.press("Control+Enter");
    await 格(page, "沟通内容").getByText("新正文").waitFor();
    const 再交 = await page.evaluate(() => (window as unknown as 窗).__改沟通 as [string, string, Record<string, unknown>][]);
    expect(再交[1][2]).toMatchObject({ content: "新正文", 版本: "v2" });
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：超长内容平时、编辑态都不溢出；笔、保存点得中", async (w) => {
  const { page, errors } = await 开(w);
  try {
    await 详情(page);
    const 溢出 = () => page.evaluate(() => ({ 页: document.documentElement.scrollWidth - innerWidth, 卡: [...document.querySelectorAll(".proj-side .ant-card, .proj-main .ant-card")].filter(c => c.scrollWidth > c.clientWidth + 1).length }));
    expect(await 溢出()).toEqual({ 页: expect.any(Number), 卡: 0 });
    expect((await 溢出()).页).toBeLessThanOrEqual(0);
    for (const 名 of ["金额", "定金金额", "需求描述", "备注", "沟通内容"]) {
      await 笔(page, 名).evaluate((e: HTMLElement) => e.click());
      const 里 = 格(page, 名);
      await 里.getByRole("button", { name: /保\s*存/ }).waitFor();
      const 量 = await 里.evaluate((el) => {
        const 外 = el.closest(".ant-card")!.getBoundingClientRect();
        const 超 = [...el.querySelectorAll("*")].filter(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.right > 外.right + 0.5; }).length;
        const 钮 = [...el.querySelectorAll("button")].find(b => /保\s*存/.test(b.textContent ?? ""))!;
        钮.scrollIntoView({ block: "center" });
        const r = 钮.getBoundingClientRect();
        const 顶 = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { 超, 点得中: !!顶 && (顶 === 钮 || 钮.contains(顶)) };
      });
      expect(量, 名).toEqual({ 超: 0, 点得中: true });
      expect((await 溢出()).页, 名).toBeLessThanOrEqual(0);
      await 里.getByRole("button", { name: /取\s*消/ }).click();
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// —— 附件 ——
const 文件 = (名: string) => ({ name: 名, mimeType: 名.endsWith(".mp3") ? "audio/mpeg" : "application/pdf", buffer: Buffer.from("x") });
/** 接管 /api/attachments：POST 按次序回 结果们 里的（默认成功），GET 回 库 */
async function 接管附件(page: Page, opts: { 慢?: number; 失败?: (名: string) => string | null } = {}) {
  const 库: object[] = []; const 上传: string[] = []; let 读次数 = 0;
  await page.route("http://proj.test/api/attachments**", async (r) => {
    const u = new URL(r.request().url());
    if (r.request().method() === "DELETE") return r.fulfill({ json: { ok: true } });
    if (r.request().method() === "GET") { 读次数++; return r.fulfill({ json: { 附件: 库 } }); }
    const 名 = u.searchParams.get("name") ?? "";
    上传.push(名);
    if (opts.慢) await new Promise(k => setTimeout(k, opts.慢));
    const 错 = opts.失败?.(名);
    if (错) return r.fulfill({ status: 400, json: { error: 错 } });
    const a = { id: `id-${名}`, name: 名, mime: "application/pdf", size: 1, 有文件: true, createdAt: "2026-10-01" };
    库.push(a);
    return r.fulfill({ json: { 附件: a } });
  });
  return { 上传, 读次数: () => 读次数 };
}

it("沟通附件：传完不用 refresh 就出现；传着按钮灰、不能重复点；一批只通知外面一次", async () => {
  const { page, errors } = await 开();
  try {
    const { 上传 } = await 接管附件(page, { 慢: 200 });
    await page.evaluate(() => (window as unknown as 窗).__沟通附件([]));
    const 钮 = page.getByRole("button", { name: /加截图/ });
    await page.locator('input[type="file"]').setInputFiles([文件("a.mp3"), 文件("b.mp3")]);
    await page.getByText(/正在传 2 个/).waitFor();
    expect(await 钮.isDisabled()).toBe(true);
    await page.getByTitle("a.mp3").waitFor();
    await page.getByTitle("b.mp3").waitFor();
    expect(上传.sort()).toEqual(["a.mp3", "b.mp3"]);
    expect(await 钮.isDisabled()).toBe(false);
    expect(await page.getByText(/正在传/).count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as 窗).__变了)).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("沟通附件：传失败报原因、按钮恢复、列表不多东西、不通知外面；再传能成", async () => {
  const { page } = await 开();
  try {
    await 接管附件(page, { 失败: (名) => (名 === "坏.mp3" ? "这个文件太大了" : null) });
    await page.evaluate(() => (window as unknown as 窗).__沟通附件([]));
    await page.locator('input[type="file"]').setInputFiles([文件("坏.mp3")]);
    await page.getByText("这个文件太大了").waitFor();
    expect(await page.getByRole("button", { name: /加截图/ }).isDisabled()).toBe(false);
    expect(await page.locator(".follow-att-file").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as 窗).__变了)).toBeUndefined();
    await page.locator('input[type="file"]').setInputFiles([文件("好.mp3")]);
    await page.getByTitle("好.mp3").waitFor();
    expect(await page.evaluate(() => (window as unknown as 窗).__变了)).toBe(1);
  } finally { await page.close(); }
});

it("沟通附件：挂载时空、props 后到也进得来（记沟通时先挂行、传完才 refresh）；到了不重复；删掉的不被旧 props 带回来", async () => {
  const { page } = await 开();
  try {
    const 后到 = () => page.evaluate(() => { const x = window as unknown as 窗; x.__沟通附件([x.__附("后到"), { ...x.__附("c"), id: "id-c.mp3", name: "c.mp3" }]); });
    await page.evaluate(() => (window as unknown as 窗).__沟通附件([]));
    await page.evaluate(() => { const x = window as unknown as 窗; x.__沟通附件([x.__附("后到")]); });
    await page.getByTitle("后到.pdf").waitFor();
    await 接管附件(page);
    await page.locator('input[type="file"]').setInputFiles([文件("c.mp3")]);
    await page.getByTitle("c.mp3").waitFor();
    // 刚传的 + 服务端带回同一个：只一行
    await 后到();
    await page.waitForTimeout(50);
    expect(await page.getByTitle("c.mp3").count()).toBe(1);
    // 删掉；refresh 回来之前又来一遍旧 props：不回来
    await page.getByRole("button", { name: "删掉 后到.pdf" }).click();
    await page.locator(".ant-popconfirm").getByRole("button", { name: /删\s*掉/ }).click();
    await page.getByTitle("后到.pdf").waitFor({ state: "detached" });
    await 后到();
    await page.waitForTimeout(50);
    expect(await page.getByTitle("后到.pdf").count()).toBe(0);
    expect(await page.getByTitle("c.mp3").count()).toBe(1);
    expect(await page.evaluate(() => (window as unknown as 窗).__变了)).toBe(2);
  } finally { await page.close(); }
});

it("项目附件格：传完马上出现、不用刷新；传着灰；失败报原因；一批只通知一次", async () => {
  const { page } = await 开();
  try {
    await 接管附件(page, { 慢: 150, 失败: (名) => (名 === "坏.pdf" ? "没传上" : null) });
    await page.evaluate(() => (window as unknown as 窗).__面板());
    await page.getByText("还没有附件").waitFor();
    const 钮 = page.getByRole("button", { name: /上传/ });
    await page.locator('input[type="file"]').setInputFiles([文件("甲.pdf"), 文件("乙.pdf")]);
    await page.getByText(/正在传 2 个/).waitFor();
    expect(await 钮.isDisabled()).toBe(true);
    await page.getByTestId("attachment-item").nth(1).waitFor();
    expect(await page.getByTestId("attachment-item").count()).toBe(2);
    await page.waitForFunction(() => (window as unknown as 窗).__变了 === 1);
    expect(await 钮.isDisabled()).toBe(false);
    await page.locator('input[type="file"]').setInputFiles([文件("坏.pdf")]);
    await page.getByText("没传上").waitFor();
    expect(await page.getByTestId("attachment-item").count()).toBe(2);
    expect(await 钮.isDisabled()).toBe(false);
    expect(await page.evaluate(() => (window as unknown as 窗).__变了)).toBe(1);
  } finally { await page.close(); }
});
