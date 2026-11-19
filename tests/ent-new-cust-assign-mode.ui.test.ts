/**
 * 新建客户弹窗（没开项目）给市场成员的「项目分配方式」（11-18 用户，lib/project/new-cust-assign.ts）：
 *   市场成员：摆这一格，只给指定 / 自动 / 暂不分配，默认自动分配（用不了退回暂不分配）；
 *     指定分配才摆客户负责人（选的就是客户负责人）；按区域的选自动分配摆「分配方向」，默认按电话 → 本人事业部，改了才交
 *   销售：不摆，客户负责人照旧；交的不带 项目分配
 *   打开「有项目」：这一格收起，项目自己的「分配方式」照建档向导默认（市场 = 自动分配）
 *   Windows 1024 / 1280 / 1366 + 超长客户名：弹窗里不横向溢出
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ent-new-cust-assign", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷新=(window.__刷新??0)+1},push(u){(window.__跳=window.__跳??[]).push(u)},replace(){}});export const usePathname=()=>'/customers';");
  stub(/^next\/link$/, "export default function L({href,children,prefetch,...p}){return <a href={href} {...p}>{children}</a>}");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/^\.\.\/actions$/, "export const 建档向导=async(x)=>{(window.__调||=[]).push(['建档向导',x]);return {ok:true,customerId:'c1',projectId:'p1'}};export const 建档只建客户=async(x)=>{(window.__调||=[]).push(['建档只建客户',x]);return {ok:true,customerId:'c2',projectId:null}};");
  stub(/customers\/actions$/, "export const checkDuplicate=async()=>null;export const 推荐人候选=async()=>[];");
  stub(/(^|\/)number-actions$/, "export const 查号码=async(t,v)=>({ok:true,状态:'首次录入',提示:'首次录入',值:v,归属地:null});export const 查客户名=async()=>({ok:true,撞:null});export const 申请挂靠=async()=>({ok:true});export const 从回收站捞回=async()=>({ok:true});");
  stub(/customers\/DedupeClaimKey$/, "export default function D(){return null}");
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[];");
  stub(/customers\/\[id\]\/project-actions$/, "export const 给客户建项目=async()=>({ok:true,projectId:'np9'});export const 新项目分配数据=async()=>null;export const 建项目带走的项目=async()=>({项目数:0,项目:[]});");
  stub(/same-number-actions$/, "export const 同号协同录入=async()=>({ok:true});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {建档弹窗} from '@/app/(app)/projects/new/ProjectWizard';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    const 市场=!!window.__市场;
    const 全=[{i:0,名:'指定分配'},{i:1,名:'自动分配'},{i:2,名:'公海捞取'},{i:3,名:'暂不分配'}];
    const 分配方式们=window.__分配方式们??(市场?全:[{i:3,名:'暂不分配'},{i:4,名:'个人自持'}]);
    const 数据={users:[{id:'u1',name:'我自己',email:'a'},{id:'u2',name:'销售乙',email:'b'}],要下一步:false,企业:{渠道们:[],节点们:['潜客培育','线索验证','线索推进'],分配方式们,默认分配方式:window.__默认??(市场?1:4),是销售:!市场,是市场:市场,按区域:市场,本人线:window.__本人线??null,客户只给自己:!!window.__只给自己}};
    function 页(){const [开,set开]=React.useState(true);return <建档弹窗 open={开} 标题='新增客户' 项目='关' 数据={数据} onClose={()=>set开(false)}/>;}
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
/** 上一个下拉收起动画还没完时两个下拉都算可见：等它收完再开下一个 */
const 等下拉收起 = (page: Page) => expect.poll(() => page.locator(".ant-select-dropdown:visible").count()).toBe(0);
const 选 = async (page: Page, 标签: string, 项: string) => {
  await 等下拉收起(page);
  await page.getByRole("dialog").getByLabel(标签, { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").getByTitle(项, { exact: true }).click();
};
const 下拉项 = async (page: Page, 标签: string) => {
  await 等下拉收起(page);
  await page.getByRole("dialog").getByLabel(标签, { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option").first().waitFor();
  const 项 = await page.locator(".ant-select-dropdown .ant-select-item-option").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  await page.keyboard.press("Escape");
  return 项;
};
const 填齐 = async (page: Page) => {
  const 框 = page.getByRole("dialog");
  await 框.getByLabel("号码", { exact: true }).fill("13905712266");
  await 框.getByLabel("客户名称").fill("华东展具");
  await 框.getByLabel("联系人姓名").fill("王总");
  await 选(page, "渠道触点", "公司资源");
  await 选(page, "业务线", "内贸");
  await 框.getByLabel("沟通内容").fill("客户要报价");
};
const 交的客户 = async (page: Page) => {
  await page.getByRole("dialog").getByRole("button", { name: /^建\s*好$/ }).click();
  await expect.poll(async () => (await 调(page)).find((x) => x[0] === "建档只建客户")).toBeTruthy();
  return ((await 调(page)).find((x) => x[0] === "建档只建客户")![1] as { 客户: Record<string, unknown> }).客户;
};

it("市场成员：摆「项目分配方式」，只给指定 / 自动 / 暂不分配，默认自动分配；不摆客户负责人，摆分配方向；三档宽度 + 超长名不溢出", async () => {
  for (const w of [1024, 1280, 1366]) {
    const page = await 开(w, { __市场: true, __本人线: "外贸" });
    try {
      const 框 = page.getByRole("dialog");
      const 格 = 框.getByTestId("cust-assign-mode");
      expect(await 格.innerText()).toContain("自动分配");
      expect(await 下拉项(page, "项目分配方式")).toEqual(["指定分配", "自动分配", "暂不分配"]);
      // 自动分配：客户负责人不摆（建在自己名下），分配方向默认按本人事业部，填了大陆手机改按电话
      expect(await 框.getByLabel("客户负责人", { exact: true }).count()).toBe(0);
      const 为什么 = 框.getByTestId("cust-assign-direction-why");
      expect(await 为什么.innerText()).toContain("按你所在事业部：外贸");
      await 框.getByLabel("号码", { exact: true }).fill("13905712266");
      await expect.poll(() => 为什么.innerText()).toContain("按电话（大陆手机号）：内贸");
      // 和客户分配（custAssign）不混：这张表上没有「客户分配」这一格
      expect(await 框.getByText("客户分配", { exact: true }).count()).toBe(0);
      await 框.getByLabel("客户名称").fill("某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购中心第二分部");
      const 量 = await page.evaluate(() => {
        const s = document.querySelector(".cr-sheet") as HTMLElement;
        const body = document.querySelector(".ant-modal-body") as HTMLElement;
        const 们 = ["cust-assign-mode", "cust-assign-direction"].map((id) => document.querySelector(`[data-testid='${id}']`) as HTMLElement);
        const 出格 = 们.some((x) => x.getBoundingClientRect().right > s.getBoundingClientRect().right + 0.5 || x.scrollWidth > x.clientWidth);
        return { 表: s.scrollWidth - s.clientWidth, 体: body.scrollWidth - body.clientWidth, 页: document.documentElement.scrollWidth - window.innerWidth, 出格 };
      });
      expect(量, `${w}`).toEqual({ 表: 0, 体: 0, 页: 0, 出格: false });
    } finally { await page.close(); }
  }
});

it("市场成员默认自动分配、没改方向：交 项目分配 {分配方式:1}、不带方向，客户负责人 = 自己；改成外贸 = 带外贸", async () => {
  {
    const page = await 开(1280, { __市场: true });
    try {
      await 填齐(page);
      const 客户 = await 交的客户(page);
      expect(客户).toMatchObject({ salesOwnerId: "u1", 项目分配: { 分配方式: 1 } });
      expect((客户.项目分配 as Record<string, unknown>).分配方向).toBeUndefined();
    } finally { await page.close(); }
  }
  {
    const page = await 开(1280, { __市场: true });
    try {
      await 填齐(page);
      await 选(page, "分配方向", "外贸");
      await expect.poll(() => page.getByRole("dialog").getByTestId("cust-assign-direction-why").innerText()).toContain("你改成了外贸");
      expect(await 交的客户(page)).toMatchObject({ salesOwnerId: "u1", 项目分配: { 分配方式: 1, 分配方向: "外贸" } });
    } finally { await page.close(); }
  }
});

it("市场成员选指定分配：摆客户负责人（渠运平常只给自己也摆），选的那位就是客户负责人；分配方向收起", async () => {
  const page = await 开(1024, { __市场: true, __只给自己: true });
  try {
    const 框 = page.getByRole("dialog");
    await 填齐(page);
    await 选(page, "项目分配方式", "指定分配");
    await 框.getByLabel("客户负责人", { exact: true }).waitFor();
    expect(await 框.getByTestId("cust-assign-direction").count()).toBe(0);
    await 选(page, "客户负责人", "销售乙");
    expect(await 交的客户(page)).toMatchObject({ salesOwnerId: "u2", 项目分配: { 分配方式: 0 } });
  } finally { await page.close(); }
});

it("市场成员选暂不分配：客户负责人不摆、交的是自己（之前选过别人也不带）", async () => {
  const page = await 开(1366, { __市场: true });
  try {
    await 填齐(page);
    await 选(page, "项目分配方式", "指定分配");
    await 选(page, "客户负责人", "销售乙");
    await 选(page, "项目分配方式", "暂不分配");
    expect(await page.getByRole("dialog").getByLabel("客户负责人", { exact: true }).count()).toBe(0);
    expect(await 交的客户(page)).toMatchObject({ salesOwnerId: "u1", 项目分配: { 分配方式: 3 } });
  } finally { await page.close(); }
});

it("自动分配用不了（规则没开）：默认退回暂不分配", async () => {
  const page = await 开(1280, { __市场: true, __分配方式们: [{ i: 0, 名: "指定分配" }, { i: 2, 名: "公海捞取" }, { i: 3, 名: "暂不分配" }], __默认: 0 });
  try {
    expect(await page.getByRole("dialog").getByTestId("cust-assign-mode").innerText()).toContain("暂不分配");
  } finally { await page.close(); }
});

it("打开「有项目」：这一格收起，项目的分配方式照建档向导默认（市场 = 自动分配）", async () => {
  const page = await 开(1280, { __市场: true });
  try {
    const 框 = page.getByRole("dialog");
    await 框.getByRole("switch", { name: "有项目" }).click();
    await 框.getByLabel("项目名称").waitFor();
    expect(await 框.getByTestId("cust-assign-mode").count()).toBe(0);
    expect(await 框.locator("[data-ge='分配方式']").innerText()).toContain("自动分配");
  } finally { await page.close(); }
});

it("销售：不摆这一格，客户负责人照旧；交的不带 项目分配", async () => {
  const page = await 开(1280);
  try {
    const 框 = page.getByRole("dialog");
    expect(await 框.getByTestId("cust-assign-mode").count()).toBe(0);
    expect(await 框.getByText("项目分配方式").count()).toBe(0);
    await 框.getByLabel("客户负责人", { exact: true }).waitFor();
    // 打开「有项目」：销售默认个人自持不变；关回去接着建客户
    const 开关 = 框.getByRole("switch", { name: "有项目" });
    await 开关.click();
    await 框.getByLabel("项目名称").waitFor();
    expect(await 框.locator("[data-ge='分配方式']").innerText()).toContain("个人自持");
    await 开关.click();
    await 填齐(page);
    const 客户 = await 交的客户(page);
    expect(客户.salesOwnerId).toBe("u1");
    expect(客户.项目分配).toBeUndefined();
  } finally { await page.close(); }
});
