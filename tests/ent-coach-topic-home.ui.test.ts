/**
 * 教练主题的另外两处入口（11-17，销售教练角色 PR3b）：
 *   - 首页待办「待回复主题 N 条 · 最早 …」：没有不画；点了去最早那条的项目
 *   - 复盘「沟通」页签头上「沟通 | 主题」：切到主题带 tv=topic、丢掉沟通那几个筛选；主题一档有「我发起的 / 待我回复 / 全部」和状态筛选，待我回复时状态锁「待回复」
 *   - Windows 1024 / 1280 / 1366：超长主题、项目名、人名不横向撑出，切换钮点得中
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "coach-topic-home-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__去=u},replace(u){window.__换=u}});export const useSearchParams=()=>new URLSearchParams(window.__sp??'');export const usePathname=()=>'/overview';");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/demo-data$/, "const f=async()=>({});export const 查演示数据状态=f,灌一套演示数据=f,清除演示数据=f;");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import CoachTopicTodo from '@/app/(app)/dashboard/CoachTopicTodo';
    import BoardTopics,{TalkKindSwitch} from '@/app/(app)/overview/BoardTopics';
    const root=createRoot(document.getElementById('root'));
    const 长='很长'.repeat(40)+'X'.repeat(120);
    const 行=(id,状态)=>({id,时间:'2026-11-17T02:00:00.000Z',projectId:'p'+id,项目:'项目'+长,节点:'线索验证',状态,标题:'主题'+长,发起人:'教练'+'Y'.repeat(60),身份:'销售教练',回复数:2});
    window.__render=(what,x)=>root.render(<App><div style={{maxWidth:'min(1100px, calc(100vw - 32px))',margin:'0 auto'}} className="card-like">{
      what==='todo'?<CoachTopicTodo 数据={x}/>:
      what==='switch'?<TalkKindSwitch 当前="talk"/>:
      <BoardTopics 数={{总数:3,页:1,行:[行('1','待回复'),行('2','已回复'),行('3','已关闭')]}} 范围={x?.范围??'all'} 状态={x?.状态??''}/>
    }</div></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(what: "todo" | "switch" | "list", x: unknown = null, width = 1366, sp = "") {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://home.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://home.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([w, d, s]) => { (window as unknown as { __sp: string }).__sp = s as string; (window as unknown as { __render: (a: unknown, b: unknown) => void }).__render(w, d); }, [what, x, sp] as const);
  return { page, errors };
}
const 没撑出 = (page: Page) => page.evaluate(() => {
  const 坏: string[] = [];
  if (document.documentElement.scrollWidth > window.innerWidth) 坏.push(`页面 ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
  for (const el of document.querySelectorAll<HTMLElement>(".home-cth-todo, .btodo-head, .rtopic-k, .card-like")) {
    if (el.scrollWidth > el.clientWidth + 1) 坏.push(`${el.className} ${el.scrollWidth} > ${el.clientWidth}`);
  }
  return 坏;
});
const 点得中 = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
});

it("首页待办：没有不画；有就写条数、最早一条，链到那个项目", async () => {
  const 空 = await open("todo", { 条数: 0, 最早: null });
  expect(await 空.page.getByTestId("home-coach-topics").count()).toBe(0);
  await 空.page.close();
  const { page, errors } = await open("todo", { 条数: 2, 最早: { at: "2026-11-16T06:02:00.000Z", projectId: "p 1", title: "先问清预算" } });
  const 条 = page.getByTestId("home-coach-topics");
  expect(await 条.textContent()).toMatch(/^待回复主题 2 条最早 .* · 先问清预算去回复 ›$/);
  expect(await 条.getByRole("link").getAttribute("href")).toBe("/projects/p%201");
  expect(errors).toEqual([]);
  await page.close();
});

it("复盘「沟通 | 主题」：切到主题带 tv=topic，沟通那几个筛选和页码丢掉", async () => {
  const { page } = await open("switch", null, 1366, "tab=talk&t=7&m=PHONE&p=3&ownerId=u1");
  await page.getByTestId("talk-kind").getByText("主题").click();
  expect(await page.evaluate(() => (window as unknown as { __换: string }).__换)).toBe("/overview?tab=talk&ownerId=u1&tv=topic");
  await page.close();
});

it("主题一档：三条按给的顺序列，带状态、回复数、发起人；点一条去项目；待我回复时状态锁「待回复」", async () => {
  const { page, errors } = await open("list", { 范围: "all", 状态: "" }, 1366, "tab=talk&tv=topic");
  const 条们 = page.getByTestId("review-topic");
  expect(await 条们.count()).toBe(3);
  expect(await 条们.nth(0).textContent()).toMatch(/待回复回复 2教练Y+（销售教练）$/);
  await 条们.nth(1).click();
  expect(await page.evaluate(() => (window as unknown as { __去: string }).__去)).toBe("/projects/p2");
  await page.getByLabel("谁的主题").getByText("待我回复").click();
  expect(await page.evaluate(() => (window as unknown as { __换: string }).__换)).toBe("/overview?tab=talk&tv=topic&tw=wait");
  expect(errors).toEqual([]);
  await page.close();
  const 锁 = await open("list", { 范围: "wait", 状态: "" }, 1366, "tab=talk&tv=topic&tw=wait");
  const 状态框 = 锁.page.locator(".ant-select").filter({ has: 锁.page.getByLabel("主题状态") });
  expect(await 状态框.getAttribute("class")).toContain("ant-select-disabled");
  expect(await 状态框.textContent()).toContain("待回复");
  await 锁.page.close();
});

for (const w of [1024, 1280, 1366]) {
  it(`Windows ${w}：首页待办、主题列表不横向撑出；切换钮点得中`, async () => {
    const a = await open("todo", { 条数: 12, 最早: { at: "2026-11-16T06:02:00.000Z", projectId: "p1", title: "主题" + "很长".repeat(40) } }, w);
    expect(await 没撑出(a.page)).toEqual([]);
    expect(await 点得中(a.page, ".home-cth-todo-a")).toBe(true);
    await a.page.close();
    const b = await open("list", { 范围: "all", 状态: "" }, w, "tab=talk&tv=topic");
    expect(await 没撑出(b.page)).toEqual([]);
    expect(await 点得中(b.page, "[data-testid=talk-kind] .ant-segmented-item:first-child")).toBe(true);
    await b.page.close();
  });
}
