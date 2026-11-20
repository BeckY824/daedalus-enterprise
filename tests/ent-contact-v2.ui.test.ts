import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* 2026-10-29 P13：企业版联系人第二轮的三处界面——
   1. 级别：10-31 起（F-客户-01）去星标只显示字母徽标，读屏念「客户级别 A 重点」
   2. 联系人表单号码撞了：框顶黄条列出撞到的那位（看得到的可点进客户页、客户页上新建能「挂到本客户」），没有「仍然保存」（11-20 号码全公司唯一）；改了表单黄条收起
   3. 客户页联系人卡的挂靠一段：挂来的摆主客户 + 说明、能解除；自家的摆「也挂在」、看不到的客户不给链接
   4. 10-31：企业版联系人「职务」下拉 19 项、也能手填；字典外的老职务原样显示；非企业版照旧「与客户关系」 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "contact-v2-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷新=(window.__刷新||0)+1},push(){}});");
  stub(/^next\/link$/, "export default function L({href,children,...p}){return <a href={href} {...p}>{children}</a>}");
  stub(/(^|\/)CustomerSearchSelect$/, "export default function Empty(){return null}");
  stub(/^\.\/pick$/, "export const 搜客户=async()=>[{id:'k9',name:'别的客户',附注:null}];");
  stub(/^\.\/actions$/, `
    export const saveUnassignedContact=async()=>({ok:true});
    // dt.contact：号码失焦先查（默认没撞；__先查撞 给了就撞那几位）
    export const 联系人号码先查=async(们,除了)=>{(window.__先查=window.__先查||[]).push([们,除了]);return {ok:true,撞了:window.__先查撞||[],...(window.__先查回收站?{回收站:window.__先查回收站}:{})};};
    export const saveContact=async(x)=>{(window.__存=window.__存||[]).push(x);
      if(x.照存) return {ok:true};
      return {ok:false,error:'撞了',撞了:[
        {contactId:'p1',name:'张三',customerId:'k1',customerName:'甲公司'.repeat(8),同事:'销售',kind:'phone',value:'13900000001'},
        {contactId:null,name:null,customerId:null,customerName:null,同事:'销售B',kind:'email',value:'a@x.com'}]};};
  `);
  stub(/^\.\/number-actions$/, "export const 从回收站捞回=async(类型,值)=>{window.__捞={类型,值};return {ok:true,提示:'已捞回',已不在:false,查:{}}};");
  stub(/^\.\/contact-link-actions$/, `
    const 记=(名)=>async(...a)=>{(window.__挂=window.__挂||[]).push([名,...a]);return {ok:true}};
    export const 挂到客户=记('挂'),改挂靠说明=记('说明'),解除挂靠=记('解除'),换主客户=记('换');
  `);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ContactForm from '@/app/(app)/customers/[id]/ContactForm';
    import ContactLinks from '@/app/(app)/customers/[id]/ContactLinks';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 壳=(x)=><ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>{x}</BusinessProvider></App></ConfigProvider>;
    const 种类=[{名:'手机',kind:'phone',active:true},{名:'邮箱',kind:'email',active:true}];
    const 人={id:'c1',name:'王五',position:null,phone:null,email:null,wechat:null,isPrimary:false,remark:null,updatedAt:'2026-01-01T00:00:00.000Z'};
    window.__表单=()=>root.render(壳(<ContactForm open onClose={()=>{}} onSaved={()=>{window.__存好=1}} customerId='k0' record={null} 号码种类={种类}/>));
    // 10-31：企业版「职务」下拉（字典 contactTitle 的 19 项），也能手填；库里已有的字典外职务原样显示
    const 职务=['董事长','总经理','CEO','董事长秘书','总经理助理','分管副总','部门总监','业务负责人','项目经理','项目设计负责人','采购','财务','法务','技术','国企高管','店长','店员','运营主管','场馆经理'];
    window.__职务=()=>root.render(壳(<ContactForm open onClose={()=>{}} onSaved={()=>{}} customerId='k0' record={null} 号码种类={种类} 职务选项={职务}/>));
    window.__职务老=()=>root.render(壳(<ContactForm open onClose={()=>{}} onSaved={()=>{}} customerId='k0' record={{...人,position:'字典外的老职务'}} 号码种类={种类} 职务选项={职务}/>));
    // 审核 11-18 新建入口 P2-6：号码在回收站里的客户上——拦下，框顶上摆「从回收站捞回」
    window.__回收站=()=>root.render(壳(<ContactForm open onClose={()=>{}} onSaved={()=>{window.__存好=1}} customerId='k0' record={null} 号码种类={种类}
      存法={async(x)=>{(window.__存=window.__存||[]).push(x);return {ok:false,error:'这个号码在回收站里的客户上，本次没保存，可以从回收站捞回',回收站:{类型:'phone',值:'13900000009'}}}}/>));
    window.__非企业=()=>root.render(壳(<ContactForm open onClose={()=>{}} onSaved={()=>{}} customerId='k0' record={null}/>));
    window.__挂靠=()=>root.render(壳(<div style={{width:300}}>
      <div data-t='挂来的'><ContactLinks customerId='k0' 只读={false} c={{...人,挂靠:{linkId:'L1',note:'采购对接',主客户Id:'k1',主客户名:'主客户甲',主客户看得到:true,能改:false}}}/></div>
      <div data-t='自家的'><ContactLinks customerId='k0' 只读={false} c={{...人,id:'c2',另挂:[{id:'k2',name:'看得到的',看得到:true},{id:'k3',name:'看不到的',看得到:false}]}}/></div>
      <div data-t='只读'><ContactLinks customerId='k0' 只读 c={{...人,id:'c3',另挂:[{id:'k2',name:'看得到的',看得到:true}]}}/></div>
    </div>));
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(画: "__表单" | "__挂靠" | "__职务" | "__职务老" | "__非企业" | "__回收站", width = 1024) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  await page.route("http://cv2.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://cv2.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(f => (window as unknown as Record<string, () => void>)[f](), 画);
  return page;
}

it("号码撞了：黄条列出撞到的人（可点、可挂到本客户）、看不到的只说负责人；没有仍然保存 / 仍然新建；改表单黄条收起", async () => {
  const page = await open("__表单");
  try {
    await page.getByLabel("姓名").fill("李四");
    // 号码那一行：类型默认手机，填号
    await page.getByPlaceholder(/号码/).first().fill("13900000001");
    await page.getByRole("button", { name: /^保\s?存$/ }).click();
    const 条 = page.locator(".ant-alert-warning");
    await 条.waitFor();
    expect(await 条.innerText()).toContain("这些号码已经记在别的联系人或客户身上，本次没保存");
    expect(await 条.getByRole("link", { name: /张三/ }).getAttribute("href")).toBe("/customers/k1");
    expect(await 条.innerText()).toContain("销售B名下的一位联系人（不在你的范围，可与他核实）");
    // 超长客户名不把弹框撑宽
    const [条宽, 框宽] = await page.evaluate(() => [document.querySelector(".ant-alert-warning")!.scrollWidth, document.querySelector(".ant-modal")!.clientWidth]);
    expect(条宽).toBeLessThanOrEqual(框宽);
    await 条.getByRole("button", { name: /挂到本/ }).click();
    await page.waitForFunction(() => (window as unknown as { __存好?: number }).__存好 === 1);
    expect(await page.evaluate(() => (window as unknown as { __挂: unknown[] }).__挂)).toEqual([["挂", "p1", "k0"]]);
  } finally { await page.close(); }

  const p2 = await open("__表单");
  try {
    await p2.getByLabel("姓名").fill("李四");
    await p2.getByPlaceholder(/号码/).first().fill("13900000001");
    await p2.getByRole("button", { name: /^保\s?存$/ }).click();
    await p2.locator(".ant-alert-warning").waitFor();
    // 号码全公司唯一（11-20）：没有「仍然新建 / 仍然保存」，黄条说清不能重复登记
    expect(await p2.getByRole("button", { name: /仍然/ }).count()).toBe(0);
    expect(await p2.locator(".ant-alert-warning").innerText()).toContain("号码全公司唯一，不能重复登记");
    const 存 = await p2.evaluate(() => (window as unknown as { __存: { 照存?: boolean }[] }).__存.map(x => !!x.照存));
    expect(存).toEqual([false]);
  } finally { await p2.close(); }

  const p3 = await open("__表单");
  try {
    await p3.getByLabel("姓名").fill("李四");
    await p3.getByPlaceholder(/号码/).first().fill("13900000001");
    await p3.getByRole("button", { name: /^保\s?存$/ }).click();
    await p3.locator(".ant-alert-warning").waitFor();
    await p3.getByPlaceholder(/号码/).first().fill("13900000002");
    await p3.locator(".ant-alert-warning").waitFor({ state: "detached" });
  } finally { await p3.close(); }
});

it("dt.contact：号码一失焦就查，撞了不等点保存就摆黄条（挂到本客户，没有仍然新建）；没撞不摆", async () => {
  const page = await open("__表单");
  try {
    await page.getByLabel("姓名").fill("李四");
    // 没撞：失焦查了一遍，不摆黄条
    await page.getByPlaceholder(/号码/).first().fill("13900000009");
    await page.getByLabel("姓名").click();
    await page.waitForFunction(() => ((window as unknown as { __先查?: unknown[] }).__先查 ?? []).length === 1);
    expect(await page.locator(".ant-alert-warning").count()).toBe(0);
    const 查的 = await page.evaluate(() => (window as unknown as { __先查: [{ kind: string; value: string }[], unknown][] }).__先查[0]);
    expect(查的[0]).toEqual([{ kind: "phone", value: "13900000009" }]);
    expect(查的[1]).toBeNull();
    // 撞了：失焦就摆，标题说先核对（还没保存）
    await page.evaluate(() => { (window as unknown as { __先查撞: unknown[] }).__先查撞 = [{ contactId: "p1", name: "张三", customerId: "k1", customerName: "甲公司", 同事: "销售", kind: "phone", value: "13900000001" }]; });
    await page.getByPlaceholder(/号码/).first().fill("13900000001");
    await page.getByLabel("姓名").click();
    const 条 = page.locator(".ant-alert-warning");
    await 条.waitFor();
    expect(await 条.innerText()).toContain("这个号码已经记在别的联系人或客户身上，先核对一下");
    expect(await page.evaluate(() => (window as unknown as { __存?: unknown[] }).__存 ?? [])).toEqual([]);
    await 条.getByRole("button", { name: /挂到本/ }).waitFor();
    expect(await 条.getByRole("button", { name: /仍然/ }).count()).toBe(0);
  } finally { await page.close(); }
});

it("撞号那一句按真给得出的动作说（11-20 3703 实操）：看不到的 / 客户本身只叫改号码；本客户自己的联系人说清是哪位；看得到的别家才提挂", async () => {
  const 情形: [string, unknown[], RegExp | string, boolean][] = [
    ["看不到的", [{ contactId: null, name: null, customerId: null, customerName: null, 同事: "销售B", kind: "phone", value: "13900000001" }], "号码全公司唯一，不能重复登记：核对后改号码", false],
    ["客户本身", [{ contactId: null, name: null, customerId: "k1", customerName: "甲公司", 同事: "销售", kind: "phone", value: "13900000001", 客户本身: true }], "号码全公司唯一，不能重复登记：核对后改号码", false],
    ["本客户自己的", [{ contactId: "p2", name: "总机甲", customerId: "k0", customerName: "本家", 同事: "销售", kind: "phone", value: "13900000001" }], "本客户已有联系人「总机甲」用了这个号码，号码全公司唯一，请改号码", false],
    ["看得到的别家", [{ contactId: "p1", name: "张三", customerId: "k1", customerName: "甲公司", 同事: "销售", kind: "phone", value: "13900000001" }], "号码全公司唯一，不能重复登记：核对后改号码，或把那位挂到本客户", true],
  ];
  for (const [名, 撞, 话, 有挂] of 情形) {
    const page = await open("__表单");
    try {
      await page.evaluate((x) => { Reflect.set(window, "__先查撞", x); }, 撞);
      await page.getByLabel("姓名").fill("李四");
      await page.getByPlaceholder(/号码/).first().fill("13900000001");
      await page.getByLabel("姓名").click();
      const 条 = page.locator(".ant-alert-warning");
      await 条.waitFor();
      expect(await page.getByTestId("contact-dup-advice").innerText(), 名).toBe(话);
      expect(await 条.getByRole("button", { name: /挂到本/ }).count(), `${名} 挂键`).toBe(有挂 ? 1 : 0);
    } finally { await page.close(); }
  }
});

it("号码在回收站里（11-20 3703 实操）：失焦就摆「从回收站捞回」，不等点保存（同建档向导）；改号码收起", async () => {
  const page = await open("__表单");
  try {
    await page.evaluate(() => { Reflect.set(window, "__先查回收站", { 类型: "手机号", 值: "13900000009" }); });
    await page.getByLabel("姓名").fill("李四");
    await page.getByPlaceholder(/号码/).first().fill("13900000009");
    await page.getByLabel("姓名").click();
    const 条 = page.getByTestId("contact-trash-hit");
    await 条.waitFor();
    expect(await 条.innerText()).toContain("这个号码在回收站里的客户上，先捞回或改号码");
    await 条.getByTestId("rescue-from-trash").waitFor();
    // 还没点保存
    expect(await page.evaluate(() => Reflect.get(window, "__存") ?? [])).toEqual([]);
    await page.getByPlaceholder(/号码/).first().fill("13900000010");
    await 条.waitFor({ state: "detached" });
  } finally { await page.close(); }
});

it("挂靠一段：挂来的摆主客户和说明、能解除不能换；自家的摆也挂在、看不到的不给链接；只读不给按钮", async () => {
  const page = await open("__挂靠");
  try {
    const 挂来 = page.locator("[data-t='挂来的']");
    await 挂来.getByText("主客户甲").waitFor();
    expect(await 挂来.getByRole("link", { name: "主客户甲" }).getAttribute("href")).toBe("/customers/k1");
    expect(await 挂来.innerText()).toContain("采购对接");
    expect(await 挂来.getByRole("button", { name: "改到这位名下" }).count()).toBe(0);
    await 挂来.getByRole("button", { name: "解除挂靠" }).click();
    await 挂来.getByRole("button", { name: /^解\s?除$/ }).click();
    await page.waitForFunction(() => ((window as unknown as { __挂?: unknown[] }).__挂 ?? []).length === 1);
    expect(await page.evaluate(() => (window as unknown as { __挂: unknown[] }).__挂)).toEqual([["解除", "L1"]]);

    const 自家 = page.locator("[data-t='自家的']");
    expect(await 自家.getByRole("link", { name: "看得到的" }).count()).toBe(1);
    expect(await 自家.getByRole("link", { name: "看不到的" }).count()).toBe(0);
    expect(await 自家.getByText("看不到的").getAttribute("title")).toContain("不在你的范围");
    expect(await 自家.getByRole("button", { name: "挂到别的客户" }).count()).toBe(1);
    expect(await 自家.getByRole("button", { name: "换主客户" }).count()).toBe(1);

    const 只读 = page.locator("[data-t='只读']");
    expect(await 只读.innerText()).toContain("也挂在");
    expect(await 只读.getByRole("button").count()).toBe(0);

    // 挂到别的客户：挑一位、填说明、挂上
    await 自家.getByRole("button", { name: "挂到别的客户" }).click();
    await 自家.getByRole("combobox").click();
    await page.locator(".ant-select-item-option", { hasText: "别的客户" }).click();
    await 自家.getByLabel("职位 / 关系说明").fill("顾问");
    await 自家.getByRole("button", { name: /^挂\s?上$/ }).click();
    await page.waitForFunction(() => (window as unknown as { __挂: unknown[] }).__挂.length === 2);
    expect(await page.evaluate(() => (window as unknown as { __挂: unknown[] }).__挂[1])).toEqual(["挂", "c2", "k9", "顾问"]);
  } finally { await page.close(); }
});

it("企业版「职务」：下拉给字典 19 项（打字筛）、选得上；也能手填字典外的；老职务原样显示；非企业版照旧", async () => {
  const page = await open("__职务");
  try {
    const 格 = page.getByRole("combobox", { name: "职务" });
    await 格.click();
    const 项 = page.locator(".ant-select-item-option");
    await 项.first().waitFor();
    expect(await 项.first().innerText()).toBe("董事长");
    // 下拉是虚拟列表，只渲染看得见的几行：打字筛到最后一项，证明 19 项都在
    await 格.fill("场馆");
    await page.locator(".ant-select-item-option", { hasText: "场馆经理" }).click();
    expect(await 格.inputValue()).toBe("场馆经理");
    // 手填字典外的叫法，提交时原样带上
    await 格.fill("外聘顾问");
    await page.keyboard.press("Escape");
    await page.getByLabel("姓名").fill("李四");
    await page.getByRole("button", { name: /^保\s?存$/ }).click();
    await page.waitForFunction(() => ((window as unknown as { __存?: unknown[] }).__存 ?? []).length > 0);
    expect(await page.evaluate(() => (window as unknown as { __存: { position?: string }[] }).__存[0].position)).toBe("外聘顾问");
  } finally { await page.close(); }

  const p2 = await open("__职务老");
  try {
    expect(await p2.getByRole("combobox", { name: "职务" }).inputValue()).toBe("字典外的老职务");
  } finally { await p2.close(); }

  const p3 = await open("__非企业");
  try {
    await p3.getByLabel("姓名").waitFor();
    expect(await p3.getByText("职务", { exact: true }).count()).toBe(0);
    expect(await p3.getByText(/^与.+关系$/).count()).toBe(1);
  } finally { await p3.close(); }
});

it("号码在回收站里的客户上（审核 11-18 新建入口 P2-6）：没保存，框顶上说清并摆「从回收站捞回」；捞回带这个号；改表单提示收起；1024 / 1280 / 1366", async () => {
  for (const w of [1024, 1280, 1366]) {
    const page = await open("__回收站", w);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    try {
      await page.getByLabel("姓名").fill("李四");
      await page.getByPlaceholder(/号码/).first().fill("13900000009");
      await page.getByRole("button", { name: /^保\s?存$/ }).click();
      const 条 = page.getByTestId("contact-trash-hit");
      await 条.waitFor();
      expect(await 条.innerText()).toContain("这个号码在回收站里的客户上，本次没保存");
      expect(await page.evaluate(() => Reflect.get(window, "__存好") ?? null)).toBeNull();
      await 条.getByTestId("rescue-from-trash").click();
      await page.locator(".ant-popconfirm").getByRole("button", { name: /捞\s*回/ }).click();
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__捞") ?? null)).toEqual({ 类型: "phone", 值: "13900000009" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByLabel("姓名").fill("李四五");
      await expect.poll(() => 条.count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
