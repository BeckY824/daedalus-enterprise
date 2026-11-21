/**
 * 客户资料卡上客户本身的号码（11-17 号码审计 P1-3）+ 电话格按服务端回的值显示（P0-2），在真的客户页（RecordView）里量：
 *   - 1024 / 1280 / 1366：号码一类一行、长值一行省略号、不出左栏、左栏不横滚；编辑态「类型 + 号码」几行也不出栏
 *   - 点一行进编辑：改、加、删后保存，交给 saveCustomerNumbers 的是改完的几行；没存上原因 role=alert 写在这一块下面，不弹顶部提示
 *   - 电话格：服务端拒了（像微信号）退回原号、原因写在格子下面；存上了按服务端回的值（规整后）显示；清空回空串显示「—」
 * 只桩掉服务端动作，渲染法照 ent-cust-detail-layout.ui.test.ts。号码、名字全是编造的
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "customer-numbers", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷新=(window.__刷新??0)+1},push(){}});export const usePathname=()=>\"/customers/x\";");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(^|\/)(TaskForm|PlanForm|ContactForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|NewProjectEntry|ResearchRun|ResearchPerson)$/, "export default function Empty(){return null}");
  // 联系人组头和行经 ContactLinks 摆（D3 · 方案 A 的「⋯」在它里面）：桩照样把头和行摆出来，只是不给菜单
  stub(/(^|\/)ContactLinks$/, "export default function L(p){return <>{p.头?.(null)}{p.children}</>}");
  stub(/research\/ResearchEntry$/, "export const useResearchEntry=()=>false;");
  stub(/research\/actions$/, "export const 最近背调=async()=>null,背调价目=async()=>({可用:false,原因:'桩'});");
  stub(/^\.\/pick$/, "export const 搜客户=async()=>[];");
  stub(/^\.\/link-actions$/, "export const 关联客户=async()=>({ok:true}),改关联说明=关联客户,取消关联=关联客户;");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({});export const ContactRemoveInline=()=>null;");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海,退回原因选项=async()=>[];");
  stub(/(^|\/)tri-state-actions$/, "export const 三态继续持有=async()=>({ok:false,error:\"\"}),三态暂缓回收=三态继续持有,三态让同事结束项目=三态继续持有;");
  // 电话格、号码几行的服务端动作：交上来的记在 window 上，回什么由用例定（window.__回）
  stub(/^\.\.\/actions$/, `
    export const patchCustomer=async(id,k,v)=>{window.__改=[k,v];return (window.__回 && window.__回.patch) ?? {ok:true};};
    export const saveCustomerNumbers=async(id,rows)=>{window.__号=rows;return (window.__回 && window.__回.号) ?? {ok:true};};
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
    export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=async()=>({ok:true});`);
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  stub(/projects\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "export const 项目沟通须知=async()=>({ok:true,能记:false}),记项目沟通Action=async()=>({ok:true,followUpId:'f1'});"));
  stub(/^\.\/actions$/, 补全动作桩("src/app/(app)/customers/[id]/actions.ts", `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,沟通可选项目=async()=>({ok:true,项目们:null,能建项目:true}),saveFollowUp=toggleTask,deleteFollowUp=toggleTask;
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
    export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'p1'});`));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Record from '@/app/(app)/customers/[id]/RecordView';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 号码种类=['手机','座机','微信','邮箱','WhatsApp','阿里国际站ID','传真','Telegram'].map((名,i)=>({名,kind:['phone','landline','wechat','email','whatsapp','wangwang','fax','telegram'][i],active:true}));
    const 客户号码们=[
      {kind:'landline',value:'+86 (0)10 6600 1234 转 80012 总机前台'},
      {kind:'whatsapp',value:'+44 20 7946 0958'},
      {kind:'email',value:'procurement.department.overseas.buyer@very-long-company-domain-name.photography'},
      {kind:'wechat',value:'wxid_abcdefghijklmnopq'},
    ];
    const 项目们=[{id:'p1',name:'项目一',phase:'进行中',node:'报价',result:null,pooledAt:null,amount:0,currency:'CNY'}];
    const 项目={跟进去处:[{id:'p1',名:'项目一',主:true,结束:false,说明:null,下一步:null,下一步文字:null}],待办计划:[],followUps:[]};
    const 名单=<aside className='pane pane-roster'><div className='pane-h'><span className='pane-t'>客户</span></div><div className='pane-rows'/></aside>;
    window.__render=(phone)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><div className='shell'><nav className='rail' aria-label='主导航'/>{名单}<main className='main app-content' style={{padding:'22px 26px'}}><div><Record customer={{id:'a',extra:null,name:'某某超长贸易进出口有限公司',shortName:null,customerNo:1,phone,school:null,grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z'}} contacts={[]} contracts={[]} opportunities={[]} tasks={[]} plan={null} users={[]} channels={[]} aiEnabled={false} followUpsHasMore={false} 项目们={项目们} 参与项目们={[]} 关联们={[]} 旺旺们={[]} 号码种类={号码种类} 客户号码们={客户号码们} {...项目}/></div></main></div></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number, phone = "13912345678") {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("http://cust-numbers.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://cust-numbers.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(p => (window as unknown as { __render: (p: string) => void }).__render(p), phone);
  await page.getByTestId("customer-numbers").waitFor();
  return { page, errors };
}

/** 号码那几行：每行的值截没截、出没出左栏；左栏横不横滚 */
const 量 = (page: import("playwright").Page) => page.evaluate(() => {
  const 栏 = document.querySelector("aside.rec-rail") as HTMLElement;
  const 栏框 = 栏.getBoundingClientRect();
  const 行们 = [...document.querySelectorAll("[data-testid=customer-numbers] .rec-field")].map((f) => {
    const v = f.querySelector(".rec-field-v") as HTMLElement;
    const r = f.getBoundingClientRect();
    // 省略号打在哪一层都算（号码、邮箱打在复制键左边的文字上，别的打在值那一格上）：真截了、且那一层是 ellipsis
    const 截的 = [v, ...v.querySelectorAll<HTMLElement>("*")].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible");
    return {
      键: f.querySelector(".rec-field-k")?.textContent ?? "",
      截了: 截的.length > 0, 省略: 截的.every((e) => getComputedStyle(e).textOverflow === "ellipsis"),
      高: r.height, 出栏: r.right > 栏框.right + 0.5 || r.left < 栏框.left - 0.5,
      // 带复制键的：号码文字几行高、复制键是不是和号码同一行、跟在号码后面
      号: (() => {
        const t = f.querySelector(".copy-val-t")?.getBoundingClientRect(); const b = f.querySelector(".copy-val-b")?.getBoundingClientRect();
        return t && b ? { 字高: Math.round(t.height), 同行: Math.abs((b.top + b.bottom) / 2 - (t.top + t.bottom) / 2) < 6, 在后面: b.left >= t.right - 1 } : null;
      })(),
    };
  });
  const 编辑件 = [...document.querySelectorAll("[data-testid=customer-numbers] :is(.ant-select, input, button)")].map((e) => e.getBoundingClientRect()).filter((r) => r.right > 栏框.right + 0.5);
  return { 栏宽: 栏框.width, 行们, 栏横滚: 栏.scrollWidth > 栏.clientWidth + 1, 编辑出栏: 编辑件.length, 页横滚: document.documentElement.scrollWidth - window.innerWidth };
});

it("1024 / 1280 / 1366：号码一类一行，不出左栏；带复制键的号码、邮箱不打省略号、折行看全（D3 · M3-a），别的长值一行省略；编辑态也不出栏", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await open(w);
    try {
      const m = await 量(page);
      expect(m.行们.map((r) => r.键), `${w}`).toEqual(["座机", "WhatsApp", "邮箱", "微信"]);
      for (const r of m.行们) {
        expect(r.出栏, `${w} ${r.键}`).toBe(false);
        expect(r.省略, `${w} ${r.键} 截了的那层是省略号`).toBe(true);
      }
      // 长邮箱、长座机在 232 / 260 的左栏里放不下：折成几行、一个字不截；短的 WhatsApp 一行；微信照旧一行
      expect(m.行们.map((r) => r.截了), `${w}`).toEqual([false, false, false, false]);
      // D3（PR #401 实操）起带复制键的格整行展开：名字一行、号码一行（复制键 28 高跟在号码后面），所以至多「两行」= 6 + 22 + 28 + 6 ≈ 60。
      // 这份只跑现状主题（不挂 data-skin），换皮主题那边结构不变、见 ent-design-d3-skins.ui.test.ts
      const 两行 = 60;
      // 长座机、长邮箱折不折到第三行看机器字体（CI 上 1024 的座机两行就放下了）：一个字不截由上面「截了」管，这里只要求不比短号码矮
      expect(m.行们[0].高, `${w} 座机`).toBeGreaterThanOrEqual(m.行们[1].高);
      expect(m.行们[2].高, `${w} 邮箱`).toBeGreaterThanOrEqual(m.行们[1].高);
      expect(m.行们[1].高, `${w} WhatsApp 两行以内`).toBeLessThanOrEqual(两行);
      expect(m.行们[1].号, `${w} WhatsApp 整串一行、复制键同一行跟在后面`).toEqual({ 字高: 22, 同行: true, 在后面: true });
      expect(m.行们[3].高, `${w} 微信`).toBeLessThan(44);
      expect(m.栏横滚, `${w}`).toBe(false);
      expect(m.页横滚, `${w}`).toBeLessThanOrEqual(0);
      await page.getByRole("button", { name: "编辑号码" }).first().click();
      await page.getByRole("button", { name: "加一个号码" }).waitFor();
      const 编 = await 量(page);
      expect(编.编辑出栏, `${w} 编辑态的下拉、输入框、按钮不出栏`).toBe(0);
      expect(编.栏横滚, `${w}`).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("点一行进编辑：改、加、删后保存，交的是改完的几行；存上了收起、刷新", async () => {
  const { page, errors } = await open(1280);
  try {
    await page.getByRole("button", { name: "编辑号码" }).first().click();
    const 号们 = page.getByRole("textbox", { name: "号码" });
    expect(await 号们.count()).toBe(4);
    await 号们.nth(1).fill("+44 20 7946 0000");
    await page.getByRole("button", { name: "去掉这一行" }).nth(3).click();
    await page.getByRole("button", { name: "加一个号码" }).click();
    await page.getByRole("textbox", { name: "号码" }).nth(3).fill("13900001111");
    await page.getByRole("button", { name: /^保\s*存$/ }).click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__刷新"))).toBe(1);
    const 交 = await page.evaluate(() => Reflect.get(window, "__号") as { kind: string; value: string }[]);
    expect(交).toEqual([
      { kind: "landline", value: "+86 (0)10 6600 1234 转 80012 总机前台" },
      { kind: "whatsapp", value: "+44 20 7946 0000" },
      { kind: "email", value: "procurement.department.overseas.buyer@very-long-company-domain-name.photography" },
      { kind: "phone", value: "13900001111" },
    ]);
    expect(await page.getByRole("button", { name: "加一个号码" }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("没存上：原因 role=alert 写在这一块下面，不弹顶部提示，停在编辑态", async () => {
  const { page, errors } = await open(1280);
  try {
    await page.evaluate(() => { Reflect.set(window, "__回", { 号: { ok: false, error: "删完后这位客户就没有任何联系方式了：先在联系人里补一个号码，或留一个号码" } }); });
    await page.getByRole("button", { name: "编辑号码" }).first().click();
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "去掉这一行" }).first().click();
    await page.getByRole("button", { name: /^保\s*存$/ }).click();
    await page.getByRole("alert").filter({ hasText: "没有任何联系方式" }).waitFor();
    expect(await page.getByRole("button", { name: "加一个号码" }).count()).toBe(1);
    expect(await page.locator(".ant-message-notice").count()).toBe(0);
    await page.getByRole("button", { name: /^取\s*消$/ }).click();
    expect((await 量(page)).行们.length).toBe(4);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("电话格：拒了退回原号、原因写在格子下面；存上了按服务端回的值显示；清空显示「—」", async () => {
  const { page, errors } = await open(1280);
  try {
    const 格 = page.getByRole("button", { name: "编辑电话" });
    await page.evaluate(() => { Reflect.set(window, "__回", { patch: { ok: false, error: "格式不对，像微信号？请到联系方式里选「微信」类型" } }); });
    await 格.click();
    await page.locator("[data-field=phone] input").fill("sqin17548955941");
    await page.locator("[data-field=phone] input").press("Enter");
    await page.getByRole("alert").filter({ hasText: "像微信号" }).waitFor();
    expect(await 格.innerText()).toContain("13912345678");
    expect(await 格.innerText()).not.toContain("sqin");

    await page.evaluate(() => { Reflect.set(window, "__回", { patch: { ok: true, 值: "13900002222" } }); });
    await 格.click();
    await page.locator("[data-field=phone] input").fill("+86 139-0000-2222");
    await page.locator("[data-field=phone] input").press("Enter");
    await expect.poll(() => 格.innerText()).toContain("13900002222");
    expect(await 格.innerText()).not.toContain("+86");

    await page.evaluate(() => { Reflect.set(window, "__回", { patch: { ok: true, 值: "" } }); });
    await 格.click();
    await page.locator("[data-field=phone] input").fill("");
    await page.locator("[data-field=phone] input").press("Enter");
    await expect.poll(() => 格.innerText()).toContain("—");
    expect(await page.evaluate(() => Reflect.get(window, "__改"))).toEqual(["phone", null]);
    expect(await page.locator(".ant-message-notice").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
