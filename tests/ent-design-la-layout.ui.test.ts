/**
 * 设计语言 L-A（11-21，客户列表页头 + 工具栏 / 筛选；落地计划「L-A」，依据《现在-客户列表》L1 / L2 / L6）：
 *   L-新1 「重置」只在真筛了东西时看得见：币种（sortCurrency）、停在默认范围都不算「筛了」（3703 复现的哑按钮）
 *   L-新3 / D31 页头主按钮「新建 ▾」固定最右，「离职交接」排在它左边；市场管理的客户页（我分出去的）同序，「列表 | 看板」同客户页顺序
 *   L-新4 「导出」悬停说清按什么导、导多少（不加确认框，P-界面-40）
 *   L-新13 导出中 / 导完那句不挤页头按钮：挪到页头下一行
 *   L-新5 / D06 1366 / 390 同一摆法：外面只摆搜索、客户状态、负责人，阶段 / 进程收进「更多筛选」，按钮写字；390 筛选少占行、首屏多露行
 *   L-新6 负责人下拉同名的带部门；L-新7 客户状态下拉释义一行；D37 「全部 X」一个颜色；D35 导入 / 导出图标分开；K9 390「我分出去的」标题不挤
 *   换皮主题（像素、账簿、奢华、科技）外观不动（用户 11-21）：结构改动只在现状主题出，末尾一条对照
 *   排版门槛：Windows 1024 / 1280 / 1366（左栏 220）+ 手机 390，超长客户名 / 同事名；页面不横滚、关键按钮 elementFromPoint 点得中
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, 列表包: string, 市场包: string;
const 列表桩: Plugin = { name: "design-la-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__push=u},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\/ImportDrawer$/, "export default function D({open}){return <div data-testid='import-drawer' data-open={String(open)}/>}");
  // 导出：window.__导出放 拿到放行的钩子（看导出中那一行），放了回一个结果（看导完那一句）
  stub(/^\.\/export-client$/, "export const 完整导出=async(f,b,进度)=>{进度('正在导出客户：18000 / 19497');await new Promise(r=>window.__导出放=r);return {客户:19497,跟进:63794}};");
  stub(/^\.\/pool-actions$/, `const f=${空跑};export const 放进公海=f,领取=f,分配公海=f,撤销公海=f,退回原因选项=async()=>[];`);
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/CustomerPick$/, "export default function C(){return null}");
  stub(/^\.\/form-data-action$/, "export const 取客户页表单料=async()=>({channels:[],建档:null});");
  stub(/projects\/new\/ProjectWizard$/, "export function 建档弹窗(){return null}");
  stub(/projects\/NewProjectFlow$/, "export default function F(){return <div className='new-proj-flow-stub'/>}");
  stub(/^\.\.\/channels\/actions$/, `export const saveChannel=${空跑};`);
  stub(/^(\.\/|\.\.\/)actions$/, `const f=${空跑};
    export const saveCustomer=f,checkDuplicate=async()=>null,推荐人候选=async()=>[],patchCustomer=f,
    assignSalesOwner=f,bulkFollowStatus=f,撤销改负责人=f,deleteCustomers=f,删除前清点=async()=>({}),客户删除预检=async()=>({ok:true}),转走项目预览of=async()=>({项目数:0,项目:[]}),saveChannel=f,供应商候选=async()=>[];`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

/* 市场管理的客户页（我分出去的）= ProjectsView 换回客户列表：桩照 ent-new-leads.ui.test.ts（同一个 ProjectsView），这里不点分配、建项目，回空就行 */
const 市场桩: Plugin = { name: "design-la-market", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  const 好 = "async()=>({ok:true})";
  stub(/^next\/link$/, "export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/actions$/, `const f=${好};export const 回项目邀请=f,市场复核Action=f,总管理终判Action=f,看板推进预检=async()=>({ok:true,还差:[]}),改项目节点=f,编辑项目=f,看板补必填料=async()=>({ok:false,error:'x'});`);
  stub(/^\.\.\/actions$/, `const f=${好};export const 编辑项目=f,改项目画像Action=f,勾项目交付=f;`);
  stub(/assign-actions$/, `const f=${好};export const 分配线索=f,自动分配线索=f,撤销自动分配=f,批量自动分配=f,本月分配情况=async()=>({月:'2026-11',人:[]}),我分出去的线索=async()=>[],项目分配线=async()=>({线:'内贸'}),分配带走的项目=async()=>({项目数:0,项目:[]});`);
  stub(/blocker-actions$/, `const f=${好};export const 发布卡点Action=f,认领卡点Action=f,完成卡点Action=f,删卡点Action=f,存卡点默认Action=f,存卡点角色开关Action=f,新增原因Action=f,改原因名Action=f,改原因状态Action=f,删原因Action=f,合并原因Action=f;`);
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[],取客户选项=async()=>null,取客户近况=async()=>null;");
  stub(/project-actions$/, "export const 给客户建项目=async()=>({ok:true});export const 新项目分配数据=async()=>null;export const 建项目带走的项目=async()=>({项目数:0,项目:[]});");
  stub(/new\/wizard-actions$/, "export const 取建档数据=async()=>({users:[],要下一步:false,企业:null});");
  stub(/new\/ProjectWizard$/, "export const 建档弹窗=()=>null;");
  stub(/customers\/board-actions$/, "export const 再看一列=async()=>({ok:true,行:[],总:0});");
  stub(/^\.\/board-actions$/, "export const 再看项目页一列=async()=>({ok:true,行:[],总:0});export const 项目标签筛选项=async()=>[];");
  stub(/^next\/dynamic$/, "export default function d(){return function D(){return null}}");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

const 打包 = async (contents: string, plugin: Plugin) => (await build({ stdin: { contents, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
beforeAll(async () => {
  列表包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import CustomersView from '@/app/(app)/customers/CustomersView';import {themeConfig} from '@/lib/theme';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    // 两位同名的销售（L-新6）：部门不同；还有一位超长名字的同事
    const users=[{id:'me',name:'小王',email:'s1',部门:'内贸一部'},{id:'u2',name:'张伟',email:'s2',部门:'内贸销售一部'},{id:'u3',name:'张伟',email:'s3',部门:'外贸销售二部'},{id:'u4',name:'一个名字特别特别长的同事'.repeat(2),email:'s4',部门:null}];
    const 行=(id,owner)=>({id,name:长+id,phone:'+86 138 0000 0000 转 8888',school:长,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',custStatus:'潜在',salesOwnerId:owner,salesOwnerName:users.find(u=>u.id===owner).name,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:'2026-11-01T00:00:00.000Z',signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null,expectedSignAt:null,remark:null,addrCountry:'阿拉伯联合酋长国',extra:{level:'A'},customerNo:12345678});
    const rows=Array.from({length:20},(_,i)=>行('c'+i,['me','u2','u3','u4'][i%4]));
    const 释义={潜在:'有过接触、还没有明确需求的客户；先建立联系、了解对方的业务和采购节奏，等待需求出现',意向:'对方有明确需求并愿意继续沟通，正在比较方案和报价，需要持续推进',成交:'已经签约或下单的客户',交付:'正在交付中的客户'};
    window.__render=(o={})=>{const 管=o.管!==false;const 范围={值:o.范围||(管?'visible':'mine'),默认:管?'visible':'mine',选项:管?['mine','joined','visible']:['mine','joined']};
      root.render(<ConfigProvider locale={zhCN} theme={themeConfig}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true,currency:'CNY'}}><我Provider value={{id:'me',name:'小王'}}>
      <CustomersView rows={rows} total={19497} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} 企业版 项目看板 能新建和领取={o.新建!==false}
        filters={{phase:'',node:'',scope:范围.值,...(o.筛||{})}} 排序币种={o.币种} 客户数={19497} 能导入导出={o.导入导出!==false} 待交接={o.交接===undefined?3:o.交接} 客户范围={范围}
        客户状态选项={['潜在','意向','成交','交付']} 字典释义={{状态:释义,类型:{}}}/>
      </我Provider></BusinessProvider></App></ConfigProvider>);};
  `, 列表桩);
  市场包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Projects from '@/app/(app)/projects/ProjectsView';import {themeConfig} from '@/lib/theme';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购项目第二期';
    const row=(i)=>({id:'p'+i,name:长+i,customerId:'c'+i,customerName:长,ownerId:'u'+(i%2),ownerName:'一个名字特别特别长的同事'+i,phase:'线索',node:'线索验证',result:null,exceptionCategory:null,exceptionReason:null,pooled:false,amount:1234567,currency:'CNY',updatedAt:new Date().toISOString()});
    const 市场={视角:'市场管理',创建人们:[{id:'u0',name:'王0'},{id:'u1',name:'王1'}]};
    window.__render=()=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN} theme={themeConfig}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <Projects 行={[row(1),row(2),row(3)]} 列={[]} 总数={3} 页={1} 每页={20} users={[{id:'u0',name:'王0',email:'a'},{id:'u1',name:'王1',email:'b'}]} filters={{keyword:'',ownerId:'',pool:'',phase:''}}
        企业版 市场={市场} 待交接={2} 基址="/customers" 标题="客户" 换回客户列表 能新建客户 能新建/>
    </BusinessProvider></App></ConfigProvider>);
  `, 市场桩);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

/** 打开一页：桌面宽左边留出左栏 220（壳里正文就这么宽）；手机宽左栏收起、按触屏开。主题 = <html data-skin>，不给 = 现状 */
async function 开(w: number, 参: Record<string, unknown> = {}, 主题?: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: w, height: w < 768 ? 800 : 900 }, ...(w < 768 ? { isMobile: true, hasTouch: true } : {}) });
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://design-la.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><html${主题 ? ` data-skin="${主题}"` : ""}><style>body{margin:0}</style><div id='root'></div></html>` }));
  await page.goto("http://design-la.test");
  if (主题) await page.evaluate((t) => document.documentElement.setAttribute("data-skin", t), 主题);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ content: w >= 768 ? "#root{margin-left:220px;padding:22px 26px}" : "#root{padding:12px 16px}" });
  await page.addScriptTag({ content: 列表包 });
  await page.evaluate((x) => (window as unknown as { __render: (x: object) => void }).__render(x), 参);
  await page.locator("tr.ant-table-row").first().waitFor();
  if (process.env.LA_SHOT) await page.screenshot({ path: `${process.env.LA_SHOT}/la-${w}-${主题 ?? "now"}-${Object.keys(参).join("_") || "base"}.png` });
  return { page, errors };
}

/** 页头右上那组按钮从左到右的字；离职交接只认「离职交接」三个字 */
const 页头钮序 = (page: Page) => page.locator(".page-head-a button").evaluateAll((bs) => bs.map((b) => (b.textContent ?? "").replace(/\s+/g, "").replace(/\d+$/, "").replace(/^离职交接.*/, "离职交接")));
const 点得中 = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((el) => {
  const r = el.getBoundingClientRect(); const 中 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { 字: (el.textContent ?? "").trim() || el.outerHTML.slice(0, 160), 中: !!中 && el.contains(中), 在屏: r.left >= 0 && r.right <= document.documentElement.clientWidth + 1 };
}));
const 页横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const 重置看得见 = (page: Page) => page.locator(".list-reset").evaluate((el) => !el.classList.contains("is-off") && getComputedStyle(el).visibility !== "hidden");

it("L-新1：没筛（地址只带默认币种、默认范围）「重置」看不见；真筛了一项才出来", async () => {
  const { page, errors } = await 开(1366, { 币种: "CNY" });
  try {
    expect(await 重置看得见(page)).toBe(false);
    await page.close();
    const 筛了 = await 开(1366, { 币种: "CNY", 筛: { custStatus: "潜在" } });
    expect(await 重置看得见(筛了.page)).toBe(true);
    expect(筛了.errors).toEqual([]);
    await 筛了.page.close();
    // 换到非默认范围也算筛了（重置回到这个人的默认范围）
    const 换范围 = await 开(1366, { 币种: "USD", 范围: "joined" });
    expect(await 重置看得见(换范围.page)).toBe(true);
    await 换范围.page.close();
    expect(errors).toEqual([]);
  } finally { if (!page.isClosed()) await page.close(); }
});

for (const w of [1024, 1280, 1366, 390]) {
  it(`L-新3 / D35：页头「导入 · 导出 · 离职交接 · 新建 ▾」，新建在最右；每颗点得中、页面不横滚（${w} 宽）`, async () => {
    const { page, errors } = await 开(w);
    try {
      expect(await 页头钮序(page)).toEqual(["导入", "导出", "离职交接", "新建"]);
      for (const x of await 点得中(page, ".page-head-a button")) expect(x, `${w} 宽 ${x.字}`).toEqual({ 字: x.字, 中: true, 在屏: true });
      expect(await 页横滚(page)).toBe(false);
      // D35：导入、导出两颗图标不一样
      const 图标 = await page.locator(".page-head-a button .anticon").evaluateAll((xs) => xs.slice(0, 2).map((x) => x.getAttribute("aria-label")));
      expect(图标[0]).not.toBe(图标[1]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("L-新3：销售（没有导入导出、没有离职交接）只剩「新建 ▾」；只读管理员一颗都没有", async () => {
  const { page, errors } = await 开(1366, { 导入导出: false, 交接: null, 管: false });
  try {
    expect(await 页头钮序(page)).toEqual(["新建"]);
    await page.close();
    const 读 = await 开(1366, { 导入导出: false, 交接: null, 新建: false });
    expect(await 页头钮序(读.page)).toEqual([]);
    await 读.page.close();
    expect(errors).toEqual([]);
  } finally { if (!page.isClosed()) await page.close(); }
});

it("L-新4 / L-新13：导出悬停说清范围和条数；导出中、导完那句在页头下一行，页头按钮不挪位", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 导出 = page.locator(".page-head-a button").filter({ hasText: "导出" });
    await 导出.hover();
    await expect.poll(() => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").innerText().catch(() => "")).toMatch(/^按当前范围「我可见的」导出 19,497 位客户/);
    const 位置 = () => page.locator(".page-head-a button").evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().left)));
    const 原 = await 位置();
    await 导出.click();
    await expect.poll(() => page.getByRole("button", { name: "取消导出" }).count()).toBe(1);
    // 导出中：进度和「取消导出」不在页头按钮那一排
    expect(await page.locator(".page-head-a").getByText("正在导出客户").count()).toBe(0);
    expect(await page.locator(".page-head-a").getByRole("button", { name: "取消导出" }).count()).toBe(0);
    expect(await 位置()).toEqual(原);
    await page.evaluate(() => (window as unknown as { __导出放: () => void }).__导出放());
    await expect.poll(() => page.getByText(/已完整导出 19497 位客户/).count()).toBe(1);
    expect(await page.locator(".page-head-a").getByText(/已完整导出/).count()).toBe(0);
    expect(await 位置()).toEqual(原);
    expect(await 页横滚(page)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [1280, 1366, 390]) {
  it(`L-新5：外面只摆搜索 / 客户状态 / 负责人，阶段 / 进程收进「更多筛选」，按钮写字（${w} 宽）`, async () => {
    const { page, errors } = await 开(w);
    try {
      expect(await page.getByRole("combobox", { name: "阶段" }).count()).toBe(0);
      expect(await page.getByRole("combobox", { name: "客户状态" }).count()).toBe(1);
      const 更多 = page.getByRole("button", { name: /^更多筛选/ });
      expect(await 更多.locator(".cf-more-t").evaluate((el) => getComputedStyle(el).display)).not.toBe("none");
      await 更多.click();
      await expect.poll(() => page.locator(".ant-popover").getByRole("combobox", { name: "阶段" }).count()).toBe(1);
      expect(await 页横滚(page)).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

for (const w of [1024, 1280, 1366]) {
  it(`筛选行和「列」一行、点得中（${w} 宽、超长名字）`, async () => {
    const { page, errors } = await 开(w);
    try {
      const 行 = await page.locator(".list-bar").evaluate((el) => el.getBoundingClientRect().height);
      expect(行, `${w} 宽筛选行一行`).toBeLessThanOrEqual(40);
      for (const x of await 点得中(page, ".list-bar button:not(.ant-input-clear-icon)")) if (x.字 !== "重置") expect(x, `${w} 宽 ${x.字}`).toEqual({ 字: x.字, 中: true, 在屏: true });
      expect(await 页横滚(page)).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("D06：390 宽筛选少占行——表头在首屏一半以上，首屏露出的行比原来多（表格从 y ≤ 360 开始）", async () => {
  const { page, errors } = await 开(390);
  try {
    const 表顶 = await page.locator(".ant-table-thead").first().evaluate((el) => el.getBoundingClientRect().top);
    expect(表顶).toBeLessThanOrEqual(360);
    for (const x of await 点得中(page, ".list-bar button:not(.ant-input-clear-icon)")) if (x.字 !== "重置") expect(x, `390 宽 ${x.字}`).toEqual({ 字: x.字, 中: true, 在屏: true });
    expect(await 页横滚(page)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("L-新6：负责人下拉里同名的两位带部门，别的照旧只写名字", async () => {
  const { page, errors } = await 开(1366);
  try {
    await page.getByRole("combobox", { name: "负责人" }).click();
    const 项 = await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").allInnerTexts();
    expect(项).toContain("张伟（内贸销售一部）");
    expect(项).toContain("张伟（外贸销售二部）");
    expect(项).toContain("小王");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("L-新7：客户状态下拉每项释义只占一行（放不下省略号、悬停看全）", async () => {
  const { page, errors } = await 开(1366);
  try {
    await page.getByRole("combobox", { name: "客户状态" }).click();
    const 释 = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .dict-note-1l");
    await expect.poll(() => 释.count()).toBe(4);
    const 量 = await 释.evaluateAll((xs) => xs.map((x) => ({ 高: x.getBoundingClientRect().height, 行高: parseFloat(getComputedStyle(x).lineHeight), 全: x.getAttribute("title") })));
    for (const m of 量) expect(m.高).toBeLessThanOrEqual(m.行高 + 1);
    expect(量[0].全).toMatch(/等待需求出现$/);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D37：筛选行里「全部 X」一个颜色（不是 faint 浅灰）", async () => {
  const { page, errors } = await 开(1366);
  try {
    const 色们 = await page.locator(".list-bar .ant-select-placeholder").evaluateAll((xs) => [...new Set(xs.map((x) => getComputedStyle(x).color))]);
    expect(色们.length).toBe(1);
    const faint = await page.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--text-faint)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
    expect(色们[0]).not.toBe(faint);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("换皮主题外观不动：像素主题页头照原来「导入 · 导出 · 新建 ▾ · 离职交接」、阶段 / 进程照原来的摆法", async () => {
  const { page, errors } = await 开(390, {}, "pixel");
  try {
    expect(await 页头钮序(page)).toEqual(["导入", "导出", "新建", "离职交接"]);
    expect(await page.getByRole("combobox", { name: "阶段" }).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});


/** 市场管理的客户页（我分出去的）：列表视图（看法记在本机，先写成「列表」再开） */
async function 开市场(w: number, 主题?: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: w, height: w < 768 ? 800 : 900 }, ...(w < 768 ? { isMobile: true, hasTouch: true } : {}) });
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://design-la.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://design-la.test/customers");
  await page.evaluate((t) => { localStorage.setItem("projects-view", JSON.stringify("列表")); if (t) document.documentElement.setAttribute("data-skin", t); }, 主题);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ content: w >= 768 ? "#root{margin-left:220px;padding:22px 26px}" : "#root{padding:12px 16px}" });
  await page.addScriptTag({ content: 市场包 });
  await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
  await page.locator(".page-head h1").waitFor();
  if (process.env.LA_SHOT) await page.screenshot({ path: `${process.env.LA_SHOT}/la-market-${w}-${主题 ?? "now"}.png` });
  return { page, errors };
}
/** 页头右上那组从左到右：分段按钮记成「分段:各项」，按钮记字 */
const 市场页头序 = (page: Page) => page.locator(".page-head-a .ant-space-item > *").evaluateAll((xs) => xs.map((x) => x.classList.contains("ant-segmented")
  ? `分段:${[...x.querySelectorAll(".ant-segmented-item")].map((i) => (i.textContent ?? "").trim()).join("|")}`
  : (x.textContent ?? "").replace(/\s+/g, "").replace(/\d+$/, "")));

for (const w of [1024, 1366, 390]) {
  it(`L-新3 / D31：市场管理的客户页同客户页的序——「列表 | 看板」· 离职交接 · 新建 ▾（最右）；K9 标题不挤（${w} 宽）`, async () => {
    const { page, errors } = await 开市场(w);
    try {
      expect(await 市场页头序(page)).toEqual(["分段:列表|看板", "离职交接", "新建"]);
      const h1 = await page.locator(".page-head h1").evaluate((el) => ({ 截了: el.scrollWidth > el.clientWidth + 1, 宽: el.getBoundingClientRect().width }));
      expect(h1.截了, `${w} 宽标题「客户」不截`).toBe(false);
      for (const x of await 点得中(page, ".page-head-a button, .page-head-a .ant-segmented-item")) expect(x, `${w} 宽 ${x.字}`).toEqual({ 字: x.字, 中: true, 在屏: true });
      expect(await 页横滚(page)).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("D37：市场管理客户页筛选行「全部成员 / 全部创建人 / 全部阶段 / 全部进程」一个颜色", async () => {
  const { page, errors } = await 开市场(1366);
  try {
    const 色们 = await page.locator(".list-bar .ant-select").evaluateAll((xs) => [...new Set(xs.map((x) => {
      const t = x.querySelector(".ant-select-placeholder") ?? x.querySelector(".ant-select-content-value, .ant-select-selection-item") ?? x;
      return getComputedStyle(t).color;
    }))]);
    expect(色们.length).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("换皮主题外观不动：像素主题市场管理客户页页头照原来「离职交接 · 看板 | 列表 · 新建 ▾」", async () => {
  const { page, errors } = await 开市场(1366, "pixel");
  try {
    expect(await 市场页头序(page)).toEqual(["离职交接", "分段:看板|列表", "新建"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
