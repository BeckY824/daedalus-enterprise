/**
 * PR5b 列表页的确认与反馈（原型 09-lists.js，规则 P-界面-40）：
 *   - ls.ho.revoke 撤回交接：就地确认；被挡（回 ok:false）原因写在卡上，问句留着，不提示成功
 *   - ls.ho.one 单条交：挑了人按钮写「交给 X」，超长名不撑破格子；ls.ho.all 全部交给：后果框点取消不交
 *   - ls.at.approve 挂靠审批：批准 / 拒绝都先就地确认，不确认不调；被挡原因就地写，不弹顶部提示
 *   - ls.ld.batch 批量自动分配：先后果框，取消不分；确认后名单就地列在上方（不弹 modal.info / 顶部提示）；被挡原因写在框里、框不关
 *   - ls.ld.assign 分配线索：挑了人确认键写「分给 X」；被挡原因写在框里
 *   - ls.ct.orphan 未归属联系人彻底删除：就地确认，不确认不删
 * 1024 宽：超长名字页面不横滚。认元素用 role / 文字；只有就地确认那一行用组件自己的类（.inlc-ask）。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser;
const 包: Record<string, string> = {};
const 长人 = "名字特别特别长的一位同事".repeat(3);
const 长客户 = "某某超长公司名".repeat(8);
const 记 = `const 记=(名,成={ok:true})=>async(...x)=>{(window.__调=window.__调||[]).push([名,...x]);const 挡=(window.__挡||{})[名];return 挡?{ok:false,error:挡}:(typeof 成==='function'?成(...x):成)};`;
const plugin: Plugin = { name: "pr5b-lists", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/settings\/actions$/, "export const deactivateUser=async()=>({ok:true});");
  // 交接、挂靠两页的 ./actions 合在一份假的里
  stub(/^\.\/actions$/, `${记}export const 交接客户=记('交接客户'),交接项目=记('交接项目'),交接全部=记('交接全部'),批准挂靠=记('批准挂靠'),拒绝挂靠=记('拒绝挂靠'),打开挂靠只读卡=记('打开挂靠只读卡',{ok:false,error:'x'}),saveContact=记('saveContact'),saveUnassignedContact=记('saveUnassignedContact'),联系人号码先查=async()=>({ok:true,撞了:[]});`);
  stub(/readonly-card-actions$/, 补全动作桩("src/app/(app)/projects/[id]/readonly-card-actions.ts", "export const 打开客户只读卡Action=async()=>({ok:false,error:'x'});"));
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[],取客户选项=async()=>[];");
  stub(/contact-link-actions$/, "export const 挂到客户=async()=>({ok:true});");
  stub(/handover-actions$/, `${记}export const 撤回交接=记('撤回交接'),改接手人=记('改接手人');`);
  stub(/assign-actions$/, `${记}
    export const 分配线索=记('分配线索'),项目分配线=async()=>null,分配带走的项目=async()=>({项目:[]}),我分出去的线索=async()=>[];
    export const 本月分配情况=async()=>[{userId:'s1',name:${JSON.stringify(长人)},line:null,已分:1,配额:5,加额:0},{userId:'s2',name:'小王',line:null,已分:0,配额:5,加额:0}];
    export const 批量自动分配=记('批量自动分配',(ids)=>({ok:true,结果:ids.map((id,i)=>i===0?{leadId:id,name:${JSON.stringify(长客户)},ok:true,接手人:'小王',已分:2,配额:5}:{leadId:id,name:'第'+i+'条',ok:false,error:'配额满了'})}));`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
const 打包 = async (body: string) => (await build({
  stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    ${body}
    window.__go=()=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><Test/></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic",
  alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent",
})).outputFiles[0].text;

beforeAll(async () => {
  const 等 = { id: "h1", 起日: "2026-11-05", 接手人: 长人, 接手人id: "t", 挂起天数: 2, 挂起工作日: 2, 超期: false, 我能撤回: true };
  包.交接 = await 打包(`
    import HandoverView from '@/app/(app)/projects/handover/HandoverView';
    const 人们=[
      {id:'a',name:${JSON.stringify(长人)},上级:null,交接中:false,单条等确认:1,
        客户:[{id:'c1',name:${JSON.stringify(长客户)},项目数:1,交接中:${JSON.stringify(等)}},{id:'c2',name:${JSON.stringify(长客户)},项目数:0}],
        项目:[],其余:{线索:0,渠道:0,主渠道:0,待办:0}},
      {id:'b',name:'另一位',上级:null,交接中:false,单条等确认:0,客户:[{id:'c3',name:'客户三',项目数:2}],项目:[],其余:{线索:1,渠道:0,主渠道:0,待办:0}},
    ];
    function Test(){return <HandoverView 人们={人们} 候选={[{id:'t',name:${JSON.stringify(长人)}},{id:'u',name:'接手人'}]} 项目模式 系统管理员 下属={[]}/>}
  `);
  包.挂靠 = await 打包(`
    import AttachView from '@/app/(app)/projects/attach/AttachView';
    const 待批=[{id:'x1',申请人:${JSON.stringify(长人)},客户名:${JSON.stringify(长客户)},撞的:'手机号：13800000000',负责人:${JSON.stringify(长人)},申请时间:new Date('2026-11-14T02:00:00Z'),转来的:true}];
    function Test(){return <AttachView 待批={待批} 我的={[]}/>}
  `);
  包.线索 = await 打包(`
    import {useBatchAutoAssign,AssignLeadModal} from '@/app/(app)/leads/AssignLead';
    function Test(){const 分=useBatchAutoAssign((r)=>'已分给 '+r.接手人,{先问:true});const [开,set开]=React.useState(false);
      return <><button onClick={()=>void 分(['l1','l2'],()=>{window.__清=true},[{id:'l1',ownerId:null},{id:'l2',ownerId:null}])}>自动分配</button>
        <button onClick={()=>set开(true)}>分配一条</button>{分.框}
        <AssignLeadModal lead={开?{id:'l9',name:${JSON.stringify(长客户)},ownerId:null}:null} 关={()=>set开(false)}/></>}
  `);
  包.联系人 = await 打包(`
    import ContactForm from '@/app/(app)/customers/[id]/ContactForm';
    import OrphanSidePanel from '@/app/(app)/contacts/OrphanSidePanel';
    function Test(){return <OrphanSidePanel><ContactForm open onClose={()=>{}} onSaved={()=>{}} 学员们={[]} 未归属
      record={{id:'k1',name:'老张',position:null,phone:null,email:null,wechat:null,isPrimary:false,remark:null,updatedAt:'2026-11-01T00:00:00Z'}}
      onDelete={async()=>{(window.__调=window.__调||[]).push(['删']);return {ok:true}}}/></OrphanSidePanel>}
  `);
  browser = await chromium.launch();
}, 180_000);
afterAll(async () => { await browser?.close(); });

async function 开(bundle: string, width = 1024): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://src.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://src.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as Record<string, () => void>).__go());
  return { page, errors };
}
const 调了 = (page: Page) => page.evaluate(() => ((window as unknown as { __调?: unknown[][] }).__调 ?? []).map((x) => x[0]));
const 挡 = (page: Page, 名: string, 话: string) => page.evaluate(([n, h]) => { (window as unknown as { __挡: Record<string, string> }).__挡 = { [n]: h }; }, [名, 话]);
const 不横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const 无顶部提示 = async (page: Page) => expect(await page.locator(".ant-message-notice").count()).toBe(0);

it("ls.ho.revoke：就地确认才撤；被挡原因写在卡上、问句留着、不提示成功", async () => {
  const { page, errors } = await 开(包.交接);
  try {
    await 挡(page, "撤回交接", "对方已经确认了，撤不了");
    await page.locator(".ant-table-tbody button", { hasText: "撤回" }).first().click();
    const 问 = page.locator(".inlc-ask").first();
    await 问.waitFor();
    expect(await 调了(page)).toEqual([]);
    await 问.getByRole("button", { name: "撤回" }).click();
    await page.getByRole("alert").filter({ hasText: "对方已经确认了，撤不了" }).waitFor();
    expect(await 调了(page)).toEqual(["撤回交接"]);
    expect(await 问.isVisible()).toBe(true);
    await 无顶部提示(page);
    expect(await 不横滚(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("ls.ho.one：挑了人按钮写「交给 X」，超长名不撑破格子；点了才交", async () => {
  const { page, errors } = await 开(包.交接);
  try {
    const 行 = page.locator(".ant-table-tbody tr").filter({ has: page.locator(".ant-select") }).first();
    await 行.locator(".ant-select").click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option").first().click();
    const 钮 = 行.getByRole("button", { name: /^交给 / });
    await 钮.waitFor();
    expect(await 钮.getAttribute("title")).toBe(`交给 ${长人}`);
    const 量 = await 行.evaluate((tr) => { const td = tr.lastElementChild!.getBoundingClientRect(); const b = [...tr.querySelectorAll("button")].pop()!.getBoundingClientRect(); return b.right <= td.right + 0.5; });
    expect(量).toBe(true);
    expect(await 调了(page)).toEqual([]);
    await 钮.click();
    await expect.poll(() => 调了(page)).toEqual(["交接客户"]);
    await 无顶部提示(page);
    expect(await 不横滚(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("ls.ho.all：后果框点取消不交", async () => {
  const { page } = await 开(包.交接);
  try {
    const 卡 = page.locator(".ant-card").filter({ hasText: "另一位" });
    await 卡.locator(".ant-select").first().click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: /^接手人$/ }).click();
    await 卡.getByRole("button", { name: "全部交给" }).click();
    const 框 = page.getByRole("dialog");
    await 框.waitFor();
    expect(await 框.innerText()).toContain("1 位");
    await 框.getByRole("button", { name: /取\s*消/ }).click();
    await 框.waitFor({ state: "hidden" });
    expect(await 调了(page)).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("ls.at.approve：批准、拒绝都先就地确认；不确认不调；被挡原因就地写、不提示成功；1024 不横滚", async () => {
  const { page, errors } = await 开(包.挂靠);
  try {
    await page.getByRole("button", { name: /批\s*准/ }).click();
    const 问 = page.locator(".inlc-ask").first();
    await 问.waitFor();
    expect(await 问.innerText()).toContain("只读卡");
    expect(await 调了(page)).toEqual([]);
    await 问.getByRole("button", { name: "取消" }).click();
    await 问.waitFor({ state: "detached" });
    await 挡(page, "拒绝挂靠", "这条已经被上级处理了");
    await page.getByRole("button", { name: /拒\s*绝/ }).click();
    const 问2 = page.locator(".inlc-ask").first();
    await 问2.waitFor();
    await 问2.getByRole("button", { name: "拒绝" }).click();
    await page.getByRole("alert").filter({ hasText: "这条已经被上级处理了" }).waitFor();
    expect(await 调了(page)).toEqual(["拒绝挂靠"]);
    await 无顶部提示(page);
    expect(await 不横滚(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("ls.ld.batch：先后果框，取消不分；被挡原因写在框里；确认后名单就地列出、不弹提示", async () => {
  const { page, errors } = await 开(包.线索);
  try {
    await page.getByRole("button", { name: "自动分配" }).click();
    const 框 = page.getByRole("dialog");
    await 框.waitFor();
    expect(await 框.innerText()).toContain("2 条");
    await 框.getByRole("button", { name: /取\s*消/ }).click();
    await 框.waitFor({ state: "hidden" });
    expect(await 调了(page)).toEqual([]);

    await 挡(page, "批量自动分配", "线索分配开关没开");
    await page.getByRole("button", { name: "自动分配" }).click();
    await 框.waitFor();
    await 框.getByRole("button", { name: "自动分配" }).click();
    await 框.getByText("线索分配开关没开").waitFor();
    expect(await page.getByTestId("lead-auto-assign-result").count()).toBe(0);

    await 挡(page, "x", "");
    await 框.getByRole("button", { name: "自动分配" }).click();
    await 框.waitFor({ state: "hidden" });
    const 名单 = page.getByTestId("lead-auto-assign-result");
    await 名单.waitFor();
    expect(await 名单.innerText()).toContain("已分给 小王");
    expect(await 名单.innerText()).toContain("没分：配额满了");
    expect(await page.evaluate(() => (window as unknown as { __清?: boolean }).__清)).toBe(true);
    await 无顶部提示(page);
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await 不横滚(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("ls.ld.assign：挑了人确认键写「分给 X」；被挡原因写在框里、不提示成功", async () => {
  const { page, errors } = await 开(包.线索);
  try {
    await page.getByRole("button", { name: "分配一条" }).click();
    const 框 = page.getByRole("dialog");
    await 框.waitFor();
    // 弹窗长出来的那一下点下拉会落空：等它放完（配额名单也是打开后才取）
    await page.waitForTimeout(600);
    await 框.locator(".ant-select").first().click();
    await page.locator(".ant-select-dropdown .ant-select-item-option").filter({ hasText: "小王" }).click();
    const 确认 = 框.getByRole("button", { name: "分给 小王" });
    await 确认.waitFor();
    await 挡(page, "分配线索", "小王本月配额满了");
    await 确认.click();
    await 框.getByText("小王本月配额满了").waitFor();
    expect(await 调了(page)).toEqual(["分配线索"]);
    await 无顶部提示(page);
    const 框不溢出 = await 框.evaluate((d) => [...d.querySelectorAll(".ant-modal-footer button")].every((b) => b.scrollWidth <= b.clientWidth + 1 || getComputedStyle(b).textOverflow === "ellipsis"));
    expect(框不溢出).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("ls.ct.orphan：彻底删除就地确认，不确认不删", async () => {
  const { page, errors } = await 开(包.联系人);
  try {
    await page.getByRole("button", { name: "彻底删除" }).click();
    const 问 = page.locator(".inlc-ask").first();
    await 问.waitFor();
    expect(await 调了(page)).toEqual([]);
    await 问.getByRole("button", { name: "彻底删除" }).click();
    await expect.poll(() => 调了(page)).toEqual(["删"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("ls.ct.orphan：编辑是右侧浮起的面板——离窗口边 8px、占满高度、1024 / 375 不横滚；滑进来，减弱动态不位移", async () => {
  for (const [width, 减弱] of [[1024, false], [375, false], [1280, true]] as const) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 减弱 ? "reduce" : "no-preference" }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.route("http://src.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
      await page.goto("http://src.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 包.联系人 });
      // 进场那一段每帧看一眼：有没有位移、放的是哪一段关键帧（认我们自己的 ct-side-in，不是 antd 的放大）
      const 位移过 = page.evaluate(() => new Promise<{ 移: boolean; 名: string[] }>((ok) => {
        let 移 = false; const 名 = new Set<string>();
        const 看 = () => {
          const d = document.querySelector<HTMLElement>("[role=dialog]"); if (!d) return;
          const cs = getComputedStyle(d.closest(".ant-modal") ?? d); if (cs.animationName !== "none") 名.add(cs.animationName);
          if (cs.transform !== "none" && !/matrix\(1, 0, 0, 1, 0, 0\)/.test(cs.transform)) 移 = true;
        };
        const 停 = performance.now() + 900; const 走 = () => { 看(); if (performance.now() < 停) requestAnimationFrame(走); else ok({ 移, 名: [...名] }); }; requestAnimationFrame(走);
      }));
      await page.evaluate(() => (window as unknown as Record<string, () => void>).__go());
      const 框 = page.getByRole("dialog");
      await 框.waitFor();
      const 进场 = await 位移过;
      if (减弱) { expect(进场.移, "减弱动态不位移").toBe(false); expect(进场.名).not.toContain("ct-side-in"); }
      else { expect(进场.移, "从右边滑进来").toBe(true); expect(进场.名).toContain("ct-side-in"); }
      await expect.poll(() => 框.evaluate((e) => { const r = (e.closest(".ant-modal") ?? e).getBoundingClientRect(); return [Math.round(r.top), Math.round(innerWidth - r.right), Math.round(innerHeight - r.bottom)]; })).toEqual([8, 8, 8]);
      expect(await 框.evaluate((e) => Math.round((e.closest(".ant-modal") ?? e).getBoundingClientRect().left))).toBeGreaterThanOrEqual(8);
      expect(await 不横滚(page)).toBe(true);
      // 彻底删除照旧在面板里就地确认
      await page.getByRole("button", { name: "彻底删除" }).waitFor();
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
}, 60_000);
