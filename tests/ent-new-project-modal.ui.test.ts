import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* 11-01 会议 §6：客户页「新开项目」整套在弹窗里走完——建好不跳去项目页，留在客户页；原型 cr.submit：建好键里转圈→对勾「已建好」→框收起、落到新项目（?project=…&landed=1，新项目卡亮 2 秒），不弹顶部提示 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "new-project-modal-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷新=(window.__刷新??0)+1},push(u){(window.__跳=window.__跳??[]).push(u)},replace(u){(window.__跳=window.__跳??[]).push(u)}});export const usePathname=()=>\"/customers/a\";");
  stub(/^next\/link$/, "export default function L({href,children,...p}){return <a href={href} {...p}>{children}</a>}");
  stub(/(^|\/)project-actions$/, "export const 给客户建项目=async(x)=>{window.__建={...x};return window.__回??{ok:true,projectId:'np1'}};export const 新项目分配数据=async()=>({分配方式们:[{i:0,名:'指定分配'},{i:1,名:'自动分配'}],默认分配方式:window.__默认分配??0,是销售:!!window.__销售,客户业务线:'内贸'});export const 建项目带走的项目=async(...a)=>{(window.__预览=window.__预览??[]).push(a);if(window.__预览失败)throw new Error('断网');return window.__带走??{项目数:0,项目:[]}};");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import NewProjectModal from '@/app/(app)/customers/[id]/NewProjectModal';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    function 页(){
      const [开,set开]=React.useState(true);
      return <><div data-testid="还在客户页">客户页</div><NewProjectModal open={开} onClose={()=>set开(false)} customerId="a" customerName="测试客户甲" 默认负责人="u1" users={[{id:'u1',name:'同事甲',email:'a@x.test'}]} 联系人们={[]} 节点们={['初次接触','需求确认']} 要下一步={false}/></>;
    }
    root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><页/></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

it("11-01 §6 + cr.submit：新开项目在弹窗里填完，建好键里给对勾，框收起后落到客户页上的新项目（不跳项目页、不弹顶部提示）", async () => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 800 } }); page.setDefaultTimeout(5000);
  try {
    await page.route("http://npm.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
    await page.goto("http://npm.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
    const 框 = page.getByRole("dialog");
    await 框.getByText("新增项目").waitFor();
    await 框.getByRole("button", { name: "下一步" }).click();
    await 框.locator("textarea").fill("第一次电话，聊了需求");
    // 11-05：不再问客户明确回复了吗；下一步计划没开超时回收时选填，填了随这一次交
    expect(await 框.getByText("明确回复了", { exact: true }).count()).toBe(0);
    await 框.getByLabel("下一步计划").fill("发报价单");
    await 框.getByRole("button", { name: /建\s*好/ }).click();
    await 框.getByRole("button", { name: "已建好" }).waitFor();
    expect(await page.locator(".ant-message-notice").count()).toBe(0);
    await expect.poll(() => page.getByRole("dialog").count(), { timeout: 5000 }).toBe(0);
    const 记 = await page.evaluate(() => { const w = window as unknown as { __跳?: string[]; __刷新?: number; __建?: { customerId: string; 项目?: { 分配方式?: number; 业务线?: string } } }; return { 跳: w.__跳 ?? [], 刷新: w.__刷新 ?? 0, 客户: w.__建?.customerId, 建: w.__建 }; });
    expect(记.客户).toBe("a");
    // 分配方式、业务线（A1）默认带上：业务线默认 = 客户的业务线
    expect(JSON.stringify(记.建)).toContain('"分配方式":0');
    expect(JSON.stringify(记.建)).toContain('"业务线":"内贸"');
    expect(JSON.stringify(记.建)).toContain('"下一步":"发报价单"');
    expect(JSON.stringify(记.建)).not.toContain("明确回复");
    // 落到客户页上的新项目（换地址栏查询串 = 页面重新取数，ProjectZone 认 landed 让新项目卡亮 2 秒）；不是项目页
    expect(记.跳).toEqual(["/customers/a?project=np1&landed=1"]);
    expect(await page.getByTestId("new-project-done").count()).toBe(0);
    expect(await page.getByTestId("还在客户页").count()).toBe(1);
  } finally { await page.close(); }
});

it("X-18：客户转给销售后我看不到这位客户了：不刷新（会 404）、不落到新项目；去向就地写在框里，点「回客户列表」才走", async () => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 800 } }); page.setDefaultTimeout(5000);
  try {
    await page.route("http://npm.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
    await page.goto("http://npm.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
    await page.evaluate(() => { (window as unknown as { __回: unknown }).__回 = { ok: true, projectId: "np2", 提示: "已指派给 销售甲", 转走: true, 看不到客户了: true }; });
    await page.addScriptTag({ content: bundle });
    const 框 = page.getByRole("dialog");
    await 框.getByText("新增项目").waitFor();
    await 框.getByRole("button", { name: "下一步" }).click();
    await 框.locator("textarea").fill("第一次电话");
    await 框.getByRole("button", { name: /建\s*好/ }).click();
    const 话 = 框.getByTestId("new-project-done");
    await 话.waitFor();
    expect(await 话.getAttribute("role")).toBe("status");
    expect(await 话.innerText()).toContain("已指派给 销售甲");
    expect(await page.locator(".ant-message-notice").count()).toBe(0);
    // 读完再走：还没跳、没刷新
    let 记 = await page.evaluate(() => { const w = window as unknown as { __跳?: string[]; __刷新?: number }; return { 跳: w.__跳 ?? [], 刷新: w.__刷新 ?? 0 }; });
    expect(记).toEqual({ 跳: [], 刷新: 0 });
    await 框.getByRole("button", { name: "回客户列表" }).click();
    记 = await page.evaluate(() => { const w = window as unknown as { __跳?: string[]; __刷新?: number }; return { 跳: w.__跳 ?? [], 刷新: w.__刷新 ?? 0 }; });
    expect(记.跳).toEqual(["/customers"]);
    expect(记.刷新).toBe(0);
    await expect.poll(() => page.getByRole("dialog").count(), { timeout: 5000 }).toBe(0);
  } finally { await page.close(); }
});

it("按分配方式进了待分配（没转走）：去向用橙字写在框里，点「知道了」才落到新项目", async () => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 800 } }); page.setDefaultTimeout(5000);
  try {
    await page.route("http://npm.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
    await page.goto("http://npm.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
    await page.evaluate(() => { (window as unknown as { __回: unknown }).__回 = { ok: true, projectId: "np3", 提示: "没有可分的销售，项目在待分配" }; });
    await page.addScriptTag({ content: bundle });
    const 框 = page.getByRole("dialog");
    await 框.getByText("新增项目").waitFor();
    await 框.getByRole("button", { name: "下一步" }).click();
    await 框.locator("textarea").fill("第一次电话");
    await 框.getByRole("button", { name: /建\s*好/ }).click();
    const 话 = 框.getByTestId("new-project-done");
    await 话.waitFor();
    expect(await 话.getAttribute("class")).toContain("cu-said-warn");
    await 框.getByRole("button", { name: "知道了" }).click();
    const 跳 = await page.evaluate(() => (window as unknown as { __跳?: string[] }).__跳 ?? []);
    expect(跳).toEqual(["/customers/a?project=np3&landed=1"]);
  } finally { await page.close(); }
});

it("cr.auto：销售选自动分配——就地黄条写后果、键写「建好并分出去」，不再叠一层确认框", async () => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 800 } }); page.setDefaultTimeout(5000);
  try {
    await page.route("http://npm.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
    await page.goto("http://npm.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
    await page.evaluate(() => { const w = window as unknown as { __销售: boolean; __默认分配: number }; w.__销售 = true; w.__默认分配 = 1; });
    await page.addScriptTag({ content: bundle });
    const 框 = page.getByRole("dialog");
    await 框.getByText("新增项目").waitFor();
    await 框.getByTestId("new-project-auto-warn").waitFor();
    expect(await 框.getByTestId("new-project-auto-warn").innerText()).toContain("分出去后你将看不到这个项目");
    await 框.getByRole("button", { name: "下一步" }).click();
    await 框.locator("textarea").fill("第一次电话");
    await 框.getByRole("button", { name: "建好并分出去" }).click();
    await 框.getByRole("button", { name: "已建好" }).waitFor();
    expect(await page.getByRole("dialog").count()).toBe(1);
    expect(await page.evaluate(() => JSON.stringify((window as unknown as { __建?: unknown }).__建))).toContain('"分配方式":1');
  } finally { await page.close(); }
});

/* P-转-07：客户页指定 / 自动分配走 X-18 时，一起转的项目（含同事在推的，只给个数），和分配弹窗一样先列出来 */
const 带走一个 = { 项目数: 2, 项目: [{ name: "市场的老项目", 客户: "测试客户甲" }], 同事: { 项目数: 1 } };
type 窗 = { __建?: unknown; __预览?: unknown[][]; __带走?: unknown; __预览失败?: boolean };
async function 填到建好(设: (w: 窗, 带走: unknown) => void) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 800 } }); page.setDefaultTimeout(5000);
  await page.route("http://npm.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://npm.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.evaluate(`(${设.toString()})(window, ${JSON.stringify(带走一个)})`);
  await page.addScriptTag({ content: bundle });
  const 框 = page.getByRole("dialog", { name: "新增项目" });
  await 框.getByText("新增项目").waitFor();
  await 框.getByRole("button", { name: "下一步" }).click();
  await 框.locator("textarea").fill("第一次电话");
  const 点建好 = () => 框.getByRole("button", { name: /建\s*好/ }).click();
  return { page, 框, 点建好 };
}
const 确认标题 = "会一起转走的 2 个项目";

it("P-转-07：有项目一起转时先列出来，同事在推的只给个数；取消不建、弹窗还在、键上说为什么没建、可再点；一起转才建", async () => {
  const { page, 框, 点建好 } = await 填到建好((w, 带走) => { w.__带走 = 带走; });
  try {
    await 点建好();
    const 问 = page.getByRole("dialog").filter({ hasText: "会一起转走" });
    await 问.getByText(确认标题).first().waitFor();
    expect(await 问.innerText()).toContain("另外有 1 个同事在推的项目，负责人也一起改成新负责人");
    expect(await page.evaluate(() => (window as unknown as 窗).__建 ?? null)).toBeNull();
    await 问.getByRole("button", { name: /^取\s?消$/ }).click();
    await 问.waitFor({ state: "hidden" });
    expect(await page.evaluate(() => (window as unknown as 窗).__建 ?? null)).toBeNull();
    // 没建的原因浮在建好键上方（SaveButton），不弹顶部提示；停一会儿键回原样
    await page.getByText("没建：一起转的项目还没确认").first().waitFor();
    await 框.getByRole("button", { name: /建\s*好/ }).waitFor({ timeout: 8000 });
    expect(await 框.getByRole("button", { name: /建\s*好/ }).isEnabled()).toBe(true);
    await 点建好();
    await 问.getByText(确认标题).first().waitFor();
    await 问.getByRole("button", { name: "一起转" }).click();
    await 框.getByRole("button", { name: "已建好" }).waitFor();
    expect(await page.evaluate(() => JSON.stringify((window as unknown as 窗).__建))).toContain('"分配方式":0');
  } finally { await page.close(); }
});

it("P-转-07：没有要转的不弹，直接建；问的时候带上这次的分配方式、负责人、业务线", async () => {
  const { page, 点建好 } = await 填到建好(() => {});
  try {
    await 点建好();
    await page.getByRole("button", { name: "已建好" }).waitFor();
    expect(await page.getByRole("dialog").filter({ hasText: "会一起转走" }).count()).toBe(0);
    const 预览 = await page.evaluate(() => (window as unknown as 窗).__预览 ?? []);
    expect(预览).toHaveLength(1);
    expect(预览[0][0]).toBe("a");
    expect(预览[0][1]).toMatchObject({ 分配方式: 0, ownerId: "u1", 业务线: "内贸" });
  } finally { await page.close(); }
});

it("P-转-07：取预览失败不拦着建（断网时服务端照常查）", async () => {
  const { page, 点建好 } = await 填到建好((w) => { w.__预览失败 = true; });
  try {
    await 点建好();
    await page.getByRole("button", { name: "已建好" }).waitFor();
    expect(await page.getByRole("dialog").filter({ hasText: "会一起转走" }).count()).toBe(0);
  } finally { await page.close(); }
});
