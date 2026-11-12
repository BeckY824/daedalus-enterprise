/**
 * 「放回公海」按钮只给能放的人（P-公海-05）：服务端页面把 能放回客户公海（permissions.ts，和动作 放进公海 同一处）的结果传下来，
 * 这里看界面照着摆——
 *   客户详情：能放公海 = false 不摆「退回公海」，true 才摆；
 *   客户列表批量条：勾的全在 放不了ids 里不摆「放回公海」；有一位放得了就摆，点了照旧整批交给服务端（放不了的服务端跳过、提示几位没放）。
 * 1024 / 1280 / 1366 宽、超长客户名：批量条和详情页头不撑出页面、按钮点得到。
 * 判定本身（七种角色 × 客户归谁）在 ent-pool-return-perm-matrix.test.ts。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, 列表包: string, 详情包: string;
const 列表桩: Plugin = { name: "import-perm-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__push=u},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\/ImportDrawer$/, "export default function D({open}){return <div data-testid='import-drawer' data-open={String(open)}/>}");
  stub(/^\.\/export-client$/, "export const 完整导出=async()=>({ok:true});");
  stub(/^\.\/pool-actions$/, `const f=${空跑};export const 放进公海=async(ids)=>{window.__放=ids;return{ok:true,updated:1,unchanged:0,没权限:ids.length-1}},领取=f,分配公海=f,撤销公海=f,退回原因选项=async()=>[];`);
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
const 详情桩: Plugin = { name: "customer-modules", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;");
  stub(/(^|\/)InlineField$/, "export default function Inline(p){return <div className='rec-field' data-field={p.field}>{p.label}: {p.value}</div>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>\"/customers/x\";");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(^|\/)(TaskForm|PlanForm|ContactForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|NewProjectModal|ContactLinks|ResearchRun|ResearchPerson)$/, "export default function Empty(){return null}");
  stub(/research\/ResearchEntry$/, "export const useResearchEntry=()=>false;");
  stub(/research\/actions$/, "export const 最近背调=async()=>null,背调价目=async()=>({可用:false,原因:'桩'});");
  stub(/^\.\/pick$/, "export const 搜客户=async()=>[];");
  stub(/^\.\/link-actions$/, "export const 关联客户=async()=>({ok:true}),改关联说明=关联客户,取消关联=关联客户;");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({问怎么拿掉(){}});");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海,退回原因选项=async()=>[];");
  stub(/^\.\.\/actions$/, "export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=async()=>({ok:true});");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  stub(/projects\/actions$/, "export const 项目沟通须知=async()=>({ok:true,能记:false}),记项目沟通Action=async()=>({ok:true,followUpId:'f1'});");
  stub(/^\.\/actions$/, `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,saveFollowUp=toggleTask,deleteFollowUp=toggleTask;
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
    export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'p1'});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

const 打包 = async (contents: string, plugin: Plugin) => (await build({ stdin: { contents, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
beforeAll(async () => {
  列表包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import CustomersView from '@/app/(app)/customers/CustomersView';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'小张',email:'s2',role:'SALES',active:true},{id:'u3',name:'小李',email:'s3',role:'SALES',active:true}];
    const 行=(id,owner,名)=>({id,name:名+长,phone:'1380000000'+id.slice(1),school:长,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',salesOwnerId:owner,salesOwnerName:owner==='me'?'小王':'小张',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:null,signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null,expectedSignAt:null,remark:null});
    const rows=[行('c1','me','我的'),行('c2','u2','下属的'),行('c3','u2','别线的'),行('c4','u2','别线的二')];
    window.__render=({放不了})=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'me',name:'小王'}}>
      <CustomersView rows={rows} total={4} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{}} 客户数={4} 企业版 能转出自己的 放不了ids={放不了}/>
    </我Provider></BusinessProvider></App></ConfigProvider>);
  `, 列表桩);
  详情包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Record from '@/app/(app)/customers/[id]/RecordView';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    const users=[{id:'qa',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'小张',email:'s2',role:'SALES',active:true}];
    const 项目们=[{id:'p1',name:'项目一',phase:'进行中',node:'报价',result:null,pooledAt:null,amount:0,currency:'CNY'}];
    const 项目={跟进去处:[{id:'p1',名:'项目一',主:true,结束:false,说明:null,下一步:null,下一步文字:null}],待办计划:[],followUps:[]};
    window.__render=({能放})=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><div className='shell'><nav className='rail' aria-label='主导航'/><main className='main app-content' style={{padding:'22px 26px'}}><div>
      <Record customer={{id:'a',extra:null,name:长,phone:'13800138000',school:长,grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'u2',salesOwnerName:'小张',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z'}} contacts={[]} contracts={[]} opportunities={[]} tasks={[]} plan={null} users={users} channels={[]} aiEnabled={false} followUpsHasMore={false} 项目们={项目们} 参与项目们={[]} 关联们={[]} 旺旺们={[]} 企业版 能放公海={能放} 能转让客户 {...项目}/>
    </div></main></div></BusinessProvider></App></ConfigProvider>);
  `, 详情桩);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(包: string, 参: object, width: number, 等: string) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://pool-btn.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://pool-btn.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 包 });
  await page.evaluate(x => (window as unknown as { __render: (x: object) => void }).__render(x), 参);
  await page.locator(等).first().waitFor();
  return { page, errors };
}
const 宽们 = [1024, 1280, 1366];
const 不撑出 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** 按钮整个在视口里、中心点没被别的盖住 */
const 点得到 = (page: Page, sel: string, 字: RegExp) => page.locator(sel).filter({ hasText: 字 }).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  const 顶 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return r.left >= 0 && r.right <= window.innerWidth && r.width > 0 && (el === 顶 || el.contains(顶));
});
const 勾 = async (page: Page, ids: string[]) => { for (const id of ids) await page.locator(`tr[data-row-key="${id}"] .ant-checkbox-input`).check(); };
const 批量放回 = (page: Page) => page.locator(".list-sel button").filter({ hasText: /放回公海/ });

it("客户列表批量条：勾的全是放不了的，不摆「放回公海」（三种宽度）", async () => {
  for (const w of 宽们) {
    const { page, errors } = await 开(列表包, { 放不了: ["c3", "c4"] }, w, "tr.ant-table-row");
    try {
      await 勾(page, ["c3", "c4"]);
      await page.locator(".list-sel").waitFor();
      expect(await 批量放回(page).count(), `宽 ${w}`).toBe(0);
      expect(await 不撑出(page), `宽 ${w}`).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("客户列表批量条：勾的里有放得了的就摆，不撑出页面、点得到；点了整批交给服务端", async () => {
  for (const w of 宽们) {
    const { page, errors } = await 开(列表包, { 放不了: ["c3", "c4"] }, w, "tr.ant-table-row");
    try {
      await 勾(page, ["c1", "c2", "c3"]);
      await expect.poll(() => 批量放回(page).count(), { message: `宽 ${w}` }).toBe(1);
      expect(await 不撑出(page), `宽 ${w}`).toBe(true);
      expect(await 点得到(page, ".list-sel button", /放回公海/), `宽 ${w}`).toBe(true);
      await 批量放回(page).click();
      await page.locator(".ant-modal-confirm").getByRole("button", { name: /放回公海/ }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __放?: string[] }).__放 ?? null)).toEqual(["c1", "c2", "c3"]);
      // 放不了的服务端跳过，提示里说几位没放
      await expect.poll(() => page.locator(".ant-message").innerText()).toMatch(/2 位你放不了，没放/);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("客户列表：没传 放不了ids（都放得了）照旧摆", async () => {
  const { page, errors } = await 开(列表包, {}, 1280, "tr.ant-table-row");
  try {
    await 勾(page, ["c2"]);
    await expect.poll(() => 批量放回(page).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("客户详情：能放公海 = false 不摆「客户退回公海」，true 才摆；三种宽度页头不撑出、点得到", async () => {
  for (const w of 宽们) {
    for (const 能放 of [false, true]) {
      const { page, errors } = await 开(详情包, { 能放 }, w, ".rec-acts");
      try {
        const 钮 = page.locator(".rec-acts button").filter({ hasText: /退回公海/ });
        expect(await 钮.count(), `宽 ${w} 能放 ${能放}`).toBe(能放 ? 1 : 0);
        expect(await 不撑出(page), `宽 ${w}`).toBe(true);
        if (能放) expect(await 点得到(page, ".rec-acts button", /退回公海/), `宽 ${w}`).toBe(true);
        // 11-12 改名：客户页头叫「客户退回公海」，和项目页的「项目退回公海」分开；三种宽度都不折行
        if (能放) expect(await 钮.evaluate((el) => [(el as HTMLElement).innerText.replace(/\s+/g, ""), el.getBoundingClientRect().height <= 40]), `宽 ${w}`).toEqual(["客户退回公海", true]);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }
  }
});
