/**
 * 客户表格「当前节点」「项目数」两列（11-12 客户详情合并第 3 批，定稿 UI 表格）：
 *   表头这两列紧跟客户名；当前节点画成标签、一行放不下省略号（悬停看全文是全站 TruncTip）；没有我能看的项目写「—」、项目数 0；
 *   1024 / 1280 / 1366 宽、超长客户名和超长节点名：每格一行、页面不横向撑出；「阶段」「进程」两个筛选默认收在「更多筛选」里。
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
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import CustomersView from '@/app/(app)/customers/CustomersView';
    const root=createRoot(document.getElementById('root'));
    const 长='某某超长贸易进出口有限公司'.repeat(6);
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true},{id:'u2',name:'一个名字特别特别长的同事',email:'s2',role:'SALES',active:true}];
    const 行=(id,owner)=>({id,name:长+id,phone:'1380000000'+id.slice(1),school:null,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',custStatus:'跟进中',salesOwnerId:owner,salesOwnerName:owner==='me'?'小王':'一个名字特别特别长的同事',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:'2026-11-01T00:00:00.000Z',signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null,expectedSignAt:null,remark:null,addrCountry:'阿拉伯联合酋长国',extra:{level:'A'}});
    const rows=[行('c1','me'),行('c2','u2'),行('c3','me')];
    const 项目概况={c1:{项目数:12,当前节点:'异常 · 某个后台改得特别特别长的节点名字',当前阶段:'订单'},c2:{项目数:1,当前节点:'方案敲定',当前阶段:'商机'}};
    root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'me',name:'小王'}}>
      <CustomersView rows={rows} total={3} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{phase:'',node:''}} 客户数={3} 企业版 项目概况={项目概况}/>
    </我Provider></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [列表桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

it("两列紧跟客户名；节点标签一行省略、—、0；三种宽度每格一行、页面不撑出；阶段 / 进程收在更多筛选里", async () => {
  for (const w of [1024, 1280, 1366]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    try {
      await page.route("http://cust-cols.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
      await page.goto("http://cust-cols.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 包 });
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
      // 阶段、进程默认不摆在外面（1024 宽筛选行本来就刚好一行），「更多筛选」里挑得到
      expect(await page.getByRole("combobox", { name: "阶段" }).count(), `宽 ${w}`).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
