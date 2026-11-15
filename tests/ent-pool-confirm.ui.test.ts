/**
 * 公海页确认与反馈（11-15 PR6，原型 pool.*；规则 P-界面-40 / 41 / 43 / 44）：
 *   P-界面-40 公海那几项「不确认不生效」：单个领取（原地确认）、批量领取（选择条原地确认）、标无效（后果框）、批量分配（选人 → 后果框）——
 *     只点到确认前、或点了取消，server action 一次都不调
 *   P-界面-41：领取确认写名额 / 收回 / 不能领回；号码不全并进确认（不另弹框）；确认连点只领一次
 *   P-界面-43：「分配给同事」写全，页面上没有「…」；单个分配走选人框（可搜、↑↓ 回车）
 *   P-界面-44：回收站行上直接「恢复」，一步完成、底部撤销条
 *   权限被挡（server 回 ok:false）：原因就地写出来，不出撤销条、不说成功
 *   Windows 1024 / 1280 / 1366 + 超长名字：确认展开后按钮在屏里、点得到，后果在格子里折行，页面不横向撑出
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
type W = { __调: Record<string, unknown[][]>; __挡?: boolean; __render: (o?: { 持有?: { 有: number; 上限: number } | null }) => void };

beforeAll(async () => {
  const plugin: Plugin = { name: "pool-confirm-boundaries", setup(b) {
    const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
    // 每个 action 记下调了什么；window.__挡 = true 时回「没权限」
    const 记 = (名: string, 成: string, 挡: string) => `async(...a)=>{const w=window;(w.__调[${JSON.stringify(名)}]=w.__调[${JSON.stringify(名)}]||[]).push(a);await new Promise(r=>setTimeout(r,60));return w.__挡?${挡}:${成}}`;
    const 公海成 = "{ok:true,updated:a[0].length,unchanged:0,原负责人:a[0].map(id=>({id,值:''})),项目:{领到:a[2]||[],没领到:[]},给谁:{id:'u1',name:'同事'}}";
    stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
    stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
    stub(/customers\/pool-actions$/, `export const 领取=${记("领取", 公海成, "{ok:false,error:'只有销售、销售管理、总管理能领'}")},分配公海=${记("分配公海", 公海成, "{ok:false,error:'只有总管理和销售管理能分配'}")},撤销公海=async()=>({ok:true,updated:1});`);
    stub(/\/projects\/actions$/, "export const 领取项目=async()=>({ok:true,updated:0});");
    stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
    stub(/^\.\/actions$/, `export const 标无效客户=${记("标无效", "{ok:true,updated:1,unchanged:0}", "{ok:false,error:'只有总管理和销售管理能标无效客户'}")},恢复有效客户=${记("恢复", "{ok:true,updated:1,unchanged:0}", "{ok:false,error:'只有系统管理员或回收站副手能恢复无效客户'}")},分配公海项目=${记("分配公海项目", "{ok:true,分到:a[0],没分到:[],给谁:{id:'u1',name:'同事'}}", "{ok:false,error:'没权限'}")},撤销公海项目=async()=>({ok:true,updated:1});`);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
  } };
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import Pool from '@/app/(app)/pool/PoolView';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import {快捷们} from '@/lib/enterprise/unified-pool';
    const 快捷数=Object.fromEntries(快捷们.map(k=>[k,9]));
    const 时=new Date().toISOString();
    const 客=(id,名,o={})=>({id,种:'客户',customerId:id,projectId:null,客户名:名,项目名:null,进程:null,属性:'客户池',最后跟进:null,入池时间:时,创建时间:时,类:'主动退回',累计:1,进程明细:null,入池原因:'—',快捷:'首次退回',原负责人是我:false,...o});
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域销售服务中心';
    const 行=[客('c1',长),客('c2','蓝湾科技',{号码不全:true}),客('c3','Sahara Games',{类:'无效',快捷:'无效客户'})];
    const users=[{id:'u1',name:'李想',email:'a'},{id:'u2',name:'周宁',email:'b'},{id:'u3',name:'一位名字特别特别长的同事欧阳某某某',email:'c'}];
    window.__调={};
    let root;
    window.__render=(o={})=>{ root=root||createRoot(document.getElementById('root')); root.render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <div style={{display:'flex'}}><nav style={{width:220,flex:'none'}}/><main style={{flex:1,minWidth:0,padding:24}}>
        <Pool 行={行} 总数={3} 当前页={1} pageSize={20} 快捷数={快捷数} 属性数={{全部:3,线索池:0,商机池:0,订单池:0,客户池:3}} 截断={false} 库里有 filters={{keyword:'',attr:'',quick:'',sort:''}} 渠道筛选项={[]} 能标无效 能恢复 能分配 users={users} 持有={o.持有??null} 三态开/>
      </main></div></BusinessProvider></App>); };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width = 1366, o: { 挡?: boolean } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://route.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://route.test/pool"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate((挡) => { const w = window as unknown as W; w.__挡 = 挡; w.__render(); }, !!o.挡);
  await page.locator("tr[data-row-key='c1']").waitFor();
  return { page, errors };
}
const 调 = (page: Page, 名: string) => page.evaluate((n) => ((window as unknown as W).__调[n] ?? []).length, 名);
const 行 = (page: Page, id: string) => page.locator(`tr[data-row-key='${id}']`);
const 撤销条 = (page: Page) => page.locator(".undo-bar");

it("单个领取：先原地确认、写清后果；取消不调；确认连点只领一次，之后底部撤销条", async () => {
  const { page, errors } = await open();
  try {
    await page.evaluate(() => (window as unknown as W).__render({ 持有: { 有: 3, 上限: 10 } }));
    const r = 行(page, "c1");
    await r.getByRole("button", { name: /^领取/ }).click();
    const 确认 = r.getByRole("button", { name: "确认领取" });
    await 确认.waitFor();
    const 后果 = await r.locator(".pool-why").innerText();
    expect(后果).toContain("收回公海");
    expect(后果).toContain("不能再领回");
    expect(await 调(page, "领取")).toBe(0);
    // 取消 → 回到「领取」，什么都没做
    await r.getByRole("button", { name: "取消" }).click();
    await r.getByRole("button", { name: /^领取/ }).waitFor();
    expect(await r.locator(".pool-why").count()).toBe(0);
    expect(await 调(page, "领取")).toBe(0);
    // 再来：确认连点三下只领一次
    await r.getByRole("button", { name: /^领取/ }).click();
    await 确认.click(); await 确认.click({ force: true }).catch(() => {}); await 确认.click({ force: true }).catch(() => {});
    await expect.poll(() => 撤销条(page).count()).toBe(1);
    expect(await 调(page, "领取")).toBe(1);
    expect(await 撤销条(page).innerText()).toContain("已领取");
    // 不再弹 antd 顶部提示
    expect(await page.locator(".ant-message-notice").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("号码不全并进领取确认（不另弹框）", async () => {
  const { page } = await open();
  try {
    const r = 行(page, "c2");
    await r.getByRole("button", { name: /^领取/ }).click();
    await r.getByRole("button", { name: "确认领取" }).waitFor();
    expect(await r.locator(".pool-why").innerText()).toContain("号码不全，领到后记得补全");
    expect(await page.getByRole("dialog").count()).toBe(0);
  } finally { await page.close(); }
});

it("批量领取：选择条原地变确认；不点确认 / 点取消都不领，确认后才领", async () => {
  const { page } = await open();
  try {
    await 行(page, "c1").locator(".ant-checkbox-input").check();
    await 行(page, "c2").locator(".ant-checkbox-input").check();
    const 条 = page.locator(".list-sel");
    await 条.getByRole("button", { name: /^领\s*取$/ }).click();
    const 问 = 条.getByRole("group", { name: "确认批量领取" });
    await 问.waitFor();
    expect(await 问.innerText()).toContain("领取 2 个");
    expect(await 问.innerText()).toContain("不能再领回");
    expect(await 调(page, "领取")).toBe(0);
    await 问.getByRole("button", { name: /取\s*消/ }).click();
    await 条.getByRole("button", { name: /^领\s*取$/ }).waitFor();
    expect(await 调(page, "领取")).toBe(0);
    await 条.getByRole("button", { name: /^领\s*取$/ }).click();
    await 条.getByRole("button", { name: /确认领取/ }).click();
    await expect.poll(() => 调(page, "领取")).toBe(1);
    await expect.poll(() => 撤销条(page).count()).toBe(1);
  } finally { await page.close(); }
});

it("标成无效：后果框分条写，取消不标；确认才标", async () => {
  const { page } = await open();
  try {
    await 行(page, "c1").getByRole("button", { name: /更多操作/ }).click();
    const 菜单 = page.locator(".ant-dropdown-menu");
    await 菜单.waitFor();
    // P-界面-43：写全，不用「…」
    expect(await 菜单.innerText()).toContain("分配给同事");
    expect(await 菜单.innerText()).not.toMatch(/…|\.\.\./);
    await page.getByRole("menuitem", { name: "标成无效客户" }).click();
    const 框 = page.getByRole("dialog");
    await 框.waitFor();
    expect(await 框.innerText()).toContain("谁都领不了");
    expect(await 框.innerText()).toContain("系统管理员、回收站副手");
    await 框.getByRole("button", { name: /取\s*消/ }).click();
    await expect.poll(() => page.getByRole("dialog").count()).toBe(0);
    expect(await 调(page, "标无效")).toBe(0);
    await 行(page, "c1").getByRole("button", { name: /更多操作/ }).click();
    await page.getByRole("menuitem", { name: "标成无效客户" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "标成无效" }).click();
    await expect.poll(() => 调(page, "标无效")).toBe(1);
  } finally { await page.close(); }
});

it("批量分配：选人框选好人后进后果框，取消不分；单个分配选人框可搜、回车即分、给撤销条", async () => {
  const { page } = await open();
  try {
    await 行(page, "c1").locator(".ant-checkbox-input").check();
    await 行(page, "c2").locator(".ant-checkbox-input").check();
    const 条 = page.locator(".list-sel");
    expect(await 条.innerText()).not.toMatch(/…/);
    await 条.getByRole("button", { name: "分配给同事" }).click();
    await page.getByRole("option", { name: /周宁/ }).click();
    await page.getByRole("button", { name: /下一步：分给 周宁/ }).click();
    const 框 = page.getByRole("dialog").filter({ hasText: "把 2 个分配给 周宁" });
    await 框.waitFor();
    expect(await 框.innerText()).toContain("号码不全");
    expect(await 调(page, "分配公海")).toBe(0);
    await 框.getByRole("button", { name: /取\s*消/ }).click();
    await expect.poll(() => page.getByRole("dialog").filter({ hasText: "把 2 个分配给" }).count()).toBe(0);
    expect(await 调(page, "分配公海")).toBe(0);
    // 单个：搜 + 回车即分（P-界面-40「选人框里写后果」一类：框里写了后果，点人就是确认）
    await 行(page, "c1").getByRole("button", { name: /更多操作/ }).click();
    await page.getByRole("menuitem", { name: "分配给同事" }).click();
    const 搜 = page.getByLabel("搜同事名字");
    await 搜.waitFor();
    expect(await page.locator(".pool-pick-eff").innerText()).toContain("会收到通知");
    await 搜.fill("周");
    await 搜.press("Enter");
    await expect.poll(() => 调(page, "分配公海")).toBe(1);
    await expect.poll(() => 撤销条(page).count()).toBe(1);
    expect(await 撤销条(page).innerText()).toContain("分给 同事");
  } finally { await page.close(); }
});

it("回收站：行上直接「恢复」（P-界面-44），一步完成、给撤销条；无效行没有「⋯」", async () => {
  const { page } = await open();
  try {
    const r = 行(page, "c3");
    expect(await r.getByRole("button", { name: /更多操作/ }).count()).toBe(0);
    expect(await r.getByRole("button", { name: /^领取/ }).count()).toBe(0);
    await r.getByRole("button", { name: /恢\s*复/ }).click();
    await expect.poll(() => 调(page, "恢复")).toBe(1);
    await expect.poll(() => 撤销条(page).count()).toBe(1);
    expect(await 撤销条(page).innerText()).toContain("已恢复");
  } finally { await page.close(); }
});

it("权限被挡：领取 / 批量领取 / 标无效 / 分配 / 恢复都不提示成功，原因就地写出来", async () => {
  const { page, errors } = await open(1366, { 挡: true });
  try {
    // 单个领取
    const r = 行(page, "c1");
    await r.getByRole("button", { name: /^领取/ }).click();
    await r.getByRole("button", { name: "确认领取" }).click();
    await expect.poll(() => r.locator(".pool-row-err").count()).toBe(1);
    expect(await r.locator(".pool-row-err").innerText()).toContain("只有销售");
    // 批量领取
    await 行(page, "c2").locator(".ant-checkbox-input").check();
    const 条 = page.locator(".list-sel");
    await 条.getByRole("button", { name: /^领\s*取$/ }).click();
    await 条.getByRole("button", { name: /确认领取/ }).click();
    await expect.poll(() => 条.locator(".pool-err").count()).toBe(1);
    await 条.getByRole("group", { name: "确认批量领取" }).getByRole("button", { name: /^取\s*消$/ }).click();
    // 标无效：框不关，原因在框里
    await 行(page, "c1").getByRole("button", { name: /更多操作/ }).click();
    await page.getByRole("menuitem", { name: "标成无效客户" }).click();
    const 框 = page.getByRole("dialog");
    await 框.getByRole("button", { name: "标成无效" }).click();
    await expect.poll(() => 框.innerText()).toContain("只有总管理和销售管理能标无效客户");
    await 框.getByRole("button", { name: /取\s*消/ }).click();
    await expect.poll(() => page.getByRole("dialog").count()).toBe(0);
    // 单个分配：框不关，原因在框里
    await 行(page, "c1").getByRole("button", { name: /更多操作/ }).click();
    await page.getByRole("menuitem", { name: "分配给同事" }).click();
    await page.getByLabel("搜同事名字").press("Enter");
    await expect.poll(() => page.locator(".pool-pick-eff").innerText()).toContain("只有总管理和销售管理能分配");
    await page.getByRole("dialog").getByRole("button", { name: /取\s*消/ }).click();
    // 恢复：按钮里写没恢复上
    await 行(page, "c3").getByRole("button", { name: /恢\s*复/ }).click();
    await expect.poll(() => 行(page, "c3").innerText()).toContain("没恢复上");
    // 全程没有撤销条、没有「已领取 / 已恢复 / 已把」
    expect(await 撤销条(page).count()).toBe(0);
    expect(await page.locator("body").innerText()).not.toMatch(/已领取|已恢复|已把|已分给/);
    expect(await page.locator(".ant-message-notice").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx + 超长名字：领取确认展开后按钮在屏里点得到，后果不撑破，页面不横向撑出", async (w) => {
  const { page, errors } = await open(w);
  try {
    await page.evaluate(() => (window as unknown as W).__render({ 持有: { 有: 9, 上限: 10 } }));
    const r = 行(page, "c1");
    await r.getByRole("button", { name: /^领取/ }).click();
    await r.getByRole("button", { name: "确认领取" }).waitFor();
    const 量 = await page.evaluate(() => {
      const tr = document.querySelector("tr[data-row-key='c1']")!;
      const 键们 = [...tr.querySelectorAll(".inlc-ask button")].map((b) => {
        const x = b.getBoundingClientRect();
        const 顶 = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2);
        return { 在屏: x.left >= 0 && x.right <= window.innerWidth, 点得到: !!顶 && b.contains(顶) };
      });
      const 格 = tr.querySelector(".pool-why")!.closest("td")!;
      const 后 = tr.querySelector(".pool-why")!;
      return { 键们, 后果在格里: 后.getBoundingClientRect().right <= 格.getBoundingClientRect().right + 1 && 后.scrollWidth <= 后.clientWidth + 1, 页宽: document.documentElement.scrollWidth <= window.innerWidth };
    });
    expect(量.键们).toEqual([{ 在屏: true, 点得到: true }, { 在屏: true, 点得到: true }]);
    expect(量.后果在格里).toBe(true);
    expect(量.页宽).toBe(true);
    // 选人框：超长同事名折行不撑破
    await r.getByRole("button", { name: /取\s*消/ }).click();
    await r.getByRole("button", { name: /更多操作/ }).click();
    await page.getByRole("menuitem", { name: "分配给同事" }).click();
    const 人 = page.getByRole("option", { name: /欧阳/ });
    await 人.waitFor();
    expect(await 人.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
