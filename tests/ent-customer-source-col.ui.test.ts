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
 *
 * F-049（11-25）：「客户来源」下拉「未填」在最前，渠道触点单列一组，渠道一组；选上触点 / 未填进地址栏 channelId；
 * 长渠道名一行省略（悬停看全），手机宽 390 打开下拉不横向撑出页面
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { 客户来源筛选项, 来源未填, 触点前缀 } from "@/lib/enterprise/customer-source-filter";

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
  // 表单那两份料点开才取（11-15，form-data-action.ts）：首屏给了 channels 的用例用不上；没给的点开拿这一份
  stub(/^\.\/form-data-action$/, "export const 取客户页表单料=async()=>({channels:window.__表单渠道??[],建档:window.__表单建档??null});");
  // 企业版「新增客户」弹窗（10-31 会议，新客户带潜客培育项目）：向导本身另有测试，这里只看导入导出按钮
  stub(/projects\/new\/ProjectWizard$/, "export function 建档弹窗(){return null}");
  // 页头「新建 ▾ → 新建项目」那条路（projects/NewProjectFlow.tsx，点了才挂）：里面的选客户、建项目都是 server action，这里换成一块牌子
  stub(/projects\/NewProjectFlow$/, "export default function F(){return <div className='new-proj-flow-stub'/>}");
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
    window.__render=({what,能,锁,空,粘贴,编辑,企,来源,渠道,触点,筛,市场})=>{window.__来源=来源;const row2={...row,channelName:来源??null,touchpoint:触点??null};root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'me',name:'小王'}}><TruncTip/>{
      what==='list'?<CustomersView rows={空?[]:[row2]} total={空?0:1} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={筛??{}} 项目看板={!!市场} 市场视图={!!市场} 能导入导出={能} 负责人只能自己={锁} 直接粘贴={粘贴} 客户数={空?0:1} 企业版={!!企} 渠道筛选项={渠道}/>:
      <CustomerForm open editing={编辑?{id:'c1',name:'老客户',phone:'13800000001',salesOwnerId:'u2',salesOwnerName:'小张',followStatus:'待跟进',decisionStatus:'了解中',updatedAt:'2026-10-01T00:00:00.000Z'}:null} users={users} channels={[]} 负责人只能自己={锁} onClose={()=>{}}/>
    }</我Provider></BusinessProvider></App></ConfigProvider>);};
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
type 参数 = { what: "list" | "form"; 能?: boolean; 锁?: boolean; 空?: boolean; 粘贴?: boolean; 编辑?: boolean; 企?: boolean; 来源?: string | null; 渠道?: ReturnType<typeof 客户来源筛选项> | { value: string; label: string }[]; 触点?: string | null; 筛?: Record<string, string>; 市场?: boolean; 地址?: string };
async function open(p: 参数, width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://src.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto(`http://src.test/${p.地址 ?? ""}`); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(x => (window as unknown as { __render: (x: 参数) => void }).__render(x), { 能: true, 锁: false, ...p });
  await page.getByRole("button", { name: /新\s*建|保\s*存/ }).first().waitFor();
  return { page, errors };
}

// expect.poll 默认只等 1 秒，并发负载下不够：统一放宽到 5 秒
const 轮询 = <T,>(fn: () => T | Promise<T>) => expect.poll(fn, { timeout: 5000 });
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
    await 轮询(async () => (await 表头(page)).some((t) => t.includes("客户来源"))).toBe(true);
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

it("企业版：没主渠道、只挂触点的客户这一格写「公司资源（触点）」（F-049 审查，和下拉一个写法）", async () => {
  const { page, errors } = await open({ what: "list", 企: true, 来源: null, 触点: "公司资源" });
  try {
    await 打开列设置(page);
    await page.locator(".ant-dropdown").getByText("客户来源", { exact: true }).click();
    await page.keyboard.press("Escape");
    const 列号 = await page.locator(".ant-table-thead th").evaluateAll((ths) => ths.findIndex((th) => th.textContent?.includes("客户来源")));
    expect(列号).toBeGreaterThan(-1);
    const 格 = page.locator(".ant-table-tbody tr.ant-table-row").first().locator("td").nth(列号);
    expect((await 格.innerText()).trim()).toBe("公司资源（触点）");
    expect(await 格.locator('span[title="公司资源（触点）"]').count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const [值, 该去] of [["未填", "/customers"], ["触点:客户介绍", "/customers"], ["ch1", "/customers?channelId=ch1"]] as const) {
  it(`市场角色切「我分出去的」：客户来源筛的是 ${值} 时${值 === "ch1" ? "留着" : "channelId 一并去掉"}（F-049 审查）`, async () => {
    const { page, errors } = await open({ what: "list", 企: true, 市场: true, 筛: { channelId: 值 }, 地址: `?${new URLSearchParams({ channelId: 值, scope: "mine" })}` }, 1280);
    try {
      await page.getByText("我分出去的", { exact: true }).click();
      await 轮询(() => page.evaluate(() => (window as unknown as { __push?: string }).__push ?? "")).toBe(该去);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

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
    await 轮询(() => 弹层.getByLabel("客户来源").count()).toBe(1);
    await 弹层.getByText("自定义筛选项").click();
    await 弹层.locator("label.ant-checkbox-wrapper", { hasText: "客户来源" }).click();
    await 轮询(() => 弹层.locator("label.ant-checkbox-wrapper-checked", { hasText: "客户来源" }).count()).toBe(1);
    await 弹层.getByRole("button", { name: "返回" }).click();
    await page.keyboard.press("Escape");
    await 轮询(async () => (await 外面的筛选(page)).some((t) => t.includes("客户来源"))).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("list-filters:customers"))).toContain("channelId");

    await 更多筛选(page).click();
    await 弹层.getByText("自定义筛选项").click();
    await 弹层.getByRole("button", { name: "恢复默认" }).click();
    await page.keyboard.press("Escape");
    await 轮询(async () => 外面的筛选(page)).toEqual(默认);
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

describe("客户来源下拉：未填 + 渠道触点一组（F-049）", () => {
  const 组 = 客户来源筛选项([{ value: "ch1", label: "展会渠道" }, { value: "ch2", label: "公司资源（已停用）" }, { value: "ch3", label: 长渠道 }]);
  async function 打开来源下拉(page: import("playwright").Page) {
    await 更多筛选(page).click();
    const 弹层 = page.locator(".ant-popover:visible");
    await 弹层.getByLabel("客户来源").click();
    const 下拉 = page.locator(".ant-select-dropdown:visible");
    await 下拉.waitFor();
    // 选项是下拉展开后才渲染（虚拟列表）：等到第一条选项文字出现再交出去，读选项不抢跑
    await 下拉.locator(".ant-select-item").first().waitFor();
    await 轮询(() => 下拉.locator(".ant-select-item").count()).toBeGreaterThan(0);
    return 下拉;
  }

  for (const 宽 of [1280, 390]) it(`${宽} 宽：未填在最前、触点单列一组；选上进地址栏；长名一行省略、不横向撑出页面`, async () => {
    const { page, errors } = await open({ what: "list", 企: true, 渠道: 组 }, 宽);
    try {
      const 下拉 = await 打开来源下拉(page);
      const 条们 = await 下拉.locator(".ant-select-item").evaluateAll((els) => els.map((e) => `${e.classList.contains("ant-select-item-group") ? "#" : ""}${e.textContent?.trim()}`));
      expect(条们.slice(0, 7)).toEqual(["未填", "#渠道触点", "公司资源（触点）", "客户介绍（触点）", "#渠道", "展会渠道", "公司资源（已停用）"]);
      // 长渠道名：一行、省略号
      const 长那条 = 下拉.locator(".ant-select-item-option-content", { hasText: "某某跨境电商" });
      expect(await 长那条.evaluate((el) => [getComputedStyle(el).whiteSpace, getComputedStyle(el).textOverflow, el.scrollWidth > el.clientWidth])).toEqual(["nowrap", "ellipsis", true]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // 下拉整个在屏幕里（不按长名撑到屏幕外）；悬停长名浮出全文
      expect(await 下拉.evaluate((d) => { const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; })).toBe(true);
      // 悬停全文：每轮重新悬停（鼠标事件可能早于浮层挂载），等到非空再断言
      await 轮询(async () => { await 长那条.hover(); return (await page.locator(".trunc-tip").textContent({ timeout: 1000 }).catch(() => "")) ?? ""; }).toBe(长渠道);
      // 搜「公司资源」触点和停用的同名渠道都出来
      await page.keyboard.type("公司资源");
      await 轮询(() => 下拉.locator(".ant-select-item-option").allInnerTexts()).toEqual(["公司资源（触点）", "公司资源（已停用）"]);
      await 下拉.locator(".ant-select-item-option", { hasText: "公司资源（触点）" }).click();
      await 轮询(() => page.evaluate(() => (window as unknown as { __push?: string }).__push ?? "")).toContain(`channelId=${encodeURIComponent(`${触点前缀}公司资源`)}`);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("选「未填」进地址栏 channelId=未填；框里一行写「未填」", async () => {
    const { page, errors } = await open({ what: "list", 企: true, 渠道: 组 }, 1024);
    try {
      const 下拉 = await 打开来源下拉(page);
      await 下拉.locator(".ant-select-item-option", { hasText: 来源未填 }).first().click();
      await 轮询(() => page.evaluate(() => (window as unknown as { __push?: string }).__push ?? "")).toContain(`channelId=${encodeURIComponent(来源未填)}`);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
});

it("钉到外面：没选时框 160 宽；选中「客户介绍（触点）」框里一行写全、不截成「…」（F-049 审查，1280 宽）", async () => {
  const 组 = 客户来源筛选项([{ value: "ch1", label: "展会渠道" }]);
  const { page, errors } = await open({ what: "list", 企: true, 渠道: 组 }, 1280);
  try {
    await 更多筛选(page).click();
    const 弹层 = page.locator(".ant-popover:visible");
    await 弹层.getByText("自定义筛选项").click();
    await 弹层.locator("label.ant-checkbox-wrapper", { hasText: "客户来源" }).click();
    await 弹层.getByRole("button", { name: "返回" }).click();
    await page.keyboard.press("Escape");
    const 框 = page.locator(".list-bar .ant-select", { has: page.locator('[aria-label="客户来源"]') });
    await 轮询(() => 框.count()).toBe(1);
    expect(await 框.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(160);
    // 选上以后（地址栏回来带着 channelId）：变成「客户来源：客户介绍（触点）」标签，字一行写全
    await page.evaluate((筛) => (window as unknown as { __render: (x: unknown) => void }).__render({ what: "list", 能: true, 锁: false, 企: true, 渠道: 筛.组, 筛: { channelId: 筛.值 } }), { 组, 值: `${触点前缀}客户介绍` });
    await 轮询(() => 框.locator(".ant-select-content").textContent()).toBe("客户介绍（触点）");
    expect(await 框.evaluate((el) => { const c = el.querySelector(".ant-select-content") as HTMLElement; return c.scrollWidth <= c.clientWidth; })).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
