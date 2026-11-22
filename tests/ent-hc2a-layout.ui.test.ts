/**
 * 设计语言 HC-2a（11-22，回答排版、步骤条、操作行、打断 / 出错；依据 现在-首页对话-20261122.md HC-08/09/11/12/13/18/20，
 * 用户 11-22 选 C6-A / C7-A / C8-A / C11-A）：
 *   C6 一条左边线：步骤条圆点、正文、表格第一列、确认卡、涉及客户、追问、操作行第一颗图标同一个 x（±1）；
 *      表格数字列右对齐、等宽数字；宽表格在表格里横滑，页面不横滚；确认卡「确认」实心主色
 *   C7 步骤条不带框不带底
 *   C8 最后一轮操作行常显，之前的悬停才出；⋯ 往上弹：复制为表格（有表格才出）/ 引用到新问题 / 移除这一轮（红字）；
 *      移除照旧原地「已移除… 撤销」；触屏（390）常显、钮 44
 * 换皮主题（账簿）照旧：操作行每轮常显、还是 ×，没有 ⋯。
 *
 * 外面的结构照 HC-1 的一张纸（.cli-paper 框里滚），里面是真 TurnView + 真 StreamMarkdown；任务表、建议卡、背调、扣次数打桩。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ent-hc2a", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>'/dashboard';export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/dynamic$/, "export default ()=>()=>null;");
  stub(/(^|\/)ProposalCard$/, "export default function C({proposal}){return <div className='prop'><div className='prop-h'><span className='prop-t'>{proposal.subject}</span></div><div className='prop-foot'><button type='button' className='prop-ok'>确认</button></div></div>}");
  stub(/(^|\/)ProposalBatch$/, "export default function B(){return null}");
  stub(/(^|\/)(ResearchRun|ResearchPerson)$/, "export default function View(){return null};export function ResearchPick(){return null}");
  stub(/(^|\/)AiCost$/, "export default function Cost(){return null};export const useAiOutOfCredits=()=>false;");
  stub(/^@\/lib\/ai-jobs$/, "export const clearJob=()=>{},useJob=key=>(window.__jobs||{})[key];");
  stub(/^@\/lib\/draft-jobs$/, "export const useCopyDraft=()=>()=>{},草稿键=(kind,id)=>kind+id,起草=()=>{};");
  stub(/^@\/lib\/clipboard$/, "export const useCopy=()=>async(t,话)=>{window.__复制=[t,话]};");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

const 长 = "某某超长贸易进出口有限公司".repeat(3);
const 表 = [
  "| 客户 | 项目数 | 金额 | 最近跟进 |",
  "|---|---|---|---|",
  "| 华东展具 | 3 | ¥12,800 | 11-20 |",
  `| ${长} | 12 | ¥1,200,000 | 11-18 |`,
  "| 北岸游乐 | 7 | ¥960 | 11-02 |",
].join("\n");
const 宽表 = ["| " + Array.from({ length: 12 }, (_, i) => `第${i + 1}列标题`).join(" | ") + " |", "|" + "---|".repeat(12), "| " + Array.from({ length: 12 }, (_, i) => (i % 2 ? String(i * 1000) : `某项${i}内容较长`)).join(" | ") + " |"].join("\n");

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import TurnView from '@/app/(app)/dashboard/TurnView';
    import { 加引用 } from '@/app/(app)/dashboard/TurnMenu';
    window.__加引用 = 加引用;
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import { useIsNowSkin } from '@/lib/use-skin';
    let root;
    function 页({ 轮们 }) {
      const 现状 = useIsNowSkin();
      return (
        <div className={'cli' + (现状 ? ' cli-paper' : '')}><div className="cli-ck"><div className="cli-ck-g">
          <div className="cli-col cli-frame">
            {现状 && <div className="cli-head"><span className="cli-head-t">对话</span></div>}
            <div className="cli-log">
              {轮们.map((t) => <TurnView key={t.id} turn={t} onRetry={() => {}} onRemove={() => { window.__移除 = t.id; }} onAsk={() => {}} scrollOnMount={false} />)}
              <div />
            </div>
            <div className="cli-composer cli-composer-sticky"><div className="cli-input"><textarea rows={1} aria-label="问一句" /></div></div>
          </div>
        </div></div></div>
      );
    }
    window.__画 = (el, 轮们) => { root = createRoot(el); root.render(<ConfigProvider locale={zhCN}><App component={false}><BusinessProvider value={DEFAULT_BUSINESS}><页 轮们={轮们} /></BusinessProvider></App></ConfigProvider>); };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, plugins: [plugin], logLevel: "silent" });
  bundle = "window.process = { env: {} };\n" + r.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 起 = Date.now() - 20_000;
const 步 = (i: number, label: string, detail: string) => ({ type: "step", id: `tool-${i}`, label, status: "done", detail, at: 起 + (i + 1) * 2000 });
const 答 = (text: string, o: { 客户?: boolean; 卡?: boolean } = {}) => ({
  status: "done", startedAt: 起,
  value: { ms: 8000, text, steps: [步(0, "search_customers(华东)", "3 位"), 步(1, "list_projects()", "4 个")],
    answer: { text, records: [], customers: o.客户 ? [{ id: "c1", name: "华东展具", followStatus: "跟进中" }] : [], proposals: o.卡 ? [{ id: "p1", kind: "add_plan", customerId: "c1", customerName: "华东展具", reason: "", subject: "周五回电", plannedAt: "2026-11-23", method: "电话" }] : [] } },
});
const 轮们 = [
  { id: "t0", question: "今天该跟谁", kind: "ask", at: 起 },
  { id: "t1", question: "帮我给华东展具排个跟进", kind: "ask", at: 起 },
  { id: "t2", question: "按金额排一下我的客户", kind: "ask", at: 起 },
];
const 任务们 = {
  "home:t0": 答("今天有 **3 位**该联系：华东展具约好今天回电。", { 客户: true }),
  "home:t1": 答("排好了，确认一下：", { 卡: true }),
  "home:t2": 答(`按金额从高到低：\n\n${表}\n\n${宽表}\n\n就这些。`),
};

async function 开(宽: number, skin: "now" | "ledger" = "now"): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const 手机 = 宽 < 768;
  const ctx = await browser.newContext({ viewport: { width: 宽, height: 900 }, reducedMotion: "reduce", hasTouch: 手机, isMobile: 手机 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const 壳 = 手机
    ? `<section class='ant-layout' style='min-height:100vh;display:flex;flex-direction:column'><header style='height:48px;flex:none'></header><main class='app-content' id='root' style='padding:22px 26px'></main></section>`
    : `<div class='shell'><nav style='width:220px;flex:none'></nav><aside class='pane' style='width:232px'></aside><main class='main app-content' style='padding:22px 26px'><div id='root' style='max-width:1720px;margin:0 auto'></div></main></div>`;
  await page.route("http://hc2a.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html${skin === "now" ? "" : ` data-skin="${skin}" data-paper="tone" data-mode="light"`}><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><body style='margin:0'>${壳}</body></html>` }));
  await page.goto("http://hc2a.test/dashboard");
  for (const f of ["globals.css", ...(skin === "now" ? [] : ["skins/shared.css", `skins/${skin}.css`])]) await page.addStyleTag({ path: path.resolve("src/app", f) });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([轮, 任务]) => { (window as unknown as { __jobs: unknown }).__jobs = 任务; (window as unknown as { __画: (el: Element, t: unknown) => void }).__画(document.getElementById("root")!, 轮); }, [轮们, 任务们] as const);
  await page.locator(".cli-turn .cli-bar").first().waitFor({ state: "attached" });
  await page.waitForTimeout(50);
  if (errors.length) throw new Error(errors.join("\n"));
  return { page, errors, close: () => ctx.close() };
}
const 轮 = (page: Page, i: number) => page.locator(".cli-log > .cli-turn").nth(i);
/** 一段元素里第一个字（或图标）实际画在哪：文字取第一个非空文本节点的 Range，图标取 svg */
const 字左 = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => {
  const svg = e.querySelector("svg");
  if (svg) return svg.getBoundingClientRect().left;
  const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent!.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  const n = w.nextNode();
  if (!n) return e.getBoundingClientRect().left;
  const r = document.createRange(); r.setStart(n, n.textContent!.search(/\S/)); r.setEnd(n, n.textContent!.search(/\S/) + 1);
  return r.getBoundingClientRect().left;
});
const 盒左 = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => e.getBoundingClientRect().left);

for (const 宽 of [1366, 1024]) {
  it(`C6 一条左边线（${宽}）：圆点、正文、表格、确认卡、涉及客户、追问、操作行图标同一个 x；数字列右对齐；宽表格在表格里横滑`, async () => {
    const { page, errors, close } = await 开(宽);
    try {
      const 基 = await 字左(page, ".cli-turn:nth-child(1) .cli-a");
      const 各 = {
        圆点: await 盒左(page, ".cli-turn:nth-child(1) .ais-dot"),
        涉及客户: await 盒左(page, ".cli-turn:nth-child(1) .cli-card"),
        追问: await 盒左(page, ".cli-turn:nth-child(1) .cli-next"),
        操作行图标: await 字左(page, ".cli-turn:nth-child(1) .cli-bar .cli-ic"),
        确认卡: await 盒左(page, ".cli-turn:nth-child(2) .prop"),
        表格首列: await 字左(page, ".cli-turn:nth-child(3) .md-table th"),
        第三轮正文: await 字左(page, ".cli-turn:nth-child(3) .cli-a"),
      };
      for (const [名, x] of Object.entries(各)) expect(Math.abs(x - 基), `${名} x=${x} 正文 x=${基}`).toBeLessThanOrEqual(1);
      // 正文 14 / 行高 1.7
      expect(await page.locator(".cli-turn:nth-child(1) .cli-a").evaluate((e) => { const c = getComputedStyle(e); return [c.fontSize, Math.round(parseFloat(c.lineHeight) / parseFloat(c.fontSize) * 100) / 100]; })).toEqual(["14px", 1.7]);
      // 数字列右对齐、等宽数字；文字列左对齐
      const 格 = page.locator(".cli-turn:nth-child(3) .md-table").first().locator("tbody tr").first().locator("td");
      expect(await 格.nth(0).evaluate((e) => getComputedStyle(e).textAlign)).toBe("left");
      for (const j of [1, 2]) expect(await 格.nth(j).evaluate((e) => [getComputedStyle(e).textAlign, getComputedStyle(e).fontVariantNumeric])).toEqual(["right", "tabular-nums"]);
      expect(await 格.nth(3).evaluate((e) => e.classList.contains("md-num"))).toBe(false);
      // 宽表格：在表格里横滑，不撑出对话列、页面不横滚
      const 滑 = await page.locator(".cli-turn:nth-child(3) .md-tw").nth(1).evaluate((e) => ({ 能滑: e.scrollWidth > e.clientWidth, 列内: e.getBoundingClientRect().right <= e.closest(".cli-turn")!.getBoundingClientRect().right + 1 }));
      expect(滑).toEqual({ 能滑: true, 列内: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // 步骤条不带框；确认卡「确认」实心主色
      expect(await page.locator(".ais").first().evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("0px");
      const 主色 = await page.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--brand)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
      expect(await page.locator(".prop-ok").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(主色);
      expect(errors).toEqual([]);
    } finally { await close(); }
  });
}

it("C8 操作行：最后一轮常显，之前的悬停才出；⋯ 往上弹，复制为表格 / 引用到新问题 / 移除这一轮", async () => {
  const { page, errors, close } = await 开(1366);
  try {
    const 透明 = (i: number) => 轮(page, i).locator(".cli-bar").evaluate((e) => getComputedStyle(e).opacity);
    expect(await 透明(2)).toBe("1");
    expect(await 透明(0)).toBe("0");
    await 轮(page, 0).locator(".cli-a").hover();
    await expect.poll(() => 透明(0)).toBe("1");
    // × 收进 ⋯；时间在末尾
    expect(await page.getByRole("button", { name: "移除这一轮" }).count()).toBe(0);
    expect(await 轮(page, 0).locator(".cli-bar > :last-child").evaluate((e) => e.classList.contains("cli-bar-t"))).toBe(true);
    // 没有表格的那一轮：没有「复制为表格」
    await 轮(page, 0).getByRole("button", { name: "这一轮的更多操作" }).click();
    let 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden)");
    await 菜单.waitFor();
    expect(await 菜单.locator(".ant-dropdown-menu-item").allInnerTexts()).toEqual(["引用到新问题", "移除这一轮"]);
    await page.keyboard.press("Escape");
    await 菜单.waitFor({ state: "hidden" });
    // 有表格的最后一轮
    await page.locator(".cli-log").evaluate((e) => { e.scrollTop = e.scrollHeight; });
    const 钮 = 轮(page, 2).getByRole("button", { name: "这一轮的更多操作" });
    await 钮.click();
    菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden)");
    await 菜单.waitFor();
    expect(await 菜单.locator(".ant-dropdown-menu-item").allInnerTexts()).toEqual(["复制为表格", "引用到新问题", "移除这一轮"]);
    expect(await 菜单.locator(".ant-dropdown-menu-item-danger").innerText()).toBe("移除这一轮");
    // 往上弹：菜单底边在钮的上面
    const 钮盒 = await 钮.boundingBox();
    const 菜盒 = await 菜单.locator(".ant-dropdown-menu").boundingBox();
    expect(菜盒!.y + 菜盒!.height).toBeLessThanOrEqual(钮盒!.y + 1);
    await 菜单.getByText("复制为表格").click();
    const [复制, 话] = await page.evaluate(() => (window as unknown as { __复制: [string, string] }).__复制);
    expect(话).toBe("已复制表格");
    expect(复制.split("\n").slice(0, 3)).toEqual(["客户\t项目数\t金额\t最近跟进", "华东展具\t3\t¥12,800\t11-20", `${长}\t12\t¥1,200,000\t11-18`]);
    // 引用到新问题：事件冒到对话根，带着这一问
    await page.evaluate(() => { document.querySelector(".cli")!.addEventListener("cli:quote", (e) => { (window as unknown as { __引用: unknown }).__引用 = (e as CustomEvent).detail; }); });
    await 钮.click();
    await page.locator(".ant-dropdown:not(.ant-dropdown-hidden)").getByText("引用到新问题").click();
    expect(await page.evaluate(() => (window as unknown as { __引用: unknown }).__引用)).toBe("按金额排一下我的客户");
    // 移除：原地「已移除… 撤销」，不另弹确认
    await 钮.click();
    await page.locator(".ant-dropdown:not(.ant-dropdown-hidden)").getByText("移除这一轮").click();
    await 轮(page, 2).locator(".cli-turn-gone-t").waitFor();
    expect(await page.locator(".ant-modal").count()).toBe(0);
    await 轮(page, 2).getByRole("button", { name: "撤销" }).click();
    await 轮(page, 2).locator(".cli-a").waitFor();
    expect(errors).toEqual([]);
  } finally { await close(); }
});

it("C8 ⋯ 补点（#420 审查）：⋯ 有提示「更多」、菜单打开焦点进菜单；引用选中的字（按下 ⋯ 那一刻存下，之后选区没了也照样引）；连着引用不叠两层；移除的那轮不算「后面还有一轮」", async () => {
  const { page, errors, close } = await 开(1366);
  try {
    await page.evaluate(() => { document.querySelector(".cli")!.addEventListener("cli:quote", (e) => { (window as unknown as { __引用: unknown }).__引用 = (e as CustomEvent).detail; }); });
    const 钮0 = 轮(page, 0).getByRole("button", { name: "这一轮的更多操作" });
    await 轮(page, 0).locator(".cli-a").hover();
    await 钮0.hover();
    await expect.poll(() => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: "更多" }).count()).toBe(1);
    // 在第 0 轮回答里选一段字，再点 ⋯
    const 选的 = await 轮(page, 0).locator(".cli-a").evaluate((e) => {
      const 走 = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      const t = 走.nextNode() as Text;
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, Math.min(4, t.length));
      const 选 = window.getSelection()!; 选.removeAllRanges(); 选.addRange(r);
      return 选.toString();
    });
    expect(选的.length).toBeGreaterThan(0);
    await 钮0.click();
    const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden)");
    await 菜单.waitFor();
    // 菜单打开焦点进菜单（键盘能直接上下选）
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".ant-dropdown"))).toBe(true);
    // 菜单开着时选区没了（焦点挪走、点击收掉选区）：仍引用按下 ⋯ 那一刻选中的字
    await page.evaluate(() => window.getSelection()!.removeAllRanges());
    await 菜单.getByText("引用到新问题").click();
    expect(await page.evaluate(() => (window as unknown as { __引用: unknown }).__引用)).toBe(选的.replace(/\s+/g, " ").trim());
    // 没选字：引用这一问
    await 钮0.click();
    await page.locator(".ant-dropdown:not(.ant-dropdown-hidden)").getByText("引用到新问题").click();
    expect(await page.evaluate(() => (window as unknown as { __引用: unknown }).__引用)).toBe("今天该跟谁");
    // 连着引用：开头已有的引用先去掉，不叠两层
    const 加 = (原: string, 片段: string) => page.evaluate(([原, 片段]) => (window as unknown as { __加引用: (a: string, b: string) => string }).__加引用(原, 片段), [原, 片段] as const);
    expect(await 加("", "今天该跟谁")).toBe("关于「今天该跟谁」：");
    expect(await 加("关于「今天该跟谁」：", "华东展具")).toBe("关于「华东展具」：");
    expect(await 加("关于「今天该跟谁」：要不要先打电话", "华东展具")).toBe("关于「华东展具」：要不要先打电话");
    expect(await 加("关于「a」：关于「b」：接着问", "c")).toBe("关于「c」：接着问");
    expect(await 加("我想问关于「a」：的事", "c")).toBe("关于「c」：我想问关于「a」：的事");
    // 最后一轮移除（还在「已移除… 撤销」那 5 秒）：前一轮就是看得见的最后一轮，操作行常显
    await expect.poll(() => page.locator(".ant-dropdown:not(.ant-dropdown-hidden)").count()).toBe(0);
    await page.locator(".cli-log").evaluate((e) => { e.scrollTop = e.scrollHeight; });
    await 轮(page, 2).getByRole("button", { name: "这一轮的更多操作" }).click();
    await page.locator(".ant-dropdown:not(.ant-dropdown-hidden)").getByText("移除这一轮").click();
    await 轮(page, 2).locator(".cli-turn-gone-t").waitFor();
    await page.mouse.move(1, 1);
    await expect.poll(() => 轮(page, 1).locator(".cli-bar").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    expect(await 轮(page, 0).locator(".cli-bar").evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
    expect(errors).toEqual([]);
  } finally { await close(); }
});

it("C8 触屏 390：每轮操作行常显、钮 44；页面不横滚", async () => {
  const { page, errors, close } = await 开(390);
  try {
    for (const i of [0, 2]) expect(await 轮(page, i).locator(".cli-bar").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    const 钮们 = await 轮(page, 0).locator(".cli-bar .cli-ic").evaluateAll((es) => es.map((e) => { const r = e.getBoundingClientRect(); return [r.width >= 44, r.height >= 44]; }));
    expect(钮们.length).toBeGreaterThanOrEqual(2);
    for (const b of 钮们) expect(b).toEqual([true, true]);
    // 第一颗图标仍和正文同一条线
    expect(Math.abs((await 字左(page, ".cli-turn:nth-child(1) .cli-bar .cli-ic")) - (await 字左(page, ".cli-turn:nth-child(1) .cli-a")))).toBeLessThanOrEqual(1);
    // 步骤条展开钮点击区 ≥ 44（--hit-touch），那一行不变高（负外边距收回，仍约 28）（#420 审查挡合 2）
    const 步骤 = await 轮(page, 0).locator(".ais-hd").evaluate((e) => ({ 行: e.getBoundingClientRect().height, 钮: e.querySelector("button.ais-hd-b")!.getBoundingClientRect().height }));
    expect(步骤.钮).toBeGreaterThanOrEqual(44);
    expect(步骤.行, "步骤条那一行仍是原来的一行高（没被 44 撑高）").toBeLessThan(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await close(); }
});

it("换皮主题（账簿）照旧：每轮操作行常显、还是 ×，没有 ⋯；步骤条还是框", async () => {
  const { page, errors, close } = await 开(1366, "ledger");
  try {
    expect(await 轮(page, 0).locator(".cli-bar").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    expect(await page.getByRole("button", { name: "移除这一轮" }).count()).toBe(3);
    expect(await page.getByRole("button", { name: "这一轮的更多操作" }).count()).toBe(0);
    expect(await page.locator(".cli-turn .md-num").count()).toBeGreaterThan(0); // class 照加，账簿不给样子
    expect(await page.locator(".ais").first().evaluate((e) => getComputedStyle(e).borderTopWidth)).not.toBe("0px");
    expect(errors).toEqual([]);
  } finally { await close(); }
});
