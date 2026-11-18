/**
 * 客户抬头的排版（11-17 客户抬头 PR-5，出口 1 客户列表第一列、出口 2 客户详情页头；算法在 tests/ent-customer-title.test.ts）：
 *   1024 / 1280 / 1366 宽、三态开关、超长全称（不带空格）/ 超长简称 / 全空写编号|节点 / 零项目只写编号：
 *   第一列显示抬头、一行、放不下省略号（title 是全文，悬停看全）、每行一样高、页面不横向撑出；三态开着 1280 / 1366 表格不出内部横滚。
 *   详情页头：抬头一行省略、title 全文，页面不横滚。
 * 渲染的是真的 CustomersView / RecordView + globals.css，服务端动作换成桩（桩照抄 ent-cust-list-columns / ent-customer-detail-scroll 两份）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, 列表包: string, 详情包: string;
const 列表桩: Plugin = { name: "customer-title-list-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__push=u;if(window.__服务端换)setTimeout(()=>window.__设板(b=>!b),60)},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\/ImportDrawer$/, "export default function D({open}){return <div data-testid='import-drawer' data-open={String(open)}/>}");
  stub(/^\.\/export-client$/, "export const 完整导出=async()=>({ok:true});");
  stub(/^\.\/pool-actions$/, `const f=${空跑};export const 放进公海=async(ids)=>{window.__放=ids;return{ok:true,updated:1,unchanged:0,没权限:ids.length-1}},领取=f,分配公海=f,撤销公海=f,退回原因选项=async()=>[];`);
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/CustomerPick$/, "export default function C(){return null}");
  // 表单那两份料点开才取（11-15，form-data-action.ts）：首屏给了 channels 的用例用不上；没给的点开拿这一份
  stub(/^\.\/form-data-action$/, "export const 取客户页表单料=async()=>({channels:window.__表单渠道??[],建档:window.__表单建档??null});");
  // 企业版「新增客户」弹窗（10-31 会议，新客户带潜客培育项目）：向导本身另有测试，这里只看导入导出按钮
  stub(/projects\/new\/ProjectWizard$/, "export function 建档弹窗(){return null}");
  // 页头「新建 ▾ → 新建项目」那条路（projects/NewProjectFlow.tsx，点了才挂）：里面的选客户、建项目都是 server action，这里换成一块牌子
  // 牌子放在一个真的 antd 弹框里：看「关了焦点回到『新建』」用（弹框关掉把焦点还给打开那一刻有焦点的元素）
  stub(/projects\/NewProjectFlow$/, "import {useState} from 'react';import {Modal} from 'antd';export default function F(){const [o,s]=useState(true);return <Modal open={o} title='新增项目' footer={null} onCancel={()=>s(false)}><div className='new-proj-flow-stub'/></Modal>}");
  stub(/^\.\.\/channels\/actions$/, `export const saveChannel=${空跑};`);
  stub(/^(\.\/|\.\.\/)actions$/, `const f=${空跑};
    export const saveCustomer=async x=>{window.__存=x;return{ok:true,id:'new'}},checkDuplicate=async()=>null,推荐人候选=async()=>[],patchCustomer=f,
    assignSalesOwner=f,bulkFollowStatus=f,撤销改负责人=f,deleteCustomers=f,删除前清点=async()=>({}),客户删除预检=async()=>({ok:true}),转走项目预览of=async()=>({项目数:0,项目:[]}),saveChannel=f,供应商候选=async()=>[];`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
const 详情桩: Plugin = { name: "customer-title-detail-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>window.__习惯??null;", "async()=>null"));
  stub(/(^|\/)InlineField$/, "export default function Inline(p){return <div className='rec-field' data-field={p.field}>{p.label}: {p.value}</div>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>\"/customers/x\";");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(^|\/)(TaskForm|PlanForm|ContactForm|ContractForm|CustomerForm|OpportunityForm|AiPanel|StarButton|CustomerPick|LinkedCustomers|NewProjectEntry|ContactLinks)$/, "export default function Empty(){return null}");
  stub(/^\.\/useContactRemoval$/, "export const useContactRemoval=()=>({});export const ContactRemoveInline=()=>null;");
  stub(/^\.\/ai$/, "export const parseFollowUpDraft=async()=>({ok:false,error:'no AI'});");
  stub(/(^|\/)pool-actions$/, "export const 放进公海=async()=>({ok:false}),领取=放进公海,撤销公海=放进公海,退回原因选项=async()=>[];");
  stub(/(^|\/)tri-state-actions$/, "export const 三态继续持有=async()=>({ok:false,error:\"\"}),三态暂缓回收=三态继续持有,三态让同事结束项目=三态继续持有;");
  stub(/^\.\.\/actions$/, "export const saveCustomerNumbers=async()=>({ok:true});export const 转走项目预览of=async()=>(window.__预览??{项目数:0,项目:[]});export const deleteContract=async()=>({ok:false}),删签约前清点=async()=>({退回商机:[]}),assignSalesOwner=async()=>({ok:false}),撤销改负责人=async()=>({ok:false}),patchCustomerRegion=async()=>({ok:true});");
  stub(/^\.\/useCustomerResearch$/, "export function CustomerResearchCard(){return null} export function CustomerResearchTag(){return null}");
  stub(/^\.\/follow-history-actions$/, "export const loadFollowHistory=async()=>({ok:true,rows:[],hasMore:false}),readFollowHistoryRow=async()=>({ok:true,row:null}),loadCustomerFeed=async()=>({ok:true,rows:[],hasMore:false});");
  stub(/projects\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "export const 项目沟通须知=async()=>(window.__须知??{ok:true,能记:false}),记项目沟通Action=async(id,x)=>{window.__项目存={id,...x};return{ok:true,followUpId:'f1',自动推到:window.__推到}};"));
  stub(/^\.\/actions$/, `
    export const 客户删除预检=async()=>({ok:true}),删除前清点=async()=>({}),deleteCustomers=async()=>({ok:false});
    export const toggleTask=async()=>({ok:true}),deleteTask=toggleTask,completePlan=toggleTask,撤销记一笔=toggleTask,沟通可选项目=async()=>({ok:true,项目们:null,能建项目:true}),saveFollowUp=toggleTask,deleteFollowUp=toggleTask;
    export const 转走项目预览of=async()=>({项目数:0,项目:[]});
  
    export const saveTask=async()=>({ok:true,id:'t1'}),savePlan=async()=>({ok:true,id:'p1'});`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

const 长全称 = "某某超长贸易进出口有限公司".repeat(5);
const 长简称 = "某某超长简称".repeat(10);
/** 期望的抬头（和 客户抬头 的算法对得上，名字都是造的） */
const 期望 = [`义乌市|${长全称}`, `迪拜|${长简称}`, "NO.00012|痛点挖掘", "#C4"];

beforeAll(async () => {
  const 打包 = async (contents: string, plugin: Plugin) => (await build({ stdin: { contents, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  列表包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import {我Provider} from '@/lib/me-client';
    import CustomersView from '@/app/(app)/customers/CustomersView';
    const users=[{id:'me',name:'小王',email:'s1',role:'SALES',active:true}];
    const 行=(id,x)=>({id,name:'',phone:'1380000000'+id.slice(1),school:null,grade:null,major:null,followStatus:'待跟进',decisionStatus:'了解中',custStatus:'跟进中',salesOwnerId:'me',salesOwnerName:'小王',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',lastFollowAt:'2026-11-01T00:00:00.000Z',signedAmount:0,referrerCustomerId:null,referrerName:null,channelId:null,channelName:null,expectedSignAt:null,remark:null,extra:{level:'A'},customerNo:null,...x});
    const rows=[
      行('c1',{name:${JSON.stringify(长全称)},addrCountry:'中国',addrProvince:'浙江省',addrCity:'金华市',addrDistrict:'义乌市',customerNo:1}),
      行('c2',{name:'某某有限公司',shortName:${JSON.stringify(长简称)},addrCountry:'阿拉伯联合酋长国',addrCity:'迪拜',customerNo:2}),
      行('c3',{customerNo:12}),
      行('c4',{}),
    ];
    const 项目概况={c3:{项目数:1,当前节点:'痛点挖掘',当前阶段:'商机'}};
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><我Provider value={{id:'me',name:'小王'}}>
      <CustomersView rows={rows} total={4} page={1} requestedPage="1" pageSize={20} users={users} channels={[]} filters={{phase:'',node:'',...(window.__三态?{triState:''}:{})}} 三态标={window.__三态?{c1:{态:'待回收',几天后进公海:12},c2:{态:'暂缓回收中'},c3:{态:'不计时'}}:undefined} 客户数={4} 企业版 项目概况={项目概况} 抬头节点={{c3:'痛点挖掘'}} 项目看板 能新建和领取/>
    </我Provider></BusinessProvider></App></ConfigProvider>);
  `, 列表桩);
  详情包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Record from '@/app/(app)/customers/[id]/RecordView';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    const 名单=<aside className='pane pane-roster'><div className='pane-h'><span className='pane-t'>客户</span></div><div className='pane-rows'>{Array.from({length:20},(_,i)=><div key={i} style={{height:40}}>客户{i}</div>)}</div></aside>;
    window.__render=(x,节点)=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><div className='shell'><nav className='rail' aria-label='主导航'/>{名单}<main className='main app-content' style={{padding:'22px 26px'}}><div><Record customer={{id:'a',extra:null,name:'',phone:'13800138000',school:null,grade:null,major:null,followStatus:'跟进中',decisionStatus:'了解中',expectedSignAt:null,lastFollowAt:null,remark:null,referrerCustomerId:null,channelId:null,channelOwnerId:null,salesOwnerId:'qa',salesOwnerName:'QA',signedAmount:0,updatedAt:'2026-01-01T02:00:00.000Z',...x}} contacts={[]} contracts={[]} opportunities={[]} tasks={[]} plan={null} users={[]} channels={[]} aiEnabled={false} followUps={[]} followUpsHasMore={false} 项目们={[]} 旺旺们={[]} 抬头节点={节点}/></div></main></div></BusinessProvider></App></ConfigProvider>);
  `, 详情桩);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

for (const 三态 of [false, true]) {
  it(`客户列表第一列显示抬头：1024 / 1280 / 1366、超长全称 / 简称，一行省略、title 全文、行高一样、不横滚（三态${三态 ? "开" : "关"}）`, async () => {
    for (const w of [1024, 1280, 1366]) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 } }); page.setDefaultTimeout(5000);
      const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
      try {
        await page.route("http://cust-title.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
        await page.goto("http://cust-title.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
        if (三态) await page.addStyleTag({ path: path.resolve("src/app/(app)/tri-state-ui.css") });
        // 左边留出 220 的左栏（壳里正文就这么宽）
        await page.addStyleTag({ content: "#root{margin-left:220px;padding:22px 26px}" });
        if (三态) await page.evaluate(() => { (window as unknown as { __三态: boolean }).__三态 = true; });
        await page.addScriptTag({ content: 列表包 });
        await page.locator("tr.ant-table-row").first().waitFor();
        const 量 = await page.evaluate(() => {
          const 列 = [...document.querySelectorAll("thead th")].findIndex((th) => (th as HTMLElement).innerText.trim() === "客户");
          const 行们 = [...document.querySelectorAll("tr.ant-table-row")] as HTMLElement[];
          const 表 = document.querySelector<HTMLElement>(".ant-table-content, .ant-table-body");
          return {
            格: 行们.map((tr) => {
              const td = tr.children[列] as HTMLElement, a = td.querySelector("a") as HTMLElement, cs = getComputedStyle(a);
              const r = a.getBoundingClientRect(), t = td.getBoundingClientRect();
              return {
                字: a.innerText, title: a.title, 一行: cs.whiteSpace === "nowrap" && cs.textOverflow === "ellipsis",
                截了: a.scrollWidth > a.clientWidth + 1, 在格里: r.right <= t.right + 0.5, 行高: tr.getBoundingClientRect().height,
              };
            }),
            页横滚: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            表横滚: 表 ? 表.scrollWidth > 表.clientWidth : false,
          };
        });
        const 标 = `宽 ${w} 三态${三态 ? "开" : "关"}`;
        expect(量.格.map((g) => g.字), 标).toEqual(期望);
        expect(量.格.map((g) => g.title), 标).toEqual(期望);
        for (const g of 量.格) { expect(g.一行, `${标} ${g.字}`).toBe(true); expect(g.在格里, `${标} ${g.字}`).toBe(true); }
        // 两个超长的截了（悬停看全文）；「#C4」怎么都放得下。三态开着 1024 宽列只有 136，「NO.00012|痛点挖掘」也可能被截，同样悬停看全
        expect(量.格.map((g) => g.截了).filter((_, i) => i !== 2), 标).toEqual([true, true, false]);
        expect(Math.max(...量.格.map((g) => g.行高)) - Math.min(...量.格.map((g) => g.行高)), 标).toBeLessThanOrEqual(1);
        expect(量.页横滚, 标).toBe(false);
        if (三态 && w >= 1280) expect(量.表横滚, 标).toBe(false);
        expect(errors).toEqual([]);
        console.log(`[${标}] 表格内部横滚：${量.表横滚}`);
      } finally { await page.close(); }
    }
  });
}

it("客户详情页头显示抬头：1024 / 1280 / 1366、超长全称 / 简称一行省略、title 全文、不横滚；全空写编号|节点，零项目只写编号", async () => {
  // 最后一格：超长的要截（悬停看全文），短的不截
  const 例们: [Record<string, unknown>, string | null, string, boolean][] = [
    [{ name: 长全称, addrDistrict: "义乌市", customerNo: 1 }, null, `义乌市|${长全称}`, true],
    [{ name: "某某有限公司", shortName: 长简称, addrCountry: "阿拉伯联合酋长国", addrCity: "迪拜", customerNo: 2 }, null, `迪拜|${长简称}`, true],
    [{ customerNo: 12 }, "痛点挖掘", "NO.00012|痛点挖掘", false],
    [{ customerNo: 12 }, null, "NO.00012", false],
  ];
  for (const w of [1024, 1280, 1366]) {
    const page = await browser.newPage({ viewport: { width: w, height: 760 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    try {
      await page.route("http://cust-title-d.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
      await page.goto("http://cust-title-d.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 详情包 });
      for (const [x, 节点, 抬头, 要截] of 例们) {
        await page.evaluate(([x, 节点]) => (window as unknown as { __render: (x: unknown, n: unknown) => void }).__render(x, 节点), [x, 节点] as const);
        await expect.poll(() => page.locator("h1.rec-head-name").innerText(), { message: `宽 ${w}` }).toBe(抬头);
        const 量 = await page.evaluate(() => {
          const h = document.querySelector<HTMLElement>("h1.rec-head-name")!, cs = getComputedStyle(h);
          const r = h.getBoundingClientRect(), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
          return { title: h.title, 一行: cs.whiteSpace === "nowrap" && cs.textOverflow === "ellipsis" && r.height < lh * 1.5, 截了: h.scrollWidth > h.clientWidth + 1,
            页横滚: document.documentElement.scrollWidth > document.documentElement.clientWidth };
        });
        const 标 = `宽 ${w} ${抬头.slice(0, 12)}`;
        expect(量.title, 标).toBe(抬头);
        expect(量.一行, 标).toBe(true);
        expect(量.截了, 标).toBe(要截);
        expect(量.页横滚, 标).toBe(false);
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
