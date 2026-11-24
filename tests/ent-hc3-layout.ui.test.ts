/**
 * 设计语言 HC-3（11-22，输入框、框下一行；依据 现在-首页对话-20261122.md HC-14/15/16/17，用户 11-22 选 C9-A / C10-A）：
 *   C9 首页输入框圆角 14、--field-line 边；聚焦只换 --brand 边、不出光晕；还没问 / 问过之后同一套
 *      回答中的停止钮首页、浮窗统一白底描边方块（首页原来蓝实心、浮窗墨色实心）
 *      排队的问题不在对话流里，挪到框上方小签「排队 N 条：… 取消」；390 一行省略、「取消」不换行
 *   C10 问过之后输入框下不放键盘提示、快捷问题（要计次的人只留额度那一句）
 *
 * 外面照 HC-1 的一张纸；对话流是真 TurnView，框里是真 SendKey / QueueChip / ComposerFoot（Composer 整个连着路由、模型、背调，单拎画不了）。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ent-hc3", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>'/dashboard';export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/dynamic$/, "export default ()=>()=>null;");
  stub(/(^|\/)(ProposalCard|ProposalBatch)$/, "export default function C(){return null}");
  stub(/(^|\/)(ResearchRun|ResearchPerson)$/, "export default function View(){return null};export function ResearchPick(){return null}");
  stub(/(^|\/)AiCost$/, "export default function Cost(){return null};export const useAiOutOfCredits=()=>false;export function AiRemaining(){return window.__额度?<span className='cli-quota'>免费次数还剩 2 次 · 每问用 1 次</span>:null}");
  stub(/^@\/lib\/ai-jobs$/, "export const clearJob=()=>{},useJob=key=>(window.__jobs||{})[key];");
  stub(/^@\/lib\/draft-jobs$/, "export const useCopyDraft=()=>()=>{},草稿键=(kind,id)=>kind+id,起草=()=>{};");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

const 长 = "帮我把某某超长贸易进出口有限公司这个月所有没跟进的项目按金额排一下".repeat(2);

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import TurnView from '@/app/(app)/dashboard/TurnView';
    import { ComposerFoot, QueueChip, SendKey } from '@/app/(app)/dashboard/ComposerParts';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 示例们 = [{ label: "今天该跟谁", question: "今天该跟谁", kind: "fill" }];
    function 页({ 轮们, 浮窗 }) {
      const 排队 = 轮们.filter((t) => t.queued);
      const 框 = (
        <div className={'cli-composer cli-composer-sticky'}>
          <QueueChip 排队={排队} on取消={(id) => { window.__取消 = id; }} />
          <div className="cli-input cli-input-rich">
            <textarea rows={1} aria-label="问一句" placeholder="可以接着打字，回车后排在这一条后面" />
            <div className="cli-bar2"><div className="cli-bar2-l" /><div className="cli-bar2-r"><SendKey 在跑 onStop={() => {}} canSend={false} on发={() => {}} /></div></div>
          </div>
          <ComposerFoot 摆建议={false} suggestions={示例们} suggIdx={-1} 空={false} 在跑 背调模式={false} 背调价={null} AI已用完={false} on问={() => {}} 只留额度={!浮窗} />
        </div>
      );
      const 流 = (
        <div className="cli-log">
          {轮们.map((t) => <TurnView key={t.id} turn={t} onRetry={() => {}} onRemove={() => { window.__移除 = t.id; }} onAsk={() => {}} scrollOnMount={false} />)}
          <div />
        </div>
      );
      if (浮窗) return <aside className="dock dock-float"><div className="dock-body"><div className="cli">{流}{框}</div></div></aside>;
      return (
        <div className="cli cli-paper"><div className="cli-ck"><div className="cli-ck-g">
          <div className="cli-col cli-frame">{流}{框}</div>
        </div></div></div>
      );
    }
    window.__画 = (el, 轮们, 浮窗) => createRoot(el).render(<ConfigProvider locale={zhCN}><App component={false}><BusinessProvider value={DEFAULT_BUSINESS}><页 轮们={轮们} 浮窗={浮窗} /></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, plugins: [plugin], logLevel: "silent" });
  bundle = "window.process = { env: {} };\n" + r.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 起 = Date.now() - 6000;
const 轮们 = [
  { id: "t0", question: "今天该跟谁", kind: "ask", at: 起 },
  { id: "t1", question: 长, kind: "ask", at: 起, queued: true },
  { id: "t2", question: "第三句", kind: "ask", at: 起, queued: true },
];
const 任务们 = { "home:t0": { status: "loading", startedAt: 起, value: { steps: [{ type: "step", id: "tool-0", label: "search_customers(x)", status: "running", at: 起 + 1000 }] } } };

async function 开(宽: number, o: { 浮窗?: boolean; 额度?: boolean } = {}): Promise<{ page: Page; close: () => Promise<void> }> {
  const 手机 = 宽 < 768;
  const ctx = await browser.newContext({ viewport: { width: 宽, height: 900 }, reducedMotion: "reduce", hasTouch: 手机, isMobile: 手机 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const 壳 = 手机
    ? `<section class='ant-layout' style='min-height:100vh;display:flex;flex-direction:column'><header style='height:48px;flex:none'></header><main class='app-content' style='padding:22px 26px'><div class='page-fade' id='root'></div></main></section>`
    : `<div class='shell'><nav style='width:220px;flex:none'></nav><main class='main app-content' style='padding:22px 26px'><div class='page-fade' id='root' style='max-width:1720px;margin:0 auto'></div></main></div>`;
  await page.route("http://hc3.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><body style='margin:0'>${壳}</body></html>` }));
  await page.goto("http://hc3.test/dashboard");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([轮, 任务, 浮窗, 额度]) => { const w = window as unknown as { __jobs: unknown; __额度: boolean; __画: (el: Element, t: unknown, f: boolean) => void }; w.__jobs = 任务; w.__额度 = 额度; w.__画(document.getElementById("root")!, 轮, 浮窗); }, [轮们, 任务们, !!o.浮窗, !!o.额度] as const);
  await page.locator(".cli-input").waitFor();
  await page.waitForTimeout(50);
  if (errors.length) throw new Error(errors.join("\n"));
  return { page, close: () => ctx.close() };
}
const 色 = (page: Page, v: string) => page.evaluate((v) => { const d = document.createElement("i"); d.style.color = `var(${v})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, v);

for (const 宽 of [1366, 390]) {
  it(`C9（${宽}）：输入框圆角 14、聚焦只换边色不出光晕；停止钮白底描边方块；排队小签在框上方一行、「取消」不换行`, async () => {
    const { page, close } = await 开(宽);
    try {
      const 框 = page.locator(".cli-frame .cli-input");
      expect(await 框.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toBe("14px");
      expect(await 框.evaluate((e) => getComputedStyle(e).borderTopColor)).toBe(await 色(page, "--field-line"));
      await page.locator("textarea").focus();
      const 主色 = await 色(page, "--brand");
      await expect.poll(() => 框.evaluate((e) => [getComputedStyle(e).borderTopColor, getComputedStyle(e).boxShadow])).toEqual([主色, "none"]);
      // 停止钮
      const 停 = page.getByRole("button", { name: "打断" });
      expect(await 停.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await 色(page, "--panel"));
      expect(await 停.evaluate((e) => getComputedStyle(e).boxShadow)).toContain("inset");
      expect(await 停.locator(".cli-stop-sq").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await 色(page, "--ink"));
      // 排队：对话流里只剩正在答的那一轮，小签在输入框上方
      expect(await page.locator(".cli-log > .cli-turn").count()).toBe(1);
      expect(await page.getByText("排队中，等上一问答完").count()).toBe(0);
      const 签 = page.locator(".cli-queue-c");
      expect(await 签.innerText()).toMatch(/^排队 2 条：帮我把[\s\S]*取消$/);
      const [签盒, 框盒, 取消盒, 字] = await Promise.all([签.boundingBox(), 框.boundingBox(), 签.locator(".cli-queue-x").boundingBox(), 签.locator(".cli-queue-t").evaluate((e) => ({ 省略: e.scrollWidth > e.clientWidth, 高: e.getBoundingClientRect().height }))]);
      expect(签盒!.y + 签盒!.height).toBeLessThanOrEqual(框盒!.y);
      expect(签盒!.x + 签盒!.width).toBeLessThanOrEqual(框盒!.x + 框盒!.width + 1);
      expect(Math.abs(签盒!.x - 框盒!.x)).toBeLessThanOrEqual(1); // 和输入框左边齐
      expect(字.省略).toBe(true);
      expect(字.高).toBeLessThan(26);
      expect(取消盒!.height).toBeLessThan(26);
      await 签.getByRole("button", { name: /取消排队/ }).click();
      expect(await page.evaluate(() => (window as unknown as { __取消: string }).__取消)).toBe("t1");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally { await close(); }
  });
}

it("C10：问过之后框下不放键盘提示、快捷问题；要计次的人只留额度那一句", async () => {
  let { page, close } = await 开(1366);
  try {
    expect(await page.locator(".cli-hints-keys").count()).toBe(0);
    expect(await page.locator(".cli-sugg").count()).toBe(0);
    expect(await page.locator(".cli-hints-quota").evaluate((e) => getComputedStyle(e).display)).toBe("none");
  } finally { await close(); }
  ({ page, close } = await 开(1366, { 额度: true }));
  try {
    expect(await page.locator(".cli-hints-quota").innerText()).toBe("免费次数还剩 2 次 · 每问用 1 次");
    expect(await page.locator(".cli-sugg").count()).toBe(0);
  } finally { await close(); }
});

it("全局浮窗：停止钮同样白底描边、排队小签同样在框上方；输入框还是浮窗自己的透明框、框下一行照留", async () => {
  const { page, close } = await 开(1366, { 浮窗: true });
  try {
    expect(await page.getByRole("button", { name: "打断" }).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await 色(page, "--panel"));
    expect(await page.locator(".cli-queue").count()).toBe(1);
    expect(await page.locator(".dock .cli-log > .cli-turn").count()).toBe(1);
    expect(await page.locator(".dock .cli-input").evaluate((e) => getComputedStyle(e).borderTopColor)).toBe("rgba(0, 0, 0, 0)");
    expect(await page.locator(".dock .cli-hints").count()).toBe(1);
    expect(await page.locator(".dock .cli-hints-quota").count()).toBe(0);
  } finally { await close(); }
});
