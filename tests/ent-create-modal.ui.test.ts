/**
 * 新建弹窗（P-界面-36，11-15 用户：「之前是填入手机号客户名……不用分5步」「该选的，只不过我们会默认一个值」「没有开项目，就只能算客户沟通」）。
 *
 *   一个表单分三段（客户 / 项目 / 首条沟通），没有「下一步」；项目是开关：客户页「新建客户」默认关，新线索开着并锁住
 *   默认值：项目负责人 = 我（P-界面-33）；下一步时间 = 3 天后（P-界面-34）
 *   号码、客户名离开输入框自动查重；按钮不变灰，点了就地标红缺的格、写「还差 N 项」
 *   没开项目：走「只建客户」（客户沟通、客户业务线），不交项目
 *   销售选自动分配：就地黄条 + 按钮「建好并分出去」，不叠确认框
 *   Windows 1024 / 1280 / 1366 + 超长客户名：弹窗里不横向溢出，「建好」在可视区点得中
 *   市场成员选自动分配（P-转-26，用户 11-17）：业务线那格换成只读「按客户区域自动定」，不交业务线；三档宽度不溢出
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ent-create-modal", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷新=(window.__刷新??0)+1},push(u){(window.__跳=window.__跳??[]).push(u)},replace(){}});export const usePathname=()=>'/customers';");
  stub(/^next\/link$/, "export default function L({href,children,prefetch,...p}){return <a href={href} {...p}>{children}</a>}");
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>window.__习惯??null;");
  // 建档两个 server action：记下交了什么，回成功
  stub(/^\.\.\/actions$/, "export const 建档向导=async(x)=>{(window.__调||=[]).push(['建档向导',x]);return window.__回??{ok:true,customerId:'c1',projectId:'p1'}};export const 建档只建客户=async(x)=>{(window.__调||=[]).push(['建档只建客户',x]);return {ok:true,customerId:'c2',projectId:null}};");
  stub(/customers\/actions$/, "export const checkDuplicate=async()=>null;export const 推荐人候选=async()=>[];");
  stub(/(^|\/)number-actions$/, "export const 查号码=async(t,v)=>{(window.__调||=[]).push(['查号码',t,v]);return {ok:true,状态:'首次录入',提示:'首次录入',值:v,归属地:null}};export const 查客户名=async(n)=>{(window.__调||=[]).push(['查客户名',n]);return {ok:true,撞:null}};export const 申请挂靠=async()=>({ok:true});export const 从回收站捞回=async()=>({ok:true});");
  // 老客户新增项目（cr.old）：搜得到一位老客户；给客户建项目记下交了什么
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async(w)=>{(window.__调||=[]).push(['搜客户',w]);return [{id:'c9',name:'华东展具',附注:'138****5678'}]};");
  stub(/customers\/\[id\]\/project-actions$/, "export const 给客户建项目=async(x)=>{(window.__调||=[]).push(['给客户建项目',x]);return {ok:true,projectId:'np9'}};export const 新项目分配数据=async()=>({分配方式们:[],默认分配方式:0,是销售:false,客户业务线:'外贸',客户区域线:window.__区域线??null,客户有地址:!!window.__区域线});export const 建项目带走的项目=async()=>({项目数:0,项目:[]});");
  stub(/same-number-actions$/, "export const 同号协同录入=async()=>({ok:true});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {建档弹窗} from '@/app/(app)/projects/new/ProjectWizard';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    const 数据={users:[{id:'u1',name:'我自己',email:'a'},{id:'u2',name:'同事乙',email:'b'}],要下一步:false,企业:{渠道们:[],节点们:['潜客培育','线索验证','线索推进'],分配方式们:[{i:0,名:'指定分配'},{i:1,名:'自动分配'}],默认分配方式:0,是销售:!window.__市场,按区域:!!window.__市场,客户只给自己:false}};
    function 页(){const [开,set开]=React.useState(true);return <建档弹窗 open={开} 标题={window.__标题||'新增客户'} 项目={window.__开关||'关'} 数据={数据} onClose={()=>set开(false)}/>;}
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'u1',name:'我自己'}}><页/></我Provider></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"', "process.env.CRM_ENTERPRISE": '"1"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(w: number, 设: Record<string, unknown> = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: w, height: 800 } }); page.setDefaultTimeout(5000);
  await page.route("http://npm.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://npm.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.evaluate((s) => { localStorage.clear(); Object.assign(window, s); }, 设);
  await page.addScriptTag({ content: bundle });
  await page.getByRole("dialog").getByText("首条沟通").first().waitFor();
  return page;
}
const 调 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? []);
const 选 = async (page: Page, 标签: string, 项: string) => {
  await page.getByRole("dialog").getByLabel(标签, { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").getByTitle(项, { exact: true }).click();
};
const 三天后 = () => { const d = new Date(Date.now() + 3 * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

it("新建客户：一个表单、没有「下一步」；项目开关默认关、没有项目那几格；首条沟通标明算客户沟通；下一步时间默认 3 天后", async () => {
  const page = await 开(1280);
  try {
    const 框 = page.getByRole("dialog");
    expect(await 框.getByRole("button", { name: "下一步" }).count()).toBe(0);
    const 开关 = 框.getByRole("switch", { name: "有项目" });
    expect(await 开关.getAttribute("aria-checked")).toBe("false");
    expect(await 开关.isDisabled()).toBe(false);
    expect(await 框.getByLabel("项目名称").count()).toBe(0);
    await 框.getByText("没开项目，记成客户沟通").waitFor();
    expect(await 框.getByLabel("下一步时间").inputValue()).toBe(三天后());
    // 打开开关：项目那几格就地展开；项目负责人默认我（P-界面-33）
    await 开关.click();
    await 框.getByLabel("项目名称").waitFor();
    expect(await 框.locator("[data-ge='负责人']").innerText()).toContain("我自己");
  } finally { await page.close(); }
});

it("按钮不变灰：空着点「建好」就地标红、写「还差 N 项」，不交；填好一格那格的红字立刻消失", async () => {
  const page = await 开(1280);
  try {
    const 框 = page.getByRole("dialog");
    const 建好 = 框.getByRole("button", { name: /^建\s*好$/ });
    expect(await 建好.isDisabled()).toBe(false);
    await 建好.click();
    await 框.getByRole("status").filter({ hasText: /还差 \d+ 项/ }).waitFor();
    expect(await 框.locator("[data-ge='客户名'] [role=alert]").innerText()).toContain("请填写名称");
    expect((await 调(page)).filter((x) => String(x[0]).startsWith("建档")).length).toBe(0);
    await 框.getByLabel("客户名称").fill("华东展具");
    expect(await 框.locator("[data-ge='客户名'] [role=alert]").count()).toBe(0);
  } finally { await page.close(); }
});

it("没开项目：号码、客户名离开输入框自动查重；建好走「只建客户」，带客户业务线、下一步时间，不带项目；落到新客户页", async () => {
  const page = await 开(1280);
  try {
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("号码", { exact: true }).fill("13905712266");
    await 框.getByLabel("客户名称").click();
    await expect.poll(async () => (await 调(page)).some((x) => x[0] === "查号码")).toBe(true);
    await 框.getByText("首次录入").waitFor();
    await 框.getByLabel("客户名称").fill("华东展具");
    await 框.getByLabel("联系人姓名").click();
    await expect.poll(async () => (await 调(page)).some((x) => x[0] === "查客户名" && x[1] === "华东展具")).toBe(true);
    await 框.getByLabel("联系人姓名").fill("王总");
    await 选(page, "渠道触点", "公司资源");
    await 选(page, "业务线", "内贸");
    await 框.getByLabel("沟通内容").fill("客户要 3 套方案报价");
    await 框.getByRole("button", { name: /^建\s*好$/ }).click();
    await expect.poll(async () => (await 调(page)).find((x) => x[0] === "建档只建客户")).toBeTruthy();
    const 交 = (await 调(page)).find((x) => x[0] === "建档只建客户")![1] as { 客户: Record<string, unknown>; 跟进: Record<string, unknown>; 项目?: unknown };
    expect(交.项目).toBeUndefined();
    expect(交.客户).toMatchObject({ name: "华东展具", touchpoint: "公司资源", salesOwnerId: "u1", 企业资料: { bizLine: "内贸" } });
    expect(交.跟进).toMatchObject({ content: "客户要 3 套方案报价", 下一步时间: 三天后() });
    expect(交.跟进.节点).toBeUndefined();
    expect((await 调(page)).some((x) => x[0] === "建档向导")).toBe(false);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __跳?: string[] }).__跳 ?? [])).toEqual(["/customers/c2"]);
  } finally { await page.close(); }
});

it("新线索进来：项目开关开着并锁住；销售选自动分配就地黄条、按钮写明「建好并分出去」，不叠确认框", async () => {
  const page = await 开(1280, { __开关: "锁开", __标题: "新线索" });
  try {
    const 框 = page.getByRole("dialog");
    const 开关 = 框.getByRole("switch", { name: "有项目" });
    expect(await 开关.getAttribute("aria-checked")).toBe("true");
    expect(await 开关.isDisabled()).toBe(true);
    await 框.getByLabel("项目名称").waitFor();
    await 选(page, "分配方式", "自动分配");
    await 框.getByTestId("wizard-auto-warn").waitFor();
    expect(await 框.getByTestId("wizard-auto-warn").innerText()).toContain("分出去后你将看不到这个项目");
    await 框.getByRole("button", { name: "建好并分出去" }).waitFor();
    expect(await page.getByRole("dialog").count()).toBe(1);
  } finally { await page.close(); }
});

it("老客户新增项目（cr.old）：客户名直接搜到老客户，挑中后客户段收成一行、项目开关开着锁住；建好走「给客户建项目」，不新建客户，落到这位客户停在新项目", async () => {
  const page = await 开(1280, { __开关: "开", __标题: "新增项目" });
  try {
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("客户名称").fill("华东");
    const 项 = page.locator(".ant-select-dropdown:visible").getByText("华东展具", { exact: false }).first();
    await 项.waitFor();
    await page.locator(".ant-select-dropdown:visible").getByText(/新客户「华东」/).waitFor();
    await 项.click();
    const 一行 = 框.getByTestId("wizard-old-customer");
    await 一行.waitFor();
    expect(await 一行.innerText()).toContain("已有客户");
    expect(await 框.getByLabel("号码", { exact: true }).count()).toBe(0);
    expect(await 框.getByLabel("联系人姓名").count()).toBe(0);
    const 开关 = 框.getByRole("switch", { name: "有项目" });
    expect(await 开关.getAttribute("aria-checked")).toBe("true");
    expect(await 开关.isDisabled()).toBe(true);
    // 业务线默认带这位客户的
    await expect.poll(() => 框.locator("[data-ge='业务线']").innerText()).toContain("外贸");
    await 框.getByLabel("项目名称").fill("华东展具-二期");
    await 框.getByLabel("沟通内容").fill("老客户要加一套");
    await 框.getByRole("button", { name: /^建\s*好$/ }).click();
    await expect.poll(async () => (await 调(page)).find((x) => x[0] === "给客户建项目")).toBeTruthy();
    const 交 = (await 调(page)).find((x) => x[0] === "给客户建项目")![1] as { customerId: string; 项目: Record<string, unknown>; 跟进: Record<string, unknown> };
    expect(交).toMatchObject({ customerId: "c9", 项目: { name: "华东展具-二期", ownerId: "u1", 业务线: "外贸" }, 跟进: { content: "老客户要加一套", 节点: "潜客培育" } });
    expect((await 调(page)).some((x) => x[0] === "建档向导" || x[0] === "建档只建客户" || x[0] === "查号码")).toBe(false);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __跳?: string[] }).__跳 ?? [])).toEqual(["/customers/c9?project=np9&landed=1"]);
  } finally { await page.close(); }
});

it("挑了老客户点「换」：回到新客户那几格，开关照入口恢复可点", async () => {
  const page = await 开(1280, { __开关: "关" });
  try {
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("客户名称").fill("华东");
    await page.locator(".ant-select-dropdown:visible").getByText("华东展具", { exact: false }).first().click();
    await 框.getByTestId("wizard-old-customer").waitFor();
    await 框.getByRole("button", { name: "换" }).click();
    await 框.getByLabel("号码", { exact: true }).waitFor();
    expect(await 框.getByRole("switch", { name: "有项目" }).isDisabled()).toBe(false);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx + 超长客户名：弹窗里不横向溢出，「建好」在可视区、点得中", async (w) => {
  const page = await 开(w, { __开关: "开" });
  try {
    const 框 = page.getByRole("dialog");
    const 长 = "某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购中心第二分部";
    await 框.getByLabel("客户名称").fill(长);
    await 框.getByLabel("项目名称").fill(长.slice(0, 60));
    await 框.getByRole("button", { name: /^建\s*好$/ }).click();
    const 量 = await page.evaluate(() => {
      const s = document.querySelector(".cr-sheet") as HTMLElement;
      const body = document.querySelector(".ant-modal-body") as HTMLElement;
      const btn = [...document.querySelectorAll(".cr-foot button")].pop() as HTMLElement;
      btn.scrollIntoView({ block: "nearest" });
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { 表: s.scrollWidth - s.clientWidth, 体: body.scrollWidth - body.clientWidth, 页: document.documentElement.scrollWidth - window.innerWidth, 点得中: !!hit && btn.contains(hit), 右: r.right <= window.innerWidth };
    });
    expect(量).toEqual({ 表: 0, 体: 0, 页: 0, 点得中: true, 右: true });
  } finally { await page.close(); }
});

// 多个号码（员工反馈「客户会留多个电话或者微信号，需要可以新增多个添加框」）：第一行下面「加一个号码」，类型 + 号码 + 去掉；
// 新行类型默认跟第一行（类型表同 AI 新线索卡，号码类型字典八种）；连第一行最多 20 行；交的时候空行丢掉、跟着主要联系人交（联系人.号码们），第一行照旧是 企业号码
it("多个号码：加一行类型默认跟第一行、能改类型、能去掉；空行不交；只填第一行不带 号码们", async () => {
  const page = await 开(1280);
  try {
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("号码", { exact: true }).fill("13905712266");
    const 第一行类型 = await 框.locator("[data-ge='号码'] .ant-select").first().innerText();
    const 加 = 框.getByRole("button", { name: "加一个号码" });
    // 刚填完第一行号码会再渲染一次（查重提示），紧跟着的一下点击可能落空：点到第 2 行出来为止
    await expect.poll(async () => {
      if ((await 框.getByLabel("第 2 个号码", { exact: true }).count()) === 0) await 加.click();
      return 框.getByLabel("第 2 个号码", { exact: true }).count();
    }).toBe(1);
    // 多加的行用号码类型字典的叫法（同 AI 新线索卡）：第一行「手机号」→ 新行「手机」
    expect(await 框.locator("[data-testid='wizard-more-numbers'] .ant-select").first().innerText()).toBe("手机");
    await 框.getByLabel("第 2 个号码", { exact: true }).fill("13905712267");
    await 加.click();
    await 选(page, "第 3 个号码类型", "微信");
    await 框.getByLabel("第 3 个号码", { exact: true }).fill("wx_buyer01");
    await 加.click();
    await 加.click();
    // 第 5 行填了再去掉，第 4 行空着
    await 框.getByLabel("第 5 个号码", { exact: true }).fill("要去掉的");
    await 框.getByRole("button", { name: "去掉第 5 个号码" }).click();
    expect(await 框.getByLabel("第 5 个号码", { exact: true }).count()).toBe(0);
    await 框.getByLabel("客户名称").fill("华东展具");
    await 框.getByLabel("联系人姓名").fill("王总");
    await 选(page, "渠道触点", "公司资源");
    await 选(page, "业务线", "内贸");
    await 框.getByLabel("沟通内容").fill("客户留了两个手机一个微信");
    await 框.getByRole("button", { name: /^建\s*好$/ }).click();
    await expect.poll(async () => (await 调(page)).find((x) => x[0] === "建档只建客户")).toBeTruthy();
    const 交 = (await 调(page)).find((x) => x[0] === "建档只建客户")![1] as { 客户: Record<string, unknown>; 联系人: Record<string, unknown> };
    // 第一行照旧是 企业号码（默认手机号）；多加的跟着联系人交，空行、去掉的不在里面
    expect(第一行类型).toBe("手机号");
    expect(交.客户.企业号码).toEqual({ 类型: "手机号", 值: "13905712266" });
    expect(交.联系人.号码们).toEqual([{ kind: "phone", value: "13905712267" }, { kind: "wechat", value: "wx_buyer01" }]);
  } finally { await page.close(); }
});

it("多个号码：只填第一行时不带 号码们；连第一行 20 行后「加一个号码」不再摆", async () => {
  const page = await 开(1280);
  try {
    const 框 = page.getByRole("dialog");
    const 加 = 框.getByRole("button", { name: "加一个号码" });
    for (let i = 0; i < 19; i++) await 加.click();
    expect(await 框.getByLabel("第 20 个号码", { exact: true }).count()).toBe(1);
    expect(await 加.count()).toBe(0);
    await 框.getByRole("button", { name: "去掉第 20 个号码" }).click();
    await 加.waitFor();
    // 空行全不交：只填第一行的照旧没有 号码们
    await 框.getByLabel("号码", { exact: true }).fill("13905712266");
    await 框.getByLabel("客户名称").fill("华东展具");
    await 框.getByLabel("联系人姓名").fill("王总");
    await 选(page, "渠道触点", "公司资源");
    await 选(page, "业务线", "内贸");
    await 框.getByLabel("沟通内容").fill("只留了一个号");
    await 框.getByRole("button", { name: /^建\s*好$/ }).click();
    await expect.poll(async () => (await 调(page)).find((x) => x[0] === "建档只建客户")).toBeTruthy();
    const 交 = (await 调(page)).find((x) => x[0] === "建档只建客户")![1] as { 联系人: Record<string, unknown> };
    expect("号码们" in 交.联系人).toBe(false);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx + 多个超长号码：弹窗里不横向溢出，每行类型、号码、去掉都在框里", async (w) => {
  const page = await 开(w, { __开关: "开" });
  try {
    const 框 = page.getByRole("dialog");
    const 加 = 框.getByRole("button", { name: "加一个号码" });
    for (let i = 0; i < 3; i++) await 加.click();
    for (let i = 2; i <= 4; i++) await 框.getByLabel(`第 ${i} 个号码`, { exact: true }).fill("very.long.purchasing.mailbox.name@example-supplier-company-with-long-name.com");
    const 量 = await page.evaluate(() => {
      const s = document.querySelector(".cr-sheet") as HTMLElement;
      const body = document.querySelector(".ant-modal-body") as HTMLElement;
      const 块 = document.querySelector("[data-testid='wizard-more-numbers']") as HTMLElement;
      const 块框 = 块.getBoundingClientRect();
      const 出格 = [...块.querySelectorAll(".ant-space-compact > *")].filter((e) => { const r = e.getBoundingClientRect(); return r.right > 块框.right + 0.5 || r.left < 块框.left - 0.5; }).length;
      return { 表: s.scrollWidth - s.clientWidth, 体: body.scrollWidth - body.clientWidth, 页: document.documentElement.scrollWidth - window.innerWidth, 出格 };
    });
    expect(量, `${w}`).toEqual({ 表: 0, 体: 0, 页: 0, 出格: 0 });
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx 市场成员选自动分配：业务线换成只读「按客户区域自动定」、没有下拉，不溢出", async (w) => {
  const page = await 开(w, { __开关: "锁开", __标题: "新线索", __市场: true });
  try {
    const 框 = page.getByRole("dialog");
    expect(await 框.getByTestId("wizard-bizline").count()).toBe(1);
    await 选(page, "分配方式", "自动分配");
    const 只读 = 框.getByTestId("wizard-bizline-auto");
    await 只读.waitFor();
    expect(await 只读.innerText()).toContain("客户没填区域，按全部销售分配，建议补区域");
    expect(await 框.getByTestId("wizard-bizline").count()).toBe(0);
    // 市场不是销售：没有「分出去后看不到」黄条
    expect(await 框.getByTestId("wizard-auto-warn").count()).toBe(0);
    await 框.getByLabel("客户名称").fill("某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购中心第二分部");
    const 量 = await page.evaluate(() => {
      const s = document.querySelector(".cr-sheet") as HTMLElement;
      const body = document.querySelector(".ant-modal-body") as HTMLElement;
      const 格 = document.querySelector("[data-testid='wizard-bizline-auto']") as HTMLElement;
      return { 表: s.scrollWidth - s.clientWidth, 体: body.scrollWidth - body.clientWidth, 页: document.documentElement.scrollWidth - window.innerWidth, 格: 格.scrollWidth - 格.clientWidth };
    });
    expect(量).toEqual({ 表: 0, 体: 0, 页: 0, 格: 0 });
    // 换回指定分配：业务线下拉回来
    await 选(page, "分配方式", "指定分配");
    await 框.getByTestId("wizard-bizline").waitFor();
  } finally { await page.close(); }
});

it("市场成员选自动分配：没选业务线也能建，交的业务线是 null（服务端按客户区域定）", async () => {
  const page = await 开(1280, { __开关: "锁开", __标题: "新线索", __市场: true });
  try {
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("号码", { exact: true }).fill("13905712266");
    await 框.getByLabel("客户名称").fill("华东展具");
    await 框.getByLabel("联系人姓名").fill("王总");
    await 选(page, "渠道触点", "公司资源");
    await 框.getByLabel("项目名称").fill("华东展具-一期");
    await 选(page, "分配方式", "自动分配");
    await 框.getByLabel("沟通内容").fill("客户要报价");
    await 框.getByRole("button", { name: /^建\s*好$/ }).click();
    await expect.poll(async () => (await 调(page)).find((x) => x[0] === "建档向导")).toBeTruthy();
    const 交 = (await 调(page)).find((x) => x[0] === "建档向导")![1] as { 项目: Record<string, unknown> };
    expect(交.项目).toMatchObject({ 分配方式: 1, 业务线: null });
  } finally { await page.close(); }
});

it("市场成员给有地址的老客户新增项目、选自动分配：只读显示客户区域定的线，交的业务线是 null", async () => {
  const page = await 开(1280, { __开关: "开", __标题: "新增项目", __市场: true, __区域线: "内贸" });
  try {
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("客户名称").fill("华东");
    await page.locator(".ant-select-dropdown:visible").getByText("华东展具", { exact: false }).first().click();
    await 框.getByTestId("wizard-old-customer").waitFor();
    await 选(page, "分配方式", "自动分配");
    await expect.poll(() => 框.getByTestId("wizard-bizline-auto").innerText()).toContain("按客户区域自动定：内贸");
    await 框.getByLabel("项目名称").fill("华东展具-二期");
    await 框.getByLabel("沟通内容").fill("老客户要加一套");
    await 框.getByRole("button", { name: /^建\s*好$/ }).click();
    await expect.poll(async () => (await 调(page)).find((x) => x[0] === "给客户建项目")).toBeTruthy();
    const 交 = (await 调(page)).find((x) => x[0] === "给客户建项目")![1] as { 项目: Record<string, unknown> };
    expect(交.项目).toMatchObject({ 分配方式: 1, 业务线: null });
  } finally { await page.close(); }
});

// 联系人姓名企业版选填（11-17「联系人姓名不一定知道」，同服务端 联系人姓名问题）：姓名和联系方式至少一项
it("企业版联系人姓名选填：空名 + 联系人电话能交（姓名交空串）；姓名和联系人号码全空就地拦「联系人姓名和联系方式至少填一项」", async () => {
  const page = await 开(1280);
  try {
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("号码", { exact: true }).fill("13905712266");
    await 框.getByLabel("客户名称").fill("华东展具");
    await 选(page, "渠道触点", "公司资源");
    await 选(page, "业务线", "内贸");
    await 框.getByLabel("沟通内容").fill("只知道电话");
    // 全空：联系人电话清掉、姓名不填，点建好就地标红那句，不交
    await 框.getByLabel("联系人电话").fill("");
    await 框.getByRole("button", { name: /^建\s*好$/ }).click();
    await 框.getByText("联系人姓名和联系方式至少填一项").first().waitFor();
    expect((await 调(page)).find((x) => x[0] === "建档只建客户")).toBeUndefined();
    // 填上联系人电话、姓名还空着：能交，姓名是空串
    await 框.getByLabel("联系人电话").fill("13905712266");
    await 框.getByRole("button", { name: /^建\s*好$/ }).click();
    await expect.poll(async () => (await 调(page)).find((x) => x[0] === "建档只建客户")).toBeTruthy();
    const 交 = (await 调(page)).find((x) => x[0] === "建档只建客户")![1] as { 联系人: Record<string, unknown> };
    expect(交.联系人).toMatchObject({ name: "", phone: "13905712266" });
  } finally { await page.close(); }
});

it("企业版联系人姓名选填：空名 + 只有多加的号码也能交", async () => {
  const page = await 开(1280);
  try {
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("号码", { exact: true }).fill("13905712266");
    await 框.getByLabel("客户名称").fill("华东展具");
    await 选(page, "渠道触点", "公司资源");
    await 选(page, "业务线", "内贸");
    await 框.getByLabel("沟通内容").fill("只留了微信");
    await 框.getByLabel("联系人电话").fill("");
    await 框.getByRole("button", { name: "加一个号码" }).click();
    await 选(page, "第 2 个号码类型", "微信");
    await 框.getByLabel("第 2 个号码", { exact: true }).fill("wx_buyer01");
    await 框.getByRole("button", { name: /^建\s*好$/ }).click();
    await expect.poll(async () => (await 调(page)).find((x) => x[0] === "建档只建客户")).toBeTruthy();
    const 交 = (await 调(page)).find((x) => x[0] === "建档只建客户")![1] as { 联系人: Record<string, unknown> };
    expect(交.联系人).toMatchObject({ name: "", 号码们: [{ kind: "wechat", value: "wx_buyer01" }] });
  } finally { await page.close(); }
});
