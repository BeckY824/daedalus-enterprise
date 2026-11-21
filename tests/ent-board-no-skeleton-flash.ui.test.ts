/**
 * 项目看板改筛选时已经出来的卡片不闪回骨架（11-20）。
 *
 * 原来：改筛选（useUrlFilters 的 startTransition(router.push)）一挂起，ProjectsView 就把每一列的卡片全换成两张骨架卡（原型 pr.filter），
 * 回包后卡片整批重新挂上、从透明淡入——哪怕筛完还是这几张，人看到的是「卡片没了 → 骨架 → 卡片又冒出来」。
 * 现在：等回包时卡片原地留着、整块变淡（aria-busy，晚 180ms 才淡，快的回包看不见），回来以后还在的卡片不动、不重放淡入，
 * 只有新冒出来的卡片依次落位。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-board-no-skeleton-flash", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  // router.push 回一个等测试放行的 promise：startTransition 一直挂着 = 「等筛选回包」；放行时把新一屏画上去
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(u){(window.__去||=[]).push(u);return new Promise(r=>{window.__放=(新)=>{window.__画(新);r()}})},refresh(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/^\.\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "", "async()=>({ok:true})"));
  stub(/^\.\.\/actions$/, "const 好=async()=>({ok:true});export const 编辑项目=好,改项目画像Action=好,勾项目交付=好;");
  stub(/assign-actions$/, "export const 分配线索=async()=>({ok:true}),自动分配线索=async()=>({ok:true}),撤销自动分配=async()=>({ok:true}),批量自动分配=async()=>({ok:true,结果:[]}),本月分配情况=async()=>[],我分出去的线索=async()=>[],项目分配线=async()=>null,分配带走的项目=async()=>({项目数:0,项目:[]});");
  stub(/blocker-actions$/, "const 好=async()=>({ok:true});export const 发布卡点Action=好,认领卡点Action=好,完成卡点Action=好,删卡点Action=好,存卡点默认Action=好,存卡点角色开关Action=好,新增原因Action=好,改原因名Action=好,改原因状态Action=好,删原因Action=好,合并原因Action=好;");
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
    import {BusinessProvider} from '@/lib/business-client';
    import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const row=(id,node)=>({id,name:'项目'+id,customerId:'c'+id,customerName:'客户'+id,ownerId:'u0',ownerName:'王0',phase:'线索',node,result:null,exceptionCategory:null,exceptionReason:null,pooled:false,amount:1000,currency:'CNY',updatedAt:new Date().toISOString()});
    const 列=(ids)=>[
      {列:'潜客培育',名:'潜客培育',色:'线索',阶段:'线索',空态:'还没有',数:ids.length,合计:[],行:ids.map((i)=>row(i,'潜客培育'))},
      {列:'线索验证',名:'线索验证',色:'线索',阶段:'线索',空态:'还没有在线索验证的项目',数:0,合计:[],行:[]},
    ];
    window.__画=(o={})=>{const root=(window.__root||=createRoot(document.getElementById('root')));
      const ids=o.ids??['p1','p2','p3'];
      root.render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
        <Projects 行={[]} 列={列(ids)} 每列={{}} 总数={ids.length} 页={1} 每页={20} users={[{id:'u0',name:'王0',email:'a'}]} filters={{keyword:o.keyword??'',ownerId:'',pool:'',phase:''}} 企业版 客户页={false}/>
      </BusinessProvider></App>);};
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(width = 1280): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/projects");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: "try{localStorage.setItem('projects-view',JSON.stringify('看板'))}catch{}" });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as { __画: (o: unknown) => void }).__画({}));
  await page.locator(".pipe-card").first().waitFor();
  return { page, errors };
}
/** 每帧记一次：骨架卡几张、真卡片几张、正在放淡入动画（CSS animation，不算变淡的 transition）的卡片几张 */
const 开始记 = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __记: { 骨: number; 卡: number; 动: number }[] };
  w.__记 = [];
  const 量 = () => {
    const 卡们 = [...document.querySelectorAll<HTMLElement>(".pipe-card:not(.pipe-card-skel)")];
    w.__记.push({ 骨: document.querySelectorAll(".pipe-card-skel").length, 卡: 卡们.length, 动: 卡们.filter((e) => e.getAnimations().some((a) => a instanceof CSSAnimation && a.playState === "running")).length });
    requestAnimationFrame(量);
  };
  量();
});
const 记下的 = (page: Page) => page.evaluate(() => (window as unknown as { __记: { 骨: number; 卡: number; 动: number }[] }).__记);

it("改筛选等回包：卡片原地留着、不换成骨架；看板标 aria-busy、晚一拍才变淡", async () => {
  const { page, errors } = await 打开();
  try {
    await 开始记(page);
    const 搜 = page.getByPlaceholder("项目名称 / 客户").first();
    await 搜.fill("项目");
    await 搜.press("Enter");
    await expect.poll(() => page.locator(".pipe").getAttribute("aria-busy")).toBe("true");
    await page.waitForTimeout(400);
    expect(await page.locator(".pipe-card-skel").count()).toBe(0);
    expect(await page.locator(".pipe-card").count()).toBe(3);
    // 变淡在 180ms 之后（快的回包看不见），等了 400ms 已经淡下去
    expect(Number(await page.locator(".pipe-card").first().evaluate((e) => getComputedStyle(e).opacity))).toBeLessThan(0.9);
    expect((await 记下的(page)).every((x) => x.骨 === 0 && x.卡 === 3)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("回包后：还在的卡片不重挂、不重放淡入；新冒出来的那张才落位", async () => {
  const { page, errors } = await 打开();
  try {
    await page.locator(".pipe-card").first().evaluate((e) => { e.setAttribute("data-old", "1"); });
    const 搜 = page.getByPlaceholder("项目名称 / 客户").first();
    await 搜.fill("项目");
    await 搜.press("Enter");
    await expect.poll(() => page.locator(".pipe").getAttribute("aria-busy")).toBe("true");
    await 开始记(page);
    await page.evaluate(() => (window as unknown as { __放: (o: unknown) => void }).__放({ ids: ["p1", "p2", "p3", "p4"], keyword: "项目" }));
    await expect.poll(() => page.locator(".pipe-card").count()).toBe(4);
    await expect.poll(() => page.locator(".pipe").getAttribute("aria-busy")).toBe(null);
    // 原来那张还是同一个节点（没被卸掉重挂）
    expect(await page.locator(".pipe-card[data-old='1']").count()).toBe(1);
    await page.waitForTimeout(600);
    const 记 = await 记下的(page);
    expect(记.every((x) => x.骨 === 0)).toBe(true);
    expect(Math.max(...记.map((x) => x.动))).toBeLessThanOrEqual(1);
    expect(await page.locator(".pipe-card.pipe-card-in").count()).toBe(1);
    expect(await page.locator(".pipe-card.pipe-card-in").getAttribute("aria-label")).toMatch(/客户p4/);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
