/**
 * 首页 / 全局面板那一轮（TurnView）接上状态条以后（2026-11-15）：
 *   不再一行行铺 .cli-step；跑着是一个状态条，出错 / 打断的重试走原来的 onRetry；
 *   ≥2 张建议卡走合并清单，1 张照旧单张；还有没处理的卡，状态条是「等你确认」
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "turn-status-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){}});");
  stub(/^next\/link$/, "export default function Link(p){return <a {...p}/>}");
  stub(/^next\/dynamic$/, "export default ()=>()=>null;");
  // 卡片本身另有用例（ai-status.ui.test.ts）：这里只看 TurnView 选的是哪一种，并替卡片报一声状态
  stub(/(^|\/)ProposalCard$/, "import {useEffect} from 'react';export default function C({proposal,报}){useEffect(()=>{报?.(proposal.id,{状态:window.__卡态||'idle',能确认:true,缺:'',能撤:false,不可撤销:false})},[]);return <div className='stub-card'/>}");
  stub(/(^|\/)ProposalBatch$/, "import {useEffect} from 'react';export default function B({proposals,报}){useEffect(()=>{proposals.forEach(p=>报?.(p.id,{状态:window.__卡态||'idle',能确认:true,缺:'',能撤:false,不可撤销:false}))},[]);return <div className='stub-batch'>{proposals.length}</div>}");
  stub(/(^|\/)(StreamMarkdown|ResearchRun|ResearchPerson)$/, "export default function View(){return null};export function ResearchPick(){return null}");
  stub(/(^|\/)AiCost$/, "export default function Cost(){return null};export const useAiOutOfCredits=()=>false;");
  stub(/^@\/lib\/ai-jobs$/, "export const clearJob=()=>{},useJob=key=>key.startsWith('home:')?window.__job:null;");
  stub(/^@\/lib\/draft-jobs$/, "export const useCopyDraft=()=>()=>{},草稿键=(kind,id)=>kind+id,起草=()=>{};");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{App}from'antd';import Turn from'@/app/(app)/dashboard/TurnView';import{BusinessProvider}from'@/lib/business-client';import{DEFAULT_BUSINESS}from'@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    window.__render=(job,卡态)=>{window.__job=job;window.__卡态=卡态;window.__重试=0;flushSync(()=>root.render(<App><BusinessProvider value={DEFAULT_BUSINESS}><Turn key={Math.random()} turn={{id:'qa',question:'QA问题',kind:'ask',at:Date.now()}} onRetry={()=>{window.__重试++}} onRemove={()=>{}} onAsk={()=>{}} scrollOnMount={false}/></BusinessProvider></App>))};`,
    loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 起 = Date.now() - 5000;
const 步 = (i: number, label: string, status: string, detail?: string) => ({ type: "step", id: `tool-${i}`, label, status, detail, at: 起 + i * 1000 });
const 计划 = (id: string) => ({ id, kind: "add_plan", customerId: "c", customerName: "甲", reason: "", subject: "x", plannedAt: "2026-11-23", method: "电话" });
async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://turn.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://turn.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  return { page, errors };
}
const 画 = (page: Page, job: unknown, 卡态?: string) => page.evaluate(([j, k]) => (window as unknown as { __render: (j: unknown, k?: string) => void }).__render(j, k), [job, 卡态] as const);

it("跑着：一个状态条，不铺 .cli-step；出错停在第几步、重试走 onRetry；打断写已打断", async () => {
  const { page, errors } = await open();
  await 画(page, { status: "loading", startedAt: 起, value: { steps: [步(0, "search_customers(张三)", "done", "1 位"), 步(1, "get_customer(c1)", "running")] } });
  expect(await page.locator(".cli-step").count()).toBe(0);
  expect(await page.locator(".ais-tt").innerText()).toBe("正在读客户的记录…");
  expect(await page.locator(".ais-mt").innerText()).toContain("Esc 打断");

  await 画(page, { status: "error", error: "网络断了", startedAt: 起, value: { steps: [步(0, "search_customers(张三)", "done", "1 位"), 步(1, "get_customer(c1)", "running")] } });
  expect(await page.locator(".ais-tt").innerText()).toBe("停在第 2 步：网络断了");
  expect(await page.locator(".cli-err").count()).toBe(0);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __重试: number }).__重试)).toBe(1);

  await 画(page, { status: "error", error: "已取消", startedAt: 起, value: { steps: [步(0, "search_customers(张三)", "done", "1 位"), 步(1, "get_customer(c1)", "running")] } });
  expect(await page.locator(".ais-tt").innerText()).toBe("已打断 · 做了 2 步");
  await page.locator(".ais-hd-b").click();
  expect(await page.locator(".ais-line").nth(1).innerText()).toContain("被打断");
  expect(errors).toEqual([]);
  await page.close();
});

it("答完：≥2 张卡走合并清单、状态条「等你确认」；1 张照旧；都处理过就收成「用了 X 秒」", async () => {
  const { page } = await open();
  const 答 = (n: number) => ({ status: "done", startedAt: 起, value: { ms: 4000, steps: [步(0, "list_projects()", "done", "3 个")], answer: { text: "好", customers: [], proposals: Array.from({ length: n }, (_, i) => 计划(`p${i}`)), records: [] } } });
  await 画(page, 答(3));
  expect(await page.locator(".stub-batch").innerText()).toBe("3");
  expect(await page.locator(".stub-card").count()).toBe(0);
  await expect.poll(() => page.locator(".ais-tt").innerText()).toBe("等你确认 3 项");
  await 画(page, 答(1));
  expect(await page.locator(".stub-batch").count()).toBe(0);
  expect(await page.locator(".stub-card").count()).toBe(1);
  await expect.poll(() => page.locator(".ais-tt").innerText()).toBe("等你确认 1 项");
  await 画(page, 答(2), "done");
  await expect.poll(() => page.locator(".ais-tt").innerText()).toBe("用了 4 秒 · 1 步");
  await page.close();
});
