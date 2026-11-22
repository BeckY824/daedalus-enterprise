/**
 * 设计语言 L-B（11-22，客户列表表格 / 批量条 / 仅项目 / 看板；落地计划「L-B」，依据《现在-客户列表》L3 / L4 / L5）：
 *   L-新2 行菜单「删除」红色危险项 + 上面一道分隔线；点了照旧弹后果确认框（P-界面-40）
 *   L-新8 号码不被省略号截掉（列宽按这一页最长的号码给）；L-新9 钉住列边上的渐隐收短、不压墨色（不像滚动条）
 *   L-新14 390 勾选后的批量条不被钉住的客户列盖住、不压在右下 AI 球上
 *   L-新11 390「仅项目」小表：标题不折、列头收起、每位两排；客户名那列不再被挤成 0 宽（3703 实操 F-040）、点一下不冒黑气泡
 *   L-新12 看板卡项目名 = 客户名时只写一遍（两行摆法 P-界面-43 不变）；D30 看板卡悬停只换底色；D21 空态句式；D20 筛选胶囊同控件高
 *   D40 滚到底末行「⋮」、看板最后一张卡不在 AI 球底下（壳的 .has-ai-fab 留白）
 *   换皮主题（像素、账簿、奢华、科技）外观不动（用户 11-21）：末尾对照
 *   排版门槛：Windows 1024 / 1280 / 1366（左栏 220）+ 手机 390，超长客户名 / 号码；页面不横滚、关键按钮 elementFromPoint 点得中
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, 列表包: string, 看板包: string;
const 列表桩: Plugin = { name: "design-lb-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__push=u},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\/ImportDrawer$/, "export default function D(){return null}");
  stub(/^\.\/export-client$/, "export const 完整导出=async()=>({客户:0,跟进:0});");
  stub(/^\.\/pool-actions$/, `const f=${空跑};export const 放进公海=f,领取=f,分配公海=f,撤销公海=f,退回原因选项=async()=>[];`);
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/CustomerPick$/, "export default function C(){return null}");
  stub(/^\.\/form-data-action$/, "export const 取客户页表单料=async()=>({channels:[],建档:null});");
  stub(/projects\/new\/ProjectWizard$/, "export function 建档弹窗(){return null}");
  stub(/projects\/NewProjectFlow$/, "export default function F(){return null}");
  stub(/^\.\.\/channels\/actions$/, `export const saveChannel=${空跑};`);
  stub(/^(\.\/|\.\.\/)actions$/, `const f=${空跑};
    export const saveCustomer=f,checkDuplicate=async()=>null,推荐人候选=async()=>[],patchCustomer=f,
    assignSalesOwner=f,bulkFollowStatus=f,撤销改负责人=f,deleteCustomers=f,删除前清点=async()=>({}),客户删除预检=async()=>({ok:true}),转走项目预览of=async()=>({项目数:0,项目:[]}),saveChannel=f,供应商候选=async()=>[];`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
const 看板桩: Plugin = { name: "design-lb-board", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  const 好 = "async()=>({ok:true})";
  stub(/^next\/link$/, "export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "", 好));
  stub(/^\.\.\/actions$/, `const f=${好};export const 编辑项目=f,改项目画像Action=f,勾项目交付=f;`);
  stub(/assign-actions$/, `const f=${好};export const 分配线索=f,自动分配线索=f,撤销自动分配=f,批量自动分配=f,本月分配情况=async()=>[],我分出去的线索=async()=>[],项目分配线=async()=>null,分配带走的项目=async()=>({项目数:0,项目:[]});`);
  stub(/blocker-actions$/, `const f=${好};export const 发布卡点Action=f,认领卡点Action=f,完成卡点Action=f,删卡点Action=f,存卡点默认Action=f,存卡点角色开关Action=f,新增原因Action=f,改原因名Action=f,改原因状态Action=f,删原因Action=f,合并原因Action=f;`);
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[],取客户选项=async()=>null,取客户近况=async()=>null;");
  stub(/project-actions$/, "export const 给客户建项目=async()=>({ok:true});export const 新项目分配数据=async()=>null;export const 建项目带走的项目=async()=>({项目数:0,项目:[]});");
  stub(/new\/wizard-actions$/, "export const 取建档数据=async()=>null;");
  stub(/new\/ProjectWizard$/, "export const 建档弹窗=()=>null;");
  stub(/board-actions$/, "export const 再看一列=async()=>({ok:true,行:[],总:0}),再看项目页一列=async()=>({ok:true,行:[],总:0}),项目标签筛选项=async()=>[];");
  stub(/^next\/dynamic$/, "export default function d(){return function D(){return null}}");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

const 打包 = async (contents: string, plugin: Plugin) => (await build({ stdin: { contents, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
/** 壳：.has-ai-fab 给正文底下留 --ai-room，右下角一颗 AI 球（同 AppShell / AiFab 的类名） */
const 壳 = "<div class='has-ai-fab'><main class='app-content'><div id='root'></div></main><button class='ai-fab' aria-label='AI 助手'><span class='ai-fab-core'></span></button></div>";
beforeAll(async () => {
  列表包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import CustomersView from '@/app/(app)/customers/CustomersView';import TruncTip from '@/components/TruncTip';import {themeConfig} from '@/lib/theme';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    const users=[{id:'me',name:'小王',email:'s1'},{id:'u2',name:'张伟',email:'s2'}];
    const 行=(id,i)=>({id,name:长+id,phone:i===0?'+86 138 0000 0000 转 8888':'+90 507 984 4123',school:长,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',custStatus:'潜在',salesOwnerId:'me',salesOwnerName:'小王',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:'2026-11-01T00:00:00.000Z',signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null,expectedSignAt:null,remark:null,addrCountry:'土耳其',extra:{level:'A',country:'土耳其'},customerNo:52120+i});
    const rows=Array.from({length:20},(_,i)=>行('c'+i,i));
    // 仅项目：一位全空客户（F-040：抬头写项目名）、一位超长全称、一位短名
    const 仅=(id,o)=>({id,name:'',shortName:null,school:null,customerNo:9000+id.length,customerType:null,customerAttr:null,地区:'',addrCountry:null,addrProvince:null,addrCity:null,addrDistrict:null,当前节点:'方案敲定',抬头格:null,当前阶段:'商机',项目数:2,仅项目:true,...o});
    const 仅项目行=[仅('p1',{抬头格:{节点:'方案敲定',项目名:'二期扩产自动化产线改造项目'}}),仅('p22',{name:长,customerType:'终端客户',地区:'浙江 杭州'}),仅('p333',{name:'甲乙丙',customerType:'经销商',地区:'土耳其'})];
    window.__render=(o={})=>root.render(<ConfigProvider locale={zhCN} theme={themeConfig}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true,currency:'CNY'}}><我Provider value={{id:'me',name:'小王'}}>
      <TruncTip/>
      <CustomersView rows={o.空?[]:rows} total={o.空?0:19497} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} 企业版 项目看板 能新建和领取
        filters={{phase:'',node:'',scope:'visible',...(o.筛||{})}} 客户数={19497} 能导入导出 能删 能转出自己的 客户范围={{值:'visible',默认:'visible',选项:['mine','joined','visible']}}
        仅项目行={o.仅项目?仅项目行:[]} 本月新增={!!o.胶囊} 三态标={{c0:{态:'沉睡'},c1:{态:'待回收',几天后进公海:3}}}
        客户状态选项={['潜在','意向']} 字典释义={{状态:{},类型:{}}}/>
      </我Provider></BusinessProvider></App></ConfigProvider>);
  `, 列表桩);
  看板包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';
    import Projects from '@/app/(app)/projects/ProjectsView';import {themeConfig} from '@/lib/theme';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    // 前两张项目名 = 客户名（L-新12），第三张不一样
    const row=(id,名,客)=>({id,name:名,customerId:'c'+id,customerName:客,ownerId:'u0',ownerName:'王0',phase:'线索',node:'潜客培育',result:null,exceptionCategory:null,exceptionReason:null,pooled:false,amount:1234567,currency:'CNY',updatedAt:new Date().toISOString()});
    const 卡=[row('p1','杭州某某机械有限公司','杭州某某机械有限公司'),row('p2','某某超长名字的智能制造装备与工业自动化系统集成有限公司','某某超长名字的智能制造装备与工业自动化系统集成有限公司 '),row('p3','二期扩产项目','宁波某某贸易有限公司'),...Array.from({length:9},(_,i)=>row('q'+i,'项目'+i,'客户'+i))];
    const 列=[{列:'潜客培育',名:'潜客培育',色:'线索',阶段:'线索',空态:'还没有在潜客培育的项目',数:卡.length,合计:[],行:卡},{列:'线索验证',名:'线索验证',色:'线索',阶段:'线索',空态:'还没有在线索验证的项目',数:0,合计:[],行:[]}];
    window.__render=(o={})=>createRoot(document.getElementById('root')).render(<ConfigProvider theme={themeConfig}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <Projects 行={[]} 列={o.空?列.map(c=>({...c,数:0,行:[]})):列} 每列={{}} 总数={卡.length} 页={1} 每页={20} users={[{id:'u0',name:'王0',email:'a'}]} filters={{keyword:o.keyword??'',ownerId:'',pool:'',phase:''}} 企业版 客户页={false}/>
    </BusinessProvider></App></ConfigProvider>);
  `, 看板桩);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 开参 = { 包: string; 等: string; 主题?: string; 参?: Record<string, unknown>; 前置?: string };
async function 开(w: number, o: 开参): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: w, height: w < 768 ? 800 : 900 }, ...(w < 768 ? { isMobile: true, hasTouch: true } : {}) });
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://design-lb.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><html${o.主题 ? ` data-skin="${o.主题}"` : ""}><style>body{margin:0}</style>${壳}</html>` }));
  await page.goto("http://design-lb.test/customers");
  if (o.主题) await page.evaluate((t) => document.documentElement.setAttribute("data-skin", t), o.主题);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ path: path.resolve("src/app/(app)/tri-state-ui.css") });
  // 正文的留白在壳的 .app-content 上（手机宽 globals.css 给 14px 12px）；电脑宽左边让出左栏 220
  await page.addStyleTag({ content: w >= 768 ? ".app-content{display:block;margin-left:220px;padding:22px 26px}" : ".app-content{display:block}" });
  if (o.前置) await page.addScriptTag({ content: o.前置 });
  await page.addScriptTag({ content: o.包 });
  await page.evaluate((x) => (window as unknown as { __render: (x: object) => void }).__render(x), o.参 ?? {});
  await page.locator(o.等).first().waitFor();
  if (process.env.LB_SHOT) await page.screenshot({ path: `${process.env.LB_SHOT}/lb-${w}-${o.主题 ?? "now"}-${o.等.replace(/\W+/g, "")}-${Object.keys(o.参 ?? {}).join("_") || "base"}.png` });
  return { page, errors };
}
const 开列表 = (w: number, 参: Record<string, unknown> = {}, 主题?: string) => 开(w, { 包: 列表包, 等: 参.空 ? ".list-none" : "tr.ant-table-row", 参, 主题 });
const 开看板 = (w: number, 参: Record<string, unknown> = {}, 主题?: string) => 开(w, { 包: 看板包, 等: 参.空 ? ".pipe-empty" : ".pipe-card", 参, 主题, 前置: "try{localStorage.setItem('projects-view',JSON.stringify('看板'))}catch{}" });

const 页横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
/** 元素中心点下面是不是它自己（没被钉住列、AI 球、别的层盖住），在不在屏内 */
const 点得中 = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((el) => {
  const r = el.getBoundingClientRect(); const 中 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { 字: (el.textContent ?? "").trim() || el.getAttribute("aria-label") || el.outerHTML.slice(0, 120), 中: !!中 && el.contains(中), 在屏: r.left >= 0 && r.right <= document.documentElement.clientWidth + 1 };
}));
/** AI 球（含光晕 6px）的左边、上边 */
const 球框 = (page: Page) => page.locator(".ai-fab").evaluate((el) => { const r = el.getBoundingClientRect(); return { 左: r.left - 6, 上: r.top - 6 }; });

it("L-新2：行菜单「删除」是红色危险项、上面一道分隔线和编辑隔开；点了照旧弹后果确认框，取消不删", async () => {
  const { page, errors } = await 开列表(1366);
  try {
    await page.getByRole("button", { name: /^更多操作 / }).first().click();
    const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
    await 菜单.waitFor();
    const 项 = await 菜单.locator(":scope > li").evaluateAll((xs) => xs.map((x) => x.classList.contains("ant-dropdown-menu-item-divider") ? "—" : `${(x.textContent ?? "").trim()}${x.classList.contains("ant-dropdown-menu-item-danger") ? "!" : ""}`));
    expect(项).toEqual(["编辑", "—", "删除!"]);
    const 色 = await 菜单.getByText("删除", { exact: true }).evaluate((el) => getComputedStyle(el.closest("li")!).color);
    expect(色).not.toBe(await 菜单.getByText("编辑", { exact: true }).evaluate((el) => getComputedStyle(el.closest("li")!).color));
    await 菜单.getByText("删除", { exact: true }).click();
    const 框 = page.locator(".ant-modal-confirm, .ant-modal").filter({ hasText: "删除" }).first();
    await 框.waitFor();
    await 框.getByRole("button", { name: /取\s*消/ }).click();
    await expect.poll(() => page.locator(".ant-modal-wrap:visible").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [1024, 1280, 1366, 390]) {
  it(`L-新8：号码不被省略号截掉（最长的那个也写全）；页面不横滚（${w} 宽）`, async () => {
    const { page, errors } = await 开列表(w);
    try {
      const 截了 = await page.locator("tr.ant-table-row .copy-val-t").evaluateAll((xs) => xs.filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent));
      expect(截了).toEqual([]);
      expect(await 页横滚(page)).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("L-新9：钉住列边上的渐隐 = 底色淡出、宽 24（--edge-fade），不再贴边压一道墨色；右边还能滚时才出", async () => {
  const { page, errors } = await 开列表(1366);
  try {
    const 渐隐 = await page.locator("tbody .ant-table-cell-fix-end").first().evaluate((el) => {
      const s = getComputedStyle(el, "::after"); return { 宽: s.width, 底: s.backgroundImage };
    });
    expect(渐隐.宽).toBe("24px");
    // 两头：一头是格子底色（白），一头透明；没有混进墨色的那一档
    expect(渐隐.底).toMatch(/^linear-gradient\(to left, rgb\(255, 255, 255\), rgba\(0, 0, 0, 0\)\)$/);
    await expect.poll(() => page.locator("tbody .ant-table-cell-fix-end").first().evaluate((el) => getComputedStyle(el, "::after").opacity)).toBe("1");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("L-新14：390 勾 3 位后的批量条整条露出来——每颗按钮点得中（不被钉住的客户列盖住）、不压在右下 AI 球上", async () => {
  const { page, errors } = await 开列表(390);
  try {
    const 勾 = page.locator("tr.ant-table-row .ant-checkbox-input");
    for (let i = 0; i < 3; i++) await 勾.nth(i).check();
    const 条 = page.locator(".list-sel-float");
    await 条.waitFor();
    // 滚到批量条贴在可视区底部的位置（表格中段），钉住列和它重叠的地方
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(350);
    if (process.env.LB_SHOT) await page.screenshot({ path: `${process.env.LB_SHOT}/lb-390-批量条.png` });
    for (const x of await 点得中(page, ".list-sel-float button")) expect(x, `批量条 ${x.字}`).toEqual({ 字: x.字, 中: true, 在屏: true });
    const 条框 = await 条.evaluate((el) => { const r = el.getBoundingClientRect(); return { 右: r.right, 下: r.bottom, 上: r.top }; });
    const 球 = await 球框(page);
    expect(条框.右 <= 球.左 || 条框.下 <= 球.上, `批量条 ${JSON.stringify(条框)} 球 ${JSON.stringify(球)}`).toBe(true);
    expect(await 页横滚(page)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [1024, 1366]) {
  it(`L-新14：电脑宽勾选后的批量条照旧居中，按钮点得中（${w} 宽）`, async () => {
    const { page, errors } = await 开列表(w);
    try {
      const 勾 = page.locator("tr.ant-table-row .ant-checkbox-input");
      for (let i = 0; i < 2; i++) await 勾.nth(i).check();
      await page.locator(".list-sel-float").waitFor();
      await page.evaluate(() => window.scrollTo(0, 300));
      await page.waitForTimeout(350);
      for (const x of await 点得中(page, ".list-sel-float button")) expect(x, `${w} 宽 ${x.字}`).toEqual({ 字: x.字, 中: true, 在屏: true });
      expect(await 页横滚(page)).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("L-新11 / F-040：390「仅项目」小表——标题一行、列头收起，每位客户名整段写全（含全空客户写项目名），客户名那列不是 0 宽；点一下不冒黑气泡", async () => {
  const { page, errors } = await 开列表(390, { 仅项目: true });
  try {
    const 块 = page.getByTestId("project-only-block");
    // 标题「仅项目」三个字一行
    const 标题高 = await 块.locator(".cust-ponly-h > :first-child").evaluate((el) => el.getBoundingClientRect().height);
    expect(标题高).toBeLessThan(26);
    expect(await 块.locator(".cust-ponly-head").isVisible()).toBe(false);
    const 名们 = await 块.locator(".cust-ponly-row .cust-ponly-name > a").evaluateAll((xs) => xs.map((x) => ({ 字: x.textContent, 宽: x.parentElement!.getBoundingClientRect().width, 截: x.scrollWidth > x.clientWidth + 1 })));
    expect(名们[0].字).toContain("二期扩产自动化产线改造项目");
    for (const m of 名们) { expect(m.宽, m.字 ?? "").toBeGreaterThan(100); expect(m.截, m.字 ?? "").toBe(false); }
    // 第二排：编号、类型、地区、节点、「2 个项目」，空的不摆
    expect(await 块.locator(".cust-ponly-row").nth(2).innerText()).toMatch(/经销商[\s\S]*土耳其[\s\S]*方案敲定[\s\S]*2 个项目/);
    // 点一下行（触屏）：TruncTip 不出
    await 块.locator(".cust-ponly-row").nth(1).hover();
    await page.waitForTimeout(400);
    expect(await page.locator(".trunc-tip.is-on").count()).toBe(0);
    expect(await 页横滚(page)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [1024, 1280, 1366]) {
  it(`F-040：电脑宽「仅项目」小表客户名那列有宽度（不被一直空着的四列挤掉），页面不横滚（${w} 宽）`, async () => {
    const { page, errors } = await 开列表(w, { 仅项目: true });
    try {
      const 块 = page.getByTestId("project-only-block");
      const 名宽 = await 块.locator(".cust-ponly-row .cust-ponly-name").first().evaluate((el) => el.getBoundingClientRect().width);
      expect(名宽).toBeGreaterThan(200);
      expect(await 块.locator(".cust-ponly-head").innerText()).toMatch(/客户[\s\S]*编号[\s\S]*客户类型[\s\S]*地区[\s\S]*当前节点[\s\S]*项目数/);
      expect(await 块.locator(".cust-ponly-head").getByText("负责人").isVisible()).toBe(false);
      expect(await 块.locator(".cust-ponly-unit").first().isVisible()).toBe(false);
      expect(await 页横滚(page)).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("D21：搜了没对上写「没有对得上「词」的客户」，只筛了写「没有对得上这些筛选的客户」，都指回「重置」、不带句号", async () => {
  const 搜 = await 开列表(1366, { 空: true, 筛: { keyword: "某某" } });
  try {
    expect(await 搜.page.locator(".list-none").innerText()).toBe("没有对得上「某某」的客户，换个条件或点「重置」看全部");
    await 搜.page.close();
    const 筛 = await 开列表(1366, { 空: true, 筛: { custStatus: "潜在" } });
    expect(await 筛.page.locator(".list-none").innerText()).toBe("没有对得上这些筛选的客户，换个条件或点「重置」看全部");
    const 字 = await 筛.page.locator(".list-none").evaluate((el) => ({ 号: getComputedStyle(el).fontSize, 色: getComputedStyle(el).color }));
    expect(字.号).toBe("13px");
    await 筛.page.close();
    expect(搜.errors).toEqual([]);
  } finally { if (!搜.page.isClosed()) await 搜.page.close(); }
});

for (const w of [1366, 390]) {
  it(`D20：筛选行「只看本月新增」胶囊同筛选控件一个高（32），关闭键点得中（${w} 宽）`, async () => {
    const { page, errors } = await 开列表(w, { 胶囊: true });
    try {
      const 胶囊 = page.locator(".list-bar .list-chip");
      const 量 = await 胶囊.evaluate((el) => ({ 高: el.getBoundingClientRect().height, 角: parseFloat(getComputedStyle(el).borderTopLeftRadius) }));
      const 搜高 = await page.locator(".list-bar .ant-input-affix-wrapper").first().evaluate((el) => el.getBoundingClientRect().height);
      expect(量.高).toBe(搜高);
      expect(量.角).toBeGreaterThanOrEqual(16);
      for (const x of await 点得中(page, ".list-bar .list-chip .ant-tag-close-icon")) expect(x.中).toBe(true);
      expect(await 页横滚(page)).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("D20：表格里的标签（当前节点、客户状态、回收状态）一套：高 22、全圆角、12 号字", async () => {
  const { page, errors } = await 开列表(1366);
  try {
    const 量 = await page.locator("tr.ant-table-row :is(.ant-tag, .tri-tag)").evaluateAll((xs) => [...new Set(xs.map((x) => { const s = getComputedStyle(x); return `${x.getBoundingClientRect().height}|${s.fontSize}|${parseFloat(s.borderTopLeftRadius) >= 10}`; }))]);
    expect(量).toEqual(["22|12px|true"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D40：滚到底，末行的「⋮」不在右下 AI 球底下（点得中）", async () => {
  const { page, errors } = await 开列表(1366);
  try {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const 末 = page.getByRole("button", { name: /^更多操作 / }).last();
    const 框 = await 末.evaluate((el) => { const r = el.getBoundingClientRect(); return { 下: r.bottom }; });
    expect(框.下).toBeLessThanOrEqual((await 球框(page)).上);
    const [x] = await 末.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }));
    expect(x).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [1280, 390]) {
  it(`L-新12：看板卡项目名和客户名一字不差时只写一遍（客户名照旧第一行），不一样的照旧两行（${w} 宽）`, async () => {
    const { page, errors } = await 开看板(w);
    try {
      const 卡 = (id: string) => page.locator(`.pipe-card`).filter({ has: page.locator(".pipe-card-t") }).nth(id === "p1" ? 0 : id === "p2" ? 1 : 2);
      const 名行 = async (id: string) => (await 卡(id).locator(".pipe-card-t, .pipe-card-o.pipe-card-full").allInnerTexts()).map((s) => s.trim());
      expect(await 名行("p1")).toEqual(["杭州某某机械有限公司"]);
      expect(await 名行("p2")).toEqual(["某某超长名字的智能制造装备与工业自动化系统集成有限公司"]);
      expect(await 名行("p3")).toEqual(["宁波某某贸易有限公司", "二期扩产项目"]);
      expect(await 页横滚(page)).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("D30：看板卡悬停只换底色，阴影不变（不浮起）", async () => {
  const { page, errors } = await 开看板(1280);
  try {
    const 卡 = page.locator(".pipe-card").first();
    const 量 = () => 卡.evaluate((el) => ({ 底: getComputedStyle(el).backgroundColor, 影: getComputedStyle(el).boxShadow }));
    await page.mouse.move(5, 5);
    const 前 = await 量();
    await 卡.hover();
    await page.waitForTimeout(250);
    const 后 = await 量();
    expect(后.影).toBe(前.影);
    expect(后.底).not.toBe(前.底);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D21：看板筛了一列没对上写「这一列没有对得上的项目」", async () => {
  const { page, errors } = await 开看板(1280, { 空: true, keyword: "某某" });
  try {
    expect(await page.locator(".pipe-empty").first().innerText()).toBe("这一列没有对得上的项目");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D40：看板滚到底，最后一张卡的金额不在 AI 球底下（390 宽）", async () => {
  const { page, errors } = await 开看板(390);
  try {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const 金额下 = await page.locator(".pipe-col").first().locator(".pipe-card-a").last().evaluate((el) => el.getBoundingClientRect().bottom);
    expect(金额下).toBeLessThanOrEqual((await 球框(page)).上);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("换皮主题（像素）外观不动：删除照旧普通项、没有分隔线；号码列照旧 150；看板卡照旧两行；仅项目小表照旧十列", async () => {
  const { page, errors } = await 开列表(1366, { 仅项目: true }, "pixel");
  try {
    await page.getByRole("button", { name: /^更多操作 / }).first().click();
    const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu");
    await 菜单.waitFor();
    expect(await 菜单.locator(".ant-dropdown-menu-item-divider, .ant-dropdown-menu-item-danger").count()).toBe(0);
    // 号码列宽照旧（150，不按号码长短给）：最长那个号码照旧省略
    expect(await page.locator("tr.ant-table-row .copy-val-t").first().evaluate((x) => x.scrollWidth > x.clientWidth + 1)).toBe(true);
    expect(await page.getByTestId("project-only-block").locator(".cust-ponly-head").getByText("负责人").isVisible()).toBe(true);
    expect(await page.locator(".cust-ponly-unit").count()).toBe(0);
    await page.close();
    const 板 = await 开看板(1280, {}, "pixel");
    expect((await 板.page.locator(".pipe-card").first().locator(".pipe-card-t, .pipe-card-o.pipe-card-full").allInnerTexts()).length).toBe(2);
    expect(板.errors).toEqual([]);
    await 板.page.close();
    expect(errors).toEqual([]);
  } finally { if (!page.isClosed()) await page.close(); }
});
