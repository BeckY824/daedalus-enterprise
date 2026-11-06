/**
 * 企业版客户列表「列」里的可选列「客户来源」（11-05 用户）：
 *
 *   默认收着，表头没有；勾上之后多一列，显示建档时选的渠道名
 *   渠道名很长：一行省略号、悬停（title）看全文，1024 宽表格不横向撑出页面
 *   没挂渠道的客户写「—」
 *   不是企业版：列设置里没有这一项
 *
 * 自定义筛选（11-06）：默认外露的筛选不变，「客户来源」收在「更多筛选」里；
 * 可以钉到外面，恢复默认回去。勾选列不截，框旁不出小点。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "import-perm-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__push=u},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\/ImportDrawer$/, "export default function D({open}){return <div data-testid='import-drawer' data-open={String(open)}/>}");
  stub(/^\.\/export-client$/, "export const 完整导出=async()=>({ok:true});");
  stub(/^\.\/pool-actions$/, `const f=${空跑};export const 放进公海=f,领取=f,分配公海=f,撤销公海=f,退回原因选项=async()=>[];`);
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/CustomerPick$/, "export default function C(){return null}");
  // 企业版「新增客户」弹窗（10-31 会议，新客户带潜客培育项目）：向导本身另有测试，这里只看导入导出按钮
  stub(/projects\/new\/ProjectWizard$/, "export function 建档弹窗(){return null}");
  stub(/^\.\.\/channels\/actions$/, `export const saveChannel=${空跑};`);
  stub(/^(\.\/|\.\.\/)actions$/, `const f=${空跑};
    export const saveCustomer=async x=>{window.__存=x;return{ok:true,id:'new'}},checkDuplicate=async()=>null,推荐人候选=async()=>[],patchCustomer=f,
    assignSalesOwner=f,bulkFollowStatus=f,撤销改负责人=f,deleteCustomers=f,删除前清点=async()=>({}),客户删除预检=async()=>({ok:true}),转走项目预览of=async()=>({项目数:0,项目:[]}),saveChannel=f,供应商候选=async()=>[];`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import CustomersView from '@/app/(app)/customers/CustomersView';import TruncTip from '@/components/TruncTip';import CustomerForm from '@/app/(app)/customers/CustomerForm';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'小张',email:'s2',role:'SALES',active:true},{id:'boss',name:'老板',email:'b',role:'ADMIN',active:true}];
    const row={id:'c1',name:长,phone:'13800000001',school:长,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',salesOwnerId:'me',salesOwnerName:'小王',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:null,signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:'ch1',channelName:window.__来源??null,expectedSignAt:null,remark:null};
    window.__render=({what,能,锁,空,粘贴,编辑,企,来源,渠道})=>{window.__来源=来源;const row2={...row,channelName:来源??null};root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'me',name:'小王'}}><TruncTip/>{
      what==='list'?<CustomersView rows={空?[]:[row2]} total={空?0:1} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{}} 能导入导出={能} 负责人只能自己={锁} 直接粘贴={粘贴} 客户数={空?0:1} 企业版={!!企} 渠道筛选项={渠道}/>:
      <CustomerForm open editing={编辑?{id:'c1',name:'老客户',phone:'13800000001',salesOwnerId:'u2',salesOwnerName:'小张',followStatus:'待跟进',decisionStatus:'了解中',updatedAt:'2026-10-01T00:00:00.000Z'}:null} users={users} channels={[]} 负责人只能自己={锁} onClose={()=>{}}/>
    }</我Provider></BusinessProvider></App></ConfigProvider>);};
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
type 参数 = { what: "list" | "form"; 能?: boolean; 锁?: boolean; 空?: boolean; 粘贴?: boolean; 编辑?: boolean; 企?: boolean; 来源?: string | null; 渠道?: { value: string; label: string }[] };
async function open(p: 参数, width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://src.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://src.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(x => (window as unknown as { __render: (x: 参数) => void }).__render(x), { 能: true, 锁: false, ...p });
  await page.getByRole("button", { name: /新\s*建|保\s*存/ }).first().waitFor();
  return { page, errors };
}

const 长渠道 = "某某跨境电商直播间合作渠道（华东区）".repeat(3);
const 表头 = (page: import("playwright").Page) => page.locator(".ant-table-thead th").allInnerTexts();
async function 打开列设置(page: import("playwright").Page) {
  await page.getByRole("button", { name: "选择要显示的列" }).click();
  await page.locator(".ant-dropdown").waitFor();
}

it("企业版：「客户来源」默认收着，勾上才显示，长渠道名一行省略、悬停看全", async () => {
  const { page, errors } = await open({ what: "list", 企: true, 来源: 长渠道 }, 1024);
  try {
    expect((await 表头(page)).some((t) => t.includes("客户来源"))).toBe(false);
    await 打开列设置(page);
    const 勾 = page.locator(".ant-dropdown").getByText("客户来源", { exact: true });
    expect(await 勾.count()).toBe(1);
    await 勾.click();
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await 表头(page)).some((t) => t.includes("客户来源"))).toBe(true);
    const 格 = page.locator(`.ant-table-tbody span[title="${长渠道}"]`);
    expect(await 格.count()).toBe(1);
    const 量 = await 格.evaluate((el) => ({ 一行: el.getBoundingClientRect().height < 30, 省略: el.scrollWidth > el.clientWidth }));
    expect(量).toEqual({ 一行: true, 省略: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("企业版：没挂渠道的客户这一格写「—」", async () => {
  const { page, errors } = await open({ what: "list", 企: true, 来源: null });
  try {
    await 打开列设置(page);
    await page.locator(".ant-dropdown").getByText("客户来源", { exact: true }).click();
    await page.keyboard.press("Escape");
    const 列号 = await page.locator(".ant-table-thead th").evaluateAll((ths) => ths.findIndex((th) => th.textContent?.includes("客户来源")));
    expect(列号).toBeGreaterThan(-1);
    const 字 = await page.locator(".ant-table-tbody tr.ant-table-row").first().locator("td").nth(列号).innerText();
    expect(字.trim()).toBe("—");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("不是企业版：列设置里没有「客户来源」", async () => {
  const { page, errors } = await open({ what: "list", 企: false, 来源: 长渠道 });
  try {
    await 打开列设置(page);
    expect(await page.locator(".ant-dropdown").getByText("客户来源", { exact: true }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

const 渠道 = [{ value: "ch1", label: "展会渠道" }, { value: "ch2", label: "转介绍（已停用）" }];
const 外面的筛选 = (page: import("playwright").Page) => page.locator(".list-bar .ant-select").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.querySelector("[aria-label]")?.getAttribute("aria-label") ?? e.textContent?.trim() ?? ""));
const 更多筛选 = (page: import("playwright").Page) => page.locator(".list-bar").getByRole("button", { name: /更多筛选/ });

it("勾选列不截：选择框旁不出省略号小点（1024 宽）", async () => {
  const { page, errors } = await open({ what: "list", 企: true, 来源: 长渠道 }, 1024);
  try {
    const 样式 = await page.locator("tr.ant-table-row td.ant-table-selection-column").first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { overflow: s.overflow, ellipsis: s.textOverflow };
    });
    expect(样式).toEqual({ overflow: "visible", ellipsis: "clip" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("自定义筛选：默认「客户来源」收着；钉到外面弹层不关、记进本地；恢复默认收回去", async () => {
  const { page, errors } = await open({ what: "list", 企: true, 渠道 }, 1280);
  try {
    const 默认 = await 外面的筛选(page);
    expect(默认.some((t) => t.includes("客户来源"))).toBe(false);

    await 更多筛选(page).click();
    const 弹层 = page.locator(".ant-popover:visible");
    await expect.poll(() => 弹层.getByLabel("客户来源").count()).toBe(1);
    await 弹层.getByText("自定义筛选项").click();
    await 弹层.locator("label.ant-checkbox-wrapper", { hasText: "客户来源" }).click();
    await expect.poll(() => 弹层.locator("label.ant-checkbox-wrapper-checked", { hasText: "客户来源" }).count()).toBe(1);
    await 弹层.getByRole("button", { name: "返回" }).click();
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await 外面的筛选(page)).some((t) => t.includes("客户来源"))).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("list-filters:customers"))).toContain("channelId");

    await 更多筛选(page).click();
    await 弹层.getByText("自定义筛选项").click();
    await 弹层.getByRole("button", { name: "恢复默认" }).click();
    await page.keyboard.press("Escape");
    await expect.poll(async () => 外面的筛选(page)).toEqual(默认);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("1024 宽默认状态：加了「更多筛选」也不折行，按钮只留图标", async () => {
  const { page, errors } = await open({ what: "list", 企: true, 渠道 }, 1024);
  try {
    expect(await page.locator(".list-bar .cf-more-t").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    const 顶 = await page.locator(".list-bar").evaluate((b) => [...b.querySelectorAll(":scope > .ant-space > .ant-space-item, :scope > .ant-btn, :scope > .ant-dropdown-trigger")].map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(顶).size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
