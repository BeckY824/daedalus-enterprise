/**
 * 设置 → 合并台账（MergeLedgerTab.tsx，12-02）：只有拿到 合并台账 这个 prop（SettingsBody 只给系统管理员）才有这一栏；
 * 一单一行、长名字一行省略号悬停看全；搜索、导出按同一组条件调服务端；390 / 1024 / 1440 页面不横滚。测试数据全是编的
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { 打包, 开页, 调用们 } from "./settings-ui-kit";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import V from '@/app/(app)/settings/SettingsView';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import {查合并台账, 导出合并台账Action} from '@/app/(app)/settings/merge-ledger-actions';
    window.__render=(p)=>{createRoot(document.getElementById('root')).render(<App><div className='shell'><main className='main app-content'><V business={DEFAULT_BUSINESS} {...p} 合并台账={p.给台账?{查:查合并台账,导出:导出合并台账Action}:null}/></main></div></App>);};`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 长 = "编造的一个特别特别长的留下项目名字用来看省略号和悬停全文是否正常显示";
const 行 = (i: number, 状态 = "已合并") => ({
  id: `m${i}`, at: "2026-11-28T03:00:00.000Z", 发起人: "成员甲", 客户id: `c${i}`, 客户: `编造客户${i}`, 留下id: `a${i}`, 留下项目: i === 0 ? 长 : `留下${i}`,
  被并id: `b${i}`, 被并项目: `被并${i}`, 留下负责人: "成员甲", 被并负责人: "成员甲", 自查人: "成员甲", 自查时间: "2026-11-28T03:00:00.000Z",
  状态, 撤回人: 状态 === "已撤回" ? "成员乙" : "", 撤回时间: 状态 === "已撤回" ? "2026-11-29T03:00:00.000Z" : null,
});
const props = (给台账: boolean) => ({
  users: [], me: { id: "u0", name: "成员0", email: "u0@example.com", role: "ADMIN", title: "" },
  isAdmin: true, 只读: false, 只个人: false, 身份: "系统管理员", 企业版: true, 我的角色: ["director"], logs: [], 导出记录: [],
  llm: { source: null, baseUrl: "", model: "", keyMasked: null, options: [] }, aiUsage: [], 机器: null, 给台账,
});
const 装假 = `var 长=${JSON.stringify(长)};window.__act=(n,c)=>n==='查合并台账'||n==='导出合并台账Action'?{ok:true,截断:false,行们:(c?.词?[0]:[0,1,2]).map(i=>(${行.toString()})(i,i===2?'已撤回':'已合并'))}:{ok:true};`;

it("没给 合并台账（不是系统管理员）：目录里没有这一栏", async () => {
  const { page, errors } = await 开页(browser, bundle, props(false), 1366);
  try {
    await page.getByRole("tab", { name: /操作日志/ }).waitFor();
    expect(await page.getByRole("tab", { name: /合并台账/ }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [390, 1024, 1440]) {
  it(`${w} 宽：一单一行、长名一行省略号悬停看全，页面不横滚；搜索、导出按同一组条件调服务端`, async () => {
    const { page, errors } = await 开页(browser, bundle, props(true), w, "?tab=merges");
    try {
      // 去掉浏览器默认的 body 外边距（同 ent-settings-scroll）；外面套 app 壳的 .shell / .main，同线上整页 /settings
      await page.addStyleTag({ content: "body{margin:0}" });
      await page.evaluate(装假);
      // 第一次拉在 __act 装好之前已经发出（回的是空）：搜一下再清空，换成装好假的再拉
      await page.getByRole("tab", { name: /合并台账/ }).click();
      await page.getByRole("searchbox", { name: "按客户名或项目名搜" }).fill("x");
      await page.getByRole("searchbox", { name: "按客户名或项目名搜" }).fill("");
      await page.locator("[data-testid=合并台账] .ant-table-row").first().waitFor();
      expect(await page.locator("[data-testid=合并台账] .ant-table-row").count()).toBe(3);
      await page.getByText("共 3 单").waitFor();
      await page.getByText("已撤回", { exact: true }).waitFor();

      const 格 = page.locator(`[data-testid=合并台账] a[title="${长}"]`);
      expect(await 格.evaluate((el) => ({ 截: el.scrollWidth > el.clientWidth, 行高: el.getBoundingClientRect().height, 新页: (el as HTMLAnchorElement).target }))).toMatchObject({ 截: true, 新页: "_blank" });
      expect((await 格.boundingBox())!.height).toBeLessThan(30);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await page.getByRole("searchbox", { name: "按客户名或项目名搜" }).fill("编造客户0");
      await page.keyboard.press("Enter");
      await page.getByText("共 1 单").waitFor();
      await page.getByRole("button", { name: /^导\s*出$/ }).click();
      await page.waitForFunction(() => ((window as unknown as { __calls?: [string][] }).__calls ?? []).some(([n]) => n === "导出合并台账Action"));
      const 调 = await 调用们(page);
      const 最后查 = [...调].reverse().find(([n]) => n === "查合并台账")![1][0];
      const 导 = 调.find(([n]) => n === "导出合并台账Action")![1][0];
      expect(导).toEqual(最后查);
      expect(导).toMatchObject({ 词: "编造客户0" });
      // 改了词没搜就导出：导出的仍是上次查过的条件，不是输入框里的词
      await page.getByText(/已导出 \d+ 单/).waitFor();
      await page.waitForFunction(() => !document.querySelector("[data-testid=合并台账] .ant-btn-loading"));
      await page.getByRole("searchbox", { name: "按客户名或项目名搜" }).fill("还没搜的词");
      await page.getByRole("button", { name: /导\s*出$/ }).click();
      await page.waitForFunction(() => ((window as unknown as { __calls?: [string][] }).__calls ?? []).filter(([n]) => n === "导出合并台账Action").length >= 2);
      const 调2 = await 调用们(page);
      const 导们 = 调2.filter(([n]) => n === "导出合并台账Action");
      expect(导们[1][1][0]).toEqual(最后查);
      expect(调2.filter(([n]) => n === "查合并台账").map(([, a]) => (a[0] as { 词?: string }).词)).not.toContain("还没搜的词");
      // 点预设：只传日期串（YYYY-MM-DD）
      await page.getByRole("textbox", { name: "合并时间范围" }).first().click();
      await page.getByText("近 30 天", { exact: true }).dispatchEvent("click");
      await page.waitForFunction(() => ((window as unknown as { __calls?: [string, [{ 起?: string }]][] }).__calls ?? []).some(([n, a]) => n === "查合并台账" && !!a[0].起));
      const 预设查 = (await 调用们(page)).filter(([n, a]) => n === "查合并台账" && !!(a[0] as { 起?: string }).起).pop()![1][0] as { 起: string; 止: string };
      expect(预设查.起).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(预设查.止).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

for (const w of [390, 768, 1024, 1199, 1280]) {
  it(`${w} 宽：日期范围弹层整块在视口内，${w <= 1199 ? "上下叠" : "双月并排"}，起止两天点得到`, async () => {
    const { page, errors } = await 开页(browser, bundle, props(true), w, "?tab=merges");
    try {
      await page.addStyleTag({ content: "body{margin:0}" });
      await page.evaluate(装假);
      await page.getByRole("tab", { name: /合并台账/ }).click();
      const 框 = page.getByRole("textbox", { name: "合并时间范围" });
      const 量 = () => page.evaluate(() => {
        const r = document.querySelector(".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)")!.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width, vw: innerWidth };
      });
      await 框.first().click();
      await page.locator(".ant-picker-dropdown:not(.ant-picker-dropdown-hidden) .ant-picker-cell-in-view").first().waitFor();
      await page.waitForTimeout(400);
      const a = await 量();
      expect(a.left).toBeGreaterThanOrEqual(0);
      expect(a.right).toBeLessThanOrEqual(a.vw);
      if (w <= 1199) expect(a.width).toBeLessThanOrEqual(360); else expect(a.width).toBeGreaterThan(600);
      await page.locator(".ant-picker-dropdown:not(.ant-picker-dropdown-hidden) .ant-picker-cell-in-view").nth(2).click();
      await page.locator(".ant-picker-dropdown:not(.ant-picker-dropdown-hidden) .ant-picker-cell-in-view").nth(9).click();
      await page.waitForFunction(() => ((window as unknown as { __calls?: [string, [{ 起?: string; 止?: string }]][] }).__calls ?? []).some(([n, a]) => n === "查合并台账" && !!a[0].起 && !!a[0].止));
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("条件连改两次、早发的后回来：界面只认最后发出的那次", async () => {
  const { page, errors } = await 开页(browser, bundle, props(true), 1024, "?tab=merges");
  try {
    await page.addStyleTag({ content: "body{margin:0}" });
    // 词「慢」的请求 600ms 后才回（回一行「慢的」），词「快」的马上回（回一行「快的」）：先发慢、后发快，慢的后到
    await page.evaluate(`var 长=${JSON.stringify(长)};window.__act=(n,c)=>{if(n!=='查合并台账')return {ok:true};
      const r=(名)=>({ok:true,截断:false,行们:[(${行.toString()})(0)].map(x=>({...x,客户:名,客户id:null}))});
      if(c?.词==='慢')return new Promise(f=>setTimeout(()=>f(r('慢的')),600));
      return c?.词==='快'?r('快的'):r('初始');};`);
    await page.getByRole("tab", { name: /合并台账/ }).click();
    const 搜 = page.getByRole("searchbox", { name: "按客户名或项目名搜" });
    await 搜.fill("x");
    await 搜.fill("");
    await page.locator("[data-testid=合并台账] .ant-table-row").first().waitFor();
    await 搜.fill("慢");
    await page.keyboard.press("Enter");
    await 搜.fill("快");
    await page.keyboard.press("Enter");
    await page.getByText("快的", { exact: true }).waitFor();
    await page.waitForTimeout(900);
    expect(await page.getByText("慢的", { exact: true }).count()).toBe(0);
    expect(await page.getByText("快的", { exact: true }).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("客户在回收站标（已删除）仍有链接；彻底删除只显示（已删除的客户）、不出链接", async () => {
  const { page, errors } = await 开页(browser, bundle, props(true), 1024, "?tab=merges");
  try {
    await page.addStyleTag({ content: "body{margin:0}" });
    await page.evaluate(`var 长=${JSON.stringify(长)};window.__act=(n,c)=>{if(n!=='查合并台账')return {ok:true};
      const m=(${行.toString()});
      const a=m(0),b=m(1),d=m(2);
      return {ok:true,截断:false,行们:[{...a,客户状态:'在'},{...b,客户:'编造客户1（已删除）',客户状态:'回收站'},{...d,客户:'（已删除的客户）',客户状态:'已删'}]};};`);
    await page.getByRole("tab", { name: /合并台账/ }).click();
    const 搜 = page.getByRole("searchbox", { name: "按客户名或项目名搜" });
    await 搜.fill("x");
    await 搜.fill("");
    await page.locator("[data-testid=合并台账] .ant-table-row").first().waitFor();
    const 链 = (t: string) => page.locator(`[data-testid=合并台账] a[title="${t}"]`);
    expect(await 链("编造客户0").count()).toBe(1);
    expect(await 链("编造客户1（已删除）").count()).toBe(1);
    expect(await 链("（已删除的客户）").count()).toBe(0);
    expect(await page.locator("[data-testid=合并台账] span.ml-cell[title=\"（已删除的客户）\"]").count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("连续两次改日期范围、第一次的请求后回来：列表显示第二次条件的结果", async () => {
  const { page, errors } = await 开页(browser, bundle, props(true), 1440, "?tab=merges");
  try {
    await page.addStyleTag({ content: "body{margin:0}" });
    // 止=2026-11-26 的请求 700ms 后才回（「止26」），止=2026-10-03 的马上回（「止03」）；先发 26、后发 03
    await page.evaluate(`var 长=${JSON.stringify(长)};window.__act=(n,c)=>{if(n!=='查合并台账')return {ok:true};
      const r=(名)=>({ok:true,截断:false,行们:[(${行.toString()})(0)].map(x=>({...x,客户:名,客户id:null}))});
      if(c?.止==='2026-11-26')return new Promise(f=>setTimeout(()=>f(r('止26')),700));
      return c?.止==='2026-10-03'?r('止03'):r('初始');};`);
    await page.getByRole("tab", { name: /合并台账/ }).click();
    const 搜 = page.getByRole("searchbox", { name: "按客户名或项目名搜" });
    await 搜.fill("x");
    await 搜.fill("");
    await page.locator("[data-testid=合并台账] .ant-table-row").first().waitFor();
    const 起 = page.getByRole("textbox", { name: "合并时间范围" }).first();
    const 止 = page.getByRole("textbox", { name: "合并时间范围" }).nth(1);
    await 起.click();
    await 起.fill("2026-10-01");
    await 起.press("Enter");
    await 止.fill("2026-11-26");
    await 止.press("Enter");
    // 第一次发出后立刻第二次：点面板里的 10-03，弹层不收（焦点跳回开始框），不点外面也要发出
    await 止.click();
    await page.locator('.ant-picker-dropdown:visible td[title="2026-10-03"]').first().click();
    await page.getByText("止03", { exact: true }).waitFor();
    await page.waitForTimeout(1000);
    expect(await page.getByText("止26", { exact: true }).count()).toBe(0);
    expect(await page.getByText("止03", { exact: true }).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("日期范围有「上周 / 本周 / 近 30 天」预设，真点「近 30 天」发出的起止是北京日期串且相隔 29 天", async () => {
  const { page, errors } = await 开页(browser, bundle, props(true), 1440, "?tab=merges");
  try {
    await page.addStyleTag({ content: "body{margin:0}" });
    await page.getByRole("tab", { name: /合并台账/ }).click();
    await page.getByRole("textbox", { name: "合并时间范围" }).first().click();
    for (const t of ["上周", "本周", "近 30 天"]) await page.locator(".ant-picker-presets").getByText(t, { exact: true }).waitFor({ state: "visible" });
    await page.locator(".ant-picker-presets").getByText("近 30 天", { exact: true }).click();
    await page.waitForFunction(() => ((window as unknown as { __calls?: [string, [{ 起?: string }]][] }).__calls ?? []).some(([n, a]) => n === "查合并台账" && !!a[0].起));
    const 查 = (await 调用们(page)).filter(([n, a]) => n === "查合并台账" && !!(a[0] as { 起?: string }).起).pop()![1][0] as { 起: string; 止: string };
    expect(查.起).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(查.止).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((Date.parse(查.止) - Date.parse(查.起)) / 86_400_000).toBe(29);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
