/**
 * 首页新线索卡（企业版）的联系方式：类型 + 号码几行（11-17 员工反馈「只能填电话」；服务端见 ent-ai-lead-contact-type.test.ts）。
 *
 *   类型下拉八种（顺序同号码类型取值表），AI 判断的类型人能改；可加多条、能删到剩一条
 *   联系人姓名选填：不填照样能确认；号码全空不能确认（还差联系方式）
 *   老卡（只有电话 / 微信那几格）：并成几行，电话当手机，交上去不再带老格
 *   Windows 1024 / 1280 / 1366：加满几行、超长号码也不横向撑出，「确认」点得中
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ai-lead-numbers-boundaries", setup(b) {
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
    const 企={成员:[{value:'u1',label:'乙'}],分配方式们:[{i:4,名:'个人自持'}],默认分配方式:4,是销售:true};
    window.__render=(补={})=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>
      <新线索来源.Provider value={['展会']}><新线索企业.Provider value={企}>
        <div className="cli-col"><ProposalCard proposal={{id:'p1',kind:'add_lead',customerId:'',customerName:'',reason:'x',name:'测试科技',contact:'',phone:'',source:'展会',status:'待跟进',remark:'',业务线:'内贸',...补}}/></div>
      </新线索企业.Provider></新线索来源.Provider>
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number, 补: Record<string, unknown> = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://numbers.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://numbers.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate((a) => (window as unknown as { __render: (a: unknown) => void }).__render(a), 补);
  await page.locator(".prop-ok").waitFor();
  return { page, errors };
}
const 行 = (page: Page) => page.locator("[data-testid=lead-numbers] .prop-num");
const 交上去的 = (page: Page) => page.evaluate(() => (window as unknown as { __交: Record<string, unknown> }).__交);
const 不横撑 = (page: Page) => page.evaluate(() => {
  const 卡 = document.querySelector(".prop")!.getBoundingClientRect();
  const 出界 = [...document.querySelectorAll(".prop .prop-f, .prop .prop-num")].filter(e => e.getBoundingClientRect().right > 卡.right + 1).length;
  const ok = document.querySelector(".prop-ok")!.getBoundingClientRect();
  return { 页: document.documentElement.scrollWidth <= window.innerWidth, 出界, 确认点得中: document.elementFromPoint(ok.x + ok.width / 2, ok.y + ok.height / 2)?.closest(".prop-ok") !== null };
});
/** 上一个下拉收起（有动画）之前别开下一个，不然 :visible 会认到正在收的那个 */
const 下拉都收了 = (page: Page) => expect.poll(() => page.locator(".ant-select-dropdown:visible").count()).toBe(0);
async function 选类型(page: Page, i: number, 项: string) {
  await 下拉都收了(page);
  await 行(page).nth(i).locator(".ant-select").click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: new RegExp(`^${项}$`) }).first().click();
}

it("类型下拉八种、可改；可加多条、可删；联系人不填也能确认，交上去按类型（1024 / 1280 / 1366）", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await open(w, { 联系方式: [{ kind: "phone", value: "wx_test01" }] });
    try {
      expect(await page.locator(".prop-f-l:text-is('电话')").count()).toBe(0);
      expect(await 行(page).count()).toBe(1);
      // AI 判错了类型（把微信号当手机）：人在卡上改
      await 行(page).nth(0).locator(".ant-select").click();
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option").first().waitFor();
      // 下拉刚打开、还在展开动画时 innerText 可能是空的：等到文字出来再比
      await expect.poll(() => page.locator(".ant-select-dropdown:visible .ant-select-item-option").allInnerTexts()).toEqual(["手机", "座机", "微信", "邮箱", "WhatsApp", "阿里国际站ID", "传真", "Telegram"]);
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: /^微信$/ }).click();
      // 加两条：座机 + 超长邮箱
      await page.getByRole("button", { name: "加一个联系方式" }).click();
      await 选类型(page, 1, "座机");
      await 行(page).nth(1).locator("input[aria-label=号码]").fill("021-5555 0101");
      await page.getByRole("button", { name: "加一个联系方式" }).click();
      await 选类型(page, 2, "邮箱");
      await 行(page).nth(2).locator("input[aria-label=号码]").fill(`${"very.long.mailbox.name".repeat(3)}@example-international-trading.com`);
      expect(await 不横撑(page)).toEqual({ 页: true, 出界: 0, 确认点得中: true });
      // 删掉超长那条
      await 行(page).nth(2).getByRole("button", { name: "去掉这一行" }).click();
      expect(await 行(page).count()).toBe(2);
      expect(await page.locator(".prop-ok").isDisabled()).toBe(false);
      await page.locator(".prop-ok").click();
      await page.waitForFunction(() => !!(window as unknown as { __交?: unknown }).__交);
      const 交 = await 交上去的(page);
      expect(交.联系方式).toEqual([{ kind: "wechat", value: "wx_test01" }, { kind: "landline", value: "021-5555 0101" }]);
      expect(交.contact).toBe("");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
}, 90_000);

it("号码全空不能确认，写明还差联系方式；剩一条时没有删除钮", async () => {
  const { page } = await open(1280);
  try {
    expect(await 行(page).count()).toBe(1);
    expect(await 行(page).getByRole("button", { name: "去掉这一行" }).count()).toBe(0);
    expect(await page.locator(".prop-ok").isDisabled()).toBe(true);
    expect(await page.locator(".prop-note").innerText()).toContain("联系方式");
    expect(await page.locator(".prop-note").innerText()).not.toContain("联系人姓名");
  } finally { await page.close(); }
});

it("老卡：电话、微信、WhatsApp 并成几行（电话当手机），黄标并成一个；交上去不带老格", async () => {
  const { page } = await open(1024, { id: "card-x", phone: "13800000101", wechat: "wx_test02", whatsapp: "+44 7700 900101", 待确认: ["phone", "wechat"] });
  try {
    expect(await 行(page).count()).toBe(3);
    expect(await 行(page).locator(".ant-select-content").allInnerTexts()).toEqual(["手机", "微信", "WhatsApp"]);
    expect(await page.locator(".prop-f-l:text-is('微信')").count()).toBe(0);
    expect(await page.locator(".prop-f-wait").count()).toBe(1);
    await page.locator(".prop-f-wait").click();
    await page.locator(".prop-ok").click();
    await page.waitForFunction(() => !!(window as unknown as { __交?: unknown }).__交);
    const 交 = await 交上去的(page);
    expect(交.联系方式).toEqual([{ kind: "phone", value: "13800000101" }, { kind: "wechat", value: "wx_test02" }, { kind: "whatsapp", value: "+44 7700 900101" }]);
    expect([交.phone, 交.wechat, 交.whatsapp]).toEqual(["", undefined, undefined]);
  } finally { await page.close(); }
});
