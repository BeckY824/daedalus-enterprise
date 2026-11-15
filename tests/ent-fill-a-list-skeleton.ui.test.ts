/**
 * 列表取数中先出骨架行（原型 cu.filter「先出骨架再换内容」，DataList 加载中）：客户、公海、项目（和线索）都传 加载中={pending}，在 DataList 一处做。
 * 渠道页的筛选是本地筛（行全在手上），没有取数这一步，不出骨架。
 *
 *   取数中：表头不动、行数不动、行高不动（撑在取数前那一屏的行高），每一格换成一条灰条（PR2 Skeleton），不整表转圈；读屏念一次「正在加载」
 *   分页和总数不动；骨架行点不动
 *   取完：骨架消失，换成新的行
 *   上一屏 0 行：摆三行占位
 *   减弱动态：灰条不扫光
 *   1024 宽：不横滚
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-fill-a-list-skeleton", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(p){window.__去=p},refresh(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import MotionTheme from '@/components/MotionTheme';
    import DataList from '@/components/DataList';
    const 造=(前,n)=>Array.from({length:n},(_,i)=>({id:前+i,name:前+'客户'+i,owner:'王一'}));
    function 页(){
      const [s,set]=useState({行:造('甲',8),总数:42,载:false,页:1});
      window.__取=()=>set(x=>({...x,载:true}));
      window.__到=(前,n,总数)=>set(x=>({...x,行:造(前,n),总数,载:false}));
      return <div style={{padding:24}}><DataList 页="skel-test" 列={[
          {title:'名称',key:'name',常驻:true,width:400,render:(_,r)=><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{width:36,height:36,borderRadius:18,background:'#ddd',display:'inline-block'}}/>{r.name}</div>},
          {title:'负责人',key:'owner',width:200,render:(_,r)=>r.owner},
          {title:'备注',key:'note',width:300,render:()=>'—'},
        ]} 行={s.行} 空库={false} 空态={{title:'空'}} 加载中={s.载} 批量={()=>null}
        行链接={(r)=>'/customers/'+r.id}
        分页={{当前页:s.页,每页:20,总数:s.总数,翻页:(p)=>{set(x=>({...x,页:p,载:true}))}}}/></div>;
    }
    createRoot(document.getElementById('root')).render(<MotionTheme><App><页/></App></MotionTheme>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(宽 = 1280, 少动 = false): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 宽, height: 800 }, reducedMotion: 少动 ? "reduce" : "no-preference" });
  const page = await ctx.newPage(); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://skel.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://skel.test/customers");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.getByText("甲客户0").waitFor();
  return { page, errors };
}
const 调 = (page: Page, 名: string, ...参: unknown[]) => page.evaluate(([n, a]) => (window as unknown as Record<string, (...x: unknown[]) => void>)[n as string](...(a as unknown[])), [名, 参] as const);
const 量 = (page: Page) => page.evaluate(() => {
  const 行们 = [...document.querySelectorAll("tbody tr")].filter((r) => r.getAttribute("aria-hidden") !== "true" && (r as HTMLElement).offsetHeight > 2);
  const 表头 = document.querySelector("thead")!.getBoundingClientRect();
  return { 行数: 行们.length, 行高: 行们.map((r) => Math.round((r as HTMLElement).getBoundingClientRect().height)), 表头: [Math.round(表头.top), Math.round(表头.height)].join(",") };
});

it("取数中：表头、行数、行高都不动，每一格换成灰条，不整表转圈；分页总数不动；读屏念一次「正在加载」；取完换成新行", async () => {
  const { page, errors } = await 打开();
  const 前 = await 量(page);
  expect(前.行数).toBe(8);
  await 调(page, "__取");
  await page.getByRole("status").filter({ hasText: "正在加载" }).waitFor();
  expect(await page.getByText("甲客户0").count(), "原来的字换成了灰条").toBe(0);
  expect(await 量(page)).toEqual(前);
  // 灰条：每一行至少一条（PR2 Skeleton 的条），读屏不念它们
  expect(await page.locator("tbody .skel-bar").count()).toBeGreaterThanOrEqual(8 * 3);
  expect(await page.getByRole("status").count()).toBe(1);
  // 没有整表转圈：表格没被盖上一层半透明
  expect(await page.locator("tbody").evaluate((b) => getComputedStyle(b.closest("table")!).opacity)).toBe("1");
  expect(await page.getByText("共 42 条").isVisible()).toBe(true);
  // 骨架行点不动
  await page.locator("tbody tr").nth(2).click({ force: true });
  expect(await page.evaluate(() => (window as unknown as { __去?: string }).__去)).toBeUndefined();
  await 调(page, "__到", "乙", 5, 5);
  await page.getByText("乙客户0").waitFor();
  expect(await page.locator("tbody .skel-bar").count()).toBe(0);
  expect(await page.getByRole("status").filter({ hasText: "正在加载" }).count()).toBe(0);
  expect((await 量(page)).行数).toBe(5);
  expect(errors).toEqual([]);
  await page.context().close();
});

it("翻页时也先出骨架；上一屏 0 行时摆三行占位、不说「没有符合条件的」", async () => {
  const { page, errors } = await 打开();
  await page.getByRole("listitem", { name: "2" }).click();
  await page.getByRole("status").filter({ hasText: "正在加载" }).waitFor();
  expect(await page.locator("tbody .skel-bar").count()).toBeGreaterThan(0);
  await 调(page, "__到", "丙", 0, 0);
  await page.getByText("没有符合条件的", { exact: false }).waitFor();
  await 调(page, "__取");
  await page.getByRole("status").filter({ hasText: "正在加载" }).waitFor();
  expect((await 量(page)).行数).toBe(3);
  expect(await page.getByText("没有符合条件的", { exact: false }).count()).toBe(0);
  expect(errors).toEqual([]);
  await page.context().close();
});

it("灰条平时扫光；减弱动态下不扫", async () => {
  const 平时 = await 打开();
  await 调(平时.page, "__取");
  await 平时.page.getByRole("status").filter({ hasText: "正在加载" }).waitFor();
  expect(await 平时.page.locator("tbody .skel-bar").first().evaluate((e) => getComputedStyle(e).animationName)).toBe("skel-sweep");
  await 平时.page.context().close();
  const 少 = await 打开(1280, true);
  await 调(少.page, "__取");
  await 少.page.getByRole("status").filter({ hasText: "正在加载" }).waitFor();
  expect(await 少.page.locator("tbody .skel-bar").first().evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
  expect(少.errors).toEqual([]);
  await 少.page.context().close();
});

it("1024 宽：取数中不横滚，行高照样不动", async () => {
  const { page, errors } = await 打开(1024);
  const 前 = await 量(page);
  await 调(page, "__取");
  await page.getByRole("status").filter({ hasText: "正在加载" }).waitFor();
  expect(await 量(page)).toEqual(前);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
  await page.context().close();
});
