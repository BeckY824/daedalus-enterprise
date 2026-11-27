/**
 * 手机宽页头右上那组按钮（11-20 c2 实操，系统管理员客户页 375 宽横滚）：系统管理员有「导入 · 导出 · 新建 · 离职交接 N」四颗，
 * 原来 .page-head-a 是 flex: none，按一排的宽度摆，里面的 Space wrap 折不了，「离职交接」出屏、整页横滚。
 * 现在手机上（≤ 767）按钮组不比页头宽、放不下的换行；1024 / 1280 / 1366 照旧一排在右上。
 * 用例：带「范围」页签（我负责的 / 我参与的 / 我可见的）+ 四颗按钮，离职交接带数；量整页 scrollWidth、每颗按钮在屏里且点得到
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, 列表包: string;
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

const 打包 = async (contents: string, plugin: Plugin) => (await build({ stdin: { contents, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
beforeAll(async () => {
  列表包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import CustomersView from '@/app/(app)/customers/CustomersView';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'小张',email:'s2',role:'SALES',active:true}];
    const 行=(id)=>({id,name:'客户'+长,phone:'13800000000',school:长,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',salesOwnerId:'u2',salesOwnerName:'小张',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:null,signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null});
    const 范围={值:'我可见的',默认:'我可见的',选项:['我负责的','我参与的','我可见的']};
    window.__render=({待交接,导入导出=true,有范围=true})=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'me',name:'小王'}}>
      <div style={{padding:'16px'}}><CustomersView rows={[行('c1'),行('c2')]} total={2} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{}} 客户数={2} 企业版 能导入导出={导入导出} 待交接={待交接} 客户范围={有范围?范围:undefined}/></div>
    </我Provider></BusinessProvider></App></ConfigProvider>);
  `, 列表桩);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(参: object, width: number) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, ...(width < 768 ? { isMobile: true, hasTouch: true } : {}) }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://head.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://head.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 列表包 });
  await page.evaluate(x => (window as unknown as { __render: (x: object) => void }).__render(x), 参);
  await page.locator(".page-head-a").first().waitFor();
  return { page, errors };
}
/** 页头右上每颗按钮：整个在屏里、中心点没被盖住 */
const 按钮们在屏里 = (page: Page) => page.locator(".page-head-a button").evaluateAll((bs) => bs.map((b) => {
  const r = b.getBoundingClientRect();
  const 顶 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { 字: b.textContent?.trim(), 好: r.left >= 0 && r.right <= innerWidth && r.width > 0 && (b === 顶 || b.contains(顶)) };
}).filter((x) => !x.好));

it.each([375, 390, 360])("%ipx 手机：系统管理员四颗按钮（含离职交接 N）放不下就换行，不横滚、每颗点得到", async (w) => {
  for (const 有范围 of [true, false]) {
    const { page, errors } = await 开({ 待交接: 3, 有范围 }, w);
    try {
      expect(await page.locator('.page-head-a button[aria-label="离职交接 3"]').count()).toBe(1);  // 数字前的空格由 CSS ::before 补，textContent 里没有，按 aria-label 认
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `宽 ${w} 范围 ${有范围}`).toBe(true);
      expect(await 按钮们在屏里(page), `宽 ${w} 范围 ${有范围}`).toEqual([]);
      const 组 = await page.locator(".page-head-a").evaluate((e) => { const r = e.getBoundingClientRect(); return { 右: r.right, 宽: e.scrollWidth - e.clientWidth, 头右: e.parentElement!.getBoundingClientRect().right }; });
      expect(组.右, `宽 ${w}`).toBeLessThanOrEqual(w);
      expect(组.宽, `宽 ${w}`).toBeLessThanOrEqual(0);
      // 折到下一行也照旧靠右（审查 29A）
      expect(Math.abs(组.右 - 组.头右), `宽 ${w} 范围 ${有范围}`).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it.each([375, 390])("%ipx 手机：按钮少（没导入导出、有范围页签）折到标题下面那行也靠右", async (w) => {
  const { page, errors } = await 开({ 待交接: 3, 导入导出: false }, w);
  try {
    const 组 = await page.locator(".page-head-a").evaluate((e) => ({ 右: e.getBoundingClientRect().right, 左: e.getBoundingClientRect().left, 头右: e.parentElement!.getBoundingClientRect().right, 头左: e.parentElement!.getBoundingClientRect().left }));
    expect(Math.abs(组.右 - 组.头右)).toBeLessThanOrEqual(1);
    expect(组.左).toBeGreaterThan(组.头左 + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("%ipx 桌面：照旧一排摆在右上，不折行", async (w) => {
  const { page, errors } = await 开({ 待交接: 3 }, w);
  try {
    const 顶们 = await page.locator(".page-head-a button").evaluateAll((bs) => [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top)))]);
    expect(顶们.length, `宽 ${w}`).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await 按钮们在屏里(page)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
