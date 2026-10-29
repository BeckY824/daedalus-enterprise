import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* 10-27 会议：企业版项目详情两栏——左边干活的（节点、沟通、卡点），右边资料（项目、交付、项目组、提成、节点变更）；
   「记一条沟通」是主按钮；窄于 880 的容器退一栏。开关关闭时照原来一列摆、960 宽、没有提成和「记一条沟通」主按钮 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "project-detail-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\.\/actions$/, `const f=${空跑};export const 改项目节点=f,勾项目交付=f,删除项目=f,放回项目公海=f,领取项目=f,记项目沟通Action=f,判MQLAction=f,编辑项目=f,改项目画像Action=f,加项目组员=f,换项目组员角色=f,移出项目组员=f;`);
  stub(/^\.\.\/commission-actions$/, `const f=${空跑};export const 存项目底价=f,存提成分配=f,更正实际提成=f;`);
  stub(/^\.\/blocker-actions$/, `const f=${空跑};export const 发布卡点Action=f,指认卡点Action=f,认领卡点Action=f,接受卡点Action=f,转让卡点Action=f,返回卡点Action=f,改卡点进度Action=f,解决卡点Action=f,卡点可选的人Action=async()=>[];`);
  stub(/customers\/\[id\]\/ai$/, `export const parseFollowUpDraft=async()=>({ok:false,error:"未启用"});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ProjectDetail from '@/app/(app)/projects/[id]/ProjectDetail';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
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
    window.__render=(企业)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <ProjectDetail p={{...基,企业版:企业,能记沟通:企业,提成:企业?提成:null,...(企业?{项目来源:{name:'渠道'+串,跟客户:true},channelId:null,已立项天数:28,渠道们:[],aiEnabled:true}:{})}} 能改={true} 候选={[]} 在职={[]} 联系人们={[]} 角色们={[]} 类别们={[]} 卡点={企业?{们:[],能发:true,默认:{},人们:[]}:null}/>
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(企业: boolean, width = 1366, 外宽?: number) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://proj.test/**", r => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><div id='root'${外宽 ? ` style='width:${外宽}px'` : ""}></div>` }));
  await page.goto("http://proj.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(e => (window as unknown as { __render: (x: boolean) => void }).__render(e), 企业);
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
    const 记 = page.getByRole("button", { name: "记一条沟通" });
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
    for (const name of ["记一条沟通", "AI 录入", "编辑"]) {
      const box = await page.getByRole("button", { name }).first().boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(w);
      const 点中 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box!.x + box!.width / 2, box!.y + box!.height / 2]);
      expect(点中.replace(/\s/g, "")).toBe(name.replace(/\s/g, ""));
    }
  } finally { await page.close(); }
});

it("企业版 P6：项目卡有已立项、项目来源（跟客户来源时注明）；「AI 录入」打开记一条、AI 那格先摆出来，只预填不写", async () => {
  const { page, errors } = await open(true);
  try {
    const 项目卡 = await page.locator(".proj-side > .ant-card").filter({ hasText: "项目来源" }).first().innerText();
    expect(项目卡).toContain("28 天");
    expect(项目卡).toMatch(/同.+来源/);
    await page.getByRole("button", { name: "AI 录入" }).click();
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
    await page.getByRole("button", { name: "记一条沟通" }).click();
    await page.getByRole("button", { name: "用 AI 从原话预填" }).waitFor();
    expect(await page.getByRole("textbox", { name: "沟通原话" }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("容器窄于 880（开着 AI 侧栏）：退成一栏，干活的在上", async () => {
  const { page } = await open(true, 1366, 800);
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
