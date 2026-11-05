/**
 * 首页新线索卡（企业版）和「新建项目」同一套（11-04 用户：首页录入要和新建项目 / 新建客户一致；服务端规则见 ent-ai-lead-assign.test.ts）。
 *
 *   字段名：客户名称（组织 / 公司）、联系人姓名；分配方式必选，选「指定分配」才出项目负责人
 *   有国家 / 城市：出「国家 / 城市填到」，没勾不能确认；勾了交上去带 区域去处
 *   Windows 1024 / 1280 / 1366：超长公司名、超长渠道名不横向撑出，「确认」点得中
 *   渠道下拉：375（手机）和 1024 宽都显示全名，不省略、不出屏
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const 长渠道 = "海外社媒广告投放（领英 + 脸书 + 照片墙）二〇二六年度第四季度专项活动";
const plugin: Plugin = { name: "ai-lead-card-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  stub(/^next\/link$/, "export default function L({children,...p}){return <a {...p}>{children}</a>}");
  stub(/^next\/dynamic$/, "export default ()=>()=>null;");
  stub(/dashboard\/apply$/, "export const applyProposal=async p=>{window.__交=p;return{ok:true}};export const undoProposal=async()=>({ok:true});");
  stub(/card-scan\/originals$/, "export const 取走名片原图=()=>null,记下刚建的=()=>{},忘掉刚建的=()=>{};");
  stub(/attachment-upload$/, "export const 传附件=async()=>({ok:true});");
  stub(/customers\/RescueKey$/, "export default function R(){return null}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import ProposalCard,{新线索来源,新线索企业} from '@/components/ProposalCard';
    const root=createRoot(document.getElementById('root'));
    const 长名='某某超长国际贸易进出口集团股份有限公司华东区域分公司'.repeat(4);
    const 企={成员:[{value:'u1',label:'乙'}],分配方式们:[{i:0,名:'指定分配'},{i:1,名:'自动分配'},{i:3,名:'暂不分配'}],默认分配方式:null,是销售:false};
    window.__render=()=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>
      <新线索来源.Provider value={['展会',${JSON.stringify(长渠道)}]}><新线索企业.Provider value={企}>
        <div className="cli-col"><ProposalCard proposal={{id:'p1',kind:'add_lead',customerId:'',customerName:'',reason:'x',name:长名,contact:'周经理',phone:'13800000000',source:${JSON.stringify(长渠道)},status:'待跟进',remark:'',country:'摩洛哥',city:'卡萨布兰卡'}}/></div>
      </新线索企业.Provider></新线索来源.Provider>
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://lead.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://lead.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
  await page.locator(".prop-ok").waitFor();
  return { page, errors };
}
const 格 = (page: Page, 名: string) => page.locator(".prop-f").filter({ has: page.locator(`.prop-f-l:text-is("${名}")`) });
const 不横撑 = (page: Page) => page.evaluate(() => {
  const 卡 = document.querySelector(".prop")!.getBoundingClientRect();
  const 出界 = [...document.querySelectorAll(".prop .prop-f")].filter(e => e.getBoundingClientRect().right > 卡.right + 1).length;
  return { 页: document.documentElement.scrollWidth <= window.innerWidth, 出界 };
});
async function 选(page: Page, 名: string, 项: string) {
  await 格(page, 名).locator(".ant-select").click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: 项 }).first().click();
}

it("字段名、分配方式必选、指定才出负责人、国家 / 城市要选填到哪，填齐后确认交上去（1024 / 1280 / 1366）", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await open(w);
    try {
      expect(await 格(page, "客户名称（组织 / 公司）").count()).toBe(1);
      expect(await 格(page, "联系人姓名").count()).toBe(1);
      expect(await 格(page, "项目负责人").count()).toBe(0);
      expect(await page.locator(".prop-ok").isDisabled()).toBe(true);
      const 差 = await page.locator(".prop-note").innerText();
      expect(差).toContain("分配方式");
      expect(差).toContain("国家 / 城市填到哪");
      expect(await 不横撑(page)).toEqual({ 页: true, 出界: 0 });

      await 选(page, "分配方式", "自动分配");
      expect(await 格(page, "项目负责人").count()).toBe(0);
      await 选(page, "分配方式", "指定分配");
      expect(await 格(page, "项目负责人").count()).toBe(1);
      await 选(page, "项目负责人", "乙");
      await 格(page, "国家 / 城市填到").getByText("客户", { exact: false }).first().click();
      if (await 格(page, "业务线").locator(".ant-select-selection-placeholder").count()) await 选(page, "业务线", "外贸");
      // 11-05：不再问客户明确回复了吗，换成下一步做什么（没开超时回收时选填）
      expect(await 格(page, "客户明确回复了吗").count()).toBe(0);
      await 格(page, "下一步做什么").locator("input").fill("发报价单");

      await expect.poll(() => page.locator(".prop-ok").isDisabled()).toBe(false);
      expect(await 不横撑(page)).toEqual({ 页: true, 出界: 0 });
      const ok = (await page.locator(".prop-ok").boundingBox())!;
      expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".prop-ok"), [ok.x + ok.width / 2, ok.y + ok.height / 2])).toBe(true);
      await page.locator(".prop-ok").click();
      await page.waitForFunction(() => Reflect.get(window, "__交"));
      const 交 = await page.evaluate(() => Reflect.get(window, "__交") as Record<string, unknown>);
      expect(交).toMatchObject({ 分配方式: 0, ownerId: "u1", country: "摩洛哥", city: "卡萨布兰卡", 下一步: "发报价单" });
      expect(交).not.toHaveProperty("明确回复");
      expect(交.区域去处).toContain("客户");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("渠道下拉显示全名：375（手机）和 1024 宽都不省略、不出屏", async () => {
  for (const [w, h] of [[375, 812], [1024, 768]]) {
    const { page, errors } = await open(w, h);
    try {
      await 格(page, "渠道").locator(".ant-select").click();
      const 项 = page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: "专项活动" }).first();
      await 项.waitFor();
      const r = await 项.evaluate(e => {
        const 字 = (e.querySelector(".ant-select-item-option-content") ?? e) as HTMLElement;
        const b = e.getBoundingClientRect();
        return { 全: 字.textContent, 不省略: 字.scrollWidth <= 字.clientWidth + 1, 在屏内: b.left >= -1 && b.right <= window.innerWidth + 1 };
      });
      expect(r).toEqual({ 全: 长渠道, 不省略: true, 在屏内: true });
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
