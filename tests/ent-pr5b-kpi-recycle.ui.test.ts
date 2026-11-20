/**
 * PR5b home.kpi / ov.recycle：
 *   首页数字卡：点了原地展开（不跳页），展开里「看这 N 个项目 ›」带这张卡的筛选；再点 / 收起 / Esc 收回；同一时刻一张
 *   复盘回收提醒：点节点一条原地展开快到期的项目（还剩几天），「记一条沟通」原地长出小表单；
 *     被挡（ok:false）：保存键里写原因，不提示成功、表单还在；成了：调了 记项目沟通Action（带项目、阶段、下一步时间）
 *   1024 宽 + 超长项目名：不横滚
 *   沟通方式按个人习惯默认（11-18）：有习惯就选好它；习惯晚到、人先改过的不盖
 * 认元素用 role / 文字；.ant-message 只用来断言「没有」。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { 北京日期 } from "./helpers/beijing-date";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "pr5b-kpi-recycle", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p} onClick={(e)=>{e.preventDefault();(window.__去||(window.__去=[])).push(href)}}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(u){(window.__去||(window.__去=[])).push(u)},refresh(){},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可用:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/customers\/\[id\]\/actions$/, 补全动作桩("src/app/(app)/customers/[id]/actions.ts", "export const toggleTask=async()=>({ok:true}),completePlan=async()=>({ok:true}),沟通可选项目=async()=>({ok:true,项目们:null,能建项目:true});"));
  stub(/projects\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "export const 记项目沟通Action=async(id,v)=>{(window.__调||(window.__调=[])).push({id,...v});return window.__挡?{ok:false,error:window.__挡}:(window.__回??{ok:true})};"));
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>{if(window.__习惯慢)await new Promise(r=>setTimeout(r,window.__习惯慢));return window.__习惯??null};", "async()=>null"));
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
const 长 = "某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域销售中心二期产线改造项目";
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import BoardTodos from '@/app/(app)/overview/BoardTodos';
    import HomeCards from '@/app/(app)/dashboard/HomeCards';
    import {BusinessProvider} from '@/lib/business-client';
    import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 长=${JSON.stringify(长)};
    const 回收={开:true,总数:3,条:[{阶段:'线索',节点:'潜客培育',天数:7,数:3},{阶段:'商机',节点:'方案制定',天数:30,数:0}]};
    const 日表=${JSON.stringify({ 1: 北京日期(1), 3: 北京日期(3) })};const 日=(n)=>日表[n];
    const 项目=[{id:'p1',名:长,节点:'潜客培育',负责人:'甲',回收日:日(1),阶段:'线索'},{id:'p2',名:'乙项目',节点:'潜客培育',负责人:'乙',回收日:日(3),阶段:'线索'}];
    window.__画=(o)=>{
      createRoot(document.getElementById('root')).render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
        {o==='home'?<div style={{width:320}}><HomeCards 数={{'month-new':12,key:3,'no-follow':480,'due-soon':5}}/></div>
          :<BoardTodos 数={{计数:{overdue:0,today:0,week:0,all:0},总数:0,页:1,行:[]}} 卡="all" 布局="list" 回收={回收} 回收项目={项目} 只看自己={false} 看全员={true}/>}
      </BusinessProvider></App>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(o: string, width = 1024, 挡: string | null = null): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/overview");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.evaluate((x) => { (window as unknown as { __挡: string | null }).__挡 = x; }, 挡);
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (o: string) => void }).__画(x), o);
  return page;
}
const 去了 = (page: Page) => page.evaluate(() => (window as unknown as { __去?: string[] }).__去 ?? []);
const 调了 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: Record<string, unknown>[] }).__调 ?? []);
const 横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

it("home.kpi：点卡原地展开、不跳页；展开里的链接带筛选；再点收起；同一时刻一张；Esc 收", async () => {
  const page = await 打开("home");
  const 卡 = page.getByRole("button", { name: /暂未跟进 480 个/ });
  await 卡.click();
  expect(await 卡.getAttribute("aria-expanded")).toBe("true");
  expect(await 去了(page)).toEqual([]);
  expect(await page.getByRole("link", { name: "看这 480 个项目 ›" }).getAttribute("href")).toBe("/projects?f=no-follow");
  await page.getByRole("button", { name: /本月新增 12 个/ }).click();
  expect(await page.locator(".home-kpi-card.is-open").count()).toBe(1);
  expect(await page.getByRole("link", { name: "看这 12 个项目 ›" }).count()).toBe(1);
  await page.getByRole("button", { name: "收起", exact: true }).click();
  expect(await page.locator(".home-kpi-card.is-open").count()).toBe(0);
  await 卡.click(); await page.keyboard.press("Escape");
  expect(await page.locator(".home-kpi-card.is-open").count()).toBe(0);
  expect(await 去了(page)).toEqual([]);
  await page.close();
});

it("ov.recycle：点节点原地展开快到期的项目，数为 0 的点不开；记沟通被挡不提示成功、表单还在", async () => {
  const page = await 打开("todos", 1024, "这个项目已经回公海了");
  const 条 = page.getByRole("button", { name: /潜客培育 · 7 天没跟进收回/ });
  await 条.click();
  const 单 = page.getByRole("list", { name: "潜客培育 快到期的项目" });
  await 单.waitFor();
  expect(await 单.getByText("乙项目").count()).toBe(1);
  expect(await 单.getByText("还剩 3 天").count()).toBe(1);
  expect(await 单.getByRole("link", { name: /还有 1 个/ }).count()).toBe(1);
  expect(await page.getByRole("button", { name: /方案制定/ }).isDisabled()).toBe(true);
  // 没点「记下」之前不调
  await 单.getByRole("button", { name: "记一条沟通" }).first().click();
  expect(await 调了(page)).toEqual([]);
  await page.getByRole("textbox", { name: /沟通了什么/ }).fill("电话确认了方案时间");
  await page.getByRole("textbox", { name: "下一步计划" }).fill("周五发报价");
  await page.getByRole("button", { name: /^记\s*下$/ }).click();
  await page.getByText("这个项目已经回公海了").first().waitFor();
  expect(await page.getByText("已保存").count()).toBe(0);
  expect(await page.locator(".ant-message-notice").count()).toBe(0);
  expect(await page.getByRole("textbox", { name: /沟通了什么/ }).inputValue()).toBe("电话确认了方案时间");
  const 交 = await 调了(page);
  expect(交.length).toBe(1);
  expect(交[0]).toMatchObject({ id: "p1", 阶段: "线索", 下一步: "周五发报价", content: "电话确认了方案时间" });
  expect(typeof 交[0].下一步时间).toBe("string");
  expect(await 去了(page)).toEqual([]);
  expect(await 横滚(page)).toBeLessThanOrEqual(0);
  await page.close();
});

it("ov.recycle：记成了，表单收起；超长项目名 1024 宽单行省略不横滚", async () => {
  const page = await 打开("todos", 1024);
  await page.getByRole("button", { name: /潜客培育 · 7 天没跟进收回/ }).click();
  const 名 = page.getByRole("link", { name: 长 });
  const 溢 = await 名.evaluate((e) => ({ s: getComputedStyle(e).textOverflow, r: e.getBoundingClientRect().right, p: e.closest(".ov-rc-prow")!.getBoundingClientRect().right }));
  expect(溢.s).toBe("ellipsis"); expect(溢.r).toBeLessThanOrEqual(溢.p + 1);
  await page.getByRole("button", { name: "记一条沟通" }).first().click();
  await page.getByRole("textbox", { name: /沟通了什么/ }).fill("聊了");
  await page.getByRole("textbox", { name: "下一步计划" }).fill("下周回访");
  expect(await 横滚(page)).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: /^记\s*下$/ }).click();
  await expect.poll(async () => page.getByRole("textbox", { name: /沟通了什么/ }).count(), { timeout: 6000 }).toBe(0);
  expect((await 调了(page)).length).toBe(1);
  await page.close();
});

const 设习惯 = (page: Page, 习惯: { type: string; method: string | null } | null, 慢 = 0) =>
  page.evaluate(([x, m]) => { const w = window as unknown as { __习惯: unknown; __习惯慢: number }; w.__习惯 = x; w.__习惯慢 = m as number; }, [习惯, 慢] as const);

it("ov.recycle：沟通方式按个人习惯默认（11-18），交上去带着它", async () => {
  const page = await 打开("todos", 1024);
  await 设习惯(page, { type: "WECHAT", method: "微信沟通" });
  await page.getByRole("button", { name: /潜客培育 · 7 天没跟进收回/ }).click();
  await page.getByRole("button", { name: "记一条沟通" }).first().click();
  const 方式 = page.locator(".ov-rc-form .ant-select").first();
  await expect.poll(() => 方式.innerText()).toContain("微信沟通");
  await page.getByRole("textbox", { name: /沟通了什么/ }).fill("微信上聊了");
  await page.getByRole("textbox", { name: "下一步计划" }).fill("下周回访");
  await page.getByRole("button", { name: /^记\s*下$/ }).click();
  await expect.poll(async () => (await 调了(page)).length).toBe(1);
  expect((await 调了(page))[0]).toMatchObject({ type: "WECHAT", method: "微信沟通" });
  expect(await 横滚(page)).toBeLessThanOrEqual(0);
  await page.close();
});

it("ov.recycle：习惯晚到、人先改过方式 → 不盖人选的", async () => {
  const page = await 打开("todos", 1024);
  await 设习惯(page, { type: "WECHAT", method: "微信沟通" }, 800);
  await page.getByRole("button", { name: /潜客培育 · 7 天没跟进收回/ }).click();
  await page.getByRole("button", { name: "记一条沟通" }).first().click();
  const 方式 = page.locator(".ov-rc-form .ant-select").first();
  await 方式.click();
  await page.locator(".ant-select-item-option", { hasText: "上门拜访" }).click();
  await page.waitForTimeout(1200);
  expect(await 方式.innerText()).toContain("上门拜访");
  await page.getByRole("textbox", { name: /沟通了什么/ }).fill("见面聊了");
  await page.getByRole("textbox", { name: "下一步计划" }).fill("下周回访");
  await page.getByRole("button", { name: /^记\s*下$/ }).click();
  await expect.poll(async () => (await 调了(page)).length).toBe(1);
  expect((await 调了(page))[0]).toMatchObject({ type: "VISIT" });
  await page.close();
});

/* 11-20：记成了、顺带按必填把节点推了一格（画像早就齐了，这次记沟通才推）：表单收起后这一行下面说推到哪，不悄悄推；一行放不下「…」、不横滚 */
it("ov.recycle：记成了、顺带自动推了一格，行下面说推到哪；没推不说（11-20）", async () => {
  for (const w of [375, 1366]) {
    const page = await 打开("todos", w);
    await page.evaluate(() => Reflect.set(window, "__回", { ok: true, 自动推到: ["线索验证"] }));
    await page.getByRole("button", { name: /潜客培育 · 7 天没跟进收回/ }).click();
    await page.getByRole("button", { name: "记一条沟通" }).first().click();
    await page.getByRole("textbox", { name: /沟通了什么/ }).fill("聊了需求");
    await page.getByRole("textbox", { name: "下一步计划" }).fill("下周回访");
    await page.getByRole("button", { name: /^记\s*下$/ }).click();
    const 说 = page.getByRole("status").filter({ hasText: "必填齐了，自动推进到 线索验证" });
    await 说.waitFor({ timeout: 6000 });
    expect(await 横滚(page)).toBeLessThanOrEqual(0);
    // 再点「记一条沟通」：那句清掉
    await page.getByRole("button", { name: "记一条沟通" }).first().click();
    expect(await 说.count()).toBe(0);
    await page.close();
  }
  const page = await 打开("todos", 1280);
  await page.getByRole("button", { name: /潜客培育 · 7 天没跟进收回/ }).click();
  await page.getByRole("button", { name: "记一条沟通" }).first().click();
  await page.getByRole("textbox", { name: /沟通了什么/ }).fill("聊了需求");
  await page.getByRole("textbox", { name: "下一步计划" }).fill("下周回访");
  await page.getByRole("button", { name: /^记\s*下$/ }).click();
  await expect.poll(async () => page.getByRole("textbox", { name: /沟通了什么/ }).count(), { timeout: 6000 }).toBe(0);
  expect(await page.getByText("自动推进到").count()).toBe(0);
  await page.close();
});
