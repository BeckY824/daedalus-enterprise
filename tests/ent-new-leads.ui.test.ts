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
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/actions$/, "export const 回项目邀请=async()=>({ok:true}),市场复核Action=async()=>({ok:true}),总管理终判Action=async()=>({ok:true});");
  // 分配那几个 server action：记下调了什么，回成功
  stub(/assign-actions$/, "const 记=(n)=>async(...a)=>{(window.__调||=[]).push([n,...a]);return n==='本月分配情况'?{月:'2026-10',人:[]}:n==='我分出去的线索'?[]:n==='批量自动分配'?{ok:true,结果:[]}:{ok:true,toUserId:'u1',接手人:'王1',已分:1,配额:null,为什么:'按顺序'}};export const 分配线索=记('分配线索'),自动分配线索=记('自动分配线索'),批量自动分配=记('批量自动分配'),本月分配情况=记('本月分配情况'),我分出去的线索=记('我分出去的线索'),关满额提醒=记('关满额提醒');");
  // 卡点面板（我的卡点看板）的 server action：这几条测试不点卡点，回成功就行
  stub(/blocker-actions$/, "const 好=async()=>({ok:true});export const 发布卡点Action=好,指认卡点Action=好,认领卡点Action=好,接受卡点Action=好,转让卡点Action=好,返回卡点Action=好,改卡点进度Action=好,解决卡点Action=好,卡点可选的人Action=async()=>[];");
  // 「给老客户开项目」挑客户、建项目那几个 server action：这几条测试不点，空着就行
  stub(/customers\/\[id\]\/pick$/, "export const 搜客户=async()=>[],取客户选项=async()=>[],取客户近况=async()=>null;");
  stub(/project-actions$/, "export const 给客户建项目=async()=>({ok:true});");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import Projects from '@/app/(app)/projects/ProjectsView';
    import {BusinessProvider} from '@/lib/business-client';
    import {DEFAULT_BUSINESS} from '@/lib/business-config';
    window.__去=[];
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购项目第二期';
    const row=(i,node)=>({id:'p'+i,name:长+i,customerId:'c'+i,customerName:长,ownerId:'u'+(i%2),ownerName:'王'+i,phase:'线索',node,result:null,exceptionCategory:null,exceptionReason:null,pooled:false,amount:1234567,currency:'CNY',updatedAt:new Date().toISOString()});
    const 行=[row(1,'潜客培育'),row(2,'线索验证'),{...row(3,'线索推进'),result:'线索流失'}];
    window.__画=(阶段,能分)=>createRoot(document.getElementById('root')).render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <Projects 行={行} 列={[]} 取到上限={false} users={[{id:'u0',name:'王0',email:'a'},{id:'u1',name:'王1',email:'b'}]} filters={{keyword:'',ownerId:'',pool:''}} 阶段={阶段?'线索':undefined} 线索分配开着={!!能分} 能自动分配={!!能分}/>
    </BusinessProvider></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(新线索: boolean, width = 1280, 能分 = false): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto(`http://ent.test/${新线索 ? "leads" : "projects"}`); await page.addScriptTag({ content: bundle });
  await page.evaluate(([v, f]) => (window as unknown as { __画: (v: boolean, f: boolean) => void }).__画(v, f), [新线索, 能分]);
  await page.getByRole("heading").first().waitFor();
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
  expect(调.find((c) => c[0] === "自动分配线索")).toEqual(["自动分配线索", "p1", { 项目: true }]);
  expect(await 去了(page)).toEqual([]); // 点按钮不触发行跳转
  expect(errors).toEqual([]); await page.close();
  const 不能 = await 打开(true);
  expect(await 不能.page.getByRole("button", { name: `分配 ${长}1`, exact: true }).count()).toBe(0);
  await 不能.page.close();
});
