/**
 * 客户列表（11-20 员工反馈：「能显示全部号码吗？每一次我都要点进去，点进去再退出来，之前勾选设置的页面就全乱了」「可以快速的复制，在微信上粘贴」）：
 *   29Q「联系电话」一列：服务端给的完整号码原样显示、右边一颗复制键，点了复制完整号码、有一句轻提示、不算点这一行；
 *       服务端打了码的（公海、教练、字段权限藏号，见 ent-cust-list-phone-full.test.ts）带 *，不给复制键；没号的写「—」
 *   29R 进详情再回来 / 刷新：勾选、表格横滚位置还原（同一个地址才还原，换了页码不还原）；列设置刷新后还在
 * 真浏览器里挂真 CustomersView + DataList + CopyValue；「回来」用整页重新加载模拟（组件重新挂上、sessionStorage 留着，和点「回到客户列表」一样是重新挂载）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, 包: string;
const 桩: Plugin = { name: "cust-phone-state", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__push=u},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\/ImportDrawer$/, "export default function D(){return null}");
  stub(/^\.\/export-client$/, "export const 完整导出=async()=>({ok:true});");
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

beforeAll(async () => {
  包 = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import CustomersView from '@/app/(app)/customers/CustomersView';
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'小李',email:'s2',role:'SALES',active:true}];
    const 行=(id,phone,pool)=>({id,name:'某某贸易有限公司'+id,phone,school:null,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',custStatus:'跟进中',salesOwnerId:'me',salesOwnerName:'小王',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:'2026-11-01T00:00:00.000Z',signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null,expectedSignAt:null,remark:'备注'.repeat(20),addrCountry:'中国',extra:{level:'A'},customerNo:Number(id.slice(1)),pool:pool?{reason:'超时回收'}:null});
    const rows=[行('c1','13800000001'),行('c2','138****0002',true),行('c3',''),行('c4','02166668888')];
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'me',name:'小王'}}>
      <CustomersView rows={rows} total={4} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{phase:'',node:''}} 客户数={4} 企业版 项目概况={{}} 项目看板/>
    </我Provider></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

/** localhost 才有 navigator.clipboard；换成记下写了什么 */
const 记写入 = "window.__写=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(t)=>{window.__写.push(t)}}});";

async function 挂上(page: Page) {
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: 包 });
  await page.locator("tr.ant-table-row").first().waitFor();
}
async function 打开(page: Page, 地址: string, 先设?: () => void) {
  await page.goto(地址);
  if (先设) await page.evaluate(先设);
  await 挂上(page);
}
async function 新页(errors: string[], 宽 = 1024) {
  const page = await browser.newPage({ viewport: { width: 宽, height: 800 } });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://localhost/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.addInitScript(记写入);
  return page;
}
const 格 = (page: Page, id: string) => page.locator(`tr[data-row-key=${id}] td.dl-col-phone`);
const 勾着 = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>("tr.ant-table-row .ant-checkbox-input")].filter((x) => x.checked).map((x) => x.closest("tr")!.getAttribute("data-row-key")));
const 横滚 = (page: Page) => page.evaluate(() => document.querySelector<HTMLElement>(".ant-table-content")!.scrollLeft);

it("29Q：完整号码 + 复制键（复制完整号、轻提示、不进详情）；打了码的不给复制键；没号的写「—」", async () => {
  const errors: string[] = [];
  const page = await 新页(errors);
  try {
    // 「联系电话」默认收在「列」里：先勾上（列设置存本地）
    await 打开(page, "http://localhost/customers?page=1", () => localStorage.setItem("list-cols:customers", JSON.stringify(["phone"])));
    await expect.poll(() => 格(page, "c1").innerText()).toContain("13800000001");
    expect(await 格(page, "c4").innerText()).toContain("02166668888");
    expect(await 格(page, "c2").innerText()).toContain("138****0002");
    expect(await 格(page, "c2").locator(".copy-val-b").count()).toBe(0);
    expect((await 格(page, "c3").innerText()).trim()).toBe("—");
    await 格(page, "c1").getByRole("button", { name: "复制电话" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __写: string[] }).__写)).toEqual(["13800000001"]);
    await expect.poll(() => page.getByText("已复制电话").count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { __push?: string }).__push)).toBeUndefined();
    // 号码一行放得下、复制键不出格
    const 量 = await 格(page, "c1").evaluate((td) => {
      const t = td.querySelector<HTMLElement>(".copy-val-t")!, b2 = td.querySelector<HTMLElement>(".copy-val-b")!.getBoundingClientRect(), r = td.getBoundingClientRect();
      return { 截了: t.scrollWidth > t.clientWidth, 出格: b2.right > r.right + 0.5 };
    });
    expect(量).toEqual({ 截了: false, 出格: false });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("29R：勾两行、横滚一段 → 重新挂上（回来 / 刷新）勾选和横滚还原、列设置还在；换了页码的地址不还原", async () => {
  const errors: string[] = [];
  const page = await 新页(errors);
  try {
    await 打开(page, "http://localhost/customers?page=1", () => localStorage.setItem("list-cols:customers", JSON.stringify(["phone", "createdAt", "signedAmount"])));
    await page.locator("tr[data-row-key=c1] .ant-checkbox-input").check();
    await page.locator("tr[data-row-key=c4] .ant-checkbox-input").check();
    expect(await 勾着(page)).toEqual(["c1", "c4"]);
    // 1024 宽、多勾了两列：表格自己横滚
    const 能滚 = await page.evaluate(() => { const x = document.querySelector<HTMLElement>(".ant-table-content")!; return x.scrollWidth - x.clientWidth; });
    expect(能滚).toBeGreaterThan(100);
    await page.evaluate(() => { const x = document.querySelector<HTMLElement>(".ant-table-content")!; x.scrollLeft = 90; });
    // 横滚隔 150ms 才记
    await page.waitForTimeout(400);

    await page.reload();
    await 挂上(page);
    await expect.poll(() => 勾着(page)).toEqual(["c1", "c4"]);
    await expect.poll(() => 横滚(page)).toBe(90);
    await expect.poll(() => page.locator(".list-sel-float").innerText()).toContain("2");
    // 列设置（localStorage）刷新后还在
    expect(await page.locator("thead th.dl-col-phone").count()).toBe(1);
    expect(await page.locator("thead th.dl-col-createdAt").count()).toBe(1);

    // 取消一行，再回来：只剩一行
    await page.locator("tr[data-row-key=c1] .ant-checkbox-input").uncheck();
    await page.reload();
    await 挂上(page);
    await expect.poll(() => 勾着(page)).toEqual(["c4"]);

    // 换了页码（地址不一样）：不还原
    await 打开(page, "http://localhost/customers?page=2");
    await page.waitForTimeout(200);
    expect(await 勾着(page)).toEqual([]);
    expect(await 横滚(page)).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("29R 手机宽（375）：勾两行、横滚 → 回来 / 刷新照样还原；号码那一格照样带复制键", async () => {
  const errors: string[] = [];
  const page = await 新页(errors, 375);
  try {
    await 打开(page, "http://localhost/customers?keyword=a", () => localStorage.setItem("list-cols:customers", JSON.stringify(["phone"])));
    await page.locator("tr[data-row-key=c2] .ant-checkbox-input").check();
    await page.locator("tr[data-row-key=c3] .ant-checkbox-input").check();
    await page.evaluate(() => { document.querySelector<HTMLElement>(".ant-table-content")!.scrollLeft = 60; });
    await page.waitForTimeout(400);
    await page.reload();
    await 挂上(page);
    await expect.poll(() => 勾着(page)).toEqual(["c2", "c3"]);
    await expect.poll(() => 横滚(page)).toBe(60);
    expect(await 格(page, "c1").getByRole("button", { name: "复制电话" }).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
