/**
 * 看板拖动换进程（P-界面-45，原型 pr.drag / cu.board，11-15 新功能，projects/board-drag.tsx）：
 *   拖到下一个进程列：先问 看板推进预检，再走 改项目节点（规则全在服务端）；推成了卡片落到新列、底部带「撤销」
 *   被权限挡（预检或真推回 ok:false）：卡片弹回原列，说原因
 *   当前进程必填没填齐：卡片弹回，旁边小框写还差哪几项；「去补齐」进项目；谁都没有「仍要推进 · 缺的留空」（客户 11-19 定稿全员统一必须填齐）
 *   出口列（交付结清等）不能放；键盘 Alt+→ 走同一条路；减弱动态下卡片不跟指针位移
 *   不开项目模式（客户看板 CustomerBoard）、团队版五列：没有可拖的卡片
 * Windows 1024 / 1280 / 1366：补填小框整个在视口里，页面不横滚
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-board-drag", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(u){window.__去.push(u)},refresh(){window.__刷新=(window.__刷新||0)+1},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>window.__习惯??null;", "async()=>null"));
  // 项目的 server action：预检、改节点记下调了什么，回 window.__预检 / window.__改（默认放行）
  stub(/^\.\/actions$/, "const 记=(n,默)=>async(...a)=>{(window.__调||=[]).push([n,...a]);const 回=window['__'+n];return typeof 回==='function'?回(...a):回||默};export const 回项目邀请=记('回邀请',{ok:true}),市场复核Action=记('复核',{ok:true}),总管理终判Action=记('终判',{ok:true}),看板推进预检=记('预检',{ok:true,还差:[]}),改项目节点=记('改',{ok:true,变了:true}),编辑项目=记('编辑',{ok:true}),看板补必填料=记('补必填料',{ok:false,error:'读不到'});");
  // 就地补填框（ProjectFillRequired）存字段走 [id] 下的 ../actions
  stub(/^\.\.\/actions$/, "const 记=(n)=>async(...a)=>{(window.__调||=[]).push([n,...a]);return{ok:true}};export const 编辑项目=记('详编'),改项目画像Action=记('画像'),勾项目交付=记('交付');");
  stub(/assign-actions$/, "export const 分配线索=async()=>({ok:true}),自动分配线索=async()=>({ok:true}),撤销自动分配=async()=>({ok:true}),批量自动分配=async()=>({ok:true,结果:[]}),本月分配情况=async()=>[],我分出去的线索=async()=>[],关满额提醒=async()=>({ok:true}),项目分配线=async()=>null,分配带走的项目=async()=>({项目数:0,项目:[]});");
  stub(/blocker-actions$/, "const 好=async()=>({ok:true});export const 发布卡点Action=好,认领卡点Action=好,完成卡点Action=好,删卡点Action=好,存卡点默认Action=好,存卡点角色开关Action=好,新增原因Action=好,改原因名Action=好,改原因状态Action=好,删原因Action=好,合并原因Action=好,我的卡点Action=async()=>[];");
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[],取客户选项=async()=>null,取客户近况=async()=>null;");
  stub(/project-actions$/, "export const 给客户建项目=async()=>({ok:true});export const 新项目分配数据=async()=>null;export const 建项目带走的项目=async()=>({项目数:0,项目:[]});");
  stub(/new\/wizard-actions$/, "export const 取建档数据=async()=>null;");
  stub(/new\/ProjectWizard$/, "export const 建档弹窗=()=>null;");
  stub(/board-actions$/, "export const 再看一列=async()=>({ok:true,行:[],总:0}),再看项目页一列=async()=>({ok:true,行:[],总:0}),项目标签筛选项=async()=>[];");
  stub(/^next\/dynamic$/, "export default function d(){return function D(){return null}}");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import Projects from '@/app/(app)/projects/ProjectsView';
    import CustomerBoard from '@/app/(app)/customers/CustomerBoard';
    import {BusinessProvider} from '@/lib/business-client';
    import {DEFAULT_BUSINESS} from '@/lib/business-config';
    window.__去=[];
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购项目第二期';
    const row=(id,node,o={})=>({id,name:长+id,customerId:'c'+id,customerName:'客户'+长,ownerId:'u0',ownerName:'王0',phase:'线索',node,result:null,exceptionCategory:null,exceptionReason:null,pooled:false,amount:1000,currency:'CNY',updatedAt:new Date().toISOString(),...o});
    // 企业版进程列：潜客培育（两张：一张能拖、一张在公海）、线索验证（空）、线索推进（空）、交付结清（出口列，没有阶段）
    const 进程列=()=>[
      {列:'潜客培育',名:'潜客培育',色:'线索',阶段:'线索',空态:'还没有',数:2,合计:[],行:[row('p1','潜客培育'),row('p2','潜客培育',{pooled:true})]},
      {列:'线索验证',名:'线索验证',色:'线索',阶段:'线索',空态:'还没有在线索验证的项目',数:0,合计:[],行:[]},
      {列:'线索推进',名:'线索推进',色:'线索',阶段:'线索',空态:'还没有在线索推进的项目',数:0,合计:[],行:[]},
      {列:'交付结清',名:'交付结清',色:'成功交付',空态:'还没有交付结清的项目',数:0,合计:[],行:[]},
    ];
    // 跨阶段：线索推进（最后一个线索进程）→ 痛点挖掘（商机第一个）
    const 跨列=()=>[
      {列:'线索推进',名:'线索推进',色:'线索',阶段:'线索',空态:'',数:1,合计:[],行:[row('p1','线索推进')]},
      {列:'痛点挖掘',名:'痛点挖掘',色:'商机',阶段:'商机',空态:'还没有在痛点挖掘的项目',数:0,合计:[],行:[]},
    ];
    // 团队版五列（没有阶段）
    const 五列=()=>['线索','商机','订单','成功交付','没成'].map((列,i)=>({列,名:列,色:列,空态:'',数:1,合计:[],行:[row('t'+i,'潜客培育',{phase:列==='没成'?'线索':列})]}));
    window.__画=(o={})=>{const root=(window.__root||=createRoot(document.getElementById('root')));
      if(o.客户看板) return root.render(<App><CustomerBoard 行们={[{id:'k1',name:'客户甲',customerAttr:null,salesOwnerName:'王0',pool:false,extra:{}}]} 字典={[]} 加载中={false} 页={1} 每页={20} 总数={1} 翻页={()=>{}} 去={(id)=>window.__去.push(id)}/></App>);
      root.render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
        <Projects 行={[]} 列={o.团队?五列():o.跨?跨列():进程列()} 每列={{}} 总数={2} 页={1} 每页={20} users={[{id:'u0',name:'王0',email:'a'},{id:'u1',name:'王1',email:'b'}]} filters={{keyword:'',ownerId:'',pool:'',phase:''}} 企业版={!o.团队}/>
      </BusinessProvider></App>);};
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 设 = { 预检?: unknown; 改?: unknown; 团队?: boolean; 客户看板?: boolean; 少动?: boolean; 跨?: boolean };
async function 打开(width = 1280, o: 设 = {}): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: o.少动 ? "reduce" : "no-preference" }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/projects");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => { const w = window as unknown as Record<string, unknown> & { __画: (o: unknown) => void }; if (x.预检) w.__预检 = x.预检; if (x.改) w.__改 = x.改; w.__画(x); }, o);
  await page.locator(".pipe-col").first().waitFor();
  return { page, errors };
}
const 调了 = (page: Page, 名: string) => page.evaluate((n) => ((window as unknown as { __调?: unknown[][] }).__调 ?? []).filter((x) => x[0] === n), 名);
const 去了 = (page: Page) => page.evaluate(() => (window as unknown as { __去: string[] }).__去);
const 列 = (page: Page, i: number) => page.locator(".pipe-col").nth(i);
const 卡 = (page: Page) => page.locator('[data-card-id="p1"]');

/** 用鼠标把 p1 拖到第 i 列中间（分几步走，像人拖） */
async function 拖到(page: Page, i: number) {
  const a = (await 卡(page).boundingBox())!, b = (await 列(page, i).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 4, { steps: 2 });
  await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 6 });
  await page.mouse.up();
}

it("拖到下一个进程：先预检再改节点，卡片落到新列、计数跟着变，底部能撤销；不当成点卡片进详情", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 打开(w);
    try {
      expect(await 卡(page).getAttribute("aria-roledescription")).toBe("可拖动的卡片");
      // 在公海的那张不给拖
      expect(await page.locator('.pipe-card[aria-label*="在公海"]').getAttribute("data-card-id")).toBeNull();
      await 拖到(page, 1);
      await 列(page, 1).locator('[data-card-id="p1"]').waitFor();
      expect(await 调了(page, "预检")).toEqual([["预检", "p1", { phase: "线索", node: "线索验证" }]]);
      expect(await 调了(page, "改")).toEqual([["改", "p1", { phase: "线索", node: "线索验证", result: null }]]);
      await expect.poll(() => 列(page, 0).locator(".pipe-n").innerText()).toBe("1");
      await expect.poll(() => 列(page, 1).locator(".pipe-n").innerText()).toBe("1");
      expect(await 去了(page)).toEqual([]);
      // 撤销 = 改回原来的进程
      await page.locator(".undo-bar").getByRole("button", { name: /撤销/ }).click();
      await 列(page, 0).locator('[data-card-id="p1"]').waitFor();
      expect((await 调了(page, "改"))[1]).toEqual(["改", "p1", { phase: "线索", node: "潜客培育", result: null }]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `宽 ${w}`).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("拖到下一阶段的列（线索推进→痛点挖掘）：先确认（待客户定 A），推成了卡片落到新列，不给撤销条（企业版退不回上一阶段）", async () => {
  const { page, errors } = await 打开(1280, { 跨: true });
  try {
    // [待客户定 A] 先确认：取消 = 弹回原列、不改；确认了才推
    await 拖到(page, 1);
    const 问 = page.getByRole("dialog").filter({ hasText: "推过去就回不了上一阶段，确定？" });
    await 问.waitFor();
    expect(await 问.innerText()).toContain("进了商机就不能再退回线索");
    await 问.getByRole("button", { name: /取\s*消/ }).click();
    await 问.waitFor({ state: "hidden" });
    await 列(page, 0).locator('[data-card-id="p1"]').waitFor();
    expect(await 调了(page, "改")).toEqual([]);
    await 拖到(page, 1);
    await 问.waitFor();
    await 问.getByRole("button", { name: "进商机" }).click();
    await 列(page, 1).locator('[data-card-id="p1"]').waitFor();
    expect(await 调了(page, "改")).toEqual([["改", "p1", { phase: "商机", node: "痛点挖掘", result: null }]]);
    await page.waitForTimeout(300);
    expect(await page.locator(".undo-bar").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("被权限挡（预检回原因 / 真推回原因）：卡片弹回原列，说原因", async () => {
  const 话 = "只有项目负责人或系统管理员能改进程（上级、条线总管理只能看、转让）";
  const { page, errors } = await 打开(1280, { 预检: { ok: false, error: 话 } });
  try {
    await 拖到(page, 1);
    // 原因浮在卡片旁边那张小卡上（role=alert，不弹顶部提示）
    await page.getByRole("alert").filter({ hasText: 话 }).waitFor();
    expect(await page.locator(".ant-message").count()).toBe(0);
    expect(await 列(page, 0).locator('[data-card-id="p1"]').count()).toBe(1);
    expect(await 列(page, 1).locator('[data-card-id="p1"]').count()).toBe(0);
    expect(await 调了(page, "改")).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  const 二 = await 打开(1280, { 改: { ok: false, error: "这个项目在公海里，先领取再改" } });
  try {
    await 拖到(二.page, 2);
    await 二.page.getByRole("alert").filter({ hasText: "这个项目在公海里，先领取再改" }).waitFor();
    await 列(二.page, 0).locator('[data-card-id="p1"]').waitFor();
    expect(await 列(二.page, 2).locator('[data-card-id="p1"]').count()).toBe(0);
    expect(二.errors).toEqual([]);
  } finally { await 二.page.close(); }
});

it("必填没填齐：卡片弹回、旁边写还差哪几项，不改节点；「去补齐」进项目；三种宽度小框整个在视口里", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 打开(w, { 预检: { ok: true, 还差: ["需求", "预计成交日期"] } });
    try {
      await 拖到(page, 1);
      const 框 = page.getByRole("dialog", { name: "推到「线索验证」前还差 2 项" });
      await 框.waitFor();
      expect(await 框.innerText()).toContain("预计成交日期");
      expect(await 框.getByRole("button", { name: /仍要推进/ }).count()).toBe(0);
      expect(await 列(page, 0).locator('[data-card-id="p1"]').count()).toBe(1);
      expect(await 调了(page, "改")).toEqual([]);
      const b = (await 框.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `宽 ${w}`).toBeLessThanOrEqual(w);
      expect(b.y + b.height).toBeLessThanOrEqual(800);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `宽 ${w}`).toBe(true);
      await 框.getByRole("button", { name: "去补齐" }).click();
      expect((await 去了(page)).at(-1)).toBe("/customers/cp1?project=p1");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("全员统一必须填齐（客户 11-19 定稿）：老服务端还回 能留空推:true 也不摆「仍要推进 · 缺的留空」；「先不推」什么都不改", async () => {
  const { page, errors } = await 打开(1280, { 预检: { ok: true, 还差: ["需求"], 能留空推: true } });
  try {
    await 拖到(page, 1);
    const 框 = page.getByRole("dialog", { name: /前还差 1 项/ });
    await 框.waitFor();
    expect(await 框.getByRole("button", { name: /仍要推进/ }).count()).toBe(0);
    await 框.getByRole("button", { name: "先不推" }).click();
    await 框.waitFor({ state: "detached" });
    expect(await 调了(page, "改")).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("必填没填齐、读得到项目料：弹小框就地补填（和完成节点同一套），填好保存就推过去；三种宽度框在视口里", async () => {
  const 基 = { id: "p1", name: "项目一", amount: 0, currency: "USD", customer: { id: "c1" }, contact: null, expectedDealAt: null, channelId: null, 渠道们: [], level: null,
    所在地: { addrCountry: null, addrProvince: null, addrCity: null, addrDistrict: null, location: null }, 成交钱: { dealDemand: "暂无", contractAmount: null, contractCurrency: null, depositAmount: null, depositCurrency: null },
    项目新字段: { painPoints: null, contractStatus: null }, 画像: null, balanceSettled: false, acceptancePassed: false, 能记沟通: true, 项目附件: {}, 回款们: [], 线索验证: {}, 只能看字段: [], 企业版: true };
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 打开(w, { 预检: { ok: true, 还差: ["金额"] } });
    try {
      await page.evaluate((b) => {
        const x = window as unknown as Record<string, unknown> & { __调?: unknown[][] };
        x.__补必填料 = () => ({ ok: true, 联系人们: [], 能就地改: true, 改不了话: "只有项目负责人能改",
          p: { ...b, 必填: { 配了: ["金额"], 还差: (x.__调 ?? []).some((c) => c[0] === "详编") ? [] : ["金额"] } } });
      }, 基);
      await 拖到(page, 1);
      const 框 = page.getByRole("dialog", { name: "推到「线索验证」前还差 1 项" });
      await 框.getByRole("spinbutton", { name: "金额" }).waitFor();
      // 弹回原列、还没改节点
      expect(await 列(page, 0).locator('[data-card-id="p1"]').count()).toBe(1);
      expect(await 调了(page, "改")).toEqual([]);
      const b = (await 框.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(w);
      await 框.getByRole("spinbutton", { name: "金额" }).fill("100");
      await 框.getByRole("button", { name: "保存并完成节点" }).click();
      await expect.poll(() => 调了(page, "改")).toEqual([["改", "p1", { phase: "线索", node: "线索验证", result: null }]]);
      expect((await 调了(page, "详编"))[0]?.[1]).toBe("p1");
      await expect.poll(() => 框.count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
}, 90_000);

it("出口列（交付结清）不能放：弹回、说去项目里点，不预检不改", async () => {
  const { page, errors } = await 打开(1366);
  try {
    // 交付结清在第 4 列，1366 宽可能要滑过去：直接把看板滑到最右
    await page.locator(".pipe").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await 拖到(page, 3);
    await page.getByRole("alert").filter({ hasText: "请进项目里点" }).waitFor();
    expect(await 调了(page, "预检")).toEqual([]);
    expect(await 列(page, 0).locator('[data-card-id="p1"]').count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("键盘：卡片上 Alt+→ 推到下一个进程（同一条路），读屏念结果；减弱动态下拖着卡片不位移", async () => {
  const { page, errors } = await 打开(1280, { 少动: true });
  try {
    await 卡(page).focus();
    await page.keyboard.press("Alt+ArrowRight");
    await 列(page, 1).locator('[data-card-id="p1"]').waitFor();
    expect(await 调了(page, "改")).toEqual([["改", "p1", { phase: "线索", node: "线索验证", result: null }]]);
    expect(await page.locator("[role=status]").filter({ hasText: "已推到「线索验证」" }).count()).toBe(1);
    expect(await 去了(page)).toEqual([]);
    // 减弱动态：按下拖动中途量 transform，没有位移
    const a = (await 卡(page).boundingBox())!;
    await page.mouse.move(a.x + 20, a.y + 10);
    await page.mouse.down();
    await page.mouse.move(a.x + 120, a.y + 40, { steps: 4 });
    expect(await 卡(page).evaluate((el) => (el as HTMLElement).style.transform)).toBe("");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("不开项目模式（客户看板按客户属性分列）、团队版五列：没有可拖的卡片", async () => {
  const 客户 = await 打开(1280, { 客户看板: true });
  try {
    expect(await 客户.page.locator(".pipe-card").count()).toBe(1);
    expect(await 客户.page.locator("[aria-roledescription], [data-card-id]").count()).toBe(0);
    expect(客户.errors).toEqual([]);
  } finally { await 客户.page.close(); }
  const 团队 = await 打开(1280, { 团队: true });
  try {
    expect(await 团队.page.locator(".pipe-card").count()).toBe(5);
    expect(await 团队.page.locator("[data-card-id]").count()).toBe(0);
    expect(团队.errors).toEqual([]);
  } finally { await 团队.page.close(); }
});
