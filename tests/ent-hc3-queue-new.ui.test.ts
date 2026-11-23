/**
 * #441 独立审查第 1 条：正在答的时候再发一问（排队），正在答的那一轮不能丢掉「刚发的」（cli-turn-new）。
 * 原来排队那一问也调了 on发出，「刚发的」变成排队那一轮（它 return null 不画），正在答的那一轮失去 cli-turn-new，
 * 下面 100cqh 的留白答到一半被收掉，滚动位置突跳。现在：排队时不改「刚发的」，等「发排队的」出队开跑时再设。
 *
 * 真 HomeChat（真 Composer + 真 useHomeTurns + 真 TurnLog / TurnView），外面照 HC-1 一张纸；
 * runStream 换成一个手动答完的桩（真 ai-jobs），落库、背调价、各待办换成空的。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ent-hc3-queue-new", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>'/dashboard';export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/dynamic$/, "export default ()=>()=>null;");
  stub(/(^|\/)ProposalCard$/, "import {createContext} from 'react';export default function C(){return null};export const 新线索来源=createContext(null),新线索要下一步=createContext(false),新线索企业=createContext(null);");
  stub(/(^|\/)ProposalBatch$/, "export default function B(){return null}");
  stub(/(^|\/)(ResearchRun|ResearchPerson)$/, "export default function View(){return null};export function ResearchPick(){return null}");
  stub(/(^|\/)AiCost$/, "export default function Cost(){return null};export const useAiOutOfCredits=()=>false;export function AiRemaining(){return null};export function AiMeterBar(){return null}");
  stub(/^@\/lib\/ai-stream$/, `import {runJob} from '@/lib/ai-jobs';
    window.__发了=[];window.__完={};
    export const cancelStream=()=>{};
    export function runStream(key,body,meta,标签){window.__发了.push(body.question);runJob(key,()=>new Promise((r)=>{window.__完[key]=()=>r({ok:true,value:{ms:10,text:'答：'+body.question,steps:[],answer:{text:'答：'+body.question,records:[],customers:[],proposals:[]}}})}),meta,标签);}`);
  stub(/(^|\/)threads$/, "export async function 落一轮(){return {conversationId:'c1'}};export async function 重命名对话(){return {ok:true}};export async function 删除对话(){return {ok:true}};export async function 列对话(){return []};export async function 读对话(){return null};export async function 新建对话(){return {id:'c1'}}");
  stub(/^@\/lib\/research\/actions$/, "export async function 背调价目(){return {可用:false,原因:'x'}};export async function 认号码动作(){return null}");
  stub(/(^|\/)(AwaitAssignTodo|CoachTopicTodo|ReplyDueTodo|AssignEtaLine|HomeCards)$/, "export default function E(){return null}");
  // 服务端动作（"use server" 打头的文件）：浏览器里画不了，一律换成什么都不做的异步函数
  b.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, (a) => {
    const src = readFileSync(a.path, "utf8");
    if (!/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(src)) return undefined;
    const 名们 = [...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([\p{L}\p{N}_$]+)/gu)].map((m) => m[1]);
    return { contents: 名们.map((n) => `export async function ${n}(){return null}`).join("\n"), loader: "js" };
  });
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import HomeChat from '@/app/(app)/dashboard/HomeChat';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    window.__画 = (el) => createRoot(el).render(<ConfigProvider locale={zhCN}><App component={false}><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <HomeChat userName="测试" suggestions={[]} context="" models={[]} 空库={false} 企业版 指标卡={{ "month-new": 1, key: 2, "no-follow": 3, "due-soon": 4 }} />
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, plugins: [plugin], logLevel: "silent" });
  bundle = "window.process = { env: {} };\n" + r.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(宽: number, 高: number): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const 手机 = 宽 < 768;
  const ctx = await browser.newContext({ viewport: { width: 宽, height: 高 }, reducedMotion: "reduce", hasTouch: 手机, isMobile: 手机 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const 壳 = 手机
    ? `<section class='ant-layout' style='min-height:100vh;display:flex;flex-direction:column'><header style='height:48px;flex:none'></header><main class='app-content' id='root' style='padding:22px 26px'></main></section>`
    : `<div class='shell'><nav style='width:220px;flex:none'></nav><main class='main app-content' style='padding:22px 26px'><div id='root' style='max-width:1720px;margin:0 auto'></div></main></div>`;
  await page.route("http://queue.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><body style='margin:0'>${壳}</body></html>` }));
  await page.goto("http://queue.test/dashboard");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as { __画: (el: Element) => void }).__画(document.getElementById("root")!));
  await page.locator("textarea").first().waitFor();
  if (errors.length) throw new Error(errors.join("\n"));
  return { page, errors, close: () => ctx.close() };
}

async function 发(page: Page, q: string) {
  const 框 = page.locator(".cli-composer textarea").first();
  await 框.fill(q);
  await 框.press("Enter");
}
/** 哪几轮挂着 cli-turn-new（按问句认） */
const 新的 = (page: Page) => page.locator(".cli-log > .cli-turn.cli-turn-new .cli-bubble").allInnerTexts();

for (const [宽, 高] of [[1366, 900], [390, 844]] as const) {
  it(`排队（${宽}）：正在答时再发一问，正在答的那一轮还是「刚发的」、问句不挪；轮到排队那一问开跑时它才变成刚发的`, async () => {
    const { page, errors, close } = await 开(宽, 高);
    try {
      await 发(page, "第一问今天该跟谁");
      await expect.poll(() => 新的(page)).toEqual(["第一问今天该跟谁"]);
      const 顶 = () => page.locator(".cli-log > .cli-turn").first().evaluate((e) => Math.round(e.getBoundingClientRect().top));
      await page.waitForTimeout(150);
      const 顶0 = await 顶();
      // 正在答，再发一问：排进队里（框上方小签），正在答的那一轮照旧是刚发的
      await 发(page, "第二问哪些项目要回公海");
      await expect.poll(() => page.locator(".cli-queue-c").count()).toBe(1);
      await page.waitForTimeout(150);
      expect(await 新的(page), "正在答的那一轮不丢 cli-turn-new").toEqual(["第一问今天该跟谁"]);
      expect(await 顶(), "正在答的那一轮问句不跳").toBe(顶0);
      expect(await page.evaluate(() => (window as unknown as { __发了: string[] }).__发了)).toEqual(["第一问今天该跟谁"]);
      // 第一问答完：排队那一问出队开跑，这时它才是刚发的
      await page.evaluate(() => { const w = window as unknown as { __完: Record<string, () => void> }; Object.values(w.__完)[0](); });
      await expect.poll(() => page.evaluate(() => (window as unknown as { __发了: string[] }).__发了)).toEqual(["第一问今天该跟谁", "第二问哪些项目要回公海"]);
      await expect.poll(() => 新的(page)).toEqual(["第二问哪些项目要回公海"]);
      expect(await page.locator(".cli-queue-c").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await close(); }
  });
}
