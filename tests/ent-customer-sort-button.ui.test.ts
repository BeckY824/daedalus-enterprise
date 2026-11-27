/**
 * 客户列表「排序」按钮（E-332）：和表头点排序同一个 sort 参数；选字段 / 切升降序后地址参数变；
 * 带着 ?sort= 进来时打勾对、表头箭头同步；1280 / 390 宽按钮在筛选行里、菜单不出屏
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
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true}];
    const 行=(id)=>({id,name:'客户'+id,phone:'1380000000'+id.slice(1),school:null,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',custStatus:'跟进中',salesOwnerId:'me',salesOwnerName:'小王',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:'2026-11-01T00:00:00.000Z',signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null,expectedSignAt:null,remark:null,addrCountry:null,extra:{level:'A'},customerNo:12});
    const rows=[行('c1'),行('c2')];
    const s=window.__sort||'';
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'me',name:'小王'}}>
      <CustomersView rows={rows} total={2} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{phase:'',node:'',sort:s}} 客户数={2} 企业版 项目看板 能新建和领取 创建排序={s.startsWith('created')?s:''} 跟进排序={s.startsWith('follow')?s:''}/>
    </我Provider></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [列表桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(w: number, 设: Record<string, unknown> = {}): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://cust-sort.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://cust-sort.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ content: w >= 768 ? "#root{margin-left:220px;padding:22px 26px}" : "#root{padding:12px 16px}" });
  await page.evaluate((x) => Object.assign(window, x), 设);
  await page.addScriptTag({ content: 包 });
  await page.locator("tr.ant-table-row").first().waitFor();
  return { page, errors };
}
const 参数 = (page: Page) => page.evaluate(() => new URL(String((window as unknown as { __push?: string }).__push || "/x"), "http://a").searchParams.get("sort"));
const 选中项 = (page: Page) => page.locator(".cust-sort-menu .ant-dropdown-menu-item:has(.anticon-check)").allInnerTexts();

for (const w of [1280, 390]) {
  it(`${w} 宽：排序按钮在筛选行里，选字段 / 切升降序后 sort 参数跟着变，菜单在屏内`, async () => {
    const { page, errors } = await 开(w);
    const 钮 = page.getByRole("button", { name: "排序" });
    await 钮.waitFor();
    const 位 = await 钮.boundingBox();
    expect(位!.x + 位!.width).toBeLessThanOrEqual(w + 1);
    await 钮.click();
    await page.locator(".cust-sort-menu").waitFor();
    const 菜 = await page.locator(".cust-sort-menu").boundingBox();
    expect(菜!.x).toBeGreaterThanOrEqual(-1); expect(菜!.x + 菜!.width).toBeLessThanOrEqual(w + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.locator(".cust-sort-menu").getByText("创建时间", { exact: true }).click();
    expect(await 参数(page)).toBe("created-desc");
    await page.locator(".cust-sort-menu").getByText("升序", { exact: true }).click();
    expect(await 参数(page)).toBe("created-asc");
    await page.locator(".cust-sort-menu").getByText("最近跟进", { exact: true }).click();
    expect(await 参数(page)).toBe("follow-asc");
    expect(errors).toEqual([]); await page.close();
  });
}

it("带着 sort=follow-desc 进来：菜单里打勾的是最近跟进 + 降序，表头箭头同步", async () => {
  const { page } = await 开(1280, { __sort: "follow-desc" });
  await page.getByRole("button", { name: "排序" }).click();
  await page.locator(".cust-sort-menu").waitFor();
  expect((await 选中项(page)).map((t) => t.trim())).toEqual(["最近跟进", "降序"]);
  expect(await page.locator("th.ant-table-column-sort").allInnerTexts()).toEqual([expect.stringContaining("最近跟进")]);
  await page.close();
});
