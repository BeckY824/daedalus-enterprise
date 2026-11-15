/**
 * AI 状态条 + 合并确认（2026-11-15，前端改版交互原型「AI 助手 · 改后」）。
 *
 * 本机没配模型，跑不出真实步骤：这里用构造的 StepEvent 序列直接画 AiStatus / ProposalBatch / ProposalCard。
 *   状态条：进行中只露最近 3 步、头部写人话不写工具名；做完收成一行、点开才有原始调用串；
 *           出错写「停在第 N 步」、前面的步骤留着、有重试；被打断写「已打断」
 *   合并确认：≥2 张卡并成清单，只勾一部分 → 只确认勾上的、没勾的算忽略；写完收成一行，撤销逐张调；
 *           1 张卡保持原样；销售自动分配不再弹框，后果写在按钮上
 *   1024 / 1280 / 1366 / 1440 / 375 宽：超长工具结果、超长客户名不横向撑出
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ai-status-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  stub(/^next\/link$/, "export default function L({children,...p}){return <a {...p}>{children}</a>}");
  stub(/^next\/dynamic$/, "export default ()=>()=>null;");
  stub(/dashboard\/apply$/, "export const applyProposal=async p=>{(window.__交||=[]).push(p);return{ok:true,撤销:{kind:'add_followup',customerId:'c',id:p.id}}};export const undoProposal=async u=>{(window.__撤||=[]).push(u.id);return{ok:true}};");
  stub(/card-scan\/originals$/, "export const 取走名片原图=()=>null,记下刚建的=()=>{},忘掉刚建的=()=>{};");
  stub(/attachment-upload$/, "export const 传附件=async()=>({ok:true});");
  stub(/customers\/RescueKey$/, "export default function R(){return null}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import AiStatus from '@/components/AiStatus';import ProposalBatch from '@/components/ProposalBatch';
    import ProposalCard,{新线索来源,新线索企业} from '@/components/ProposalCard';
    const root=createRoot(document.getElementById('root'));
    const 包=(x)=><ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><div className="cli-col" style={{padding:16}}>{x}</div></BusinessProvider></App></ConfigProvider>;
    window.__status=(p)=>{window.__重试=0;flushSync(()=>root.render(包(<AiStatus 客户="客户" {...p} onRetry={p.无重试?undefined:()=>{window.__重试++}}/>)))};
    window.__batch=(ps)=>{window.__交=[];window.__撤=[];flushSync(()=>root.render(包(<ProposalBatch key={Math.random()} proposals={ps} 记号前缀={'t'+Math.random()}/>)))};
    window.__card=(p,企)=>{window.__交=[];root.render(包(企?<新线索来源.Provider value={['展会']}><新线索企业.Provider value={企}><ProposalCard proposal={p}/></新线索企业.Provider></新线索来源.Provider>:<ProposalCard proposal={p}/>))};
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width = 1280, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://status.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://status.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  return { page, errors };
}
const 起 = 1_700_000_000_000;
const 步 = (i: number, label: string, status: "running" | "done" | "error", detail?: string, thought?: string) => ({ type: "step", id: `tool-${i}`, label, status, detail, thought, at: 起 + (i + 1) * 2000 });
const 画 = (page: Page, p: Record<string, unknown>) => page.evaluate((p) => (window as unknown as { __status: (p: unknown) => void }).__status(p), p);
const 头 = (page: Page) => page.locator(".ais-tt").innerText();

it("进行中：头部写人话、不写工具名，只露最近 3 步，更早的收起", async () => {
  const { page, errors } = await open();
  const steps = [
    步(0, "search_customers(张三)", "done", "3 位"),
    步(1, "get_customer(c1)", "done", "6 条跟进"),
    步(2, "get_customer(c2)", "done", "2 条跟进"),
    步(3, "list_projects()", "done", "4 个"),
    步(4, "query_records(项目)", "done", "7 条"),
    步(5, "get_customer(c3)", "running"),
  ];
  await 画(page, { steps, 态: "running", 起, 附注: "Esc 打断" });
  expect(await 头(page)).toBe("正在读客户的记录…");
  expect(await page.locator(".ais-mt").first().innerText()).toMatch(/^第 6 步 · \d+ 秒 · Esc 打断$/);
  expect(await page.locator(".ais-row").count()).toBe(3);
  expect(await page.locator(".ais-more").innerText()).toBe("前面还有 2 步");
  const 全文 = await page.locator(".ais").innerText();
  expect(全文).not.toMatch(/get_customer|query_records|list_projects|\(c\d\)/);
  expect(全文).toContain("查了项目 · 4 个");
  await page.locator(".ais-more").click();
  expect(await page.locator(".ais-row").count()).toBe(5);
  // 回答写着的时候
  await 画(page, { steps: steps.map((s) => ({ ...s, status: "done" })), 态: "running", 起, 写着: true });
  expect(await 头(page)).toBe("正在写回答…");
  expect(errors).toEqual([]);
  await page.close();
});

it("做完收成一行「用了 X 秒 · N 步」，点开看每步：人话 + 原始调用 + 折叠的打算", async () => {
  const { page } = await open();
  const steps = [步(0, "list_channels()", "done", "12 个渠道", "先看看有哪些渠道"), 步(1, "query_records(客户, 渠道)", "done", "在客户里，找 渠道 是 展会，取 20 条")];
  await 画(page, { steps, 态: "done", 起, ms: 8200 });
  expect(await 头(page)).toBe("用了 8 秒 · 2 步");
  expect(await page.locator(".ais-row").count()).toBe(0);
  expect(await page.locator(".ais").getAttribute("data-state")).toBe("done");
  await page.locator(".ais-hd-b").click();
  expect(await page.locator(".ais-row").count()).toBe(2);
  expect(await page.locator(".ais-raw").first().innerText()).toBe("list_channels()");
  expect(await page.locator(".ais-line").nth(1).innerText()).toContain("按条件查了一次 · 在客户里");
  // thought 默认折叠
  const 打算 = page.locator(".ais-thought").first();
  expect(await 打算.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
  expect(await 打算.locator("div").isVisible()).toBe(false);
  await 打算.locator("summary").click();
  expect(await 打算.locator("div").innerText()).toBe("先看看有哪些渠道");
  await page.locator(".ais-hd-b").click();
  expect(await page.locator(".ais-row").count()).toBe(0);
  await page.close();
});

it("出错：「停在第 N 步：原因」，前面做完的留着，有重试；被打断写「已打断」", async () => {
  const { page } = await open();
  const steps = [步(0, "search_customers(北岸)", "done", "2 位重名"), 步(1, "list_contracts(p9)", "error")];
  await 画(page, { steps, 态: "error", 起, 原因: "这个项目还没建合同" });
  expect(await 头(page)).toBe("停在第 2 步：这个项目还没建合同");
  expect(await page.locator(".ais").getAttribute("data-state")).toBe("error");
  expect(await page.locator(".ais-row").count()).toBe(2);
  expect(await page.locator(".ais-row").first().innerText()).toContain("搜了客户 · 2 位重名");
  await page.getByRole("button", { name: "重试" }).click();
  expect(await page.evaluate(() => (window as unknown as { __重试: number }).__重试)).toBe(1);
  // 没有重发机制就不摆按钮
  await 画(page, { steps, 态: "error", 起, 原因: "x", 无重试: true });
  expect(await page.getByRole("button", { name: "重试" }).count()).toBe(0);
  // 一步都没走到就出错
  await 画(page, { steps: [], 态: "error", 起, 原因: "模型没响应" });
  expect(await 头(page)).toBe("出错了：模型没响应");
  // 打断：调用方把跑着的那步标成完成、写「被打断」
  await 画(page, { steps: [步(0, "search_customers(x)", "done", "1 位"), 步(1, "get_customer(c)", "done", "被打断")], 态: "interrupted", 起 });
  expect(await 头(page)).toBe("已打断 · 做了 2 步");
  await page.locator(".ais-hd-b").click();
  expect(await page.locator(".ais-line").nth(1).innerText()).toBe("✓读了客户的记录 · 被打断");
  // 等你确认
  await 画(page, { steps, 态: "wait", 起, ms: 3000, 等确认: 3 });
  expect(await 头(page)).toBe("等你确认 3 项");
  expect(await page.locator(".ais").getAttribute("data-state")).toBe("wait");
  await page.close();
});

const 长名 = "某某超长国际贸易进出口集团股份有限公司华东区域分公司".repeat(4);
const 计划 = (id: string, 名: string, subject = "发报价") => ({ id, kind: "add_plan", customerId: `c-${id}`, customerName: 名, reason: "到期了", subject, plannedAt: "2026-11-23", method: "电话" });

it("≥2 张卡合并确认：只勾一部分 → 只写勾上的，没勾的算忽略；写完收成一行，撤销逐张调", async () => {
  const { page, errors } = await open();
  await page.evaluate((ps) => (window as unknown as { __batch: (p: unknown) => void }).__batch(ps), [计划("a", "华东展具"), 计划("b", "北岸游乐"), 计划("c", "Lumen Arcade")]);
  await page.locator(".pbat").waitFor();
  expect(await page.locator(".pbat-h-t").innerText()).toBe("待确认 3 项");
  expect(await page.locator(".pbat-li").count()).toBe(3);
  // 卡片都在，但收着（字段要展开才看见），也没有每张自己的确认按钮
  expect(await page.locator(".pbat .prop").count()).toBe(3);
  expect(await page.locator(".pbat .prop").first().isVisible()).toBe(false);
  expect(await page.locator(".pbat .prop .prop-ok").count()).toBe(0);
  await page.locator(".pbat-li").nth(1).locator(".ant-checkbox-input").uncheck();
  const 确认 = page.locator(".pbat > .prop-foot .prop-ok");
  expect(await 确认.innerText()).toContain("确认选中 2 项");
  // 展开第一张就地改「谈什么」
  await page.locator(".pbat-edit").first().click();
  const 谈 = page.locator(".pbat-card").first().locator(".prop-f").filter({ hasText: "谈什么" }).locator("input");
  await 谈.fill("发新版报价");
  // ⌘↵ 等于点确认
  await 谈.press("Control+Enter");
  await page.locator(".pbat-done").waitFor();
  const 交 = await page.evaluate(() => (window as unknown as { __交: { id: string; subject: string }[] }).__交);
  expect(交.map((p) => p.id)).toEqual(["a", "c"]);
  expect(交[0].subject).toBe("发新版报价");
  expect(await page.locator(".pbat-done-h .prop-seal").innerText()).toContain("已写入 2 项");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __撤: string[] }).__撤)).toEqual(["a", "c"]);
  // 撤销后回到待确认：没勾的那张已经按忽略收掉了，剩下撤回来的两张
  await page.locator(".pbat-h-t").waitFor();
  expect(await page.locator(".pbat-h-t").innerText()).toBe("待确认 2 项");
  expect(errors).toEqual([]);
  await page.close();
});

it("只有 1 张卡保持原样；销售自动分配不再弹框，后果写在按钮上", async () => {
  const { page } = await open();
  await page.evaluate((p) => (window as unknown as { __card: (p: unknown) => void }).__card(p), 计划("a", "华东展具"));
  await page.locator(".prop-ok").waitFor();
  expect(await page.locator(".pbat").count()).toBe(0);
  expect((await page.locator(".prop-ok").innerText()).trim()).toBe("确认");
  await page.locator(".prop-ok").click();
  await page.locator(".prop-done").waitFor();
  const 企 = { 成员: [{ value: "u1", label: "乙" }], 分配方式们: [{ i: 1, 名: "自动分配" }], 默认分配方式: 1, 是销售: true };
  const 线索 = { id: "l1", kind: "add_lead", customerId: "", customerName: "", reason: "x", name: "某公司", contact: "周经理", phone: "13800000000", source: "展会", status: "待跟进", remark: "", 业务线: "内贸", 节点: undefined };
  await page.evaluate(([p, q]) => (window as unknown as { __card: (p: unknown, q: unknown) => void }).__card(p, q), [线索, 企] as const);
  await page.locator(".prop-ok").waitFor();
  expect(await page.locator(".prop-ok").innerText()).toContain("确认，自动分出去");
  expect(await page.locator(".prop-note").innerText()).toContain("分出去后你将看不到这个项目");
  await page.locator(".prop-ok").click();
  await page.locator(".prop-done").waitFor();
  expect(await page.locator(".ant-modal").count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __交: { id: string }[] }).__交.map((p) => p.id))).toEqual(["l1"]);
  await page.close();
});

it("1024 / 1280 / 1366 / 1440 / 375 宽：超长工具结果、超长客户名不横向撑出，一行省略", async () => {
  for (const w of [1024, 1280, 1366, 1440, 375]) {
    const { page } = await open(w);
    const 长结果 = `在客户里，找 名称 是 ${长名}，取 20 条`;
    await 画(page, { steps: [步(0, `query_records(${长名})`, "done", 长结果), 步(1, "get_customer(c)", "running")], 态: "running", 起 });
    const 状态 = await page.evaluate(() => {
      const a = document.querySelector(".ais")!;
      const 行 = [...document.querySelectorAll(".ais-line, .ais-tt")] as HTMLElement[];
      return { 页: document.documentElement.scrollWidth <= window.innerWidth, 框: a.scrollWidth <= a.clientWidth + 1, 一行: 行.every((e) => e.getBoundingClientRect().height < 26) };
    });
    expect(状态, `${w} 宽状态条`).toEqual({ 页: true, 框: true, 一行: true });
    await page.evaluate((ps) => (window as unknown as { __batch: (p: unknown) => void }).__batch(ps), [计划("a", 长名, 长名), 计划("b", 长名, 长名)]);
    await page.locator(".pbat").waitFor();
    const 清单 = await page.evaluate(() => {
      const a = document.querySelector(".pbat")!;
      const 行 = [...document.querySelectorAll(".pbat-n")] as HTMLElement[];
      return { 页: document.documentElement.scrollWidth <= window.innerWidth, 框: a.scrollWidth <= a.clientWidth + 1, 一行: 行.every((e) => e.getBoundingClientRect().height < 26), 有悬停: 行.every((e) => !!e.title) };
    });
    expect(清单, `${w} 宽合并清单`).toEqual({ 页: true, 框: true, 一行: true, 有悬停: true });
    await page.close();
  }
});
