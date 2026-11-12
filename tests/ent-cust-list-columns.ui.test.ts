/**
 * 客户表格「当前节点」「项目数」两列（11-12 客户详情合并第 3 批，定稿 UI 表格）：
 *   表头这两列紧跟客户名；当前节点画成标签、一行放不下省略号（悬停看全文是全站 TruncTip）；没有我能看的项目写「—」、项目数 0；
 *   1024 / 1280 / 1366 宽、超长客户名和超长节点名：每格一行、页面不横向撑出；「阶段」「进程」两个筛选照定稿摆外面，
 *   筛选行一行放不下时自动收进「更多筛选」（筛选行始终一行）；1920 宽摆得下就在外面。
 * 数据怎么算（只算我能看的、最近有动静的那个）在 tests/ent-customer-list-queries.test.ts。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, 包: string;
const 列表桩: Plugin = { name: "import-perm-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__push=u},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\/ImportDrawer$/, "export default function D({open}){return <div data-testid='import-drawer' data-open={String(open)}/>}");
  stub(/^\.\/export-client$/, "export const 完整导出=async()=>({ok:true});");
  stub(/^\.\/pool-actions$/, `const f=${空跑};export const 放进公海=async(ids)=>{window.__放=ids;return{ok:true,updated:1,unchanged:0,没权限:ids.length-1}},领取=f,分配公海=f,撤销公海=f,退回原因选项=async()=>[];`);
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/CustomerPick$/, "export default function C(){return null}");
  // 企业版「新增客户」弹窗（10-31 会议，新客户带潜客培育项目）：向导本身另有测试，这里只看导入导出按钮
  stub(/projects\/new\/ProjectWizard$/, "export function 建档弹窗(){return null}");
  stub(/^\.\.\/channels\/actions$/, `export const saveChannel=${空跑};`);
  stub(/^(\.\/|\.\.\/)actions$/, `const f=${空跑};
    export const saveCustomer=async x=>{window.__存=x;return{ok:true,id:'new'}},checkDuplicate=async()=>null,推荐人候选=async()=>[],patchCustomer=f,
    assignSalesOwner=f,bulkFollowStatus=f,撤销改负责人=f,deleteCustomers=f,删除前清点=async()=>({}),客户删除预检=async()=>({ok:true}),转走项目预览of=async()=>({项目数:0,项目:[]}),saveChannel=f,供应商候选=async()=>[];`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  包 = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot,hydrateRoot} from 'react-dom/client';import {renderToString} from 'react-dom/server';import {createCache,extractStyle,StyleProvider} from '@ant-design/cssinjs';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import CustomersView from '@/app/(app)/customers/CustomersView';
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'一个名字特别特别长的同事',email:'s2',role:'SALES',active:true}];
    const 行=(id,owner)=>({id,name:长+id,phone:'1380000000'+id.slice(1),school:null,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',custStatus:'跟进中',salesOwnerId:owner,salesOwnerName:owner==='me'?'小王':'一个名字特别特别长的同事',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:'2026-11-01T00:00:00.000Z',signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null,expectedSignAt:null,remark:null,addrCountry:'阿拉伯联合酋长国',extra:{level:'A'}});
    const rows=[行('c1','me'),行('c2','u2'),行('c3','me')];
    const 项目概况={c1:{项目数:12,当前节点:'异常 · 某个后台改得特别特别长的节点名字',当前阶段:'订单'},c2:{项目数:1,当前节点:'方案敲定',当前阶段:'商机'}};
    const 树=(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'me',name:'小王'}}>
      <CustomersView rows={rows} total={3} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{phase:'',node:'',...(window.__三态?{triState:''}:{})}} 三态标={window.__三态?{c1:{态:'待回收',几天后进公海:12},c2:{态:'暂缓回收中'},c3:{态:'不计时'}}:undefined} 客户数={3} 企业版 项目概况={项目概况} 项目看板 待交接={window.__交接??null} 看板体={window.__看板?<div className='fake-board'>项目看板</div>:undefined} 市场视图={!!window.__市场}/>
    </我Provider></BusinessProvider></App></ConfigProvider>);
    const el=document.getElementById('root');
    // __静态：先只放服务端出的那份 HTML（React 还没接管），window.__水合() 再接管——照真实页面的先后
    if(window.__静态){const c=createCache();const h=renderToString(<StyleProvider cache={c}>{树}</StyleProvider>);document.head.insertAdjacentHTML('beforeend',extractStyle(c));el.innerHTML=h;window.__水合=()=>hydrateRoot(el,树);}
    else createRoot(el).render(树);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [列表桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 摆法: string[] = [];
it("两列紧跟客户名；节点标签一行省略、—、0；三种宽度每格一行、页面不撑出；阶段 / 进程摆外面、放不下收进更多筛选，筛选行一行", async () => {
  // 左边留出 220 的左栏（壳里正文就这么宽）
  for (const [w, 右栏] of [[1024, 0], [1280, 0], [1366, 0], [1920, 0]] as const) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    try {
      await page.route("http://cust-cols.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
      await page.goto("http://cust-cols.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
      await page.addStyleTag({ content: `#root{margin-left:220px;margin-right:${右栏}px;padding:22px 26px}` });
      await page.addScriptTag({ content: 包 });
      await page.locator("tr.ant-table-row").first().waitFor();
      const 头 = await page.locator("thead th").allInnerTexts();
      const 名位 = 头.findIndex((t) => t.trim() === "客户");
      expect(头.slice(名位, 名位 + 3).map((t) => t.trim()), `宽 ${w}`).toEqual(["客户", "当前节点", "项目数"]);
      const 格 = await page.evaluate(() => {
        const 行们 = [...document.querySelectorAll("tr.ant-table-row")] as HTMLElement[];
        const 列 = [...document.querySelectorAll("thead th")].findIndex((th) => (th as HTMLElement).innerText.trim() === "当前节点");
        return 行们.map((tr) => {
          const tds = [...tr.children] as HTMLElement[];
          const 标签 = tds[列].querySelector(".ant-tag") as HTMLElement | null;
          return {
            节点: tds[列].innerText.trim(), 数: tds[列 + 1].innerText.trim(),
            截了: 标签 ? 标签.scrollWidth > 标签.clientWidth && getComputedStyle(标签).textOverflow === "ellipsis" : null,
            标签在格里: 标签 ? 标签.getBoundingClientRect().right <= tds[列].getBoundingClientRect().right + 0.5 : null,
            行高: tr.getBoundingClientRect().height,
          };
        });
      });
      expect(格.map((g) => [g.数, g.节点 === "—"]), `宽 ${w}`).toEqual([["12", false], ["1", false], ["0", true]]);
      expect(格[0].截了 && 格[0].标签在格里, `宽 ${w}`).toBe(true);
      expect(格[1].截了, `宽 ${w}`).toBe(false);
      // 每格一行：超长客户名的行和普通行一样高（折行会把行撑高）
      expect(Math.max(...格.map((g) => g.行高)) - Math.min(...格.map((g) => g.行高)), `宽 ${w}`).toBeLessThanOrEqual(1);
      expect(格[0].行高, `宽 ${w}`).toBeLessThanOrEqual(60);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `宽 ${w}`).toBe(true);
      // 阶段、进程照定稿摆外面；筛选行一行放不下就先收进「更多筛选」：哪种宽度都是一行，阶段要么在外面、要么在「更多筛选」里
      const 筛选组高 = await page.locator(".list-bar > .ant-space").first().evaluate((el) => el.getBoundingClientRect().height);
      expect(筛选组高, `宽 ${w} 筛选行一行`).toBeLessThanOrEqual(40);
      const 外面 = await page.getByRole("combobox", { name: "阶段" }).count();
      if (!外面) {
        await page.getByRole("button", { name: /^更多筛选/ }).click();
        await expect.poll(() => page.locator(".ant-popover").getByRole("combobox", { name: "阶段" }).count(), { message: `宽 ${w}` }).toBe(1);
        expect(await page.locator(".ant-popover").getByRole("combobox", { name: "进程" }).count(), `宽 ${w}`).toBe(1);
      } else expect(await page.getByRole("combobox", { name: "进程" }).count(), `宽 ${w}`).toBe(1);
      摆法.push(`${w}${右栏 ? "+AI栏" : ""}:${外面 ? "外面" : "更多筛选"}`);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
// 客户三态开着（11-12 三态界面 B 组）：多「回收状态」一列（紧跟项目数，和「客户状态」分开）、多「回收状态」筛选；三种宽度筛选行仍一行、每格一行、页面不撑出
it("三态开着：回收状态列在项目数后面、和客户状态两列；1024 / 1280 / 1366 筛选行一行、每格一行、不横向撑出", async () => {
  for (const w of [1024, 1280, 1366]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    try {
      await page.route("http://cust-cols.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
      await page.goto("http://cust-cols.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addStyleTag({ path: path.resolve("src/app/(app)/tri-state-ui.css") });
      await page.addStyleTag({ content: "#root{margin-left:220px;padding:22px 26px}" });
      await page.evaluate(() => { (window as unknown as { __三态: boolean }).__三态 = true; });
      await page.addScriptTag({ content: 包 });
      await page.locator("tr.ant-table-row").first().waitFor();
      const 头 = (await page.locator("thead th").allInnerTexts()).map((t) => t.trim());
      const 名位 = 头.indexOf("客户");
      expect(头.slice(名位, 名位 + 5), `宽 ${w}`).toEqual(["客户", "当前节点", "项目数", "回收状态", "客户状态"]);
      const 列 = 头.indexOf("回收状态");
      const 格 = await page.evaluate((列) => [...document.querySelectorAll("tr.ant-table-row")].map((tr) => { const td = tr.children[列] as HTMLElement; return { 字: td.innerText.trim(), 高: tr.getBoundingClientRect().height }; }), 列);
      expect(格.map((g) => g.字), `宽 ${w}`).toEqual(["待回收 · 12 天后进公海", "暂缓回收中", "不计时"]);
      expect(Math.max(...格.map((g) => g.高)), `宽 ${w}`).toBeLessThanOrEqual(60);
      expect(await page.locator(".list-bar > .ant-space").first().evaluate((el) => el.getBoundingClientRect().height), `宽 ${w} 筛选行一行`).toBeLessThanOrEqual(40);
      // 回收状态筛选要么在外面、要么收在「更多筛选」里
      if (!(await page.getByRole("combobox", { name: "回收状态" }).count())) {
        await page.getByRole("button", { name: /^更多筛选/ }).click();
        await expect.poll(() => page.locator(".ant-popover").getByRole("combobox", { name: "回收状态" }).count(), { message: `宽 ${w}` }).toBe(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `宽 ${w}`).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
afterAll(async () => { if (process.env.CUST_COLS_DUMP) (await import("node:fs")).writeFileSync(process.env.CUST_COLS_DUMP, 摆法.join("\n")); });

it("拉宽窗口阶段 / 进程回到外面，再拉窄又收进去，筛选行一直一行", async () => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } }); page.setDefaultTimeout(5000);
  try {
    await page.route("http://cust-cols.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
    await page.goto("http://cust-cols.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
    await page.addStyleTag({ content: "#root{margin-left:220px;padding:22px 26px}" });
    await page.addScriptTag({ content: 包 });
    await page.locator("tr.ant-table-row").first().waitFor();
    const 阶段在外面 = () => page.getByRole("combobox", { name: "阶段" }).count();
    const 一行 = () => page.locator(".list-bar > .ant-space").first().evaluate((el) => el.getBoundingClientRect().height <= 40);
    expect(await 阶段在外面()).toBe(0);
    await page.setViewportSize({ width: 1920, height: 900 });
    await expect.poll(阶段在外面).toBe(1);
    expect(await 一行()).toBe(true);
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect.poll(阶段在外面).toBe(0);
    expect(await 一行()).toBe(true);
  } finally { await page.close(); }
});

/*
  PR #273 CI（window-sizes「最小窗口 1024」）：真实壳里 1024 宽、左栏 220 展开，量到筛选行折成两行、阶段 / 进程还在外面。
  原因：「放不下收进更多筛选」是 React 接管后量出来的，服务端出的那份 HTML 里阶段 / 进程照摆，接管之前筛选行就是折的（慢网、CI 上都看得到）。
  这里照真实条件复现：先只放服务端渲染出的 HTML（不接管）量一次，再接管量一次；量法照那条 E2E——取筛选行里各格的 top（不显示的探针那格不算）、
  「列」也算上；接管后各格右边不越过筛选行（接管前是把放不下的藏在行尾，不是折行）
*/
it("1024 宽、左栏 220：React 接管前后筛选行和「列」都是一行，接管后阶段 / 进程收进更多筛选", async () => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.route("http://cust-cols.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
    await page.goto("http://cust-cols.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
    await page.addStyleTag({ content: "#root{margin-left:220px;padding:22px 26px}" });
    await page.evaluate(() => { (window as unknown as { __静态: boolean }).__静态 = true; });
    await page.addScriptTag({ content: 包 });
    await page.locator("tr.ant-table-row").first().waitFor();
    const 量 = () => page.locator(".list-bar").evaluate((b) => {
      const 右 = b.getBoundingClientRect().right;
      const 项 = [...b.querySelectorAll(":scope > .ant-space > .ant-space-item, :scope > .ant-btn, :scope > .ant-dropdown-trigger")]
        .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden");
      return { 行数: new Set(项.map((e) => Math.round(e.getBoundingClientRect().top))).size, 越界: 项.filter((e) => e.getBoundingClientRect().right > 右 + 0.5).length };
    });
    // 接管前放不下的藏在组的行尾（组本身不越界），只看一行
    expect((await 量()).行数, "接管前（服务端 HTML）").toBe(1);
    await page.evaluate(() => { (window as unknown as { __水合: () => void }).__水合(); });
    await expect.poll(() => page.getByRole("combobox", { name: "阶段" }).count(), { message: "接管后放不下，阶段收进更多筛选" }).toBe(0);
    expect(await 量(), "接管后").toEqual({ 行数: 1, 越界: 0 });
    expect(await page.locator(".list-bar").getByRole("button", { name: /列/ }).count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("「列表 / 看板」单独一行停在列表；按客户属性分列的看板不摆；点「看板」记下并回客户页（服务端换成项目看板）", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(5000);
  try {
    await page.route("http://cust-cols.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
    await page.goto("http://cust-cols.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 包 });
    await page.locator("tr.ant-table-row").first().waitFor();
    const 切 = page.locator(".cust-view-seg .ant-segmented");
    expect(await 切.count()).toBe(1);
    expect(await 切.locator(".ant-segmented-item-selected").innerText()).toBe("列表");
    await 切.getByText("看板", { exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { __push?: string }).__push)).toBe("/customers");
    expect(await page.evaluate(() => document.cookie)).toContain("customers-view=board");
    // 还是客户列表（换不换是服务端的事），不会冒出按客户属性分列的那块
    expect(await page.locator(".cust-board").count()).toBe(0);
  } finally { await page.close(); }
});

it("看板视图（C17 / C18 / C15）：页头照客户列表（导入、导出、新建客户），离职交接在页头最右端带数；筛选行照摆、表格换成看板；切回列表筛选留着、页码去掉", async () => {
  for (const w of [1024, 1280, 1366]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    try {
      await page.route("http://cust-cols.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
      await page.goto("http://cust-cols.test/?keyword=abc&phase=%E5%95%86%E6%9C%BA&page=3&pageSize=50");
      await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
      await page.addStyleTag({ content: `#root{margin-left:220px;padding:22px 26px}` });
      await page.evaluate(() => { Object.assign(window, { __看板: true, __交接: 3 }); });
      await page.addScriptTag({ content: 包 });
      await page.locator(".fake-board").waitFor();
      expect(await page.locator("tr.ant-table-row").count(), `宽 ${w}`).toBe(0);
      const 钮 = (await page.locator(".page-head button").allInnerTexts()).map((t) => t.replace(/\s+/g, ""));
      expect(钮, `宽 ${w}`).toEqual(expect.arrayContaining(["导入", "导出", "新建客户"]));
      expect(钮.at(-1), `宽 ${w}`).toBe("离职交接3");
      expect(await page.locator(".page-head").getByRole("button", { name: /新增项目|分配/ }).count(), `宽 ${w}`).toBe(0);
      // 同一行筛选：搜索框、阶段、进程都在
      expect(await page.getByRole("combobox", { name: "阶段" }).count() + await page.getByText("更多筛选").count(), `宽 ${w}`).toBeGreaterThan(0);
      const 切 = page.locator(".cust-view-seg .ant-segmented");
      expect(await 切.locator(".ant-segmented-item-selected").innerText(), `宽 ${w}`).toBe("看板");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `宽 ${w}`).toBe(true);
      await 切.getByText("列表", { exact: true }).click();
      expect(await page.evaluate(() => document.cookie), `宽 ${w}`).toContain("customers-view=list");
      expect(await page.evaluate(() => (window as unknown as { __push?: string }).__push), `宽 ${w}`).toBe("/customers?keyword=abc&phase=%E5%95%86%E6%9C%BA");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("市场成员、市场管理（X-107）：切换叫「客户列表 / 我分出去的」，停在客户列表；点「我分出去的」记下看板（服务端换成原项目页那套）", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(5000);
  try {
    await page.route("http://cust-cols.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
    await page.goto("http://cust-cols.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
    await page.evaluate(() => { Object.assign(window, { __市场: true }); });
    await page.addScriptTag({ content: 包 });
    await page.locator("tr.ant-table-row").first().waitFor();
    const 切 = page.locator(".cust-view-seg .ant-segmented");
    expect(await 切.locator(".ant-segmented-item-label").allInnerTexts()).toEqual(["客户列表", "我分出去的"]);
    expect(await 切.locator(".ant-segmented-item-selected").innerText()).toBe("客户列表");
    await 切.getByText("我分出去的", { exact: true }).click();
    expect(await page.evaluate(() => document.cookie)).toContain("customers-view=board");
    expect(await page.evaluate(() => (window as unknown as { __push?: string }).__push)).toBe("/customers");
  } finally { await page.close(); }
});
