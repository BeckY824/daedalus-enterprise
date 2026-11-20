/**
 * 公海回收站里的无效客户（P-公海-09，标了 poolInvalidAt）打开客户详情（11-20 c2 实操）：
 *   原来没有「无效」标、「领取」照样能点（服务端才挡）。现在和公海列表那一格一样摆红色「无效」标；
 *   领不了（M-权限-03）：能领公海的人领取灰着、旁边写原因；能恢复的（系统管理员、回收站副手，P-删-02 / P-公海-07）摆「恢复」，一步恢复、刷新；
 *   没标无效的公海客户照旧能领。1024 / 1280 / 1366 / 375 宽、超长客户名不撑出页面
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, 详情包: string;
const 详情桩: Plugin = { name: "customer-modules", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)tri-state-actions$/, "export const 三态继续持有=async()=>({ok:false,error:\"\"}),三态暂缓回收=三态继续持有,三态让同事结束项目=三态继续持有;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>window.__习惯??null;", "async()=>null"));
  stub(/(^|\/)InlineField$/, "export default function Inline(p){return <div className='rec-field' data-field={p.field}>{p.label}: {p.value}</div>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷=(window.__刷||0)+1},push(){}});export const usePathname=()=>\"/customers/x\";");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(^|\/)(TaskForm|PlanForm|ContactForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|NewProjectEntry|ContactLinks|ResearchRun|ResearchPerson)$/, "export default function Empty(){return null}");
  stub(/research\/ResearchEntry$/, "export const useResearchEntry=()=>false;");
  stub(/research\/actions$/, "export const 最近背调=async()=>null,背调价目=async()=>({可用:false,原因:'桩'});");
  stub(/^\.\/pick$/, "export const 搜客户=async()=>[];");
  stub(/^\.\/link-actions$/, "export const 关联客户=async()=>({ok:true}),改关联说明=关联客户,取消关联=关联客户;");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({});export const ContactRemoveInline=()=>null;");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海,退回原因选项=async()=>[];");
  stub(/^\.\.\/actions$/, "export const saveCustomerNumbers=async()=>({ok:true});export const 转走项目预览of=async()=>(window.__预览??{项目数:0,项目:[]});export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=async()=>({ok:true});");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  stub(/projects\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "export const 项目沟通须知=async()=>({ok:true,能记:false}),记项目沟通Action=async()=>({ok:true,followUpId:'f1'});"));
  stub(/^\.\/actions$/, `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,沟通可选项目=async()=>({ok:true,项目们:null,能建项目:true}),saveFollowUp=toggleTask,deleteFollowUp=toggleTask;
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
    export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'p1'});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };


const 打包 = async (contents: string, plugin: Plugin) => (await build({ stdin: { contents, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
beforeAll(async () => {
  详情包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Record from '@/app/(app)/customers/[id]/RecordView';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    const users=[{id:'qa',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'小张',email:'s2',role:'SALES',active:true}];
    const 项目们=[{id:'p1',name:'项目一',phase:'线索',node:'初次接触',result:null,pooledAt:'2026-11-01T00:00:00.000Z',amount:0,currency:'CNY'}];
    const 项目={跟进去处:[],待办计划:[],followUps:[]};
    // 恢复无效 = 页面递进来的服务端动作（pool/actions 恢复有效客户）；window.__恢复回 换回什么
    const 恢复=async(ids)=>{(window.__恢复??=[]).push(ids);await new Promise(r=>setTimeout(r,30));return window.__恢复回??{ok:true,updated:1,unchanged:0}};
    window.__render=({无效,能恢复,能领=true,管理员只读=false})=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><div className='shell'><nav className='rail' aria-label='主导航'/><main className='main app-content' style={{padding:'22px 26px'}}><div>
      <Record customer={{id:'a',extra:null,name:长,phone:'13800138000',school:长,grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'',salesOwnerName:'原负责人'+长,signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z',pool:{reason:'手动',...(无效?{无效:true}:{})}}} contacts={[]} contracts={[]} opportunities={[]} tasks={[]} plan={null} users={users} channels={[]} aiEnabled={false} followUpsHasMore={false} 项目们={项目们} 参与项目们={[]} 关联们={[]} 旺旺们={[]} 企业版 能领={能领} 管理员只读={管理员只读} 恢复无效={能恢复?恢复:undefined} {...项目}/>
    </div></main></div></BusinessProvider></App></ConfigProvider>);
  `, 详情桩);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(参: object, width: number) {
  const page = await browser.newPage({ viewport: { width, height: width < 768 ? 667 : 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://pool-off.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://pool-off.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 详情包 });
  await page.evaluate(x => (window as unknown as { __render: (x: object) => void }).__render(x), 参);
  await page.locator(".rec-pool").first().waitFor();
  return { page, errors };
}
const 宽们 = [1024, 1280, 1366, 375];
/** 1024 / 1280 / 1366 整页不横滚；375 这里没有手机外壳（左栏 + 中栏内边距照桌面摆，项目区那颗分体按钮本来就多出几 px），只看公海那一格里的东西都在屏里 */
const 不撑出 = (page: Page) => page.evaluate(() => innerWidth < 768
  ? [...document.querySelectorAll(".rec-pool > *, #rec-pool-why")].every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })
  : document.documentElement.scrollWidth <= window.innerWidth);
const 领取钮 = (page: Page) => page.locator(".rec-pool button").filter({ hasText: /^领\s*取$/ });
const 恢复钮 = (page: Page) => page.locator(".rec-pool button").filter({ hasText: /^恢\s*复$/ });
/** 整个在视口里、中心点没被盖住 */
const 点得到 = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  const 顶 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return r.left >= 0 && r.right <= window.innerWidth && r.width > 0 && (el === 顶 || el.contains(顶));
});

it("无效客户、能领公海的人（销售）：有红色「无效」标，领取灰着，旁边写原因；不摆「恢复」", async () => {
  for (const w of 宽们) {
    const { page, errors } = await 开({ 无效: true }, w);
    try {
      const 标 = page.locator(".rec-pool .ant-tag").filter({ hasText: /^无效$/ });
      expect(await 标.count(), `宽 ${w}`).toBe(1);
      expect(await 标.evaluate((e) => e.className), `宽 ${w}`).toContain("ant-tag-red");
      expect(await 领取钮(page).count(), `宽 ${w}`).toBe(1);
      expect(await 领取钮(page).isDisabled(), `宽 ${w}`).toBe(true);
      expect(await 恢复钮(page).count(), `宽 ${w}`).toBe(0);
      const 因 = page.locator("#rec-pool-why");
      expect(await 因.innerText(), `宽 ${w}`).toBe("标了无效，要系统管理员先恢复");
      expect(await 因.isVisible(), `宽 ${w}`).toBe(true);
      expect(await 不撑出(page), `宽 ${w}`).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("无效客户、能恢复的人（系统管理员 / 回收站副手）：摆「恢复」不摆领取；点了交给服务端、刷新，就地说恢复了；没成写原因", async () => {
  for (const w of 宽们) {
    const { page, errors } = await 开({ 无效: true, 能恢复: true }, w);
    try {
      expect(await page.locator(".rec-pool .ant-tag").filter({ hasText: /^无效$/ }).count(), `宽 ${w}`).toBe(1);
      expect(await 领取钮(page).count(), `宽 ${w}`).toBe(0);
      expect(await page.locator("#rec-pool-why").count(), `宽 ${w}`).toBe(0);
      expect(await 点得到(page, ".rec-pool button"), `宽 ${w}`).toBe(true);
      await 恢复钮(page).click();
      await expect.poll(() => page.evaluate(() => JSON.stringify((window as unknown as { __恢复?: unknown }).__恢复 ?? null))).toBe(JSON.stringify([["a"]]));
      await expect.poll(() => page.evaluate(() => (window as unknown as { __刷?: number }).__刷 ?? 0)).toBe(1);
      await expect.poll(() => page.locator("body").innerText()).toContain("已恢复成有效客户");
      // 服务端挡了（如别线）：原因就地写，不刷新
      await page.evaluate(() => { Reflect.set(window, "__恢复回", { ok: false, error: "只有系统管理员或回收站副手能恢复无效客户" }); });
      await 恢复钮(page).click();
      await expect.poll(() => page.locator("body").innerText()).toContain("只有系统管理员或回收站副手能恢复无效客户");
      expect(await page.evaluate(() => (window as unknown as { __刷?: number }).__刷 ?? 0)).toBe(1);
      expect(await 不撑出(page), `宽 ${w}`).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("无效客户、管理员只读 / 没业务角色：只有「无效」标，领取、恢复、原因都不摆", async () => {
  for (const 参 of [{ 管理员只读: true }, { 能领: false }]) {
    const { page, errors } = await 开({ 无效: true, ...参 }, 1280);
    try {
      expect(await page.locator(".rec-pool .ant-tag").filter({ hasText: /^无效$/ }).count()).toBe(1);
      expect(await page.locator(".rec-pool button").count()).toBe(0);
      expect(await page.locator("#rec-pool-why").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("没标无效的公海客户：没有「无效」标，领取照旧能点", async () => {
  const { page, errors } = await 开({ 无效: false }, 1280);
  try {
    expect(await page.locator(".rec-pool .ant-tag").filter({ hasText: /^无效$/ }).count()).toBe(0);
    expect(await 领取钮(page).isDisabled()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
