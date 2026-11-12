/**
 * 企业版「新线索」页 = 项目的线索阶段（2026-10-26 用户：「线索也要去项目里面作为三阶段」）。
 *
 *   阶段="线索"：标题「新线索」、只有列表没有看板切换、按钮「新线索」去项目向导
 *   开关关（项目页本身）：照旧「项目」、有看板/列表切换、「新建项目」
 *   Windows 1024 / 1280 / 1366 宽度 + 超长项目名、客户名：页面不横向溢出，新建按钮在可视区、点得中
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-new-leads", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(u){window.__去.push(u)},refresh(){},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/actions$/, "export const 回项目邀请=async()=>({ok:true}),市场复核Action=async()=>({ok:true}),总管理终判Action=async()=>({ok:true});");
  // 分配那几个 server action：记下调了什么，回成功
  stub(/assign-actions$/, "const 记=(n)=>async(...a)=>{(window.__调||=[]).push([n,...a]);return n==='本月分配情况'?{月:'2026-10',人:[]}:n==='我分出去的线索'?[]:n==='批量自动分配'?{ok:true,结果:[]}:{ok:true,toUserId:'u1',接手人:'王1',已分:1,配额:null,为什么:'按顺序'}};export const 分配线索=记('分配线索'),自动分配线索=记('自动分配线索'),批量自动分配=记('批量自动分配'),本月分配情况=记('本月分配情况'),我分出去的线索=记('我分出去的线索'),关满额提醒=记('关满额提醒'),项目分配线=async()=>({线:'内贸'}),分配带走的项目=async(...a)=>{(window.__调||=[]).push(['分配带走的项目',...a]);return window.__带走||{项目数:0,项目:[]}};");
  // 卡点面板（我的卡点看板）的 server action：这几条测试不点卡点，回成功就行
  stub(/blocker-actions$/, "const 好=async()=>({ok:true});export const 发布卡点Action=好,认领卡点Action=好,完成卡点Action=好,删卡点Action=好,存卡点默认Action=好,存卡点角色开关Action=好,新增原因Action=好,改原因名Action=好,改原因状态Action=好,删原因Action=好,合并原因Action=好,我的卡点Action=async()=>[];");
  // 「给老客户开项目」挑客户、建项目那几个 server action：这几条测试不点，空着就行
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[],取客户选项=async()=>[],取客户近况=async()=>null;");
  stub(/project-actions$/, "export const 给客户建项目=async()=>({ok:true});export const 新项目分配数据=async()=>null;export const 建项目带走的项目=async()=>({项目数:0,项目:[]});");
  // 「新增项目」→「新客户」：取向导数据记一笔；向导框本身换成一块写着标题的牌子（向导另有测试）
  stub(/new\/wizard-actions$/, "export const 取建档数据=async()=>{(window.__调||=[]).push(['取建档数据']);return {users:[],要下一步:false,企业:null}};");
  stub(/new\/ProjectWizard$/, "export const 建档弹窗=()=>null;");
  // 看板列底「再看」（客户页 customers/board-actions.ts、别处 projects/board-actions.ts）：记下调了什么，等一会儿（看得到加载中）再回 window.__再看；
  // window.__手动 时挂起，由用例按顺序 window.__挂起[i].r(结果) 放回（复现慢请求的时序）
  const 再看码 = (名: string) => `export const ${名}=async(...a)=>{(window.__调||=[]).push(['${名}',...a]);if(window.__手动)return new Promise(r=>(window.__挂起||=[]).push({a,r}));await new Promise(r=>setTimeout(r,400));return window.__再看||{ok:true,行:[],总:0}};`;
  stub(/customers\/board-actions$/, 再看码("再看一列"));
  stub(/^\.\/board-actions$/, 再看码("再看项目页一列"));
  stub(/^next\/dynamic$/, "import React from 'react';export default function d(){return function D(p){return p.open?<div className='wizard-stub'>{p.标题}</div>:null}}");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import Projects from '@/app/(app)/projects/ProjectsView';
    import {BusinessProvider} from '@/lib/business-client';
    import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import {看板工具位} from '@/app/(app)/customers/board-slot';
    window.__去=[];
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购项目第二期';
    const row=(i,node)=>({id:'p'+i,name:长+i,customerId:'c'+i,customerName:长,ownerId:'u'+(i%2),ownerName:'王'+i,phase:'线索',node,result:null,exceptionCategory:null,exceptionReason:null,pooled:false,amount:1234567,currency:'CNY',updatedAt:new Date().toISOString()});
    const 行=[row(1,'潜客培育'),row(2,'线索验证'),{...row(3,'线索推进'),result:'线索流失'}];
    // 看板五列（11-01 C12 测「→ 还有 N 列」）：每列一张卡
    const 五列=['线索','商机','订单','成功交付','没成'].map((列,i)=>({列,数:1,合计:[],行:[{...row(10+i,'潜客培育'),phase:列==='没成'?'线索':列}]}));
    // 客户页看板每列各自取数（11-12）：第一列 25 个、首屏摆了 20 个，别的列各 1 个
    // 每次画都是新的一屏（新的数组，同服务端换了一屏）；o.数 = 第一列一共几个
    const 造每列列=(数=25)=>[{...五列[0],名:'线索',数,行:Array.from({length:20},(_,i)=>row(100+i,'潜客培育'))},...五列.slice(1).map(c=>({...c}))];
    window.__再看={ok:true,行:Array.from({length:5},(_,i)=>row(120+i,'潜客培育')),总:25};
    // o.工具位：照客户页那样在上面给一条筛选行、右端留一格（customers/board-slot.ts），看板的按钮和提示画进去
    window.__画=(阶段,能分,企,o={})=>{if(o.工具位&&!document.getElementById('slot'))document.getElementById('root').insertAdjacentHTML('beforebegin',"<div class='list-bar'><span class='list-bar-gap'></span><div class='list-bar-end' id='slot'></div></div>");return (window.__root||=createRoot(document.getElementById('root'))).render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><看板工具位.Provider value={o.工具位?document.getElementById('slot'):undefined}>
      <Projects 行={o.每列?[]:o.公海?[{...row(4,'线索推进'),pooled:true,客户在公海:true},{...row(5,'线索推进'),pooled:true}]:行} 列={o.每列?造每列列(o.数):o.看板?五列:[]} 每列={o.每列?{}:undefined} 要的页={o.要的页} 总数={(o.公海?2:行.length)} 页={1} 每页={20} users={o.单人?[{id:'u0',name:'王0',email:'a'}]:[{id:'u0',name:'王0',email:'a'},{id:'u1',name:'王1',email:'b'}]} filters={{keyword:'',ownerId:'',pool:'',phase:o.phase||''}} 阶段={阶段?'线索':undefined} 线索分配开着={!!能分} 能自动分配={!!能分} 能分公海客户项目={!!o.管公海} 企业版={!!企} 客户页={!!o.客户页} 待交接={o.客户页?2:null} 换回客户列表={!!o.换回} 能新建客户={!!o.能新建客户} 标题={o.换回?'客户':undefined}/>
    </看板工具位.Provider></BusinessProvider></App>);};
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 选项 = { phase?: string; 看板?: boolean; 每列?: boolean; 数?: number; 单人?: boolean; 要的页?: string; 样式?: boolean; 公海?: boolean; 管公海?: boolean; 客户页?: boolean; 查询?: string; 换回?: boolean; 能新建客户?: boolean; 工具位?: boolean };
async function 打开(新线索: boolean, width = 1280, 能分 = false, 企 = false, o: 选项 = {}): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto(`http://ent.test/${新线索 ? "leads" : o.客户页 ? "customers" : "projects"}${o.查询 ?? ""}`);
  // 排版类用例（单行、看板滑动）要真样式
  if (o.样式) await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([v, f, e, x]) => (window as unknown as { __画: (v: boolean, f: boolean, e: boolean, x: 选项) => void }).__画(v, f, e, x), [新线索, 能分, 企, o] as const);
  // 客户页模式只画看板那一块，没有页头标题：等看板
  await (o.客户页 ? page.locator(".pipe") : page.getByRole("heading")).first().waitFor();
  return { page, errors };
}
const 去了 = (page: Page) => page.evaluate(() => (window as unknown as { __去: string[] }).__去);

it("新线索页：标题「新线索」，只有列表，三个线索节点都列出来，新建去 /leads/new（同一个向导）", async () => {
  const { page, errors } = await 打开(true);
  expect(await page.getByRole("heading").first().innerText()).toBe("新线索");
  expect(await page.locator(".ant-segmented").count()).toBe(0);
  const t = await page.locator("body").innerText();
  // P11：阶段、进程分两列；新线索页全是线索阶段，不摆阶段列，进程格只写节点（不再是「线索 · 潜客培育」）
  expect(t).toContain("潜客培育");
  expect(t).toContain("线索验证");
  expect(t).not.toContain("线索 · ");
  expect(await page.getByRole("columnheader", { name: "阶段", exact: true }).count()).toBe(0);
  expect(t).toContain("线索流失");
  expect(t).toContain("转了商机到「项目」里接着走");
  await page.getByRole("button", { name: /新线索$/ }).click();
  expect(await 去了(page)).toEqual(["/leads/new"]);
  expect(errors).toEqual([]); await page.close();
});

it("开关关（项目页本身）：标题「项目」，有看板/列表切换，「新建项目」", async () => {
  const { page, errors } = await 打开(false);
  expect(await page.getByRole("heading").first().innerText()).toBe("项目");
  expect(await page.locator(".ant-segmented").count()).toBe(1);
  expect(await page.getByRole("button", { name: /新线索$/ }).count()).toBe(0);
  await page.getByRole("button", { name: "新建项目" }).click();
  expect(await 去了(page)).toEqual(["/projects/new"]);
  expect(errors).toEqual([]); await page.close();
});

it.each([1024, 1280, 1366])("Windows %ipx + 超长名字：不横向溢出，新建按钮在可视区、点得中", async (w) => {
  const { page } = await 打开(true, w);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await page.getByRole("button", { name: /新线索$/ }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(w);
  const 点中 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box!.x + box!.width / 2, box!.y + box!.height / 2]);
  expect(点中).toContain("新线索");
  await page.close();
});

it("能分配的人：每条没结局的新线索有「分配」「自动分配」，线索流失的没有；自动分配按项目分；不能分的人看不到", async () => {
  const { page, errors } = await 打开(true, 1280, true);
  const 长 = "某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购项目第二期";
  expect(await page.getByRole("button", { name: `分配 ${长}1`, exact: true }).count()).toBe(1);
  expect(await page.getByRole("button", { name: `自动分配 ${长}2` }).count()).toBe(1);
  expect(await page.getByRole("button", { name: `分配 ${长}3`, exact: true }).count()).toBe(0);
  await page.getByRole("button", { name: `自动分配 ${长}1` }).click();
  await page.getByText("按顺序", { exact: false }).first().waitFor();
  const 调 = await page.evaluate(() => (window as unknown as { __调: unknown[][] }).__调);
  expect(调.find((c) => c[0] === "自动分配线索")).toEqual(["自动分配线索", "p1", { 项目: true, 原负责人: "u1" }]);
  expect(await 去了(page)).toEqual([]); // 点按钮不触发行跳转
  expect(errors).toEqual([]); await page.close();
  const 不能 = await 打开(true);
  expect(await 不能.page.getByRole("button", { name: `分配 ${长}1`, exact: true }).count()).toBe(0);
  await 不能.page.close();
});

it("企业版项目首页：「新增项目」一个按钮（没有旁边的下拉、没有「去公海看」），点开先选新客户 / 老客户，都在弹窗里接着建", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 打开(false, w, false, true);
    expect(await page.getByRole("button", { name: "新建方式" }).count()).toBe(0);
    expect(await page.getByText("去公海看").count()).toBe(0);
    const 钮 = page.getByRole("button", { name: /新增项目$/ });
    expect(await 钮.count()).toBe(1);
    const box = (await 钮.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(w);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await 钮.click();
    const 框 = page.getByRole("dialog", { name: "新增项目" });
    await 框.waitFor();
    const 选项 = 框.locator(".new-proj-opt");
    expect(await 选项.allInnerTexts()).toEqual([expect.stringMatching(/^新客户\n/), expect.stringMatching(/^老客户\n/)]);
    // 老客户：接「给老客户开项目」挑客户框
    await 选项.nth(1).click();
    await page.getByRole("dialog", { name: "给老客户开项目" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "给老客户开项目" }).waitFor({ state: "hidden" });
    // 新客户：取向导数据，弹「新增项目」向导框，不跳页
    await 钮.click();
    await 框.locator(".new-proj-opt").first().click();
    await page.locator(".wizard-stub").waitFor();
    expect(await page.locator(".wizard-stub").innerText()).toBe("新增项目");
    expect(await page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调?.map((x) => x[0]))).toEqual(["取建档数据"]);
    expect(await 去了(page)).toEqual([]);
    expect(errors).toEqual([]); await page.close();
  }
});

const 长名 = "某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购项目第二期";

it("企业版项目列表（11-01 会议 §11）：1024 宽每格一行不折，项目名省略号、悬停看全；页面不横滚。非企业版照旧折行", async () => {
  const { page, errors } = await 打开(false, 1024, false, true, { 样式: true });
  await page.getByText("列表", { exact: true }).click();
  await page.locator(".ant-table-tbody td.dl-col-name").first().waitFor();
  const 量 = await page.evaluate(() => {
    const tds = Array.from(document.querySelectorAll<HTMLElement>(".ant-table-tbody > tr.ant-table-row > td"));
    const 折了的 = tds.filter((td) => {
      if (getComputedStyle(td).whiteSpace !== "nowrap") return true;
      const w = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!n.textContent?.trim()) continue;
        const r = document.createRange(); r.selectNodeContents(n);
        const 顶 = new Set(Array.from(r.getClientRects()).filter((x) => x.width > 0).map((x) => Math.round(x.top)));
        if (顶.size > 1) return true;
      }
      return false;
    });
    return { 格: tds.length, 折了: 折了的.map((t) => t.className + " | " + t.innerText.slice(0, 20)), 横滚: document.documentElement.scrollWidth > innerWidth };
  });
  expect(量.格).toBeGreaterThan(6);
  expect(量.折了).toEqual([]);
  expect(量.横滚).toBe(false);
  const 名格 = page.locator(".ant-table-tbody td.dl-col-name").first();
  expect(await 名格.evaluate((td) => Array.from(td.querySelectorAll<HTMLElement>("*")).some((el) => el.scrollWidth > el.clientWidth + 1))).toBe(true);
  // 11-04 用户：「一行显示不下的用... 但是悬浮要做好，鼠标移上去可以看完整。」全文留在格里，截了的那层带省略号；
  // 悬停浮层是 (app) 布局里全站挂的 TruncTip（这里没挂布局），见 tests/ent-inline-phone-fit.ui.test.ts
  expect(await 名格.innerText()).toContain(`${长名}1`);
  expect(await 名格.evaluate((td) => Array.from(td.querySelectorAll<HTMLElement>("*")).filter((el) => el.scrollWidth > el.clientWidth + 1).every((el) => getComputedStyle(el).textOverflow === "ellipsis"))).toBe(true);
  expect(errors).toEqual([]); await page.close();

  const 老 = await 打开(false, 1024, false, false, { 样式: true });
  await 老.page.getByText("列表", { exact: true }).click();
  const 老名格 = 老.page.locator(".ant-table-tbody td.dl-col-name").first();
  await 老名格.waitFor();
  expect(await 老.page.locator(".dl-one-line").count()).toBe(0);
  expect(await 老名格.evaluate((td) => getComputedStyle(td).whiteSpace)).not.toBe("nowrap");
  await 老.page.close();
});

it("企业版项目看板（11-01 会议 C12）：1024 宽五列，右沿渐隐 +「→ 还有 N 列」，点了往右滑到头；滚动条常显、页面不横滚", async () => {
  const { page, errors } = await 打开(false, 1024, false, true, { 样式: true, 看板: true });
  const 提示 = page.locator(".pipe-more-right");
  await 提示.waitFor();
  const 数 = async () => Number((await 提示.innerText()).match(/还有\s*(\d+)\s*列/)?.[1] ?? 0);
  const 起 = await 数();
  expect(起).toBeGreaterThan(0);
  expect(await page.locator(".pipe-wrap.pipe-fade-right").count()).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // 滚动条常显（不是悬浮隐藏的那种）：无头 Chromium 默认 --hide-scrollbars 量不出占高，改查样式表里给 .pipe 画了有高度的滚动条和轨道
  expect(await page.evaluate(() => {
    const 规则 = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } }) as CSSStyleRule[];
    const 找 = (sel: string) => 规则.find((r) => r.selectorText === sel)?.style;
    return { 高: 找(".pipe::-webkit-scrollbar")?.height, 轨: !!找(".pipe::-webkit-scrollbar-track")?.background, 块: !!找(".pipe::-webkit-scrollbar-thumb")?.background };
  })).toEqual({ 高: "10px", 轨: true, 块: true });
  // 提示在可视区、点得中
  const box = (await 提示.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(1024);
  for (let i = 0; i < 起; i++) {
    const 前 = await page.locator(".pipe").evaluate((el) => el.scrollLeft);
    await 提示.click();
    await expect.poll(() => page.locator(".pipe").evaluate((el) => el.scrollLeft)).toBeGreaterThan(前);
    if (i < 起 - 1) await expect.poll(数).toBe(起 - i - 1);
  }
  await 提示.waitFor({ state: "detached" });
  expect(await page.locator(".pipe-wrap.pipe-fade-right").count()).toBe(0);
  // 最后一列整列露出来
  expect(await page.locator(".pipe").evaluate((el) => {
    const 末 = el.lastElementChild!.getBoundingClientRect(); return 末.right <= el.getBoundingClientRect().right + 1;
  })).toBe(true);
  expect(errors).toEqual([]); await page.close();
});

it("企业版项目看板卡片（11-12 客户详情合并第 3 批）：第一行客户名、第二行项目名，都一行省略；点卡片进客户详情停在这个项目；三种宽度不撑出", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 打开(false, w, false, true, { 样式: true, 看板: true });
    try {
      const 卡 = page.locator(".pipe-card").first();
      await 卡.waitFor();
      const 行们 = await 卡.evaluate((el) => {
        const t = el.querySelector(".pipe-card-t") as HTMLElement, o = el.querySelector(".pipe-card-m .pipe-card-o") as HTMLElement;
        const 一行 = (x: HTMLElement) => x.getBoundingClientRect().height <= parseFloat(getComputedStyle(x).lineHeight) + 1;
        const 截了 = (x: HTMLElement) => x.scrollWidth > x.clientWidth && getComputedStyle(x).textOverflow === "ellipsis";
        return { 第一: t.innerText, 第二: o.innerText, 一行: 一行(t) && 一行(o), 截了: 截了(t) && 截了(o), 卡不出列: el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().right + 1 };
      });
      expect(行们.第一, `宽 ${w}`).toMatch(/^某某超长名字.*第二期$/);
      expect(行们.第二, `宽 ${w}`).toMatch(/第二期10$/);
      expect(行们.一行 && 行们.截了 && 行们.卡不出列, `宽 ${w}`).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `宽 ${w}`).toBe(true);
      await 卡.click();
      expect(await 去了(page), `宽 ${w}`).toEqual(["/customers/c10?project=p10"]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("客户页的看板视图（11-12 第 3 批 C17 / C15）：只画看板这一块——没有项目页页头、没有「看板 / 列表」、没有离职交接；没有「新增项目」（11-12 进了客户页页头「新建 ▾」），没别的按钮时看板上面不留工具行；卡片点进客户详情", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 打开(false, w, false, true, { 样式: true, 看板: true, 客户页: true });
    try {
      expect(await page.locator(".page-head").count(), `宽 ${w}`).toBe(0);
      expect(await page.locator(".ant-segmented").count(), `宽 ${w}`).toBe(0);
      expect(await page.locator(".pipe-col").count(), `宽 ${w}`).toBe(5);
      expect(await page.getByRole("button", { name: /离职交接/ }).count(), `宽 ${w}`).toBe(0);
      expect(await page.getByRole("button", { name: /新增项目|新建项目|新建/ }).count(), `宽 ${w}`).toBe(0);
      expect(await page.locator(".cust-board-tool").count(), `宽 ${w}`).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `宽 ${w}`).toBe(true);
      await page.locator(".pipe-card").first().click();
      expect(await 去了(page), `宽 ${w}`).toEqual(["/customers/c10?project=p10"]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("客户页看板每列各自取数（11-12）：没摆全的列底才有「再看」，写清已显示几个；点了只在这一列后面接上、别的列不动、不跳转；加载中按钮禁用；没有整页翻页器", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await 打开(false, w, false, true, { 样式: true, 每列: true, 客户页: true, 查询: "?keyword=abc" });
    try {
      const 列们 = page.locator(".pipe-col");
      expect(await 列们.nth(0).locator(".pipe-card").count(), `宽 ${w}`).toBe(20);
      const 钮 = page.getByRole("button", { name: "线索：再看 5 个，已显示 20 / 25" });
      expect(await 钮.count(), `宽 ${w}`).toBe(1);
      expect(await 列们.nth(0).locator(".pipe-more-n").innerText(), `宽 ${w}`).toBe("已显示 20 / 25");
      // 摆全了的列没有「再看」；看板底下没有整页共用的翻页器、没有「这一页没有，翻页看」
      expect(await page.locator(".pipe-more").count(), `宽 ${w}`).toBe(1);
      expect(await page.locator(".ant-pagination").count(), `宽 ${w}`).toBe(0);
      expect(await page.locator("body").innerText(), `宽 ${w}`).not.toContain("翻页看");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `宽 ${w}`).toBe(true);
      // 按钮整个落在列里（列最窄 240 一行放得下）
      const 钮框 = (await 钮.boundingBox())!, 列框 = (await 列们.nth(0).boundingBox())!;
      expect(钮框.x + 钮框.width, `宽 ${w}`).toBeLessThanOrEqual(列框.x + 列框.width + 1);
      const 别的列 = await 列们.nth(1).innerText();
      await 钮.click();
      await page.waitForFunction(() => document.querySelector(".pipe-more .ant-btn")?.getAttribute("aria-busy") === "true");
      expect(await page.locator(".pipe-more .ant-btn").isDisabled(), `宽 ${w}`).toBe(true);
      await page.waitForFunction(() => document.querySelectorAll(".pipe-col")[0].querySelectorAll(".pipe-card").length === 25);
      expect(await page.locator(".pipe-more").count(), `宽 ${w}`).toBe(0);
      expect(await 列们.nth(1).innerText(), `宽 ${w}`).toBe(别的列);
      const 调 = await page.evaluate(() => (window as unknown as { __调: unknown[][] }).__调.filter((c) => c[0] === "再看一列"));
      expect(调, `宽 ${w}`).toEqual([["再看一列", "?keyword=abc", "线索", 20]]);
      expect(await 去了(page), `宽 ${w}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `宽 ${w}`).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("「再看」慢请求晚回来（审查 D1）：改了筛选、新一屏又再看了两次之后，旧回包丢掉，不盖掉新一屏已展开的卡片、按钮不误收", async () => {
  const { page, errors } = await 打开(false, 1280, false, true, { 每列: true, 客户页: true });
  try {
    const 第一列卡 = () => page.locator(".pipe-col").nth(0).locator(".pipe-card").count();
    await page.evaluate(() => { (window as unknown as { __手动: boolean }).__手动 = true; });
    const 放 = (i: number, 起: number, 个: number, 总: number) => page.evaluate(([i, 起, 个, 总]) => {
      const w = window as unknown as { __挂起: { r: (x: unknown) => void }[] };
      const 长 = "某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购项目第二期";
      w.__挂起[i].r({ ok: true, 总, 行: Array.from({ length: 个 }, (_, k) => ({ id: `p${起 + k}`, name: `${长}${起 + k}`, customerId: "c", customerName: 长, ownerId: "u0", ownerName: "王0", phase: "线索", node: "潜客培育", result: null, exceptionCategory: null, exceptionReason: null, pooled: false, amount: 1, currency: "CNY", updatedAt: new Date().toISOString() })) });
    }, [i, 起, 个, 总] as const);
    // ① 旧一屏点「再看」，回包挂着
    await page.getByRole("button", { name: "线索：再看 5 个，已显示 20 / 25" }).click();
    // ② 改了筛选：服务端给了新的一屏（第一列 45 个）
    await page.evaluate(() => (window as unknown as { __画: (a: boolean, b: boolean, c: boolean, o: object) => void }).__画(false, false, true, { 每列: true, 客户页: true, 数: 45 }));
    // 新一屏没有在加载中的按钮
    const 钮1 = page.getByRole("button", { name: "线索：再看 20 个，已显示 20 / 45" });
    await 钮1.waitFor();
    expect(await 钮1.isDisabled()).toBe(false);
    // ③ 新一屏再看两次
    await 钮1.click();
    await 放(1, 200, 20, 45);
    const 钮2 = page.getByRole("button", { name: "线索：再看 5 个，已显示 40 / 45" });
    await 钮2.waitFor();
    await 钮2.click();
    // ④ 旧一屏那一包这时才回来（老的 21–25）：丢掉
    await 放(0, 120, 5, 25);
    await page.waitForTimeout(100);
    expect(await 第一列卡()).toBe(40);
    expect(await page.locator(".pipe-col").nth(0).locator(".pipe-more-n").innerText()).toBe("已显示 40 / 45");
    expect(await page.locator(".pipe-col").nth(0).getByText(/采购项目第二期12[0-4]$/).count()).toBe(0);
    // 新一屏第二次的回包到了：接上，摆全了按钮才收
    await 放(2, 220, 5, 45);
    await page.waitForFunction(() => document.querySelectorAll(".pipe-col")[0].querySelectorAll(".pipe-card").length === 45);
    expect(await page.locator(".pipe-more").count()).toBe(0);
    const 调 = await page.evaluate(() => (window as unknown as { __调: unknown[][] }).__调.filter((c) => c[0] === "再看一列").map((c) => c[3]));
    expect(调).toEqual([20, 20, 40]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("客户页看板不取列表页（行 是空的）时，「不问归属」也看卡片（审查 D2）：卡片上有别的负责人，负责人名照显示", async () => {
  const { page, errors } = await 打开(false, 1280, false, true, { 每列: true, 客户页: true, 单人: true });
  try {
    // 候选人只有王0 一位，卡片里有 u1（已不在的成员这类）的：不能当成「全是我的」把负责人藏掉
    const t = await page.locator(".pipe-col").nth(0).innerText();
    expect(t).toContain("王101");
    expect(t).toContain("王100");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("/projects 看板也每列各自取数：「再看」走项目页的动作、带地址栏条件", async () => {
  const { page, errors } = await 打开(false, 1280, false, true, { 每列: true, 查询: "?ownerId=u1" });
  try {
    await page.getByRole("button", { name: "线索：再看 5 个，已显示 20 / 25" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".pipe-col")[0].querySelectorAll(".pipe-card").length === 25);
    const 调 = await page.evaluate(() => (window as unknown as { __调: unknown[][] }).__调.filter((c) => String(c[0]).startsWith("再看")));
    expect(调).toEqual([["再看项目页一列", "?ownerId=u1", "线索", 20]]);
    expect(await page.locator(".ant-pagination").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("客户页看板（每列）不动地址栏上客户列表的页码（审查 D3）", async () => {
  const { page, errors } = await 打开(false, 1280, false, true, { 每列: true, 客户页: true, 查询: "?page=3", 要的页: "3" });
  try {
    await page.waitForTimeout(100);
    expect(new URL(page.url()).searchParams.get("page")).toBe("3");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("客户页看板视图点「分配」临时切成项目列表：表头排序留在客户页、客户那一行筛选带着、回第一页（审查 3）", async () => {
  const { page, errors } = await 打开(false, 1280, true, true, { 看板: true, 客户页: true, phase: "线索", 查询: "?keyword=abc&phase=%E7%BA%BF%E7%B4%A2&page=3" });
  try {
    await page.locator(".cust-board-tool").getByRole("button", { name: /分配/ }).first().click();
    await page.locator("thead th", { hasText: "负责人" }).first().click();
    const 去 = await 去了(page);
    expect(去.at(-1)).toBe("/customers?keyword=abc&phase=%E7%BA%BF%E7%B4%A2&sort=owner-asc");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("市场角色客户页的「我分出去的」视图（X-107）：原项目页整页（页头叫客户、自己的看板 / 列表照留），筛选行最左一颗「客户列表 / 我分出去的」停在我分出去的；点客户列表记下并回客户页", async () => {
  const { page, errors } = await 打开(false, 1280, false, true, { 看板: true, 换回: true, 查询: "?q=x&hl=p1" });
  try {
    expect(await page.getByRole("heading").first().innerText()).toBe("客户");
    expect(await page.locator(".page-head .ant-segmented").count()).toBe(1);
    // 「客户列表 / 我分出去的」在筛选行最左（同客户页，11-12），不再单独一行；页头的新建和客户页同一颗（这里不能建客户 = 只有「新建项目」）
    expect(await page.locator(".cust-view-seg").count()).toBe(0);
    expect(await page.locator(".pipe-top > :first-child").getAttribute("class")).toBe("list-view-seg");
    expect(await page.locator(".page-head").getByRole("button", { name: /新增项目/ }).count()).toBe(0);
    expect((await page.locator(".page-head").getByRole("button", { name: /新建/ }).innerText()).trim()).toBe("新建项目");
    const 切 = page.getByRole("radiogroup", { name: "客户列表 / 我分出去的" });
    expect(await 切.locator(".ant-segmented-item-selected").innerText()).toBe("我分出去的");
    await 切.getByText("客户列表", { exact: true }).click();
    expect(await page.evaluate(() => document.cookie)).toContain("customers-view=list");
    // q / hl 只对转来那一次，切走就去掉
    expect((await 去了(page)).at(-1)).toBe("/customers");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("宽屏五列放得下的时候不出「还有 N 列」也不渐隐", async () => {
  const { page } = await 打开(false, 1920, false, true, { 样式: true, 看板: true });
  await page.locator(".pipe-col").first().waitFor();
  // 1920 下列宽封顶 360，五列加间距放得下
  expect(await page.locator(".pipe").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.locator(".pipe-more-right").count()).toBe(0);
  expect(await page.locator(".pipe-wrap.pipe-fade-right").count()).toBe(0);
  await page.close();
});

it("企业版项目页阶段筛到「线索」（11-01 会议 §5）：页头有「分配」「我分出去的」、每行能分；不显示配额字样", async () => {
  for (const w of [1024, 1366]) {
    const { page, errors } = await 打开(false, w, true, true, { phase: "线索" });
    const 分配钮 = page.getByRole("button", { name: /^send 分配$|^分配$/ });
    expect(await 分配钮.count()).toBe(1);
    expect(await page.getByRole("button", { name: /我分出去的/ }).count()).toBe(1);
    const box = (await 分配钮.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(w);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // 看板上点「分配」：切到列表、给一句怎么分
    await 分配钮.click();
    await page.getByText("勾选要分的线索", { exact: false }).waitFor();
    await page.getByRole("button", { name: `分配 ${长名}1`, exact: true }).waitFor();
    // 自动分配：提示只写分给了谁，不写配额
    await page.getByRole("button", { name: `自动分配 ${长名}1` }).click();
    await page.getByText("已分给 王1", { exact: false }).first().waitFor();
    expect(await page.locator("body").innerText()).not.toContain("配额");
    const 调 = await page.evaluate(() => (window as unknown as { __调: unknown[][] }).__调);
    expect(调.find((c) => c[0] === "自动分配线索")).toEqual(["自动分配线索", "p1", { 项目: true, 原负责人: "u1" }]);
    // 指定接手人的弹窗：不写配额
    await page.getByRole("button", { name: `分配 ${长名}1`, exact: true }).click();
    const 框 = page.getByRole("dialog");
    await 框.waitFor();
    expect(await 框.innerText()).not.toContain("配额");
    expect(await 去了(page)).toEqual([]);
    expect(errors).toEqual([]); await page.close();
  }
});

it("项目页没筛线索阶段、或不能分配的人、或非企业版：页头没有「分配」", async () => {
  for (const [能分, 企, phase] of [[true, true, ""], [true, true, "商机"], [false, true, "线索"], [true, false, "线索"]] as const) {
    const { page, errors } = await 打开(false, 1280, 能分, 企, { phase });
    expect(await page.getByRole("button", { name: /^send 分配$|^分配$/ }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /我分出去的/ }).count()).toBe(0);
    expect(errors).toEqual([]); await page.close();
  }
});

it("新线索页照旧：自动分配的提示带配额", async () => {
  const { page } = await 打开(true, 1280, true);
  await page.getByRole("button", { name: `自动分配 ${长名}1` }).click();
  await page.getByText("配额 不限", { exact: false }).first().waitFor();
  await page.close();
});

it("新线索页·单条自动分配有项目一起转（P-转-07）：先列出来，取消就不分；点「一起转」才分", async () => {
  const { page, errors } = await 打开(true, 1280, true);
  await page.evaluate(() => { (window as unknown as { __带走: unknown }).__带走 = { 项目数: 1, 项目: [{ name: "公海的项目", 客户: "甲公司", 负责人: "线索公海" }] }; });
  const 框 = page.locator(".ant-modal-confirm");
  const 调了 = (n: string) => page.evaluate((名) => ((window as unknown as { __调?: unknown[][] }).__调 ?? []).filter((x) => x[0] === 名), n);
  await page.getByRole("button", { name: `自动分配 ${长名}1` }).click();
  await 框.locator(".ant-modal-confirm-title", { hasText: "会一起转走的 1 个项目" }).waitFor();
  expect((await 调了("分配带走的项目"))[0][2]).toBeUndefined();
  await 框.locator(".ant-btn:not(.ant-btn-primary)").click();
  await 框.waitFor({ state: "detached" });
  expect(await 调了("自动分配线索")).toEqual([]);
  await page.getByRole("button", { name: `自动分配 ${长名}1` }).click();
  await 框.locator(".ant-btn-primary").click();
  await page.waitForFunction(() => ((window as unknown as { __调?: unknown[][] }).__调 ?? []).some((x) => x[0] === "自动分配线索"));
  expect(errors).toEqual([]);
  await page.close();
});

it("客户公海里的项目不给「分配」「自动分配」键；线索公海（客户不在公海）的照给", async () => {
  const { page, errors } = await 打开(true, 1280, true, true, { 公海: true });
  await page.getByRole("button", { name: /^分配 .*5$/ }).waitFor();
  expect(await page.getByRole("button", { name: /^自动分配 .*5$/ }).count()).toBe(1);
  expect(await page.getByRole("button", { name: /^分配 .*4$/ }).count()).toBe(0);
  expect(await page.getByRole("button", { name: /^自动分配 .*4$/ }).count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

it("P-公海-10：销售管理 / 总管理看客户公海里的项目有「分配」（整包），没有「自动分配」", async () => {
  const { page, errors } = await 打开(true, 1280, true, true, { 公海: true, 管公海: true });
  await page.getByRole("button", { name: /^分配 .*4$/ }).waitFor();
  expect(await page.getByRole("button", { name: /^自动分配 .*4$/ }).count()).toBe(0);
  expect(await page.getByRole("button", { name: /^自动分配 .*5$/ }).count()).toBe(1);
  expect(errors).toEqual([]);
  await page.close();
});

it("客户页看板视图给了筛选行那一格（board-slot）：「→ 还有 N 列」「分配」画进那一格，看板上面不另起一行；点得中", async () => {
  // 只剩提示（没筛线索阶段）：看板上面没有 .pipe-top、没有工具行
  const { page, errors } = await 打开(false, 1024, false, true, { 样式: true, 看板: true, 客户页: true, 工具位: true });
  try {
    const 提示 = page.locator("#slot > .pipe-more-right");
    await 提示.waitFor();
    expect(await page.locator(".pipe-top").count()).toBe(0);
    expect(await page.locator(".cust-board-tool").count()).toBe(0);
    const 前 = await page.locator(".pipe").evaluate((el) => el.scrollLeft);
    await 提示.click();
    await expect.poll(() => page.locator(".pipe").evaluate((el) => el.scrollLeft)).toBeGreaterThan(前);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  // 筛到线索阶段、能分配：「分配」「我分出去的」也在那一格；点「分配」临时切成列表，「回到看板」接着在那一格
  const 分 = await 打开(false, 1280, true, true, { 看板: true, 客户页: true, phase: "线索", 工具位: true });
  try {
    expect(await 分.page.locator(".cust-board-tool").count()).toBe(0);
    expect(await 分.page.locator("#slot").getByRole("button", { name: /我分出去的/ }).count()).toBe(1);
    await 分.page.locator("#slot").getByRole("button", { name: /分配/ }).first().click();
    await 分.page.locator("#slot").getByRole("button", { name: "回到看板" }).waitFor();
    expect(分.errors).toEqual([]);
  } finally { await 分.page.close(); }
});

it("市场角色「我分出去的」页头：能建客户 = 「新建 ▾」两项；点「新建客户」取向导数据、开「新增客户」向导框（同客户页），点「新建项目」先选新老客户", async () => {
  const { page, errors } = await 打开(false, 1280, false, true, { 看板: true, 换回: true, 能新建客户: true });
  try {
    const 钮 = page.locator(".page-head").getByRole("button", { name: /新建/ });
    expect((await 钮.innerText()).replace(/\s+/g, "")).toBe("新建");
    await 钮.click();
    expect(await page.getByRole("menuitem").allInnerTexts()).toEqual(["新建客户", "新建项目"]);
    await page.getByRole("menuitem", { name: "新建客户" }).click();
    await page.locator(".wizard-stub").waitFor();
    expect(await page.locator(".wizard-stub").innerText()).toBe("新增客户");
    expect(await page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调?.map((x) => x[0]))).toEqual(["取建档数据"]);
    await 钮.click();
    await page.getByRole("menuitem", { name: "新建项目" }).click();
    await page.getByRole("dialog", { name: "新增项目" }).waitFor();
    expect(await 去了(page)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
