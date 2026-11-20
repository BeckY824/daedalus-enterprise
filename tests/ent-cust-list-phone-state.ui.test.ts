/**
 * 客户列表（11-20 员工反馈：「能显示全部号码吗？每一次我都要点进去，点进去再退出来，之前勾选设置的页面就全乱了」「可以快速的复制，在微信上粘贴」）：
 *   29Q「联系电话」一列：服务端给的完整号码原样显示、右边一颗复制键，点了复制完整号码、有一句轻提示、不算点这一行；
 *       服务端打了码的（公海、教练、字段权限藏号，见 ent-cust-list-phone-full.test.ts）带 *，不给复制键；没号的写「—」
 *   29R 进详情再回来 / 刷新：勾选、表格横滚位置还原（同一个地址才还原，换了页码不还原）；列设置刷新后还在
 *   #381 实操：「联系电话」默认显示、紧跟编号（存过列设置的照存的）；回来时表格框在几帧里变窄（左栏从图标窄栏展开）横滚照样还原到记的值、
 *       存的值不被改小；390 / 375 宽号码列能整列横滚进可视区、页面不横滚；还原的勾选在新数据到了之后按「可勾」再滤一遍
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
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷过=(window.__刷过||0)+1},push(u){window.__push=u},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
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
    import CustomersView from '@/app/(app)/customers/CustomersView';import {设列表主人} from '@/lib/list-return';
    // 外壳报现在是谁（AppShell 渲染时调）：window.__人 换人
    设列表主人(window.__人||'A');
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'小李',email:'s2',role:'SALES',active:true}];
    const 行=(id,phone,pool)=>({id,name:'某某贸易有限公司'+id,phone,school:null,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',custStatus:'跟进中',salesOwnerId:'me',salesOwnerName:'小王',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:'2026-11-01T00:00:00.000Z',signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null,expectedSignAt:null,remark:'备注'.repeat(20),addrCountry:'中国',extra:{level:'A'},customerNo:Number(id.slice(1)),pool:pool?{reason:'超时回收'}:null});
    const rows=[行('c1','13800000001'),行('c2','138****0002',true),行('c3',''),行('c4','02166668888')];
    // window.__刷新(只读ids)：模拟 router.refresh 之后服务端给的新一屏（行数组换新、只读的换了）
    function Root(){
      const [只读,set只读]=React.useState(window.__只读||[]);const [rs,setRs]=React.useState(rows);
      window.__刷新=(r)=>{set只读(r);setRs(rows.map((x)=>({...x})));};
      return <CustomersView rows={rs} total={4} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{phase:'',node:''}} 客户数={4} 企业版 项目概况={{}} 项目看板 只读ids={只读}/>;
    }
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'me',name:'小王'}}>
      <Root/>
    </我Provider></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

/** localhost 才有 navigator.clipboard；换成记下写了什么 */
const 记写入 = "window.__写=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(t)=>{window.__写.push(t)}}});";

async function 挂上(page: Page, 人?: string, 只读?: string[]) {
  if (人 || 只读) await page.evaluate(([a, r]) => { Object.assign(window, { __人: a, __只读: r }); }, [人, 只读] as const);
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
    // 「联系电话」默认显示（#381 实操）：没存过列设置就有
    await 打开(page, "http://localhost/customers?page=1");
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

it("#381：换人（同一个标签页 A 退出、B 登录）不带 A 的勾选；行变只读后不还原成勾着；从左栏点进来（新开地址）不还原", async () => {
  const errors: string[] = [];
  const page = await 新页(errors);
  try {
    await 打开(page, "http://localhost/customers?page=1");
    await page.locator("tr[data-row-key=c1] .ant-checkbox-input").check();
    await page.locator("tr[data-row-key=c4] .ant-checkbox-input").check();
    // B 在同一个标签页里（刷新 = 可还原的进法），A 的勾选一个都不带
    await page.reload();
    await 挂上(page, "B");
    await page.waitForTimeout(200);
    expect(await 勾着(page)).toEqual([]);
    // 换回 A（刷新）：A 自己的还在；c4 这时变成只读（不让勾）：只还原 c1
    await page.reload();
    await 挂上(page, "A", ["c4"]);
    await expect.poll(() => 勾着(page)).toEqual(["c1"]);
    expect(await page.locator(".list-sel-float").innerText()).toContain("1");
    // 从左栏点进来（同一个地址重新打开，不是刷新、不是从详情回来）：回默认，不还原
    await 打开(page, "http://localhost/customers?page=1");
    await page.waitForTimeout(200);
    expect(await 勾着(page)).toEqual([]);
    // 接着刷新一次（刷新算「回来」）：左栏进来那一下已把这张表记的清掉，旧勾选不再冒出来、不进批量（#381 复审）
    await page.reload();
    await 挂上(page, "A");
    await page.waitForTimeout(200);
    expect(await 勾着(page)).toEqual([]);
    expect(await page.locator(".list-sel-float").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("#381 实操：「联系电话」默认显示、紧跟编号；存过别的列设置、没提过号码的老用户照样显示；只有主动藏过（-phone）的收着", async () => {
  const errors: string[] = [];
  const page = await 新页(errors, 1366);
  const 头 = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("thead th")].map((t) => t.innerText.trim()).filter(Boolean));
  try {
    await 打开(page, "http://localhost/customers?page=1");
    expect((await 头()).slice(0, 3)).toEqual(["客户", "编号", "联系电话"]);
    // 老设置：只勾过创建时间（存的里没有 phone）→ 号码照样显示（客户口径「号码可以全部显示」，PR #384 审查）
    await 打开(page, "http://localhost/customers?page=1", () => localStorage.setItem("list-cols:customers", JSON.stringify(["createdAt"])));
    expect(await page.locator("thead th.dl-col-phone").count()).toBe(1);
    expect(await page.locator("thead th.dl-col-createdAt").count()).toBe(1);
    // 主动藏过的照旧藏着；勾过的照旧显示
    await 打开(page, "http://localhost/customers?page=1", () => localStorage.setItem("list-cols:customers", JSON.stringify(["-phone"])));
    expect(await page.locator("thead th.dl-col-phone").count()).toBe(0);
    await 打开(page, "http://localhost/customers?page=1", () => localStorage.setItem("list-cols:customers", JSON.stringify(["createdAt", "phone"])));
    expect(await page.locator("thead th.dl-col-phone").count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/** 这张表 sessionStorage 里记的横滚值（键带人：crm:list-pick:v1@A） */
const 存的横滚 = (page: Page) => page.evaluate(() => {
  const k = Object.keys(sessionStorage).find((x) => x.startsWith("crm:list-pick"));
  return k ? (JSON.parse(sessionStorage.getItem(k)!) as Record<string, { x: number }>).customers?.x ?? null : null;
});

it("#381 实操：回来时表格框在几帧里变窄（左栏从图标窄栏展开），横滚照样还原到记的值；还原期间不把夹小的值记回去", async () => {
  const errors: string[] = [];
  const page = await 新页(errors, 1366);
  // 列表页：左栏 220 宽；客户详情上是 56 宽的图标窄栏（lib/rail-mini.ts），回来那一下从 56 过渡到 220
  const 列表版面 = "#root{margin-left:220px;padding:22px 26px}";
  try {
    await 打开(page, "http://localhost/customers?page=1", () => localStorage.setItem("list-cols:customers", JSON.stringify(["phone", "createdAt", "signedAmount", "grade", "referrerName"])));
    await page.addStyleTag({ content: 列表版面 });
    // 滚到最右：这个值比框宽的时候（窄栏）能滚的最大值大，第一帧设会被夹小
    const 目标 = await page.evaluate(() => { const x = document.querySelector<HTMLElement>(".ant-table-content")!; x.scrollLeft = x.scrollWidth; return x.scrollLeft; });
    const 窄栏时最多 = await page.evaluate(() => { const x = document.querySelector<HTMLElement>(".ant-table-content")!; return x.scrollWidth - x.clientWidth - 164; });
    expect(目标).toBeGreaterThan(窄栏时最多);
    await page.waitForTimeout(400);
    expect(await 存的横滚(page)).toBe(目标);

    await page.reload();
    // 挂上时框还宽（左栏 56），表格行一出来左栏就开始展开（同一次提交里换 rail-mini，过渡 180ms）
    await page.addStyleTag({ content: "#root{margin-left:56px;padding:22px 26px;transition:margin-left 180ms cubic-bezier(.22,1,.36,1)}" });
    await page.evaluate(() => {
      const 盯 = new MutationObserver(() => {
        if (!document.querySelector("tr.ant-table-row")) return;
        盯.disconnect();
        document.getElementById("root")!.style.marginLeft = "220px";
      });
      盯.observe(document.body, { childList: true, subtree: true });
    });
    await 挂上(page);
    await expect.poll(() => 横滚(page)).toBe(目标);
    await page.waitForTimeout(700);
    expect(await 横滚(page)).toBe(目标);
    expect(await 存的横滚(page)).toBe(目标);
    // 还原完了人自己滚照常记
    await page.evaluate(() => { document.querySelector<HTMLElement>(".ant-table-content")!.scrollLeft = 40; });
    await page.waitForTimeout(400);
    expect(await 存的横滚(page)).toBe(40);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/** 记一张宽表滚到最右的值，重新加载；回来时左栏从 56 慢慢展开到 220（过渡 过渡），表格行一出来就开始展开。返回滚到最右的值 */
async function 记最右再回来(page: Page, 过渡: string, 每帧记?: boolean) {
  await 打开(page, "http://localhost/customers?page=1", () => localStorage.setItem("list-cols:customers", JSON.stringify(["phone", "createdAt", "signedAmount", "grade", "referrerName"])));
  await page.addStyleTag({ content: "#root{margin-left:220px;padding:22px 26px}" });
  const 目标 = await page.evaluate(() => { const x = document.querySelector<HTMLElement>(".ant-table-content")!; x.scrollLeft = x.scrollWidth; return x.scrollLeft; });
  await page.waitForTimeout(400);
  expect(await 存的横滚(page)).toBe(目标);
  await page.reload();
  await page.addStyleTag({ content: `#root{margin-left:56px;padding:22px 26px;transition:margin-left ${过渡}}` });
  await page.evaluate((每帧记) => {
    const w = window as unknown as { __样: (number | null)[] };
    w.__样 = [];
    const 盯 = new MutationObserver(() => {
      if (!document.querySelector("tr.ant-table-row")) return;
      盯.disconnect();
      document.getElementById("root")!.style.marginLeft = "220px";
    });
    盯.observe(document.body, { childList: true, subtree: true });
    if (!每帧记) return;
    // 每帧抄一次 sessionStorage 里记的横滚：还原途中存的值要一直是目标，不能哪一刻被夹小的值盖掉
    const 抄 = () => {
      const k = Object.keys(sessionStorage).find((x) => x.startsWith("crm:list-pick"));
      w.__样.push(k ? (JSON.parse(sessionStorage.getItem(k)!) as Record<string, { x: number }>).customers?.x ?? null : null);
      if (w.__样.length < 120) requestAnimationFrame(抄);
    };
    requestAnimationFrame(抄);
  }, !!每帧记);
  await 挂上(page);
  return 目标;
}

it("#381 实操（PR #384 审查）：左栏展开得慢（600ms 线性）时还原途中每一帧存的横滚都是目标，不被夹小的值盖掉", async () => {
  const errors: string[] = [];
  const page = await 新页(errors, 1366);
  try {
    const 目标 = await 记最右再回来(page, "600ms linear", true);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __样: unknown[] }).__样.length), { timeout: 5000 }).toBe(120);
    const 样 = await page.evaluate(() => (window as unknown as { __样: (number | null)[] }).__样);
    expect(样.filter((v) => v !== 目标), JSON.stringify(样)).toEqual([]);
    await expect.poll(() => 横滚(page)).toBe(目标);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("#381 实操（PR #384 审查）：还原途中人滚一下（单次滚轮）当场停还原，人滚到的位置照记、不被拉回目标", async () => {
  const errors: string[] = [];
  const page = await 新页(errors, 1366);
  try {
    const 目标 = await 记最右再回来(page, "600ms linear");
    await page.waitForTimeout(100);
    await page.evaluate(() => { const x = document.querySelector<HTMLElement>(".ant-table-content")!; window.dispatchEvent(new WheelEvent("wheel")); x.scrollLeft = 40; });
    await page.waitForTimeout(800);
    expect({ 实际: await 横滚(page), 存的: await 存的横滚(page) }, `目标 ${目标}`).toEqual({ 实际: 40, 存的: 40 });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("#381 实操（PR #384 审查）：记的横滚够不着（回来时列少了），滚到最长时长收尾、把实际停的位置记一次", async () => {
  const errors: string[] = [];
  const page = await 新页(errors, 1366);
  try {
    await 打开(page, "http://localhost/customers?page=1", () => localStorage.setItem("list-cols:customers", JSON.stringify(["phone", "createdAt", "signedAmount", "grade", "referrerName"])));
    await page.addStyleTag({ content: "#root{margin-left:220px;padding:22px 26px}" });
    const 目标 = await page.evaluate(() => { const x = document.querySelector<HTMLElement>(".ant-table-content")!; x.scrollLeft = x.scrollWidth; return x.scrollLeft; });
    await page.waitForTimeout(400);
    expect(await 存的横滚(page)).toBe(目标);
    // 回来前在别的页签把几列收了：表变窄，目标够不着
    await page.evaluate(() => localStorage.setItem("list-cols:customers", JSON.stringify(["phone", "createdAt"])));
    await page.reload();
    await page.addStyleTag({ content: "#root{margin-left:220px;padding:22px 26px}" });
    await 挂上(page);
    const 最多 = await page.evaluate(() => { const x = document.querySelector<HTMLElement>(".ant-table-content")!; return x.scrollWidth - x.clientWidth; });
    expect(最多).toBeGreaterThan(0);
    expect(最多).toBeLessThan(目标);
    // 最长 1500ms 到了才收尾；收尾前存的还是老值
    expect(await 存的横滚(page)).toBe(目标);
    await expect.poll(() => 存的横滚(page), { timeout: 4000 }).toBe(Math.round(await 横滚(page)));
    expect(await 存的横滚(page)).toBeLessThan(目标);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const 宽 of [390, 375]) {
  it(`#381 实操：${宽} 宽客户列表号码列能整列横滚进两侧固定列中间；名字列收窄、操作列不钉；页面不横滚`, async () => {
    const errors: string[] = [];
    const page = await 新页(errors, 宽);
    try {
      // 手机网页的版面：正文左右各 12（实操截图里表格卡片 12 起）
      await 打开(page, "http://localhost/customers?page=1");
      await page.addStyleTag({ content: "#root{padding:0 12px}" });
      await expect.poll(() => page.locator("thead th.dl-col-phone").count()).toBe(1);
      const 量 = await page.evaluate(() => {
        const 框 = document.querySelector<HTMLElement>(".ant-table-content")!;
        const th = document.querySelector<HTMLElement>("thead th.dl-col-phone")!;
        const 左固定 = [...框.querySelectorAll<HTMLElement>("thead th:is(.ant-table-cell-fix-start, .ant-table-cell-fix-left)")];
        const 右固定 = [...框.querySelectorAll<HTMLElement>("thead th:is(.ant-table-cell-fix-end, .ant-table-cell-fix-right)")];
        const 左边 = Math.max(框.getBoundingClientRect().left, ...左固定.map((t) => t.getBoundingClientRect().right));
        // 把号码列滚到紧贴左固定列
        框.scrollLeft = th.getBoundingClientRect().left - 左边 + 框.scrollLeft;
        const r = th.getBoundingClientRect();
        const 右边 = Math.min(框.getBoundingClientRect().right, ...右固定.map((t) => t.getBoundingClientRect().left));
        const 格 = document.querySelector<HTMLElement>("tr[data-row-key=c1] td.dl-col-phone .copy-val-t")!;
        return {
          整列在里: r.left >= 左边 - 0.5 && r.right <= 右边 + 0.5,
          中间宽: Math.round(右边 - 左边),
          右固定: 右固定.length,
          号码截了: 格.scrollWidth > 格.clientWidth,
          页横滚: document.documentElement.scrollWidth > window.innerWidth,
          名字宽: 左固定.find((t) => t.classList.contains("dl-col-name"))?.offsetWidth ?? null,
        };
      });
      expect(量, JSON.stringify(量)).toMatchObject({ 整列在里: true, 右固定: 0, 号码截了: false, 页横滚: false, 名字宽: 120 });
      expect(量.中间宽).toBeGreaterThanOrEqual(150);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("#381 实操：后退回来先用缓存旧数据、勾选按旧数据还原；还原出勾选就要一份新数据，新数据里变只读的行退出勾选、批量条跟着变", async () => {
  const errors: string[] = [];
  const page = await 新页(errors);
  try {
    await 打开(page, "http://localhost/customers?page=1");
    await page.locator("tr[data-row-key=c1] .ant-checkbox-input").check();
    await page.locator("tr[data-row-key=c4] .ant-checkbox-input").check();
    await page.reload();
    await 挂上(page);
    // 手上这屏还是旧的：两行都还原成勾着；同时要了一次新数据
    await expect.poll(() => 勾着(page)).toEqual(["c1", "c4"]);
    expect(await page.evaluate(() => (window as unknown as { __刷过?: number }).__刷过)).toBe(1);
    // 新数据到了：c4 变只读（改了上级成虚线）→ 退出勾选，批量条只剩 1
    await page.evaluate(() => (window as unknown as { __刷新: (r: string[]) => void }).__刷新(["c4"]));
    await expect.poll(() => 勾着(page)).toEqual(["c1"]);
    expect(await page.locator("tr[data-row-key=c4] .ant-checkbox-input").isDisabled()).toBe(true);
    await expect.poll(() => page.locator(".list-sel-float").innerText()).toContain("1");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
