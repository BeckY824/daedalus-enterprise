/**
 * 首页新线索卡（企业版）和「新建项目」同一套（11-04 用户：首页录入要和新建项目 / 新建客户一致；服务端规则见 ent-ai-lead-assign.test.ts）。
 *
 *   字段名：客户名称（组织 / 公司）、联系人姓名；分配方式必选，选「指定分配」才出项目负责人
 *   有国家 / 城市：出「国家 / 城市填到」，没勾不能确认；勾了交上去带 区域去处
 *   Windows 1024 / 1280 / 1366：超长公司名、超长渠道名不横向撑出，「确认」点得中
 *   渠道下拉：375（手机）和 1024 宽都显示全名，不省略、不出屏
 *   撞上公海转「领取并记沟通」（F-054）：勾了存截图把对话截图带进领取框，没勾不带
 *   撞号（重复咨询方案「撞号面板只露在推项目个数」）：服务端带 在推个数（市场成员，含 0）时错误下面写「在推项目 N 个」，不带就没有
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const 长渠道 = "海外社媒广告投放（领英 + 脸书 + 照片墙）二〇二六年度第四季度专项活动";
const plugin: Plugin = { name: "ai-lead-card-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  stub(/^next\/link$/, "export default function L({children,...p}){return <a {...p}>{children}</a>}");
  stub(/^next\/dynamic$/, "export default ()=>()=>null;");
  stub(/customers\/\[id\]\/actions$/, 补全动作桩("src/app/(app)/customers/[id]/actions.ts", "export const 沟通可选项目=async()=>(window.__可选??{ok:true,项目们:null,能建项目:true});"));
  // F-052：AI 项目沟通卡（ProjectProposalFields）自己取无意义沟通开关；回 null 按默认（开着）
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通判定须知=async()=>null;", "async()=>null"));
  stub(/dashboard\/apply$/, "export const applyProposal=async(p,o)=>{window.__交=p;window.__选项=o;if(window.__回)return window.__回;if(window.__撞公海)return{ok:false,error:'这个号码的客户在公海',公海号:{类型:'手机号',值:'13812000000'}};return{ok:true,...(o&&o.首条附件?{首条附件票:{followUpId:'f1',票:'t1'}}:{})}};export const undoProposal=async()=>({ok:true});");
  stub(/card-scan\/originals$/, "export const 取走名片原图=()=>[],记下刚建的=()=>{},忘掉刚建的=()=>{};");
  stub(/attachment-upload$/, "export const 传附件=async(挂,f,类,票)=>{(window.__传??=[]).push({挂,名:f.name,票});return{ok:true}};");
  stub(/customers\/RescueKey$/, "export default function R(){return null}");
  stub(/customers\/RepeatInquiryKey$/, "export default function R(){return null}");
  stub(/customers\/DedupeClaimKey$/, "export default function D(p){window.__领附件=p.带来的附件?p.带来的附件.map(f=>f.name):null;return <span data-testid='claim-stub'/>}");
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
    window.__render=(补={},企补={},图=0)=>{const 截图=图?Array.from({length:图},(_,i)=>new File([new Uint8Array(16)],'微信截图'+i+'.png',{type:'image/png'})):undefined;root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>
      <新线索来源.Provider value={['展会',${JSON.stringify(长渠道)}]}><新线索企业.Provider value={{...企,...企补}}>
        <div className="cli-col"><ProposalCard 对话截图={截图} proposal={{id:'p1',kind:'add_lead',customerId:'',customerName:'',reason:'x',name:长名,contact:'周经理',phone:'13812000000',source:${JSON.stringify(长渠道)},status:'待跟进',remark:'',country:'摩洛哥',city:'卡萨布兰卡',...补}}/></div>
      </新线索企业.Provider></新线索来源.Provider>
    </BusinessProvider></App></ConfigProvider>);};
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number, height = 900, 补: Record<string, unknown> = {}, 企补: Record<string, unknown> = {}, 图 = 0) {
  const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://lead.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://lead.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(([a, b, c]) => (window as unknown as { __render: (a: unknown, b: unknown, c: unknown) => void }).__render(a, b, c), [补, 企补, 图] as const);
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
      // 11-05：不再问客户明确回复了吗，换成下一步计划（没开超时回收时选填）
      expect(await 格(page, "客户明确回复了吗").count()).toBe(0);
      await 格(page, "下一步计划").locator("input").fill("发报价单");

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

// 反馈 1E：原话说了分给谁（模型给 assignTo → 分给），卡上认出唯一一位就预选「指定分配 + 那一位」，人仍要点确认
it("原话说了分给谁：预选指定分配 + 那一位，不横撑，确认交上去的是那一位（1024 / 1280 / 1366）", async () => {
  for (const w of [1024, 1280, 1366]) {
    const 长名 = "超长名字的同事" + "很长".repeat(30);
    const { page, errors } = await open(w, 900, { 分给: 长名 }, { 成员: [{ value: "u1", label: "乙" }, { value: "u9", label: 长名 }] });
    try {
      expect(await 格(page, "分配方式").innerText()).toContain("指定分配");
      expect(await 格(page, "项目负责人").count()).toBe(1);
      expect(await 格(page, "项目负责人").innerText()).toContain("超长名字的同事");
      expect(await 不横撑(page)).toEqual({ 页: true, 出界: 0 });
      // 还没确认：交上去之前什么都没写
      expect(await page.evaluate(() => Reflect.get(window, "__交"))).toBeFalsy();
      await 格(page, "国家 / 城市填到").getByText("客户", { exact: false }).first().click();
      if (await 格(page, "业务线").locator(".ant-select-selection-placeholder").count()) await 选(page, "业务线", "外贸");
      await 格(page, "下一步计划").locator("input").fill("发报价单");
      await expect.poll(() => page.locator(".prop-ok").isDisabled()).toBe(false);
      await page.locator(".prop-ok").click();
      await page.waitForFunction(() => Reflect.get(window, "__交"));
      expect(await page.evaluate(() => Reflect.get(window, "__交") as Record<string, unknown>)).toMatchObject({ 分配方式: 0, ownerId: "u9" });
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("分给谁认不出 / 同名两位 / 这人用不了指定分配：不预填，照旧留给人选", async () => {
  for (const [补, 企补] of [
    [{ 分给: "没这个人" }, {}],
    [{ 分给: "王芳" }, { 成员: [{ value: "a", label: "王芳（a@x.com）" }, { value: "b", label: "王芳（b@x.com）" }] }],
    [{ 分给: "乙" }, { 分配方式们: [{ i: 3, 名: "暂不分配" }, { i: 4, 名: "个人自持" }], 是销售: true }],
  ] as const) {
    const { page, errors } = await open(1024, 900, 补, 企补);
    try {
      expect(await 格(page, "项目负责人").count()).toBe(0);
      expect(await 格(page, "分配方式").innerText()).not.toContain("指定分配");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("指定分配的项目负责人下拉只列能被指定的（参与正常），暂停 / 禁止的不列（审核追加；1024 / 1280 / 1366）", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await open(w, 900, {}, { 成员: [{ value: "u1", label: "乙" }, { value: "u2", label: "暂停的丙" }], 可指定: ["u1"] });
    try {
      await 选(page, "分配方式", "指定分配");
      await 格(page, "项目负责人").locator(".ant-select").click();
      const 项们 = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
      await 项们.filter({ hasText: "乙" }).first().waitFor();
      expect(await 项们.filter({ hasText: "暂停的丙" }).count()).toBe(0);
      expect(await 不横撑(page)).toEqual({ 页: true, 出界: 0 });
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

// 11-05 客户：「来源只能采用选项，不能采用填写（无相关选项需和上级沟通）」——渠道格只能选，打字只是搜，回车不会把字当成渠道
it("渠道只能选、不能手填：输入清单外的字回车后仍是原来的渠道", async () => {
  const { page, errors } = await open(1280);
  try {
    const 框 = 格(page, "渠道").locator(".ant-select");
    await 框.click();
    await page.keyboard.type("随便写的来源");
    await expect.poll(() => page.locator(".ant-select-dropdown:visible").innerText()).toContain("没有这个渠道，请找上级添加");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    const 显示 = await 框.innerText();
    expect(显示).toContain(长渠道);
    expect(显示).not.toContain("随便写的来源");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// 11-18 员工反馈「录入的时候还是添加不了截图」：对话框里带的截图摆在新线索卡上，默认勾上存成附件，确认时凭首条附件票传（服务端见 ent-ai-lead-screenshot.test.ts）
it("对话里带了截图：缩略图 + 默认勾上「存成这条线索的附件」，确认交 首条附件、凭票传到首条沟通；不横撑（1024 / 1280 / 1366）", async () => {
  const 填齐 = { 分配方式: 0, ownerId: "u1", 业务线: "外贸", 下一步: "发报价单", 区域去处: ["客户"] };
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await open(w, 900, 填齐, {}, 2);
    try {
      expect(await page.locator(".prop-shot").count()).toBe(2);
      const 勾 = 格(page, "截图").locator(".ant-checkbox-wrapper");
      expect(await 勾.innerText()).toContain("存成这条线索的附件");
      expect(await 勾.locator("input").isChecked()).toBe(true);
      expect(await 不横撑(page)).toEqual({ 页: true, 出界: 0 });
      await expect.poll(() => page.locator(".prop-ok").isDisabled()).toBe(false);
      await page.locator(".prop-ok").click();
      await page.waitForFunction(() => (Reflect.get(window, "__传") as unknown[] | undefined)?.length === 2);
      expect(await page.evaluate(() => Reflect.get(window, "__选项"))).toEqual({ 首条附件: true });
      const 传了 = await page.evaluate(() => Reflect.get(window, "__传") as { 挂: unknown; 名: string; 票: string }[]);
      expect(传了).toEqual([
        { 挂: { followUpId: "f1" }, 名: "微信截图0.png", 票: "t1" },
        { 挂: { followUpId: "f1" }, 名: "微信截图1.png", 票: "t1" },
      ]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("取消勾选：确认不交 首条附件、不传；没带图：卡上不摆截图这一格", async () => {
  const 填齐 = { 分配方式: 0, ownerId: "u1", 业务线: "外贸", 下一步: "发报价单", 区域去处: ["客户"] };
  const { page, errors } = await open(1024, 900, 填齐, {}, 1);
  try {
    await 格(page, "截图").locator(".ant-checkbox-wrapper").click();
    expect(await 格(page, "截图").locator("input").isChecked()).toBe(false);
    await page.locator(".prop-ok").click();
    await page.waitForFunction(() => Reflect.get(window, "__交"));
    expect(await page.evaluate(() => Reflect.get(window, "__选项"))).toBeUndefined();
    expect(await page.evaluate(() => Reflect.get(window, "__传"))).toBeUndefined();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  const 无 = await open(1024, 900, 填齐);
  try {
    expect(await 格(无.page, "截图").count()).toBe(0);
    expect(await 无.page.locator(".prop-shot").count()).toBe(0);
  } finally { await 无.page.close(); }
});

it("撞上公海转领取并记沟通（F-054）：勾了存截图，对话截图带进领取框；取消勾选不带", async () => {
  const 填齐 = { 分配方式: 0, ownerId: "u1", 业务线: "外贸", 下一步: "发报价单", 区域去处: ["客户"] };
  for (const 勾着 of [true, false]) {
    const { page, errors } = await open(1024, 900, 填齐, {}, 2);
    try {
      await page.evaluate(() => Reflect.set(window, "__撞公海", true));
      if (!勾着) await 格(page, "截图").locator(".ant-checkbox-wrapper").click();
      await expect.poll(() => page.locator(".prop-ok").isDisabled()).toBe(false);
      await page.locator(".prop-ok").click();
      await page.getByTestId("claim-stub").waitFor({ state: "attached" });
      expect(await page.evaluate(() => Reflect.get(window, "__领附件"))).toEqual(勾着 ? ["微信截图0.png", "微信截图1.png"] : null);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

// 11-18：市场成员选自动分配，业务线换成可改的「分配方向」：默认 区域 → 手机号 → 我的事业部，写明来源；只写城市也算区域；判不出显示未填提示，确认不卡业务线
it("市场自动分配：分配方向默认按区域 / 电话 / 本人事业部，写明来源；改了交上去（1024）", async () => {
  const 没手机 = { phone: "", 联系方式: [{ kind: "email", value: "a@b.test" }] };
  {
    const { page, errors } = await open(1024, 900, { country: "", city: "杭州", 区域去处: ["客户"] }, { 按区域: true, 默认分配方式: 1 });
    try {
      expect(await page.getByTestId("lead-card-region-line").innerText()).toContain("按客户区域：内贸");
      expect(await 格(page, "分配方向").innerText()).toContain("内贸");
      expect(await 格(page, "业务线").count()).toBe(0);
      expect(await 不横撑(page)).toEqual({ 页: true, 出界: 0 });
      // 改成外贸：说明写明改过、默认是什么；交上去带 分配方向
      await 选(page, "分配方向", "外贸");
      expect(await page.getByTestId("lead-card-region-line").innerText()).toContain("你改成了外贸（默认按客户区域：内贸）");
      await 格(page, "下一步计划").locator("input").fill("发报价单");
      await expect.poll(() => page.locator(".prop-ok").isDisabled()).toBe(false);
      await page.locator(".prop-ok").click();
      await page.waitForFunction(() => Reflect.get(window, "__交"));
      expect(await page.evaluate(() => Reflect.get(window, "__交") as Record<string, unknown>)).toMatchObject({ 分配方式: 1, 分配方向: "外贸" });
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
  {
    // 没区域：卡上的大陆手机号 → 内贸
    const { page } = await open(1024, 900, { country: "", city: "" }, { 按区域: true, 默认分配方式: 1 });
    try {
      expect(await page.getByTestId("lead-card-region-line").innerText()).toContain("按电话（大陆手机号）：内贸");
    } finally { await page.close(); }
  }
  {
    // 没区域、没手机：按我的事业部
    const { page } = await open(1024, 900, { country: "", city: "", ...没手机 }, { 按区域: true, 默认分配方式: 1, 本人线: "外贸" });
    try {
      expect(await page.getByTestId("lead-card-region-line").innerText()).toContain("按你所在事业部：外贸");
    } finally { await page.close(); }
  }
  {
    const { page, errors } = await open(1024, 900, { country: "", city: "", ...没手机 }, { 按区域: true, 默认分配方式: 1 });
    try {
      expect(await page.getByTestId("lead-card-region-line").innerText()).toContain("客户没填区域，按全部销售分配，建议补区域");
      await 格(page, "下一步计划").locator("input").fill("发报价单");
      await expect.poll(() => page.locator(".prop-ok").isDisabled()).toBe(false);
      expect(await page.locator(".prop-note").count() ? await page.locator(".prop-note").innerText() : "").not.toContain("业务线");
      // 没改：交上去不带 分配方向（服务端按默认算）
      await page.locator(".prop-ok").click();
      await page.waitForFunction(() => Reflect.get(window, "__交"));
      expect(await page.evaluate(() => Reflect.get(window, "__交") as Record<string, unknown>)).not.toHaveProperty("分配方向");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
  {
    // 只勾联系人：客户、项目都没落区域，没手机 → 提示
    const { page } = await open(1024, 900, { country: "", city: "杭州", 区域去处: ["联系人"], ...没手机 }, { 按区域: true, 默认分配方式: 1 });
    try {
      expect(await page.getByTestId("lead-card-region-line").innerText()).toContain("建议补区域");
    } finally { await page.close(); }
  }
});

// 11-18 同类排查：模型认出的职位、区县、详细地址在卡上摆出来、能改，确认交上去；没认出的不多摆格
it("职位 / 区县 / 详细地址：认出了才摆，改了交上去（1024）", async () => {
  {
    const { page } = await open(1024);
    try {
      for (const 名 of ["职位", "区县", "详细地址", "省"]) expect([名, await 格(page, 名).count()]).toEqual([名, 0]);
    } finally { await page.close(); }
  }
  const { page, errors } = await open(1024, 900, { country: "中国", city: "杭州", district: "西湖区", address: "文三路 1 号", position: "采购", 区域去处: ["客户"] });
  try {
    for (const 名 of ["职位", "区县", "详细地址"]) expect([名, await 格(page, 名).count()]).toEqual([名, 1]);
    await 格(page, "职位").locator("input").fill("采购经理");
    expect(await 不横撑(page)).toEqual({ 页: true, 出界: 0 });
    await 选(page, "分配方式", "指定分配");
    await 选(page, "项目负责人", "乙");
    if (await 格(page, "业务线").locator(".ant-select-selection-placeholder").count()) await 选(page, "业务线", "内贸");
    await 格(page, "下一步计划").locator("input").fill("发报价单");
    await expect.poll(() => page.locator(".prop-ok").isDisabled()).toBe(false);
    await page.locator(".prop-ok").click();
    await page.waitForFunction(() => Reflect.get(window, "__交"));
    expect(await page.evaluate(() => Reflect.get(window, "__交") as Record<string, unknown>)).toMatchObject({ position: "采购经理", district: "西湖区", address: "文三路 1 号" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("撞号没写进去：服务端带了在推个数（市场成员）错误下面写「在推项目 N 个」，含 0；不带没有这一句", async () => {
  for (const [回, 该有] of [
    [{ ok: false, error: "销售甲某已有该客户信息，请及时核对", 同事号: { 类型: "手机号", 值: "13812000000", 负责人名: "销售甲某" }, 在推个数: 0 }, "在推项目 0 个"],
    [{ ok: false, error: "销售甲某已有该客户信息，请及时核对" }, null],
  ] as const) {
    const { page, errors } = await open(1280);
    try {
      await page.evaluate((r) => { Object.assign(window, { __回: r }); }, 回);
      await 选(page, "分配方式", "自动分配");
      await 格(page, "国家 / 城市填到").getByText("客户", { exact: false }).first().click();
      if (await 格(page, "业务线").locator(".ant-select-selection-placeholder").count()) await 选(page, "业务线", "外贸");
      await 格(page, "下一步计划").locator("input").fill("发报价单");
      await expect.poll(() => page.locator(".prop-ok").isDisabled()).toBe(false);
      await page.locator(".prop-ok").click();
      const 错 = page.locator(".prop-err");
      await 错.getByText("销售甲某已有该客户信息").waitFor();
      if (该有) expect(await 错.innerText()).toContain(该有);
      else expect(await 错.innerText()).not.toContain("在推项目");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
