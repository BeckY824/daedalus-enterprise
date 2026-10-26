/**
 * 企业版只用项目时「数据」页的界面（10-26 用户：「「数据」页改成按项目统计」）。
 *
 *   现在：副标题「项目现状与复盘」，卡片 新线索 / 商机 / 订单 / 异常状态，节点图，按负责人表；只有一个人时不摆表
 *   本月：新建 / 转商机 / 成功交付 / 没成，走势图，按负责人表；外币另外说一句
 *   开关关：副标题照旧「业务现状与签约复盘」
 *   Windows 1024 / 1280 / 1366 宽度 + 超长名字：页面不横向溢出
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-data-by-project", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import DataShell from '@/app/(app)/overview/DataShell';
    import {ProjectNowView, ProjectPeriodView} from '@/app/(app)/overview/ProjectStatsView';
    import {阶段们, 节点们} from '@/lib/project/nodes';
    import {BusinessProvider} from '@/lib/business-client';
    import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域销售总监';
    const 现在={
      阶段:[{phase:'线索',count:12,amount:0},{phase:'商机',count:8,amount:98765432},{phase:'订单',count:3,amount:12345678}],
      节点:阶段们.flatMap(p=>节点们[p].map((node,i)=>({phase:p,node,count:i+1,amount:1000000*i}))),
      结局:[{result:'线索流失',count:2},{result:'丢单',count:1},{result:'成功交付',count:5},{result:'异常状态',count:1}],
      公海:2,外币:1,
      按人:[1,2,3].map(i=>({id:'u'+i,name:长+i,线索:4,商机:3,订单:1,商机金额:98765432,订单金额:12345678})),
    };
    const 一段={
      合计:{新建:6,转商机:4,转订单:2,成功交付:3,交付金额:23456789,线索流失:1,丢单:1,异常状态:0},
      trend:Array.from({length:26},(_,i)=>({label:'10-'+String(i+1).padStart(2,'0'),新建:i%3,转商机:i%2,转订单:i%4===0?1:0,成功交付:i%5===0?1:0})),
      按人:[1,2].map(i=>({id:'u'+i,name:长+i,新建:3,转商机:2,转订单:1,成功交付:1,交付金额:23456789,没成:1})),
      外币:0,
    };
    window.__画=(view,项目,单人)=>createRoot(document.getElementById('root')).render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:项目}}>
      <DataShell view={view} 项目={项目}>
        {!项目?<div>老的</div>:view==='现在'?<ProjectNowView 数={现在} 本位币="CNY" 单人={单人}/>:<ProjectPeriodView 数={一段} 本位币="CNY" 口径="2026 年 10 月" 单人={单人}/>}
      </DataShell>
    </BusinessProvider></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(view: string, 项目 = true, width = 1280, 单人 = false): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/overview"); await page.addScriptTag({ content: bundle });
  await page.evaluate(([v, p, s]) => (window as unknown as { __画: (v: string, p: boolean, s: boolean) => void }).__画(v, p, s), [view, 项目, 单人] as const);
  await page.getByRole("heading").first().waitFor();
  return { page, errors };
}

it("现在：项目的卡片、节点图、按负责人表，外币另说一句", async () => {
  const { page, errors } = await 打开("现在");
  const t = await page.locator("body").innerText();
  expect(t).toContain("项目现状与复盘");
  for (const s of ["新线索", "商机", "订单", "异常状态", "各节点的项目", "按负责人", "公海里还有 2 个进行中的", "另有 1 个进行中的项目不是 CNY"]) expect(t).toContain(s);
  expect(t).toContain("成功交付 5");
  expect(await page.locator("canvas").count()).toBeGreaterThan(0);
  expect(await page.locator('a[href="/leads?ownerId=u1"]').count()).toBe(1);
  expect(await page.locator('a[href="/projects?ownerId=u1"]').count()).toBe(1);
  expect(errors).toEqual([]); await page.close();
});

it("本月：新建 / 转商机 / 成功交付 / 没成，走势图，按负责人表", async () => {
  const { page, errors } = await 打开("本月");
  const t = await page.locator("body").innerText();
  for (const s of ["新建项目", "转商机", "成功交付", "没成", "项目走势", "按负责人", "线索流失 1 · 丢单 1"]) expect(t).toContain(s);
  expect(t).not.toContain("不是 CNY");
  expect(await page.locator("canvas").count()).toBe(1);
  expect(errors).toEqual([]); await page.close();
});

it("只有一个人：不摆按负责人表", async () => {
  for (const v of ["现在", "本月"]) {
    const { page } = await 打开(v, true, 1280, true);
    expect(await page.locator("body").innerText()).not.toContain("按负责人");
    await page.close();
  }
});

it("开关关：副标题照旧", async () => {
  const { page, errors } = await 打开("现在", false);
  const t = await page.locator("body").innerText();
  expect(t).toContain("业务现状与签约复盘");
  expect(t).not.toContain("项目现状与复盘");
  expect(errors).toEqual([]); await page.close();
});

it.each([1024, 1280, 1366])("Windows %ipx + 超长名字：两个视图都不横向溢出", async (w) => {
  for (const v of ["现在", "本月"]) {
    const { page } = await 打开(v, true, w);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // 卡片的数字都在可视区里、没被盖住
    const 卡 = page.locator(".ant-col").first();
    const box = await 卡.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(w);
    await page.close();
  }
});
