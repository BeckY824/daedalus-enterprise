import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
/* 11-03 「完成节点」框一窗填完：真浏览器量 1024 / 1280 / 1366 不溢出、超高能滚；部分失败留窗且已填的不丢；存齐才推进；服务端自动推过不再手动推 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "fill-required-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷新&&window.__刷新()},push(){},prefetch(){}});");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\.\/actions$/, `
    const 记=(名,项,改)=>{(window.__存||=[]).push([名,改]);const 错=(window.__错||{})[项];if(错)return{ok:false,error:错};return{ok:true,...(window.__自动推到?{自动推到:window.__自动推到}:{})}};
    export const 编辑项目=async(id,改)=>记('项目',Object.keys(改)[0],改),改项目画像Action=async(id,改)=>记('画像',Object.keys(改)[0],改),勾项目交付=async(id,项)=>记('交付',项,项);`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider,Modal} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {ProjectFillRequired} from '@/app/(app)/projects/[id]/ProjectFillRequired';
    const 选项=['选项一','选项二'];
    const 画像={项们:[{键:'budgetLevel',名:'预算能力',多选:false,选项},{键:'demandStatus',名:'需求',多选:false,选项},{键:'productNeeds',名:'需求类型',多选:true,选项},{键:'priceSense',名:'价格感知',多选:false,选项}],值:{budgetLevel:null,demandStatus:'暂未确认',productNeeds:[],priceSense:null}};
    const 基={id:'p1',name:'项目'+'长'.repeat(40),amount:0,currency:'USD',customer:{id:'c1'},contact:null,expectedDealAt:null,channelId:null,渠道们:[{id:'ch1',name:'渠道一',attr:null,platform:null,active:true}],level:null,
      所在地:{addrCountry:null,addrProvince:null,addrCity:null,addrDistrict:null,location:null},成交钱:{dealDemand:'暂无',contractAmount:null,contractCurrency:null,depositAmount:null,depositCurrency:null},项目新字段:{painPoints:null,contractStatus:'起草中'},画像,
      balanceSettled:false,acceptancePassed:false,能记沟通:true,项目附件:{},回款们:[],线索验证:{},只能看字段:[]};
    const 草稿留着={current:{}};
    function 壳({还差,只能靠填齐,能就地改=true,联系人们=[],能推进=true,p:改项}){
      const [缺,set缺]=useState(还差);const [开,set开]=useState(true);
      /* router.refresh：测试脚本定刷新后还差剩什么；没定就按存过的算全齐 */
      window.__刷新=()=>{React.startTransition(()=>set缺(window.__刷新后还差??[]));};
      const p={...基,...改项,必填:{配了:还差,还差:缺,只能靠填齐}};
      window.__重开=()=>set开(true);
      if(!开)return <div id='关了'>框关了</div>;
      return <Modal open title='完成节点' footer={null} width={520} onCancel={()=>set开(false)}><ProjectFillRequired p={p} 联系人们={联系人们} 能就地改={能就地改} 改不了话='只有项目负责人能改，其他人只能看' 现在在='线索 · 潜客培育' 能推进={能推进} 完成到字='下一节点：线索验证'
        忙={false} on完成={()=>{window.__推=(window.__推||0)+1;set开(false)}} on关={()=>set开(false)} on去={(x)=>{window.__去=x;set开(false)}} 读草稿={()=>草稿留着.current[p.id]} 留草稿={(d)=>{草稿留着.current[p.id]=d}}/></Modal>;
    }
    const root=createRoot(document.getElementById('root'));
    window.__开=(x)=>root.render(<ConfigProvider locale={zhCN}><App><壳 key={window.__k=(window.__k||0)+1} {...x}/></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type W = Record<string, unknown> & { __开: (x: unknown) => void };
async function 开(x: Record<string, unknown>, width = 1366, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://proj.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://proj.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(a => (window as unknown as W).__开(a), x);
  await page.getByText("完成节点").first().waitFor();
  return { page, errors };
}
const 窗口变量 = <T,>(page: Page, 名: string) => page.evaluate(n => (window as unknown as Record<string, unknown>)[n], 名) as Promise<T>;
const 主按钮 = (page: Page) => page.getByRole("button", { name: "保存并完成节点" });
async function 选(page: Page, 名: string, 项: string) {
  await page.locator(`[data-required="${名}"]`).getByRole("combobox").click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").getByTitle(项, { exact: true }).click();
}
/** 框里每个元素都不出框、框不出视口、页面不横向滚 */
async function 量溢出(page: Page) {
  return page.evaluate(() => {
    const 框 = document.querySelector(".ant-modal-container, .ant-modal-content")!.getBoundingClientRect();
    const 出框 = [...document.querySelectorAll(".ant-modal-body *")].filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && !e.closest(".ant-select-dropdown") && (r.right > 框.right + 1 || r.left < 框.left - 1);
    }).map(e => `${e.tagName}.${(e.getAttribute("class") ?? "").slice(0, 40)}`);
    const 单 = document.querySelector(".proj-miss-list");
    return { 出框, 框宽: 框.width, 页面横滚: document.documentElement.scrollWidth > innerWidth, 单横滚: 单 ? 单.scrollWidth > 单.clientWidth + 1 : false, 单纵滚: 单 ? 单.scrollHeight > 单.clientHeight : false };
  });
}

describe("完成节点框：一窗填完", () => {
  const 一堆 = ["金额", "合同金额", "定金金额", "预计成交日期", "需求描述", "痛点标注", "合同已生效", "项目名称", "项目级别", "项目来源", "项目所在地", "主联系人", "需求", "需求类型", "预算能力", "价格感知", "验收通过", "尾款结清", "合同附件", "回款", "下一步时间", "线索验证结果", "来源"];

  it.each([1024, 1280, 1366])("%i 宽：全部控件 + 长名字长值不溢出，超高能滚", async (w) => {
    const 长 = "很长的联系人名字".repeat(10);
    const { page, errors } = await 开({ 还差: 一堆, 只能靠填齐: true, 联系人们: [{ id: "k1", name: 长, position: "职位".repeat(20) }] }, w, 700);
    await page.getByRole("textbox", { name: "项目名称" }).fill("长".repeat(60));
    await 选(page, "主联系人", `${长} · ${"职位".repeat(20)}`);
    const 量 = await 量溢出(page);
    expect(量.出框).toEqual([]);
    expect(量.页面横滚).toBe(false);
    expect(量.单横滚).toBe(false);
    expect(量.单纵滚).toBe(true);
    // 列表滚到底，最后一行、按钮都够得着
    await page.locator(".proj-miss-list").evaluate(e => { e.scrollTop = e.scrollHeight; });
    await expect.poll(() => page.locator(`[data-required="${[...一堆].pop()}"]`).isVisible()).toBe(true);
    const 取消 = page.getByRole("button", { name: /取\s*消/ });
    await 取消.scrollIntoViewIfNeeded();
    const 位 = (await 取消.boundingBox())!;
    expect(位.y + 位.height).toBeLessThanOrEqual(700);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it("全填好才亮，点一次存齐并推进；占位值、0 不算", async () => {
    const { page, errors } = await 开({ 还差: ["金额", "需求描述", "预算能力"], 只能靠填齐: true });
    await expect.poll(() => 主按钮(page).isDisabled()).toBe(true);
    // 库里的占位值不带进格子，也说一句
    await expect.poll(() => page.getByText("现在是「暂无」，不算填了").count()).toBe(1);
    await page.getByRole("spinbutton", { name: "金额" }).fill("0");
    await page.getByRole("textbox", { name: "需求描述" }).fill("-");
    await expect.poll(() => page.getByText("要大于 0").count()).toBe(1);
    await expect.poll(() => page.getByText("「-」是占位值，不算填了").count()).toBe(1);
    await expect.poll(() => 主按钮(page).isDisabled()).toBe(true);
    await page.getByRole("spinbutton", { name: "金额" }).fill("100");
    await page.getByRole("textbox", { name: "需求描述" }).fill("要十台");
    await 选(page, "预算能力", "选项一");
    await 主按钮(page).click();
    await page.locator("#关了").waitFor();
    const 存了 = await 窗口变量<unknown[]>(page, "__存");
    expect(存了).toHaveLength(3);
    expect(存了).toEqual(expect.arrayContaining([["项目", { amount: 100, currency: "USD" }], ["项目", { dealDemand: "要十台" }], ["画像", { budgetLevel: "选项一" }]]));
    expect(await 窗口变量(page, "__推")).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it("部分失败：留窗、写哪项错、已填的不丢、只重试失败项，存齐才推进", async () => {
    const { page } = await 开({ 还差: ["金额", "预算能力"], 只能靠填齐: true });
    await page.evaluate(() => { const w = window as unknown as Record<string, unknown>; w.__错 = { amount: "金额超过上限了" }; w.__刷新后还差 = ["金额"]; });
    await page.getByRole("spinbutton", { name: "金额" }).fill("999");
    await 选(page, "预算能力", "选项二");
    await 主按钮(page).click();
    await page.getByRole("alert").filter({ hasText: "金额超过上限了" }).waitFor();
    expect(await 窗口变量(page, "__推")).toBeUndefined();
    expect(await page.getByRole("spinbutton", { name: "金额" }).inputValue()).toMatch(/999/);
    await page.locator('[data-required="预算能力"]').getByText("已存上").waitFor();
    // 重试只存失败的
    await page.evaluate(() => { const w = window as unknown as Record<string, unknown>; w.__错 = {}; w.__刷新后还差 = []; w.__存 = []; });
    await 主按钮(page).click();
    await page.locator("#关了").waitFor();
    expect(await 窗口变量(page, "__存")).toEqual([["项目", { amount: 999, currency: "USD" }]]);
    expect(await 窗口变量(page, "__推")).toBe(1);
    await page.close();
  }, 60_000);

  it("服务端已经自动推进：关窗，不再手动推", async () => {
    const { page } = await 开({ 还差: ["金额"], 只能靠填齐: true });
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__自动推到 = ["线索验证"]; });
    await page.getByRole("spinbutton", { name: "金额" }).fill("5");
    await 主按钮(page).click();
    await page.locator("#关了").waitFor();
    expect(await 窗口变量(page, "__推")).toBeUndefined();
    await page.close();
  }, 60_000);

  it("存完系统里还差（别人同时改了）：留窗说清楚，不推", async () => {
    const { page } = await 开({ 还差: ["金额"], 只能靠填齐: true });
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__刷新后还差 = ["金额"]; });
    await page.getByRole("spinbutton", { name: "金额" }).fill("5");
    await 主按钮(page).click();
    await page.getByText(/系统里还差：/).waitFor();
    expect(await 窗口变量(page, "__推")).toBeUndefined();
    await page.close();
  }, 60_000);

  it("窗外项：不摆控件、不给一键完成，给入口；已填的可以先存，回来草稿还在", async () => {
    const { page } = await 开({ 还差: ["金额", "合同附件", "回款", "下一步时间", "线索验证结果", "来源"], 只能靠填齐: true });
    await page.getByRole("spinbutton", { name: "金额" }).fill("88");
    await expect.poll(() => 主按钮(page).isDisabled()).toBe(true);
    await expect.poll(() => page.getByText(/这里填不了，处理完才能完成节点/).count()).toBe(1);
    await expect.poll(() => page.getByRole("button", { name: "先保存已填的" }).count()).toBe(1);
    await expect.poll(() => page.getByRole("link", { name: "去客户页" }).getAttribute("href")).toBe("/customers/c1");
    await page.locator('[data-required="合同附件"]').getByRole("button", { name: "去项目附件" }).click();
    await page.locator("#关了").waitFor();
    expect(await 窗口变量(page, "__去")).toBe("附件");
    await page.evaluate(() => (window as unknown as { __重开: () => void }).__重开());
    await page.getByRole("spinbutton", { name: "金额" }).waitFor();
    expect(await page.getByRole("spinbutton", { name: "金额" }).inputValue()).toMatch(/88/);
    await page.close();
  }, 60_000);

  it("老板 / 主管：保留「仍要推进」，填了的先存再推；没填的不拦", async () => {
    const { page } = await 开({ 还差: ["金额", "预算能力"], 只能靠填齐: false });
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__刷新后还差 = ["预算能力"]; });
    await page.getByRole("spinbutton", { name: "金额" }).fill("7");
    await page.getByRole("button", { name: "仍要推进" }).click();
    await page.locator("#关了").waitFor();
    expect(await 窗口变量(page, "__存")).toEqual([["项目", { amount: 7, currency: "USD" }]]);
    expect(await 窗口变量(page, "__推")).toBe(1);
    await page.close();
  }, 60_000);

  it("只能靠填齐：没有「仍要推进」；改不了内容的上级不摆控件、写原因，还能仍要推进", async () => {
    const a = await 开({ 还差: ["金额"], 只能靠填齐: true });
    await expect.poll(() => a.page.getByRole("button", { name: "仍要推进" }).count()).toBe(0);
    await a.page.close();
    const b = await 开({ 还差: ["金额"], 只能靠填齐: false, 能就地改: false });
    await expect.poll(() => b.page.getByRole("spinbutton", { name: "金额" }).count()).toBe(0);
    await expect.poll(() => b.page.getByText("只有项目负责人能改，其他人只能看").count()).toBe(1);
    await b.page.getByRole("button", { name: "仍要推进" }).click();
    await b.page.locator("#关了").waitFor();
    expect(await 窗口变量(b.page, "__存")).toBeUndefined();
    expect(await 窗口变量(b.page, "__推")).toBe(1);
    await b.page.close();
  }, 60_000);

  it("字段权限只读：那一格不摆控件", async () => {
    const { page } = await 开({ 还差: ["金额", "预算能力"], 只能靠填齐: true, p: { 只能看字段: ["商机金额"] } });
    await expect.poll(() => page.getByRole("spinbutton", { name: "金额" }).count()).toBe(0);
    await expect.poll(() => page.getByRole("combobox", { name: "预算能力" }).count()).toBe(1);
    await page.close();
  }, 60_000);
});
