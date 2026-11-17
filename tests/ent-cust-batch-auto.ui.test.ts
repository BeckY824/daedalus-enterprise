/**
 * 客户列表批量转让框「指定分配 / 自动分配」（客户 11-17，同客户详情的单个转让框）：
 *   - 页面递了两个动作（市场成员）、勾的里有暂不分配的（预看 可 > 0）：框里先选方式，默认指定（和原来一样选人）；
 *     选自动 = 不选人、写明怎么挑，勾到的不能自动分的那几位先说清为什么、不会自动分；确认键「自动分配 N 位」，
 *     分完框里原地列出分给了谁（按接手人归拢）、几位没分成及原因，不走指定转让、没有撤销条
 *   - 预看一位都不行、或页面没递：框里没有方式这一行，和原来一样
 *   - 一位都没分出去：原因写在框里、框不关
 *   - Windows 1024 / 1280 / 1366 + 超长客户名、超长原因：框不撑出页面、名单不横溢、确认键点得到
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, 列表包: string;
const 桩: Plugin = { name: "cust-batch-auto", setup(b) {
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
    export const 转走项目预览of=async(ids,to)=>({项目数:1,项目:[{name:'VR 乐园二期'+名,客户:名,负责人:null}],...(window.__要确认===undefined?{}:{要确认:typeof window.__要确认==='function'?window.__要确认(to):window.__要确认})});`);
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
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'小张',email:'s2',role:'SALES',active:true},{id:'u3',name:'小李',email:'s3',role:'SALES',active:true}];
    const 行=(id,owner,名)=>({id,name:名+长,phone:'1380000000'+id.slice(1),school:长,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',salesOwnerId:owner,salesOwnerName:'小王',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:null,signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null,expectedSignAt:null,remark:null});
    const rows=[行('c1','me','甲'),行('c2','me','乙'),行('c3','me','丙')];
    const 名=id=>rows.find(r=>r.id===id).name;
    const 不是话='这位客户不是「暂不分配」的（名下没有暂不分配、还在线索阶段的项目），请用指定分配';
    window.__不是话=不是话;
    // 预看：c3 不是暂不分配；window.__全不行 = 一位都不行
    const 预看=async(ids)=>{(window.__调??=[]).push(['预看',ids]);if(window.__全不行)return{ok:true,可:[],不可:ids.map(id=>({customerId:id,name:名(id),error:不是话}))};
      return{ok:true,可:ids.filter(id=>id!=='c3'),不可:ids.filter(id=>id==='c3').map(id=>({customerId:id,name:名(id),error:不是话}))}};
    const 自动分=async(ids,因)=>{(window.__调??=[]).push(['自动',ids,因]);if(window.__自回)return window.__自回;
      const 给=['小张','小李'];let i=0;
      return{ok:true,结果:ids.map(id=>id==='c3'?{customerId:id,name:名(id),ok:false,error:不是话}:{customerId:id,name:名(id),ok:true,toUserId:'u',接手人:给[i++%2],为什么:'本月已分最少'})}};
    window.__render=(递)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'me',name:'小王'}}>
      <CustomersView rows={rows} total={3} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{}} 客户数={3} 企业版 能转出自己的 转让原因={{选项:['工作量调整','其他'],自己:'me'}}
        {...(递?{自动分配预看:预看,批量自动分配客户:自动分}:{})}/>
    </我Provider></BusinessProvider></App></ConfigProvider>);
  `);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(width: number, 递 = true, 设: Record<string, unknown> = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://cust-batch-auto.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://cust-batch-auto.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 列表包 });
  await page.evaluate(([递, 设]) => { for (const [k, v] of Object.entries(设)) Reflect.set(window, k, v); (window as unknown as { __render: (x: boolean) => void }).__render(递); }, [递, 设] as const);
  await page.locator("tr.ant-table-row").first().waitFor();
  return { page, errors };
}
const 调 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? []);
const 勾 = async (page: Page, ids: string[]) => { for (const id of ids) await page.locator(`tr[data-row-key="${id}"] .ant-checkbox-input`).check(); };
const 框 = (page: Page) => page.getByRole("dialog");
const 方式 = (page: Page) => 框(page).getByRole("radiogroup", { name: "分配方式" });
async function 开框(page: Page, ids: string[]) {
  await 勾(page, ids);
  await page.locator(".list-sel").getByRole("button", { name: /转让给同事$/ }).click();
  await 框(page).waitFor();
}
/** 框不撑出页面、框里没横滚、名单不横溢；键整个在视口里、中心点没被盖住 */
async function 框量(page: Page, 键: RegExp) {
  const 不撑出 = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const 框内 = await 框(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= window.innerWidth
    && [...el.querySelectorAll(".cu-tr-names, .csq-t, .cu-tr-way")].every((x) => x.scrollWidth <= x.clientWidth + 1));
  const 点得到 = await 框(page).getByRole("button", { name: 键 }).evaluate((el) => {
    const r = el.getBoundingClientRect(); const 顶 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight && (el === 顶 || el.contains(顶));
  });
  return { 不撑出, 框内, 点得到 };
}
const 好 = { 不撑出: true, 框内: true, 点得到: true };

it("市场成员勾了暂不分配的：框里有「指定分配 / 自动分配」，默认指定（照原来选人）；选自动不用选人，不能自动分的那位先说清", async () => {
  const { page, errors } = await 开(1280);
  try {
    await 开框(page, ["c1", "c2", "c3"]);
    await expect.poll(() => 方式(page).count()).toBe(1);
    expect(await 方式(page).getByRole("radio").allInnerTexts()).toEqual(["指定分配", "自动分配"]);
    expect(await 方式(page).getByRole("radio", { name: "指定分配" }).getAttribute("aria-checked")).toBe("true");
    expect(await 框(page).getByRole("combobox", { name: "转给谁" }).count()).toBe(1);
    expect(await 调(page)).toEqual([["预看", ["c1", "c2", "c3"]]]);

    await 方式(page).getByRole("radio", { name: "自动分配" }).click();
    expect(await 框(page).getByRole("combobox", { name: "转给谁" }).count()).toBe(0);
    expect(await 框(page).getByTestId("transfer-auto-note").innerText()).toMatch(/中国大陆 → 内贸[\s\S]*2 位一位一位挑/);
    const 跳 = await 框(page).getByTestId("transfer-auto-skip").innerText();
    expect(跳).toMatch(/1 位不会自动分，留在原处（要转请用指定分配）/);
    expect(跳).toContain("丙某某");
    expect(跳).toContain("请用指定分配");
    expect(await 框(page).innerText()).toContain("只通知接手人");
    expect(await 框(page).getByRole("radiogroup", { name: "转让原因" }).count()).toBe(1);
    const 发 = 框(page).getByRole("button", { name: /^自动分配 2 位$/ });
    expect(await 发.isDisabled()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("自动分配：带原因一次交给服务端，不走指定转让；框里列出分给了谁（按接手人归拢）、几位没分成及原因；没有撤销条，知道了关框", async () => {
  const { page, errors } = await 开(1280);
  try {
    await 开框(page, ["c1", "c2", "c3"]);
    await 方式(page).getByRole("radio", { name: "自动分配" }).click();
    await 框(page).getByRole("radiogroup", { name: "转让原因" }).getByRole("radio", { name: "工作量调整" }).click();
    await 框(page).getByRole("button", { name: /^自动分配 2 位$/ }).click();
    const 结 = 框(page).getByRole("status");
    await expect.poll(() => 结.innerText()).toMatch(/已自动分配 2 位[\s\S]*小张：甲某某[\s\S]*小李：乙某某[\s\S]*1 位没分成，还在原负责人名下[\s\S]*丙某某[\s\S]*请用指定分配/);
    const 调了 = await 调(page);
    expect(调了).toContainEqual(["自动", ["c1", "c2", "c3"], "工作量调整"]);
    expect(调了.some((x) => x[0] === "转"), "不走指定转让").toBe(false);
    expect(await page.locator(".undo-bar").count()).toBe(0);
    await 框(page).getByRole("button", { name: /知道了/ }).click();
    await expect.poll(() => 框(page).isVisible()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("一位都没分出去：原因写在框里、框不关；切回指定分配照原来选人", async () => {
  const { page, errors } = await 开(1280, true, { __自回: { ok: true, 结果: [{ customerId: "c1", name: "甲", ok: false, error: "没有自动分出去：没有能接的人。客户还在原负责人名下，没转；可以改用指定分配" }] } });
  try {
    await 开框(page, ["c1"]);
    await 方式(page).getByRole("radio", { name: "自动分配" }).click();
    await 框(page).getByRole("button", { name: /^自动分配 1 位$/ }).click();
    await expect.poll(() => 框(page).getByRole("alert").innerText()).toMatch(/一位都没分出去：甲：没有自动分出去/);
    expect(await 框(page).isVisible()).toBe(true);
    expect(await 框(page).getByRole("status").count()).toBe(0);
    await 方式(page).getByRole("radio", { name: "指定分配" }).click();
    expect(await 框(page).getByRole("alert").count()).toBe(0);
    expect(await 框(page).getByRole("combobox", { name: "转给谁" }).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("勾的一位都不是暂不分配的、或页面没递（不是市场成员）：框里没有方式这一行，和原来一样", async () => {
  for (const [递, 设] of [[true, { __全不行: true }], [false, {}]] as const) {
    const { page, errors } = await 开(1280, 递, 设);
    try {
      await 开框(page, ["c1", "c3"]);
      await 框(page).getByRole("combobox", { name: "转给谁" }).waitFor();
      if (递) await expect.poll(() => 调(page)).toEqual([["预看", ["c1", "c3"]]]);
      else expect(await 调(page), "没递不去预看").toEqual([]);
      expect(await 方式(page).count()).toBe(0);
      expect(await 框(page).getByRole("button", { name: /自动分配/ }).count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("1024 / 1280 / 1366 + 超长客户名：指定、自动、分完三种样子框都不撑出、名单不横溢、确认键点得到", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 开(w);
    try {
      await 开框(page, ["c1", "c2", "c3"]);
      await expect.poll(() => 方式(page).count()).toBe(1);
      await 框(page).getByRole("combobox", { name: "转给谁" }).fill("小张");
      await page.keyboard.press("Enter");
      expect(await 框量(page, /^转给小张/), `宽 ${w} 指定`).toEqual(好);
      await 方式(page).getByRole("radio", { name: "自动分配" }).click();
      expect(await 框量(page, /^自动分配 2 位$/), `宽 ${w} 自动`).toEqual(好);
      await 框(page).getByRole("button", { name: /^自动分配 2 位$/ }).click();
      await 框(page).getByRole("status").waitFor();
      expect(await 框量(page, /知道了/), `宽 ${w} 分完`).toEqual(好);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
