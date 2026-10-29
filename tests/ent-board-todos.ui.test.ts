/**
 * 企业版复盘页「待办」页签的界面（P15，10-29 用户定：复盘页改成「待办 | 数据」两个页签）。
 *
 *   四张指标卡：逾期 / 今天到期 / 本周到期 / 全部待办，显示条数；逾期不是 0 才红；卡就是筛选，选中的那张 aria-pressed、点了换地址 f=
 *   列表上方右侧：待办类型分段（全部 / 任务 / 跟进计划）+「去计划页」
 *   列：勾、到期、类型、内容、客户（带项目名）、负责人、状态；多于 20 条才有分页、点第 2 页换地址 p=2
 *   空：「没有待办」
 *   Windows 1024 / 1280 / 1366 + 超长客户名：页面不横向溢出；手机 375：四张卡 2×2
 *   减弱动态：页签下划线、内容淡入淡出都不走过渡
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-board-todos", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "const 记=(u)=>{(window.__去||(window.__去=[])).push(u)};export const useRouter=()=>({push:记,refresh(){},replace:记});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/customers\/\[id\]\/actions$/, "export const toggleTask=async()=>({ok:true}),completePlan=async()=>({ok:true});");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import DataShell from '@/app/(app)/overview/DataShell';
    import BoardTodos from '@/app/(app)/overview/BoardTodos';
    import {BusinessProvider} from '@/lib/business-client';
    import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域销售中心';
    const 组们=['逾期','逾期','今天','本周','以后'];
    const 行=(n)=>Array.from({length:n},(_,i)=>({
      key:(i%2?'plan:':'task:')+i, kind:i%2?'plan':'task', id:String(i), 时间:i===n-1?null:'2026-10-'+String(20+(i%9)).padStart(2,'0')+'T09:00:00.000Z', 明确钟点:true,
      内容:'第'+i+'条：'+长+'的方案回访和报价确认', customerId:'c'+i, customerName:长+i, projectName:i%3?'华东二期产线改造项目'+长:null,
      ownerId:'u1', ownerName:'很长很长的负责人名字', 组:组们[i%5], 去:'/projects/p'+i,
    }));
    window.__画=(o)=>{
      const n=o.行数??8;
      const 数={计数:o.计数??{overdue:3,today:2,week:1,all:45}, 总数:o.总数??n, 页:o.页??1, 行:行(n)};
      createRoot(document.getElementById('root')).render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
        <DataShell view="现在" 项目 页签="todo" 选人={{选项:[{value:'u1',label:长}],当前:''}}>
          <BoardTodos 数={数} 卡={o.卡??'all'} 类型={o.类型??'all'} 只看自己={false} 看全员={true}/>
        </DataShell>
      </BusinessProvider></App>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(o: Record<string, unknown> = {}, width = 1280, 地址 = "/overview", 减弱 = false): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 减弱 ? "reduce" : "no-preference" }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto(`http://ent.test${地址}`);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (o: unknown) => void }).__画(x), o);
  await page.locator(".btodo-cards").waitFor();
  return { page, errors };
}
const 去了 = (page: Page) => page.evaluate(() => (window as unknown as { __去?: string[] }).__去 ?? []);

it("四张卡 + 类型分段 + 去计划页 + 列；逾期有数是红的；页签在、待办选中", async () => {
  const { page, errors } = await 打开();
  expect(await page.getByRole("tab").allInnerTexts()).toEqual(["待办", "数据"]);
  expect(await page.getByRole("tab", { name: "待办" }).getAttribute("aria-selected")).toBe("true");
  // 人员选择器在页签上面
  const 人 = await page.locator(".data-shell-who").boundingBox();
  const 签 = await page.locator(".data-shell-tabs").boundingBox();
  expect(人!.y).toBeLessThan(签!.y);
  const 卡 = page.locator(".btodo-card");
  expect(await 卡.locator(".home-card-k").allInnerTexts()).toEqual(["逾期", "今天到期", "本周到期", "全部待办"]);
  expect(await 卡.locator(".home-card-v").allInnerTexts()).toEqual(["3", "2", "1", "45"]);
  expect(await 卡.nth(0).getAttribute("class")).toContain("home-card-warn");
  expect(await 卡.nth(3).getAttribute("aria-pressed")).toBe("true");
  expect(await 卡.nth(0).getAttribute("aria-pressed")).toBe("false");
  expect(await page.locator(".btodo-head .ant-segmented-item").allInnerTexts()).toEqual(["全部", "任务", "跟进计划"]);
  expect(await page.getByRole("link", { name: "去计划页" }).getAttribute("href")).toBe("/follow-ups/plans?scope=all");
  expect(await page.locator(".btodo thead th").allInnerTexts()).toEqual(["", "到期", "类型", "内容", "客户", "负责人", "状态"]);
  const t = await page.locator(".btodo tbody").innerText();
  for (const s of ["跟进计划", "任务", "华东二期产线改造项目", "没定日期", "逾期", "今天", "之后"]) expect(t).toContain(s);
  // 8 条一页放得下，不摆分页
  expect(await page.locator(".ant-pagination").count()).toBe(0);
  expect(errors).toEqual([]); await page.close();
});

it("逾期是 0：不红", async () => {
  const { page } = await 打开({ 计数: { overdue: 0, today: 2, week: 1, all: 3 } });
  expect(await page.locator(".btodo-card").nth(0).getAttribute("class")).not.toContain("home-card-warn");
  await page.close();
});

it("点卡换 f=、点类型换 kind=，都回到第一页；选中的卡再点不动", async () => {
  const { page } = await 打开({ 卡: "week" }, 1280, "/overview?ownerId=u1&f=week&p=2");
  expect(await page.locator(".btodo-card").nth(2).getAttribute("aria-pressed")).toBe("true");
  expect(await page.locator(".btodo-head .section-title").innerText()).toBe("本周到期");
  await page.locator(".btodo-card").nth(2).click();
  expect(await 去了(page)).toEqual([]);
  await page.locator(".btodo-card").nth(0).click();
  await page.locator(".btodo-head .ant-segmented-item", { hasText: "跟进计划" }).click();
  expect(await 去了(page)).toEqual(["/overview?ownerId=u1&f=overdue", "/overview?ownerId=u1&f=week&kind=plan"]);
  await page.close();
});

it("多于 20 条：分页，点第 2 页换 p=2", async () => {
  const { page } = await 打开({ 行数: 20, 总数: 45 });
  expect(await page.locator(".ant-pagination").innerText()).toContain("共 45 条");
  await page.locator(".ant-pagination-item-2").click();
  expect(await 去了(page)).toEqual(["/overview?p=2"]);
  await page.close();
});

it("空：没有待办", async () => {
  const { page } = await 打开({ 行数: 0, 计数: { overdue: 0, today: 0, week: 0, all: 0 } });
  expect(await page.locator(".btodo").innerText()).toContain("没有待办");
  await page.close();
});

it.each([1024, 1280, 1366])("Windows %ipx + 超长客户名、项目名：页面不横向溢出，卡一行四张", async (w) => {
  const { page } = await 打开({ 行数: 20, 总数: 45 }, w);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const ys = await page.locator(".btodo-card").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(ys).size).toBe(1);
  // 客户那一格是截断的、不撑开
  const 格 = page.locator(".btodo tbody tr.btodo-row td").nth(4);
  const box = await 格.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(w);
  await page.close();
});

it("手机 375：四张卡 2×2，页面不横向溢出", async () => {
  const { page } = await 打开({}, 375);
  await page.waitForTimeout(200);
  const r = await page.locator(".btodo-card").evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top)]; }));
  expect(r[0][1]).toBe(r[1][1]);
  expect(r[2][1]).toBeGreaterThan(r[0][1]);
  expect(r[2][0]).toBe(r[0][0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.close();
});

it("减弱动态：页签下划线和内容区都不走过渡；卡悬停不抬起", async () => {
  const { page } = await 打开({}, 1280, "/overview", true);
  const 时长 = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).transitionProperty + "|" + getComputedStyle(e).transitionDuration);
  expect(await 时长(".data-shell-tabs .ant-tabs-ink-bar")).toMatch(/^(none|all)\|0s$/);
  expect(await 时长(".data-shell-body")).toMatch(/^(none|all)\|0s$/);
  await page.locator(".btodo-card").nth(1).hover();
  expect(await page.locator(".btodo-card").nth(1).evaluate((e) => getComputedStyle(e).transform)).toBe("none");
  await page.close();
});
