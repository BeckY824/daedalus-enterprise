/**
 * 企业版导入导出按钮、新建客户负责人（10-27 会议，服务端规则见 ent-import-export-perm.test.ts）。
 *
 *   客户列表：没权限（普通销售、销售管理）不摆「导入」「导出」，空库那张卡也不给「从 Excel 导入」，?import=paste 也不打开导入抽屉
 *   新建客户：普通销售负责人那一格锁成自己、灰掉，提示「新建的只能记在自己名下」；编辑不锁
 *   开关关闭（页面传 能导入导出=true、负责人只能自己=false）：和原来一样
 *   Windows 1024 / 1280 / 1366：列表头部不横向撑出，「新建」点得中
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "import-perm-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\/ImportDrawer$/, "export default function D({open}){return <div data-testid='import-drawer' data-open={String(open)}/>}");
  stub(/^\.\/export-client$/, "export const 完整导出=async()=>({ok:true});");
  stub(/^\.\/pool-actions$/, `const f=${空跑};export const 放进公海=f,领取=f,分配公海=f,撤销公海=f;`);
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/CustomerPick$/, "export default function C(){return null}");
  stub(/^\.\/ReferralRadar$/, "export default function C(){return null}");
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
    import CustomersView from '@/app/(app)/customers/CustomersView';import CustomerForm from '@/app/(app)/customers/CustomerForm';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'小张',email:'s2',role:'SALES',active:true},{id:'boss',name:'老板',email:'b',role:'ADMIN',active:true}];
    const row={id:'c1',name:长,phone:'13800000001',school:长,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',salesOwnerId:'me',salesOwnerName:'小王',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:null,signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null,expectedSignAt:null,remark:null};
    window.__render=({what,能,锁,空,粘贴,编辑})=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'me',name:'小王'}}>{
      what==='list'?<CustomersView rows={空?[]:[row]} total={空?0:1} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{}} 能导入导出={能} 负责人只能自己={锁} 直接粘贴={粘贴} 客户数={空?0:1}/>:
      <CustomerForm open editing={编辑?{id:'c1',name:'老客户',phone:'13800000001',salesOwnerId:'u2',salesOwnerName:'小张',followStatus:'待跟进',decisionStatus:'了解中',updatedAt:'2026-10-01T00:00:00.000Z'}:null} users={users} channels={[]} 负责人只能自己={锁} onClose={()=>{}}/>
    }</我Provider></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
type 参数 = { what: "list" | "form"; 能?: boolean; 锁?: boolean; 空?: boolean; 粘贴?: boolean; 编辑?: boolean };
async function open(p: 参数, width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://perm.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://perm.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(x => (window as unknown as { __render: (x: 参数) => void }).__render(x), { 能: true, 锁: false, ...p });
  await page.getByRole("button", { name: /新\s*建|保\s*存/ }).first().waitFor();
  return { page, errors };
}

it("没权限：列表不摆导入、导出，也没有导入抽屉", async () => {
  const { page, errors } = await open({ what: "list", 能: false, 锁: true });
  try {
    expect(await page.getByRole("button", { name: /导\s*入/ }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /导\s*出/ }).count()).toBe(0);
    expect(await page.getByTestId("import-drawer").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("没权限：空库那张卡不给「从 Excel 导入」，?import=paste 也不打开", async () => {
  const { page, errors } = await open({ what: "list", 能: false, 锁: true, 空: true, 粘贴: true });
  try {
    expect(await page.getByText("从 Excel 导入").count()).toBe(0);
    expect(await page.getByTestId("import-drawer").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("开关关闭 / 有权限：导入、导出都在，空库卡给「从 Excel 导入」", async () => {
  const { page, errors } = await open({ what: "list" });
  try {
    expect(await page.getByRole("button", { name: /导\s*入/ }).count()).toBe(1);
    expect(await page.getByRole("button", { name: /导\s*出/ }).count()).toBe(1);
    expect(await page.getByTestId("import-drawer").count()).toBe(1);
  } finally { await page.close(); }
  const 空 = await open({ what: "list", 空: true });
  try {
    expect(await 空.page.getByText("从 Excel 导入").count()).toBe(1);
    expect([...errors, ...空.errors]).toEqual([]);
  } finally { await 空.page.close(); }
});

it("普通销售新建：负责人锁成自己、灰掉（交上去存成自己由服务端测试钉）", async () => {
  const { page, errors } = await open({ what: "form", 锁: true });
  try {
    const 格 = page.locator(".ant-form-item").filter({ hasText: "销售负责人" });
    expect(await 格.locator(".ant-select-disabled").count()).toBe(1);
    expect((await 格.locator(".ant-select").innerText()).trim()).toBe("小王");
    expect(await 格.innerText()).toContain("新建的只能记在自己名下");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("编辑不锁；开关关闭新建也不锁", async () => {
  for (const p of [{ what: "form", 锁: true, 编辑: true }, { what: "form", 锁: false }] as const) {
    const { page, errors } = await open(p);
    try {
      const 格 = page.locator(".ant-form-item").filter({ hasText: "销售负责人" });
      expect(await 格.locator(".ant-select-disabled").count()).toBe(0);
      expect(await 格.innerText()).not.toContain("新建的只能记在自己名下");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it.each([1024, 1280, 1366])("Windows %ipx：没导入导出按钮的列表头不横向撑出，「新建」点得中", async (w) => {
  const { page } = await open({ what: "list", 能: false, 锁: true }, w);
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const btn = page.getByRole("button", { name: /新\s*建/ }).first();
    const box = (await btn.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(w);
    const 点中 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box.x + box.width / 2, box.y + box.height / 2]);
    expect(点中).toBe(await btn.textContent());
  } finally { await page.close(); }
});
