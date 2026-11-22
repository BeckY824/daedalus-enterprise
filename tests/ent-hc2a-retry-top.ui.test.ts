/**
 * HC-1 实操补点（3703）：打开一段老对话，在最后一轮点「重新回答」——重答的问句没顶到框顶，停在框底附近、回答全在视线下面，
 * 过程中还自己往下挪 16px。原因：重答的老轮不算「刚发」，没有 cli-turn-new、也不顶。
 * 期望和刚发一问一样：问句顶到框顶、离顶 14，下面留一框高的空，流式不拽人；同一轮连着重答两次也再顶一次；
 * 中间某一轮重答也顶到框顶，但不在两轮之间空出一框高。
 *
 * 外面照 HC-1 的一张纸（.cli-paper 框里滚）；里面是真 TurnLog + 真 TurnView + 真 ToLatest，
 * 「刚发的」照 HomeChat 那样挂在外层状态上（动作.刚发）；任务表换成一个能订阅的小桩，好模拟重答后一段段流出来。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ent-hc2a-retry", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>'/dashboard';export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/dynamic$/, "export default ()=>()=>null;");
  stub(/(^|\/)ProposalCard$/, "export default function C(){return null}");
  stub(/(^|\/)ProposalBatch$/, "export default function B(){return null}");
  stub(/(^|\/)(ResearchRun|ResearchPerson)$/, "export default function View(){return null};export function ResearchPick(){return null}");
  stub(/(^|\/)AiCost$/, "export default function Cost(){return null};export const useAiOutOfCredits=()=>false;");
  stub(/^@\/lib\/ai-stream$/, "export const cancelStream=()=>{};");
  stub(/^@\/lib\/ai-jobs$/, `import {useSyncExternalStore} from 'react';
    const 听=new Set();window.__jobs=window.__jobs||{};
    window.__设任务=(k,v)=>{window.__jobs={...window.__jobs,[k]:v};听.forEach((f)=>f());};
    export const clearJob=(k)=>window.__设任务(k,undefined);
    export const useJob=(k)=>useSyncExternalStore((f)=>{听.add(f);return()=>听.delete(f)},()=>k?window.__jobs[k]:undefined);`);
  stub(/^@\/lib\/draft-jobs$/, "export const useCopyDraft=()=>()=>{},草稿键=(kind,id)=>kind+id,起草=()=>{};");
  stub(/^@\/lib\/clipboard$/, "export const useCopy=()=>async()=>{};");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import TurnLog from '@/app/(app)/dashboard/TurnLog';
    import ToLatest from '@/app/(app)/dashboard/ToLatest';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    function 页({ 轮们 }) {
      const [刚发的, set刚发的] = React.useState(null);
      const [动作] = React.useState(() => ({
        start: (t) => { window.__开跑 = (window.__开跑 || []).concat(t.id); window.__设任务('home:' + t.id, { status: 'running', startedAt: Date.now(), value: { text: '', steps: [] } }); },
        在跑: () => false,
        问: () => {},
        刚发: (id) => set刚发的(id),
      }));
      return (
        <div className="cli cli-paper"><div className="cli-ck"><div className="cli-ck-g">
          <div className="cli-col cli-frame">
            <div className="cli-head"><span className="cli-head-t">对话</span></div>
            <TurnLog turns={轮们} 刚发的={刚发的} scope="s" 动作={动作} 企业版 />
            <ToLatest key="c1" 刚发={轮们.some((t) => t.id === 刚发的)} />
            <div className="cli-composer cli-composer-sticky"><div className="cli-input"><textarea rows={1} aria-label="问一句" /></div></div>
          </div>
        </div></div></div>
      );
    }
    window.__画 = (el, 轮们) => createRoot(el).render(<ConfigProvider locale={zhCN}><App component={false}><BusinessProvider value={DEFAULT_BUSINESS}><页 轮们={轮们} /></BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, plugins: [plugin], logLevel: "silent" });
  bundle = "window.process = { env: {} };\n" + r.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 起 = Date.now() - 600_000;
const 长段 = "华东展具这周要回电，北岸游乐的报价单还没发，某某超长贸易进出口有限公司的样品下周到。";
const 答 = (i: number) => ({ status: "done", startedAt: 起, endedAt: 起 + 8000, value: { ms: 8000, text: `第 ${i} 轮：${长段.repeat(3 + (i % 3))}`, steps: [], answer: { text: `第 ${i} 轮：${长段.repeat(3 + (i % 3))}`, records: [], customers: [], proposals: [] } } });
const 轮数 = 8;
const 轮们 = Array.from({ length: 轮数 }, (_, i) => ({ id: `t${i}`, question: `问题 ${i}：今天该跟谁`, kind: "ask", at: 起 + i * 1000 }));

async function 开(宽: number, 高: number): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const 手机 = 宽 < 768;
  const ctx = await browser.newContext({ viewport: { width: 宽, height: 高 }, reducedMotion: "reduce", hasTouch: 手机, isMobile: 手机 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const 壳 = 手机
    ? `<section class='ant-layout' style='min-height:100vh;display:flex;flex-direction:column'><header style='height:48px;flex:none'></header><main class='app-content' id='root' style='padding:22px 26px'></main></section>`
    : `<div class='shell'><nav style='width:220px;flex:none'></nav><aside class='pane' style='width:232px'></aside><main class='main app-content' style='padding:22px 26px'><div id='root' style='max-width:1720px;margin:0 auto'></div></main></div>`;
  await page.route("http://retry.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><body style='margin:0'>${壳}</body></html>` }));
  await page.goto("http://retry.test/dashboard");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([轮, 任务]) => { (window as unknown as { __jobs: unknown }).__jobs = 任务; (window as unknown as { __画: (el: Element, t: unknown) => void }).__画(document.getElementById("root")!, 轮); },
    [轮们, Object.fromEntries(轮们.map((t, i) => [`home:${t.id}`, 答(i)]))] as const);
  await page.locator(".cli-turn .cli-bar").first().waitFor({ state: "attached" });
  await page.waitForTimeout(80);
  if (errors.length) throw new Error(errors.join("\n"));
  return { page, errors, close: () => ctx.close() };
}

/** 第 i 轮的问句气泡、这一轮本身离框（.cli-log 可见区）顶多远 */
const 离顶 = (page: Page, i: number) => page.locator(".cli-log").evaluate((e, i) => {
  const L = e.getBoundingClientRect().top;
  const t = e.querySelectorAll<HTMLElement>(":scope > .cli-turn")[i];
  // `|| 0`：-0 和 0 在 toEqual 里不等
  return { 轮: Math.round(t.getBoundingClientRect().top - L) || 0, 问: Math.round(t.querySelector(".cli-bubble")!.getBoundingClientRect().top - L) || 0 };
}, i);
const 等顶到 = (page: Page, i: number) => page.waitForFunction((i) => {
  const e = document.querySelector(".cli-log")!;
  const t = e.querySelectorAll<HTMLElement>(":scope > .cli-turn")[i];
  return Math.abs(t.getBoundingClientRect().top - e.getBoundingClientRect().top) < 1;
}, i);
/** 重答后一段段流出来（每段多几行字、最后答完） */
async function 流(page: Page, id: string, 段数: number) {
  for (let n = 1; n <= 段数; n++) {
    const 字 = `重答：${长段.repeat(n * 2)}`;
    await page.evaluate(([id, 字, 完]) => (window as unknown as { __设任务: (k: string, v: unknown) => void }).__设任务(`home:${id}`, {
      status: 完 ? "done" : "running", startedAt: Date.now() - 3000, ...(完 ? { endedAt: Date.now() } : {}),
      value: { text: 字, ms: 3000, steps: [], ...(完 ? { answer: { text: 字, records: [], customers: [], proposals: [] } } : {}) },
    }), [id, 字, n === 段数] as const);
    await page.waitForTimeout(60);
  }
}

for (const [宽, 高] of [[1366, 900], [390, 844]] as const) {
  it(`重新回答（${宽}）：老对话最后一轮点「重新回答」，问句顶到框顶离顶 14、下面留一框高的空，流式不拽、不往下挪；同一轮再点一次也再顶`, async () => {
    const { page, errors, close } = await 开(宽, 高);
    try {
      const 末 = 轮数 - 1;
      // 打开时落在最底下，最后一轮问句不在框顶
      expect(await page.locator(".cli-log").evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight)).toBeLessThan(2);
      expect((await 离顶(page, 末)).轮).toBeGreaterThan(20);
      await page.locator(".cli-log > .cli-turn").nth(末).getByRole("button", { name: "重新回答" }).click();
      expect(await page.evaluate(() => (window as unknown as { __开跑: string[] }).__开跑)).toEqual([`t${末}`]);
      await expect.poll(() => page.locator(".cli-log > .cli-turn").nth(末).evaluate((e) => e.classList.contains("cli-turn-new"))).toBe(true);
      await 等顶到(page, 末);
      expect(await 离顶(page, 末)).toEqual({ 轮: 0, 问: 14 });
      // 下面留一框高的空（去掉底边留白）
      const [轮高, 框高] = await page.locator(".cli-log").evaluate((e, i) => [e.querySelectorAll<HTMLElement>(":scope > .cli-turn")[i].offsetHeight, e.clientHeight], 末);
      expect(轮高 + 16).toBeGreaterThanOrEqual(框高 - 1);
      // 流式一段段出来、答完：问句一直在离顶 14，不被拽、不往下挪
      await 流(page, `t${末}`, 5);
      expect(await 离顶(page, 末)).toEqual({ 轮: 0, 问: 14 });
      // 往上翻开，同一轮再点一次重新回答：「刚发的」没变，也要再顶一次（这一轮留着一框高，翻到底它还在框顶，所以往上翻）
      await page.locator(".cli-log").evaluate((e) => { e.scrollTop = 0; e.dispatchEvent(new Event("scroll")); });
      await page.waitForTimeout(50);
      expect((await 离顶(page, 末)).轮).toBeGreaterThan(100);
      await page.locator(".cli-log > .cli-turn").nth(末).getByRole("button", { name: "重新回答" }).click();
      await 等顶到(page, 末);
      await 流(page, `t${末}`, 3);
      expect(await 离顶(page, 末)).toEqual({ 轮: 0, 问: 14 });
      expect(errors).toEqual([]);
    } finally { await close(); }
  });
}

it("重新回答（中间一轮）：顶到框顶离顶 14，但不在两轮之间空出一框高；最后一轮不再留空", async () => {
  const { page, errors, close } = await 开(1366, 900);
  try {
    const 中 = 2;
    await page.locator(".cli-log > .cli-turn").nth(中).scrollIntoViewIfNeeded();
    await page.locator(".cli-log > .cli-turn").nth(中).hover();
    await page.locator(".cli-log > .cli-turn").nth(中).getByRole("button", { name: "重新回答" }).click();
    await 等顶到(page, 中);
    await 流(page, `t${中}`, 2);
    expect(await 离顶(page, 中)).toEqual({ 轮: 0, 问: 14 });
    // 这一轮紧贴下一轮：轮底 = 下一轮顶
    const 缝 = await page.locator(".cli-log").evaluate((e, i) => {
      const 们 = e.querySelectorAll<HTMLElement>(":scope > .cli-turn");
      return Math.round(们[i + 1].getBoundingClientRect().top - 们[i].getBoundingClientRect().bottom);
    }, 中);
    expect(缝).toBe(0);
    expect(errors).toEqual([]);
  } finally { await close(); }
});
