/**
 * 客户页「范围」筛选的界面（客户 11-18 第 12 题）：
 * - 销售：两项「我负责的 / 我参与的」，默认停在我负责的；有管理范围的多一项「我可见的」
 * - 摆在标题旁边（企业版项目模式原来「客户 / 公海」页签的位置），不进筛选行；选中项写进地址栏 scope（换一项 = 回第一页重查）
 * - 1024 / 1280 / 1366 宽（左栏 220）、超长客户名 / 同事名：筛选行仍一行、范围每格字不溢出（scrollWidth）、
 *   每格中心点得中（elementFromPoint）、页面不横向撑出；手机宽（375）三项也在屏内、点得中、不横滚
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, 包: string;
const 列表桩: Plugin = { name: "import-perm-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__push=u;if(window.__服务端换)setTimeout(()=>window.__设板(b=>!b),60)},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
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
  // 牌子放在一个真的 antd 弹框里：看「关了焦点回到『新建』」用（弹框关掉把焦点还给打开那一刻有焦点的元素）
  stub(/projects\/NewProjectFlow$/, "import {useState} from 'react';import {Modal} from 'antd';export default function F(){const [o,s]=useState(true);return <Modal open={o} title='新增项目' footer={null} onCancel={()=>s(false)}><div className='new-proj-flow-stub'/></Modal>}");
  stub(/^\.\.\/channels\/actions$/, `export const saveChannel=${空跑};`);
  stub(/^(\.\/|\.\.\/)actions$/, `const f=${空跑};
    export const saveCustomer=async x=>{window.__存=x;return{ok:true,id:'new'}},checkDuplicate=async()=>null,推荐人候选=async()=>[],patchCustomer=f,
    assignSalesOwner=f,bulkFollowStatus=f,撤销改负责人=f,deleteCustomers=f,删除前清点=async()=>({}),客户删除预检=async()=>({ok:true}),转走项目预览of=async()=>({项目数:0,项目:[]}),saveChannel=f,供应商候选=async()=>[];`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  包 = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import CustomersView from '@/app/(app)/customers/CustomersView';
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'一个名字特别特别长的同事'.repeat(2),email:'s2',role:'SALES',active:true}];
    const 行=(id,owner)=>({id,name:长+id,phone:'1380000000'+id.slice(1),school:null,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',custStatus:'跟进中',salesOwnerId:owner,salesOwnerName:owner==='me'?'小王':users[1].name,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:'2026-11-01T00:00:00.000Z',signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null,expectedSignAt:null,remark:null,addrCountry:'阿拉伯联合酋长国',extra:{level:'A'},customerNo:12});
    const rows=[行('c1','me'),行('c2','u2'),行('c3','me')];
    const 管=!!window.__管理;
    const 范围={值:window.__范围||(管?'visible':'mine'),默认:管?'visible':'mine',选项:管?['mine','joined','visible']:['mine','joined']};
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'me',name:'小王'}}>
      <CustomersView rows={rows} total={3} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{phase:'',node:'',scope:范围.值}} 客户数={3} 企业版 项目看板 能新建和领取 客户范围={范围}/>
    </我Provider></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [列表桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(w: number, 设: Record<string, unknown> = {}): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://cust-scope.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://cust-scope.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  // 桌面宽左边留出 220 的左栏（壳里正文就这么宽）；手机宽左栏收起
  await page.addStyleTag({ content: w >= 768 ? "#root{margin-left:220px;padding:22px 26px}" : "#root{padding:12px 16px}" });
  await page.evaluate((x) => Object.assign(window, x), 设);
  await page.addScriptTag({ content: 包 });
  await page.locator("tr.ant-table-row").first().waitFor();
  return { page, errors };
}
const 范围格 = (page: Page) => page.locator(".cust-scope");
/** 范围那一排：选中的是哪项；每一格字不溢出、中心点得中（没被页头别的东西盖住）；整排在屏内、页面不横滚 */
const 量 = (page: Page) => 范围格(page).evaluate((el) => {
  const 格们 = [...el.querySelectorAll(".ant-segmented-item")] as HTMLElement[];
  const 在屏 = document.documentElement.clientWidth;
  return {
    字: (el.querySelector(".ant-segmented-item-selected") as HTMLElement | null)?.innerText.trim(),
    字溢出: 格们.some((g) => { const t = g.querySelector(".ant-segmented-item-label") as HTMLElement; return !t || t.scrollWidth > t.clientWidth + 1; }),
    点得中: 格们.every((g) => { const r = g.getBoundingClientRect(); const 中 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!中 && g.contains(中); }),
    页横滚: document.documentElement.scrollWidth > 在屏,
    右界内: el.getBoundingClientRect().right <= 在屏 + 1,
  };
});
const 选 = (page: Page, 名: string) => 范围格(page).locator(".ant-segmented-item").filter({ hasText: 名 }).click();
const 项们 = (page: Page) => 范围格(page).locator(".ant-segmented-item").allInnerTexts();
const 推到 = (page: Page) => page.evaluate(() => (window as unknown as { __push?: string }).__push ?? "");

for (const w of [1024, 1280, 1366]) {
  it(`销售：默认我负责的，两项；筛选行一行、不溢出、点得中（${w} 宽）`, async () => {
    const { page, errors } = await 开(w);
    try {
      expect(await 量(page)).toEqual({ 字: "我负责的", 字溢出: false, 点得中: true, 页横滚: false, 右界内: true });
      expect(await page.locator(".list-bar > .ant-space").first().evaluate((el) => el.getBoundingClientRect().height), `宽 ${w} 筛选行一行`).toBeLessThanOrEqual(40);
      expect(await 项们(page)).toEqual(["我负责的", "我参与的"]);
      await 选(page, "我参与的");
      await expect.poll(() => 推到(page)).toMatch(/[?&]scope=joined(&|$)/);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("有管理范围：三项、默认我可见的；1024 宽筛选行一行", async () => {
  const { page, errors } = await 开(1024, { __管理: true });
  try {
    expect(await 量(page)).toEqual({ 字: "我可见的", 字溢出: false, 点得中: true, 页横滚: false, 右界内: true });
    expect(await page.locator(".list-bar > .ant-space").first().evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(40);
    expect(await 项们(page)).toEqual(["我负责的", "我参与的", "我可见的"]);
    await 选(page, "我负责的");
    await expect.poll(() => 推到(page)).toMatch(/[?&]scope=mine(&|$)/);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("地址栏带着我参与的：停在这一项", async () => {
  const { page, errors } = await 开(1280, { __范围: "joined" });
  try {
    expect((await 量(page)).字).toBe("我参与的");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("手机宽（375）有管理范围、三项：整排在屏内、每格点得中、页面不横滚", async () => {
  const { page, errors } = await 开(375, { __管理: true });
  try {
    expect(await 量(page)).toEqual({ 字: "我可见的", 字溢出: false, 点得中: true, 页横滚: false, 右界内: true });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("手机宽（375）：范围那格在屏内、点得中、页面不横滚，能换项", async () => {
  const { page, errors } = await 开(375);
  try {
    expect(await 量(page)).toEqual({ 字: "我负责的", 字溢出: false, 点得中: true, 页横滚: false, 右界内: true });
    await 选(page, "我参与的");
    await expect.poll(() => 推到(page)).toMatch(/scope=joined/);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
