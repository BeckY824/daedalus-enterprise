/**
 * 客户列表确认改版（PR7a，原型 cu.transfer / cu.return / cu.delete / cu.bulkdel / cu.handover，P-界面-40/42/43、P-转-16）：
 *   每个要确认的事「不确认不生效」：点了取消，服务端动作一次都没调；
 *   批量删除 / 转让被服务端挡（权限）：原因写在框里、框不关，页面上没有任何「已删除 / 已转给」的成功说法；
 *   批量删除勾到别人的：不整批拦，框里写「跳过」谁，只把自己的交给服务端；
 *   转让三层合一：选人、一起转走的项目、生效（负责人本人 = 接手人确认后生效）、原因在一个框里；
 *   确认接手：不再弹确认，按钮原地变「✓ 已接手」；拒收仍要原地确认；
 *   1024 / 1280 / 1366 宽、超长客户名：框不撑出页面、确认键点得到。
 * 认元素用 role / 文字，不认 antd 内部类名。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, 列表包: string, 交接包: string;
const 桩: Plugin = { name: "cust-list-confirm", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__push=u},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\/ImportDrawer$/, "export default function D(){return null}");
  stub(/^\.\/export-client$/, "export const 完整导出=async()=>({ok:true});");
  stub(/^\.\/pool-actions$/, `const f=${空跑};export const 放进公海=async(ids,因)=>{(window.__调??=[]).push(['放',ids,因]);return{ok:true,updated:ids.length,unchanged:0}},领取=f,分配公海=f,撤销公海=f,退回原因选项=async()=>['联系不上','预算不足','其他'];`);
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/CustomerPick$/, "export default function C(){return null}");
  stub(/^\.\/form-data-action$/, "export const 取客户页表单料=async()=>({channels:[],建档:null});");
  stub(/projects\/new\/ProjectWizard$/, "export function 建档弹窗(){return null}");
  stub(/projects\/NewProjectFlow$/, "export default function F(){return null}");
  stub(/^\.\.\/channels\/actions$/, `export const saveChannel=${空跑};`);
  stub(/^\.\/handover-actions$/, `
    const 记=(k)=>async(id)=>{(window.__调??=[]).push([k,id]);return window.__交接回??{ok:true,客户:3}};
    export const 确认交接=记('确认'),拒收交接=记('拒收'),撤回交接=记('撤回'),改接手人=记('改');`);
  stub(/^(\.\/|\.\.\/)actions$/, `const f=${空跑};
    const 名='某某超长贸易进出口有限公司'.repeat(6);
    export const saveCustomer=f,checkDuplicate=async()=>null,推荐人候选=async()=>[],patchCustomer=f,bulkFollowStatus=f,撤销改负责人=f,saveChannel=f,供应商候选=async()=>[];
    export const assignSalesOwner=async(ids,to,因)=>{(window.__调??=[]).push(['转',ids,to,因]);return window.__转回??{ok:true,updated:ids.length,unchanged:0,原值:ids.map(id=>({id,值:'me'}))}};
    export const deleteCustomers=async(ids)=>{(window.__调??=[]).push(['删',ids]);return window.__删回??{ok:true,deleted:ids.length}};
    export const 删除前清点=async()=>({跟进:6,计划和待办:0,签约:0,签约金额:[],联系人:2,线索:0,进回收站:true,项目:1});
    export const 客户删除预检=async()=>({ok:true});
    export const 转走项目预览of=async()=>({项目数:1,项目:[{name:'VR 乐园二期'+名,客户:名,负责人:null}]});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

const 打包 = async (contents: string) => (await build({ stdin: { contents, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [桩], logLevel: "silent" })).outputFiles[0].text;
beforeAll(async () => {
  列表包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import CustomersView from '@/app/(app)/customers/CustomersView';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'小张'+'超长名字'.repeat(8),email:'s2',role:'SALES',active:true},{id:'u3',name:'小李',email:'s3',role:'SALES',active:true}];
    const 行=(id,owner,名)=>({id,name:名+长,phone:'1380000000'+id.slice(1),school:长,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',salesOwnerId:owner,salesOwnerName:owner==='me'?'小王':'小张',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:null,signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null,expectedSignAt:null,remark:null});
    const rows=[行('c1','me','我的一'),行('c2','me','我的二'),行('c3','u2','别人的')];
    window.__render=()=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'me',name:'小王'}}>
      <CustomersView rows={rows} total={3} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{}} 客户数={3} 企业版 能转出自己的 删不了ids={['c3']} 转让原因={{选项:['工作调整','其他'],自己:'me'}}/>
    </我Provider></BusinessProvider></App></ConfigProvider>);
  `);
  交接包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import HandoverPending from '@/app/(app)/customers/HandoverPending';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    const h={id:'h1',kind:'转让',自己的:false,发起人:'李想',从:'李想',给:'小王',接手人id:'me',客户:[长,'B'+长],客户总数:3,reason:null,状态:'待确认',确认说明:'',我能撤回:false,我能改接手人:false};
    window.__render=()=>root.render(<ConfigProvider locale={zhCN}><App><HandoverPending 等我确认={[h]} 我发起的={[]} 我="me"/></App></ConfigProvider>);
  `);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(包: string, width: number, 等: string) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://cust-confirm.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://cust-confirm.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 包 });
  await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
  await page.locator(等).first().waitFor();
  return { page, errors };
}
const 调 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? []);
const 勾 = async (page: Page, ids: string[]) => { for (const id of ids) await page.locator(`tr[data-row-key="${id}"] .ant-checkbox-input`).check(); };
const 批量钮 = (page: Page, 字: RegExp) => page.locator(".list-sel").getByRole("button", { name: 字 });
const 框 = (page: Page) => page.getByRole("dialog");
/** 框不撑出页面、框里也没横滚；确认键整个在视口里、中心点没被盖住 */
async function 框量(page: Page, 键: RegExp) {
  const 不撑出 = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const 框内 = await 框(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= window.innerWidth);
  const 点得到 = await 框(page).getByRole("button", { name: 键 }).evaluate((el) => {
    const r = el.getBoundingClientRect(); const 顶 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight && (el === 顶 || el.contains(顶));
  });
  return { 不撑出, 框内, 点得到 };
}
const 好 = { 不撑出: true, 框内: true, 点得到: true };

it("退回公海：后果分条、原因点选（「其他」必填）；取消不生效，确认才退、撤销条出来（三种宽度、超长名）", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 开(列表包, w, "tr.ant-table-row");
    try {
      await 勾(page, ["c1", "c2"]);
      await 批量钮(page, /退回公海/).click();
      await expect.poll(() => 框(page).innerText()).toMatch(/把 2 位退回公海[\s\S]*领不回[\s\S]*一起退[\s\S]*可撤/);
      const 确认 = 框(page).getByRole("button", { name: "退回公海" });
      expect(await 确认.isDisabled(), "没选原因点不了").toBe(true);
      await 框(page).getByRole("radio", { name: "其他" }).click();
      expect(await 确认.isDisabled(), "选了其他没写点不了").toBe(true);
      await 框(page).getByRole("button", { name: /^取\s?消$/ }).click();
      await expect.poll(() => 框(page).isVisible()).toBe(false);
      expect(await 调(page), "取消不生效").toEqual([]);

      await 批量钮(page, /退回公海/).click();
      await 框(page).getByRole("radio", { name: "其他" }).click();
      await 框(page).getByRole("textbox").fill("客户已转给集团采购");
      expect(await 框量(page, /^退回公海$/), `宽 ${w}`).toEqual(好);
      await 框(page).getByRole("button", { name: "退回公海" }).click();
      await expect.poll(() => 调(page)).toEqual([["放", ["c1", "c2"], "其他：客户已转给集团采购"]]);
      await expect.poll(() => page.locator(".undo-bar").innerText()).toMatch(/已放回公海 2 位/);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("批量删除：勾到别人的不整批拦，框里写跳过谁、只删自己的；取消不生效", async () => {
  const { page, errors } = await 开(列表包, 1024, "tr.ant-table-row");
  try {
    await 勾(page, ["c1", "c3"]);
    await 批量钮(page, /删除/).click();
    await expect.poll(() => 框(page).innerText()).toMatch(/删除「我的一[\s\S]*跳过[\s\S]*别人的[\s\S]*不是你负责的，留在原处[\s\S]*能恢复/);
    expect(await 框量(page, /^删除$/)).toEqual(好);
    await 框(page).getByRole("button", { name: /^取\s?消$/ }).click();
    await expect.poll(() => 框(page).isVisible()).toBe(false);
    expect(await 调(page), "取消不生效").toEqual([]);
    await 批量钮(page, /删除/).click();
    await 框(page).getByRole("button", { name: /^删除$/ }).click();
    await expect.poll(() => 调(page)).toEqual([["删", ["c1"]]]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("批量删除被服务端挡：原因写在框里、框不关，没有成功说法", async () => {
  const { page, errors } = await 开(列表包, 1280, "tr.ant-table-row");
  try {
    await page.evaluate(() => { (window as unknown as { __删回: unknown }).__删回 = { ok: false, error: "你没有删除这些客户的权限" }; });
    await 勾(page, ["c1", "c2"]);
    await 批量钮(page, /删除/).click();
    await 框(page).getByRole("button", { name: "删除 2 位" }).click();
    await expect.poll(() => 框(page).getByRole("alert").innerText()).toMatch(/你没有删除这些客户的权限/);
    expect(await 框(page).isVisible()).toBe(true);
    expect(await page.locator("body").innerText()).not.toMatch(/已删除/);
    expect(await page.locator(".undo-bar").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("勾的全是别人的：删除键灰着", async () => {
  const { page } = await 开(列表包, 1280, "tr.ant-table-row");
  try {
    await 勾(page, ["c3"]);
    expect(await 批量钮(page, /删除/).isDisabled()).toBe(true);
  } finally { await page.close(); }
});

it("行菜单删除：后果框，取消不生效", async () => {
  const { page } = await 开(列表包, 1366, "tr.ant-table-row");
  try {
    await page.getByRole("button", { name: /^更多操作 我的一/ }).click();
    await page.getByRole("menuitem", { name: "删除" }).click();
    await expect.poll(() => 框(page).innerText()).toMatch(/一起走[\s\S]*2 位联系人、1 个项目、6 条沟通记录进回收站/);
    await page.keyboard.press("Escape");
    await expect.poll(() => 框(page).isVisible()).toBe(false);
    expect(await 调(page)).toEqual([]);
  } finally { await page.close(); }
});

it("转让三层合一：按钮写全「转让给同事」，一个框里选人、一起转走、生效（本人 = 申请移交）、原因；取消不生效（三种宽度、超长名）", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 开(列表包, w, "tr.ant-table-row");
    try {
      await 勾(page, ["c1", "c2"]);
      expect(await page.locator(".list-sel").innerText()).not.toMatch(/…/);
      await 批量钮(page, /转让给同事$/).click();
      await 框(page).getByRole("combobox", { name: "转给谁" }).fill("小张");
      await page.keyboard.press("Enter");
      await expect.poll(() => 框(page).innerText()).toMatch(/一起转走[\s\S]*会一起转走的 1 个项目[\s\S]*生效[\s\S]*接手人确认后生效，确认前仍在你名下；7 天内不确认自动作废[\s\S]*转让原因（可不选）/);
      expect(await 框量(page, /^转给小张/), `宽 ${w}`).toEqual(好);
      await 框(page).getByRole("button", { name: /^取\s?消$/ }).click();
      await expect.poll(() => 框(page).isVisible()).toBe(false);
      expect(await 调(page), "取消不生效").toEqual([]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("转让被服务端挡：原因写在框里，框不关，没有「已转给」；放行后带原因转、上次选的人记住", async () => {
  const { page, errors } = await 开(列表包, 1280, "tr.ant-table-row");
  try {
    await page.evaluate(() => { (window as unknown as { __转回: unknown }).__转回 = { ok: false, error: "只能转自己负责的客户" }; });
    await 勾(page, ["c1"]);
    await 批量钮(page, /转让给同事$/).click();
    await 框(page).getByRole("combobox", { name: "转给谁" }).fill("小李");
    await page.keyboard.press("Enter");
    await 框(page).getByRole("radio", { name: "工作调整" }).click();
    await 框(page).getByRole("button", { name: "转给小李" }).click();
    await expect.poll(() => 框(page).getByRole("alert").innerText()).toMatch(/只能转自己负责的客户/);
    expect(await 框(page).isVisible()).toBe(true);
    expect(await page.locator("body").innerText()).not.toMatch(/已转给|已发起/);
    expect(await page.locator(".undo-bar").count()).toBe(0);

    await page.evaluate(() => { (window as unknown as { __转回: unknown }).__转回 = { ok: true, updated: 0, unchanged: 0, 交接中: 1, 申请移交: true }; });
    await 框(page).getByRole("button", { name: "转给小李" }).click();
    await expect.poll(() => 框(page).isVisible()).toBe(false);
    expect((await 调(page)).at(-1)).toEqual(["转", ["c1"], "u3", "工作调整"]);
    // 再开：默认上次选的人
    await 勾(page, ["c2"]);
    await 批量钮(page, /转让给同事$/).click();
    await expect.poll(() => 框(page).innerText()).toMatch(/默认上次选的/);
    expect(await 框(page).getByRole("button", { name: "转给小李" }).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("确认接手：不再弹确认，按钮原地变「✓ 已接手」；拒收仍要原地确认，不确认不生效（1024 宽、超长名）", async () => {
  const { page, errors } = await 开(交接包, 1024, "button");
  try {
    await page.getByRole("button", { name: /^拒\s?收$/ }).click();
    expect(await 调(page), "点一下拒收只是问，不生效").toEqual([]);
    await page.getByRole("button", { name: /^取\s?消$/ }).click();
    expect(await 调(page)).toEqual([]);
    await page.getByRole("button", { name: /^确认接手$/ }).click();
    await expect.poll(() => page.getByRole("status").innerText()).toMatch(/✓ 已接手/);
    expect(await page.getByRole("dialog").count(), "没有确认框").toBe(0);
    expect(await 调(page)).toEqual([["确认", "h1"]]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("确认接手被挡：原因写在横幅里，按钮还在", async () => {
  const { page } = await 开(交接包, 1280, "button");
  try {
    await page.evaluate(() => { (window as unknown as { __交接回: unknown }).__交接回 = { ok: false, error: "这笔交接已被撤回" }; });
    await page.getByRole("button", { name: /^确认接手$/ }).click();
    await expect.poll(() => page.getByRole("alert").filter({ hasText: "这笔交接已被撤回" }).count()).toBeGreaterThan(0);
    await expect.poll(() => page.getByRole("button", { name: /确认接手$/ }).count()).toBe(1);
  } finally { await page.close(); }
});
