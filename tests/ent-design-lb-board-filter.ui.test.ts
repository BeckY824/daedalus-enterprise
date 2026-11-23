/**
 * 设计语言 L-B · D37 补：客户页「看板」视图的筛选占位字也墨色（L-A 只改了列表筛选行）。
 *
 *   市场管理客户页（我分出去的）看板：筛选在 .pipe-top，「全部成员 / 全部创建人 / 全部进程」占位字和「全部阶段」一个颜色（墨色，不是 faint）
 *   销售客户页看板：筛选行照旧是 .list-bar（看板体换掉表格），占位字墨色
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, 列表包: string, 市场包: string;
const 列表桩: Plugin = { name: "design-lb-board-list", setup(b) {
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
const 市场桩: Plugin = { name: "design-lb-board-market", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  const 好 = "async()=>({ok:true})";
  stub(/^next\/link$/, "export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/actions$/, `const f=${好};export const 回项目邀请=f,市场复核Action=f,总管理终判Action=f,看板推进预检=async()=>({ok:true,还差:[]}),改项目节点=f,记完成节点被拦=f,编辑项目=f,看板补必填料=async()=>({ok:false,error:'x'});`);
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
      <CustomersView 看板体={o.看板?<div className="board-stub">看板</div>:undefined} rows={rows} total={19497} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} 企业版 项目看板 能新建和领取={o.新建!==false}
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

async function 开(包: string, w: number, 参: Record<string, unknown> = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  page.setDefaultTimeout(5000);
  await page.route("http://design-lb.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://design-lb.test/customers");
  await page.evaluate(() => { localStorage.setItem("projects-view", JSON.stringify("看板")); });
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ content: "#root{margin-left:220px;padding:22px 26px}" });
  await page.addScriptTag({ content: 包 });
  await page.evaluate((x) => (window as unknown as { __render: (x: object) => void }).__render(x), 参);
  await page.locator(".page-head h1").waitFor();
  return page;
}
/** 每个下拉显示的那段字（占位字或选中值）的颜色，按 aria-label 记 */
const 下拉色 = (page: Page, sel: string) => page.locator(`${sel} .ant-select`).evaluateAll((xs) => Object.fromEntries(xs.map((x) => {
  const t = x.querySelector(".ant-select-placeholder") ?? x.querySelector(".ant-select-content-value, .ant-select-selection-item, .ant-select-content") ?? x;
  return [x.querySelector("input")?.getAttribute("aria-label") ?? (t.textContent ?? "").trim(), getComputedStyle(t).color];
})));
const 色 = (page: Page, v: string) => page.evaluate((v) => { const d = document.createElement("i"); d.style.color = `var(${v})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, v);

it("市场管理客户页看板：「全部成员 / 全部创建人 / 全部阶段 / 全部进程」都是墨色", async () => {
  const page = await 开(市场包, 1366);
  try {
    await page.locator(".cust-market .pipe-top .ant-select").first().waitFor();
    const 们 = await 下拉色(page, ".cust-market .pipe-top");
    expect(Object.keys(们).length).toBeGreaterThanOrEqual(3);
    const 墨 = await 色(page, "--ink");
    for (const [k, c] of Object.entries(们)) expect(c, k).toBe(墨);
    expect(await page.locator(".cust-market .pipe-top .ant-select-placeholder").count()).toBeGreaterThanOrEqual(2);
  } finally { await page.close(); }
});

it("销售客户页看板：筛选行（.list-bar）占位字墨色", async () => {
  const page = await 开(列表包, 1366, { 看板: true });
  try {
    await page.locator(".board-stub").waitFor();
    const 们 = await 下拉色(page, ".cu-morph-wrap .list-bar");
    expect(Object.keys(们).length).toBeGreaterThanOrEqual(2);
    const 墨 = await 色(page, "--ink");
    for (const [k, c] of Object.entries(们)) expect(c, k).toBe(墨);
  } finally { await page.close(); }
});
