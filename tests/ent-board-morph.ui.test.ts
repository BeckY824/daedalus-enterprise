/**
 * 复盘「全部待办」看板 ↔ 列表（前端改版逐块确认 ov.view「改后」）：同一批待办从卡片的位置移到行的位置，不像重新加载。
 *
 *   点「列表」：滑块立刻过去、看板不变灰；地址换 lay=list（数据照旧由服务端按 lay 给，一次只取一种）
 *   新样子到了：对得上的行从原来那张卡的位置滑过来（有 transform 动画），对不上的淡入；反过来一样
 *   减弱动态：直接换，没有位移动画
 *   「看全部 N 条」那种同时换卡的不算变形，照旧
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-board-morph", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "const 记=(u)=>{(window.__去||(window.__去=[])).push(u)};export const useRouter=()=>({push:记,refresh(){},replace:记,prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/customers\/\[id\]\/actions$/, "export const toggleTask=async()=>({ok:true}),completePlan=async()=>({ok:true});");
  stub(/projects\/actions$/, "export const 记项目沟通Action=async()=>({ok:true});");
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import BoardTodos from '@/app/(app)/overview/BoardTodos';
    import {BusinessProvider} from '@/lib/business-client';
    import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 组们=['逾期','今天','本周'];
    const 行=(i)=>({key:'task:'+i, kind:'task', id:String(i), 时间:'2026-10-2'+i+'T09:00:00.000Z', 明确钟点:true,
      内容:'第'+i+'条回访', customerId:'c'+i, customerName:'华东展具'+i, projectName:null, ownerId:'u1', ownerName:'张敏', 组:组们[i%3], 去:'/projects/p'+i});
    const 计数={overdue:2,today:2,week:2,all:6};
    // 看板每列两条；列表一页 7 条：前 6 条和看板同一批，第 7 条看板上没有
    const 看板={计数, 列:{overdue:{总数:2,行:[行(0),行(3)]}, today:{总数:2,行:[行(1),行(4)]}, later:{总数:2,行:[行(2),行(5)]}}};
    const 数={计数, 总数:7, 页:1, 行:[0,1,2,3,4,5,6].map(行)};
    let root;
    window.__画=(lay)=>{
      root ||= createRoot(document.getElementById('root'));
      root.render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
        <BoardTodos 数={lay==='list'?数:undefined} 看板={lay==='board'?看板:undefined} 布局={lay} 卡="all" 只看自己={false} 看全员={true}/>
      </BusinessProvider></App>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(lay: "board" | "list", 减弱 = false, width = 1280): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 减弱 ? "reduce" : "no-preference" }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/overview");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (l: string) => void }).__画(x), lay);
  await page.locator(".btodo-cards").waitFor();
  return { page, errors };
}
const 画 = (page: Page, lay: string) => page.evaluate((x) => (window as unknown as { __画: (l: string) => void }).__画(x), lay);
const 去了 = (page: Page) => page.evaluate(() => (window as unknown as { __去?: string[] }).__去 ?? []);
/** 每一件（卡 / 行）上正在跑的动画：有没有位移、有没有淡入 */
const 动画们 = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-morph-key], tr[data-row-key]")].map((el) => {
  const ks = el.getAnimations().flatMap((a) => (a.effect as KeyframeEffect).getKeyframes());
  return { k: el.dataset.morphKey ?? el.dataset.rowKey, 移: ks.some((f) => typeof f.transform === "string" && f.transform.startsWith("translate")), 淡: ks.some((f) => f.opacity === "0") };
}));

it("看板 → 列表：滑块先到、看板不变灰；新样子到了同一批从卡的位置滑到行，看板上没有的淡入", async () => {
  const { page, errors } = await 打开("board");
  await page.getByText("列表", { exact: true }).click();
  expect(await 去了(page)).toEqual(["/overview?lay=list"]);
  // 等数据那一会儿：滑块已经在「列表」上，看板不变灰
  expect(await page.getByRole("radio", { name: "列表" }).isChecked()).toBe(true);
  expect(await page.locator(".btodo-board").evaluate((e) => e.classList.contains("is-pending"))).toBe(false);
  await 画(page, "list");
  await page.locator("tr[data-row-key='task:6']").waitFor();
  const 动 = await 动画们(page);
  expect(动.filter((x) => x.k !== "task:6").every((x) => x.移)).toBe(true);
  expect(动.find((x) => x.k === "task:6")).toMatchObject({ 移: false, 淡: true });
  // 放完就停在新位置
  await expect.poll(() => page.evaluate(() => document.getAnimations().length), { timeout: 3000 }).toBe(0);
  expect(await page.locator("tr[data-row-key]").count()).toBe(7);
  expect(errors).toEqual([]);
  await page.close();
});

it("列表 → 看板：一样从行的位置滑到卡；1024 宽不横向溢出", async () => {
  const { page, errors } = await 打开("list", false, 1024);
  await page.getByText("看板", { exact: true }).click();
  expect(await 去了(page)).toEqual(["/overview"]);
  await 画(page, "board");
  await page.locator("[data-morph-key='task:5']").waitFor();
  const 动 = await 动画们(page);
  expect(动).toHaveLength(6);
  expect(动.every((x) => x.移)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.close();
});

it("减弱动态：直接换，没有位移", async () => {
  const { page, errors } = await 打开("board", true);
  await page.getByText("列表", { exact: true }).click();
  await 画(page, "list");
  await page.locator("tr[data-row-key='task:6']").waitFor();
  expect((await 动画们(page)).some((x) => x.移)).toBe(false);
  expect(errors).toEqual([]);
  await page.close();
});

it("服务端自己换了样子（没点切换）不变形；再点切换照样变", async () => {
  const { page, errors } = await 打开("board");
  await 画(page, "list");
  await page.locator("tr[data-row-key='task:6']").waitFor();
  expect((await 动画们(page)).some((x) => x.移)).toBe(false);
  await page.getByText("看板", { exact: true }).click();
  await 画(page, "board");
  await page.locator("[data-morph-key='task:0']").waitFor();
  expect((await 动画们(page)).every((x) => x.移)).toBe(true);
  expect(errors).toEqual([]);
  await page.close();
});
