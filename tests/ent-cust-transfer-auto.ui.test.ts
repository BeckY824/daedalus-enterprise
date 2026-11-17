/**
 * 客户转让框「指定分配 / 自动分配」（客户 11-17：市场成员对暂不分配的客户分配时可选自动和指定）：
 *   - 页面递了 自动分配（市场成员 + 暂不分配的客户）：框里先选方式，默认指定（和原来一样）；选自动 = 不选人、写明怎么挑，
 *     一起转的项目按「还没挑人」取，确认键叫「自动分配」，成了框里原地说「已自动分配给 X」；没挑到人原因写在框里、框不关
 *   - 没递：框里没有方式这一行，和原来一样
 *   - Windows 1024 / 1280 / 1366 + 超长客户名：框不撑出页面、标题不横溢、确认键点得到
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, 包: string;
const 桩: Plugin = { name: "cust-auto", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)tri-state-actions$/, "export const 三态继续持有=async()=>({ok:false,error:\"\"}),三态暂缓回收=三态继续持有,三态让同事结束项目=三态继续持有;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/(^|\/)InlineField$/, "export default function Inline(p){return <div className='rec-field' data-field={p.field}>{p.label}: {p.value}</div>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__push=u},replace(){}});export const usePathname=()=>\"/customers/x\";export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^next\/link$/, "export default function L({prefetch,scroll,replace,...p}){return <a {...p}/>}");
  stub(/(^|\/)(TaskForm|PlanForm|ContactForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|ContactLinks|ResearchRun|ResearchPerson)$/, "export default function Empty(){return null}");
  stub(/(^|\/)NewProjectEntry$/, "export default function N({open}){return open?<div data-testid='new-project-modal'/>:null}");
  stub(/research\/ResearchEntry$/, "export const useResearchEntry=()=>false;");
  stub(/research\/actions$/, "export const 最近背调=async()=>null,背调价目=async()=>({可用:false,原因:'桩'});");
  stub(/^\.\/pick$/, "export const 搜客户=async()=>[];");
  stub(/^\.\/link-actions$/, "export const 关联客户=async()=>({ok:true}),改关联说明=关联客户,取消关联=关联客户;");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({});export const ContactRemoveInline=()=>null;");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async(ids,原因)=>{(window.__放??=[]).push({ids,原因});return window.__放回??{ok:true,updated:1,unchanged:0}},领取=async()=>({ok:false}),撤销公海=async()=>{window.__撤=true;return{ok:true,updated:1}},退回原因选项=async()=>['客户无意向','联系不上','其他'];");
  stub(/^\.\.\/actions$/, "export const 转走项目预览of=async()=>(window.__预览??{项目数:0,项目:[]});export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async(ids,to,因)=>{window.__转={ids,to,因};return window.__转回??{ok:false,error:'桩'}},撤销改负责人=async()=>{window.__撤转=true;return{ok:true,updated:1}},patchCustomerRegion=async()=>({ok:true}),saveCustomerNumbers=async()=>({ok:true});");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  stub(/projects\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "export const 项目沟通须知=async()=>({ok:true,能记:false}),记项目沟通Action=async()=>({ok:true,followUpId:'f1'});"));
  stub(/^\.\/actions$/, `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,deleteFollowUp=toggleTask;
    export const saveFollowUp=async x=>{window.__存=x;return{ok:true,id:'f1'}};
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
    export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'p1'});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  包 = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Record from '@/app/(app)/customers/[id]/RecordView';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    window.__长=长;
    const users=[{id:'qa',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'小张',email:'s2',role:'SALES',active:true}];
    window.__render=({去处,申请,自动})=>{
      const 项目们=去处.map(p=>({id:p.id,name:p.名,phase:'商机',node:'报价',result:null,pooledAt:null,amount:0,currency:'CNY'}));
      root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><div className='shell'><nav className='rail' aria-label='主导航'/><main className='main app-content' style={{padding:'22px 26px'}}><div>
      <Record customer={{id:'a',extra:null,name:长,phone:'13800138000',school:长,grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'小王',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z'}} contacts={[]} contracts={[]} opportunities={[]} tasks={[]} plan={null} users={users} channels={[]} aiEnabled={false} followUpsHasMore={false} 项目们={项目们} 参与项目们={[]} 关联们={[]} 旺旺们={[]} 企业版 能放公海 能转让客户 转让要申请={!!申请} 自动分配={自动?async(id,因)=>{window.__自={id,因};return window.__自回??{ok:true,toUserId:'u2',接手人:'小张',为什么:'本月已分最少（0 条）；按客户区域定内贸'}}:undefined} 转让原因={{选项:['客户迁移','岗位调整','其他'],自己:'qa'}}
        跟进去处={去处} 待办计划={[]} followUps={[]} 新建项目={{节点们:['线索验证'],要下一步:false}}/>
    </div></main></div></BusinessProvider></App></ConfigProvider>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 去处 = { id: string; 名: string; 主: boolean; 结束: boolean; 说明: null; 下一步: null; 下一步文字: null; 能记?: boolean };
const 项 = (id: string, 名: string): 去处 => ({ id, 名, 主: true, 结束: false, 说明: null, 下一步: null, 下一步文字: null, 能记: true });

async function 开(width = 1280, 额外: { 自动?: boolean; 自回?: unknown; 预览?: unknown } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 860 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://cust-auto.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://cust-auto.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 包 });
  await page.evaluate(x => {
    if (x.自回) Reflect.set(window, "__自回", x.自回);
    if (x.预览) Reflect.set(window, "__预览", x.预览);
    (window as unknown as { __render: (x: object) => void }).__render({ 去处: x.去处, 自动: x.自动 });
  }, { 去处: [项("p1", "项目一")], 自动: 额外.自动 ?? true, 自回: 额外.自回, 预览: 额外.预览 });
  await page.locator(".rec-head").first().waitFor();
  return { page, errors };
}
const 取 = (page: Page, k: string) => page.evaluate((k) => Reflect.get(window, k) ?? null, k);
async function 点转让(page: Page) {
  await page.locator(".rec-head-acts button").filter({ hasText: /客户操作/ }).click();
  await page.locator(".rec-head-menu").last().getByRole("menuitem", { name: /^客户转让$/ }).click();
  const 框 = page.getByRole("dialog").filter({ hasText: "客户转让" });
  await 框.waitFor();
  return 框;
}

it("市场成员 + 暂不分配：默认指定分配（和原来一样选人），选自动分配不用选人，成了框里说分给了谁", async () => {
  const { page, errors } = await 开(1280, { 预览: { 项目数: 1, 项目: [{ name: "项目一", 客户: "甲" }] } });
  try {
    const 框 = await 点转让(page);
    const 方式 = 框.getByRole("radiogroup", { name: "分配方式" });
    expect(await 方式.getByRole("radio").allInnerTexts()).toEqual(["指定分配", "自动分配"]);
    expect(await 方式.getByRole("radio", { name: "指定分配" }).getAttribute("aria-checked")).toBe("true");
    expect(await 框.getByRole("combobox", { name: "转给谁" }).count()).toBe(1);
    expect(await 框.getByRole("button", { name: /^转\s*让$/ }).isDisabled()).toBe(true);

    await 方式.getByRole("radio", { name: "自动分配" }).click();
    expect(await 框.getByRole("combobox", { name: "转给谁" }).count()).toBe(0);
    expect(await 框.getByTestId("transfer-auto-note").innerText()).toContain("中国大陆 → 内贸");
    await expect.poll(() => 框.getByTestId("transfer-carry").innerText()).toContain("项目一");
    expect(await 框.innerText()).toContain("只通知接手人");
    const 发 = 框.getByRole("button", { name: /^自动分配$/ });
    expect(await 发.isDisabled()).toBe(false);
    await 框.getByRole("radiogroup", { name: /转让原因/ }).getByRole("radio", { name: "客户迁移" }).click();
    await 发.click();
    await expect.poll(() => 框.getByRole("status").innerText()).toContain("已自动分配给 小张");
    expect(await 取(page, "__自")).toEqual({ id: "a", 因: "客户迁移" });
    expect(await 取(page, "__转")).toBeNull();
    expect(await page.locator("#undo-host").count()).toBe(0);
    await 框.getByRole("button", { name: /知道了/ }).click();
    await 框.waitFor({ state: "hidden" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("自动分配挑不到人：原因写在框里、框不关、不报成功；切回指定分配照原来选人", async () => {
  const { page, errors } = await 开(1280, { 自回: { ok: false, error: "没有自动分出去：没有能接的人。客户还在原负责人名下，没转；可以改用指定分配" } });
  try {
    const 框 = await 点转让(page);
    await 框.getByRole("radiogroup", { name: "分配方式" }).getByRole("radio", { name: "自动分配" }).click();
    await 框.getByRole("button", { name: /^自动分配$/ }).click();
    await expect.poll(() => 框.getByRole("alert").innerText()).toContain("客户还在原负责人名下");
    expect(await 框.isVisible()).toBe(true);
    expect(await 框.getByRole("status").count()).toBe(0);
    await 框.getByRole("radiogroup", { name: "分配方式" }).getByRole("radio", { name: "指定分配" }).click();
    expect(await 框.getByRole("alert").count()).toBe(0);
    expect(await 框.getByRole("combobox", { name: "转给谁" }).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("页面没递自动分配（非市场成员、或客户不是暂不分配）：框里没有方式这一行，和原来一样", async () => {
  const { page, errors } = await 开(1280, { 自动: false });
  try {
    const 框 = await 点转让(page);
    expect(await 框.getByRole("radiogroup", { name: "分配方式" }).count()).toBe(0);
    expect(await 框.getByRole("combobox", { name: "转给谁" }).count()).toBe(1);
    expect(await 框.getByRole("button", { name: /^自动分配$/ }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("1024 / 1280 / 1366 + 超长客户名：两种方式下框都不撑出、标题不横溢、方式一行不折出框、确认键点得到", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 开(w, { 预览: { 项目数: 1, 项目: [{ name: "某某超长项目名".repeat(12), 客户: "甲" }] } });
    try {
      const 框 = await 点转让(page);
      for (const 法 of ["指定分配", "自动分配"]) {
        await 框.getByRole("radiogroup", { name: "分配方式" }).getByRole("radio", { name: 法 }).click();
        if (法 === "自动分配") await expect.poll(() => 框.getByTestId("transfer-carry").innerText()).toContain("某某超长项目名");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `宽 ${w} ${法}`).toBe(true);
        const 量 = await 框.evaluate((el, 钮字) => {
          const 盒 = el.closest(".ant-modal") as HTMLElement;
          const 题 = 盒.querySelector(".ant-modal-title") as HTMLElement;
          const 体 = 盒.querySelector(".cd-transfer-body") as HTMLElement;
          const 组 = 盒.querySelector("[aria-label='分配方式']") as HTMLElement;
          const 说 = 盒.querySelector("[data-testid='transfer-auto-note']") as HTMLElement | null;
          const 钮 = [...盒.querySelectorAll("button")].find((b) => b.textContent?.replace(/\s/g, "") === 钮字)!;
          const r = 钮.getBoundingClientRect();
          const 顶 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const 盒框 = 盒.getBoundingClientRect();
          return {
            题溢: 题.scrollWidth > 题.clientWidth + 1, 体溢: 体.scrollWidth > 体.clientWidth + 1,
            组出框: 组.getBoundingClientRect().right > 盒框.right, 说溢: !!说 && 说.scrollWidth > 说.clientWidth + 1,
            盒右: 盒框.right, 点得到: 钮 === 顶 || 钮.contains(顶),
          };
        }, 法 === "自动分配" ? "自动分配" : "转让");
        expect(量, `宽 ${w} ${法}`).toEqual({ 题溢: false, 体溢: false, 组出框: false, 说溢: false, 盒右: 量.盒右, 点得到: true });
        expect(量.盒右, `宽 ${w}`).toBeLessThanOrEqual(w);
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
