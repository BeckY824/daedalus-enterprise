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
