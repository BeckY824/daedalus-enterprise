/**
 * PR5b 渠道 + 附件的确认与反馈（原型 ch.toggle / ch.delinv / ch.invest、P-界面-40「删附件」原地确认、g.save 不弹顶部提示）：
 *   停用渠道：从「⋯」点进来就地问一句，不点「停用」不调 toggleChannel；被挡（ok:false）原因写在这一行，不出「已停用」、不弹顶部提示
 *   删投入：垃圾桶就地确认，取消不调 deleteChannelInvest；确认了这一行收掉；被挡原因就地写、行还在
 *   附件：删掉要就地确认一次，取消不发 DELETE；服务端拒了原因写在附件块里，附件还在，不弹顶部提示
 *   1024 宽 + 超长渠道名：问句展开时页面不横滚
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const 长名 = "某某超长跨境电商直播间合作渠道（华东区旗舰店）".repeat(3);
const plugin: Plugin = { name: "pr5b-ch-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/actions$/, `const 记=(名)=>async (...x)=>{(window.__存=window.__存||[]).push([名,x]);return window.__挡?{ok:false,error:'没有权限改这个渠道'}:{ok:true,id:'x'}};
    export const saveChannel=记('saveChannel'),toggleChannel=记('toggleChannel'),deleteChannel=记('deleteChannel'),saveMainChannel=记('saveMainChannel'),toggleMainChannel=记('toggleMainChannel'),deleteMainChannel=记('deleteMainChannel'),addChannelInvest=记('addChannelInvest'),deleteChannelInvest=记('deleteChannelInvest');
    export const listChannelInvests=async()=>({ok:true,能录:true,rows:[{id:'i1',amount:1200,currency:'CNY',date:'2026-11-01',remark:'十月投流',userName:'小王',createdAt:'2026-11-01T00:00:00Z'},{id:'i2',amount:300,currency:'CNY',date:'2026-11-02',remark:null,userName:'小王',createdAt:'2026-11-02T00:00:00Z'}]});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import ChannelsView from '@/app/(app)/channels/ChannelsView';import AttachmentsPanel from '@/components/AttachmentsPanel';
    const root=createRoot(document.getElementById('root'));
    const 长名=${JSON.stringify(长名)};
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true},{id:'u1',name:'运营甲',email:'a',role:'SALES',active:true}];
    const 壳=(x)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'me',name:'小王'}}>{x}</我Provider></BusinessProvider></App></ConfigProvider>);
    const 统=(n)=>({关联线索:n,有效线索:n,关联商机:1,关联订单:0,关联项目:n,累计成交:[],当前投入:[],产出比:null,产出比说明:'还没录投入',累计运营天数:3,线索转商机:{分子:1,分母:n,比例:1/n},商机转订单:{分子:0,分母:0,比例:null}});
    const 行=(id,name)=>({id,name,phone:null,remark:null,active:true,attr:'公域引流',platform:name,mainId:null,strategies:[],endDate:null,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',createdByName:'QA',channelOwnerId:'me',channelOwnerName:'小王',统计:统(2),客户数:0,投入数:0,项目数:0});
    const rows=[行('a',长名),行('b','抖音官方号')];
    window.__channels=()=>壳(<ChannelsView rows={rows} users={users} 属性选项={['公域引流']} 能管/>);
    window.__附件=()=>壳(<AttachmentsPanel 归属={{projectId:'p1'}} 紧凑/>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number, 画: "__channels" | null, 挡 = false) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://ch5b.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ch5b.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => { (window as unknown as { __挡: boolean }).__挡 = x; }, 挡);
  if (画) await page.evaluate((k) => (window as unknown as Record<string, () => void>)[k](), 画);
  return { page, errors };
}
const 存的 = (page: Page) => page.evaluate(() => ((window as unknown as { __存?: [string, unknown[]][] }).__存 ?? []).map((x) => x[0]));
const 页不横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const 没顶部提示 = async (page: Page) => expect(await page.locator(".ant-message-notice").count()).toBe(0);

async function 点停用(page: Page, 名: string) {
  await page.getByRole("button", { name: `更多操作 ${名}` }).click();
  await page.getByRole("menuitem", { name: "停用" }).click();
}

it("停用渠道：就地问一句，取消不调；确认才调 toggleChannel；不弹顶部提示", async () => {
  const { page, errors } = await open(1366, "__channels");
  try {
    await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor();
    await 点停用(page, "抖音官方号");
    await page.getByText("停用后新线索里选不到").waitFor();
    await page.getByRole("button", { name: "取消" }).click();
    expect(await 存的(page)).toEqual([]);
    await 点停用(page, "抖音官方号");
    await page.getByRole("button", { name: "停用", exact: true }).click();
    await expect.poll(() => 存的(page)).toEqual(["toggleChannel"]);
    await 没顶部提示(page);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("停用渠道被挡：原因写在这一行，不出「已停用」成功话、不弹顶部提示", async () => {
  const { page } = await open(1366, "__channels", true);
  try {
    await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor();
    await 点停用(page, "抖音官方号");
    await page.getByRole("button", { name: "停用", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "没有权限改这个渠道" }).first().waitFor();
    expect(await page.getByText(/已停用$/).count()).toBe(0);
    await 没顶部提示(page);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("%ipx：超长渠道名那一行展开停用问句，页面不横滚", async (w) => {
  const { page } = await open(w, "__channels");
  try {
    await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor();
    await 点停用(page, 长名);
    await page.getByText("停用后新线索里选不到").waitFor();
    expect(await 页不横滚(page)).toBe(true);
    // 确认键点得中（没被别的东西盖住）
    const 停用键 = page.getByRole("button", { name: "停用", exact: true });
    await 停用键.scrollIntoViewIfNeeded();
    expect(await 页不横滚(page)).toBe(true);
    const 中 = await 停用键.evaluate((el) => {
      const r = el.getBoundingClientRect(); const x = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!x && (x === el || el.contains(x)) ? true : `${x?.tagName}.${x?.className} @${Math.round(r.left)},${Math.round(r.top)}`;
    });
    expect(中).toBe(true);
  } finally { await page.close(); }
});

it("删投入：取消不调；确认了这一行收掉、不弹顶部提示；被挡原因就地写、行还在", async () => {
  for (const 挡 of [false, true]) {
    const { page } = await open(1366, "__channels", 挡);
    try {
      await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor();
      await page.locator("button.chan-name", { hasText: "抖音官方号" }).first().click();
      await page.getByText("十月投流").waitFor();
      await page.getByRole("button", { name: "删除这笔投入" }).first().click();
      await page.getByText("删除这笔投入？").waitFor();
      await page.getByRole("button", { name: "取消" }).click();
      expect(await 存的(page)).toEqual([]);
      await page.getByRole("button", { name: "删除这笔投入" }).first().click();
      await page.getByRole("button", { name: "删除", exact: true }).click();
      await expect.poll(() => 存的(page)).toEqual(["deleteChannelInvest"]);
      if (挡) {
        await page.getByRole("alert").filter({ hasText: "没有权限改这个渠道" }).first().waitFor();
        expect(await page.getByText("十月投流").count()).toBe(1);
      } else {
        await page.getByText("十月投流").waitFor({ state: "detached" });
      }
      await 没顶部提示(page);
    } finally { await page.close(); }
  }
});

it("附件：删掉要就地确认，取消不发 DELETE；服务端拒了原因写在附件块里、附件还在、不弹顶部提示", async () => {
  const { page } = await open(1024, null);
  const 删请求: string[] = [];
  try {
    await page.route("http://ch5b.test/api/attachments**", (r) => {
      if (r.request().method() === "DELETE") { 删请求.push(r.request().url()); return r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "只有负责人能删附件" }) }); }
      return r.fulfill({ contentType: "application/json", body: JSON.stringify({ 附件: [{ id: "a1", name: 长名 + ".pdf", mime: "application/pdf", size: 1024, 有文件: true }] }) });
    });
    await page.evaluate(() => (window as unknown as Record<string, () => void>).__附件());
    await page.getByRole("button", { name: `删掉 ${长名}.pdf` }).click();
    await page.getByText("删掉这个？").waitFor();
    expect(await 页不横滚(page)).toBe(true);
    await page.getByRole("button", { name: "取消" }).click();
    expect(删请求).toEqual([]);
    await page.getByRole("button", { name: `删掉 ${长名}.pdf` }).click();
    await page.getByRole("button", { name: "删掉", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "只有负责人能删附件" }).waitFor();
    expect(删请求.length).toBe(1);
    expect(await page.getByTestId("attachment-item").count()).toBe(1);
    await 没顶部提示(page);
  } finally { await page.close(); }
});
