/**
 * 设计语言 HC-2b（11-22，用户选 C6-A / C11-A；依据 现在-首页对话-20261122.md HC-10 / HC-19，落地计划 HC-2b 节）：
 *   C6-A 回答里的客户名变链接、悬停出小卡（负责人、跟进状态、上次跟进；没有写「—」），点了去详情；手机（触屏）点了直接去、不出小卡
 *        从长到短、同名不同 id 不链、每个名字只链第一次（纯函数另有 ent-hc2b-entity-link.test.ts）
 *   页首第 4 件：「涉及 N 位客户」留着、缩成一行；名字也是链接，小卡里能起草跟进话术
 *   C11-A 只读被拒：一行带锁的说明（服务端固定标记 拒了写；流着时认 say_read_only 那一步），追问里不出写的动作
 *   超时：服务端结果事件带 code = timeout 才写「等了 N 秒没回来」，不看文案
 *
 * TurnView 真组件 + 真 StreamMarkdown / Markdown / AiStatus；任务表、起草、建议卡换桩（同 ai-status-turn.ui.test.ts）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ent-hc2b", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__去=u}});");
  stub(/^next\/link$/, "export default function Link({href,prefetch,...p}){return <a href={href} {...p} onClick={(e)=>{e.preventDefault();window.__去=href;p.onClick?.(e)}}/>}");
  stub(/^next\/dynamic$/, "export default ()=>()=>null;");
  stub(/(^|\/)ProposalCard$/, "export default function C(){return <div className='stub-card'/>}");
  stub(/(^|\/)ProposalBatch$/, "export default function B(){return <div className='stub-batch'/>}");
  stub(/(^|\/)(ResearchRun|ResearchPerson)$/, "export default function View(){return null};export function ResearchPick(){return null}");
  stub(/(^|\/)AiCost$/, "export default function Cost(){return null};export const useAiOutOfCredits=()=>false;");
  stub(/^@\/lib\/ai-jobs$/, "export const clearJob=()=>{},useJob=key=>key.startsWith('home:')?window.__job:((window.__草稿||{})[key]??null);");
  stub(/^@\/lib\/draft-jobs$/, "export const useCopyDraft=()=>()=>{},草稿键=(kind,id)=>'draft:'+kind+':'+id,起草=(k,id)=>{window.__起草=[k,id]};");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{App}from'antd';import Turn from'@/app/(app)/dashboard/TurnView';import{BusinessProvider}from'@/lib/business-client';import{DEFAULT_BUSINESS}from'@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    window.__render=(job,轮)=>{window.__job=job;flushSync(()=>root.render(<App><BusinessProvider value={DEFAULT_BUSINESS}><div className='cli'><div className='cli-log'><Turn key={Math.random()} turn={{id:'qa',question:'今天该跟谁',kind:'ask',at:Date.now(),...轮}} onRetry={()=>{}} onRemove={()=>{}} onAsk={(q)=>{window.__问=q}} scrollOnMount={false}/></div></div></BusinessProvider></App>))};`,
    loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 长 = "某某超长贸易进出口有限公司".repeat(4);
const 客户们 = [
  { id: "c1", name: "华东某展具公司", followStatus: "跟进中", owner: "销售甲", lastFollowAt: "11-19" },
  { id: "c2", name: "某展具", followStatus: "", owner: undefined, lastFollowAt: undefined },
  { id: "c3", name: 长, followStatus: "跟进中", owner: "销售乙", lastFollowAt: "11-02" },
  { id: "c4", name: "张三", followStatus: "", lastFollowAt: "11-20" },
  { id: "c5", name: "张三", followStatus: "", lastFollowAt: "11-21" },
];
const 答文 = `今天有 **3 位**该联系：\n- 华东某展具公司：约好今天回电，报价单已发\n- 某展具：6 天没跟\n- ${长}：指定今天 16:00 前回复\n\n张三那边下周再说；华东某展具公司的报价单周五前要回。`;
const 答完 = (改: Record<string, unknown> = {}) => ({ status: "done", startedAt: Date.now() - 4000, value: { ms: 4000, steps: [{ type: "step", id: "t0", label: "list_projects()", status: "done", at: Date.now() - 3000 }], text: 答文, answer: { text: 答文, records: [], customers: 客户们, proposals: [], ...改 } } });

type 开参 = { 宽?: number; 触屏?: boolean };
async function 开(o: 开参 = {}): Promise<{ page: Page; errors: string[] }> {
  const 宽 = o.宽 ?? 1366;
  const page = await browser.newPage({ viewport: { width: 宽, height: 900 }, reducedMotion: "reduce", hasTouch: !!o.触屏, isMobile: !!o.触屏 });
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://hc2b.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><body style='margin:0'><main style='padding:16px;max-width:760px'><div id='root'></div></main></body></html>` }));
  await page.goto("http://hc2b.test/dashboard");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  return { page, errors };
}
const 画 = (page: Page, job: unknown, 轮?: Record<string, unknown>) => page.evaluate(([j, t]) => (window as unknown as { __render: (j: unknown, t: unknown) => void }).__render(j, t), [job, 轮] as const);
const 不横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

it("C6-A（1366）：客户名变链接——从长到短、同名不同 id 不链、每个只链第一次；悬停出小卡（负责人 / 跟进状态 / 上次跟进，没有写「—」），点了去详情", async () => {
  const { page, errors } = await 开();
  try {
    await 画(page, 答完());
    const 链 = page.locator(".cli-a .md-ent");
    expect(await 链.allTextContents()).toEqual(["华东某展具公司", "某展具", 长]);
    expect(await 链.evaluateAll((es) => es.map((e) => e.getAttribute("href")))).toEqual(["/customers/c1", "/customers/c2", "/customers/c3"]);
    // 「华东某展具公司」里那截「某展具」不单独链；「某展具」链的是它自己那一行
    expect(await page.locator(".cli-a li").nth(1).locator(".md-ent").textContent()).toBe("某展具");
    // 同名不同 id 的「张三」不链；第二次出现的「华东某展具公司」也不链
    expect(await page.locator(".cli-a .md-p").last().locator(".md-ent").count()).toBe(0);
    // 链接样子：--brand-deep 字、下划线
    const 样 = await 链.first().evaluate((e) => { const s = getComputedStyle(e); return { c: s.color, u: s.textDecorationLine }; });
    const 深 = await page.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--brand-deep)"; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; });
    expect(样).toEqual({ c: 深, u: "underline" });
    // 悬停小卡
    await 链.first().hover();
    const 卡 = page.locator(".peek").filter({ hasText: "华东某展具公司" });
    await 卡.waitFor();
    expect(await 卡.locator("dd").allTextContents()).toEqual(["销售甲", "跟进中", "11-19"]);
    await page.mouse.move(5, 880);
    await expect.poll(() => page.locator(".ant-popover:not(.ant-popover-hidden) .peek").count()).toBe(0);
    await 链.nth(1).hover();
    const 卡2 = page.locator(".ant-popover:not(.ant-popover-hidden) .peek").filter({ hasText: "某展具" });
    await 卡2.waitFor();
    expect(await 卡2.locator("dd").allTextContents()).toEqual(["—", "—", "—"]);
    await 链.nth(1).click();
    expect(await page.evaluate(() => (window as unknown as { __去: string }).__去)).toBe("/customers/c2");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("涉及 N 位客户缩成一行：名字是链接、点间隔，不再是一张卡；小卡里「起草跟进话术」，起草好的就地展开", async () => {
  const { page, errors } = await 开();
  try {
    await 画(page, 答完({ customers: 客户们.slice(0, 2) }));
    expect(await page.locator(".cli-card").count()).toBe(0);
    const 行 = page.locator(".cli-inv");
    expect(await 行.locator(".cli-inv-h").textContent()).toBe("涉及 2 位客户：");
    expect(await 行.locator(".md-ent").allTextContents()).toEqual(["华东某展具公司", "某展具"]);
    // 一行：高度不超过一行字（13px · 行高 ≈ 20）
    expect((await 行.evaluate((e) => e.getBoundingClientRect().height))).toBeLessThan(28);
    // 和回答同一条左边线
    const [行左, 答左] = await page.evaluate(() => [document.querySelector(".cli-inv")!.getBoundingClientRect().left, document.querySelector(".cli-a")!.getBoundingClientRect().left]);
    expect(Math.abs(行左 - 答左)).toBeLessThanOrEqual(1);
    await 行.locator(".md-ent").first().hover();
    const 卡 = page.locator(".ant-popover:not(.ant-popover-hidden) .peek");
    await 卡.waitFor();
    await 卡.getByRole("button", { name: /起草跟进话术/ }).click();
    expect(await page.evaluate(() => (window as unknown as { __起草: unknown }).__起草)).toEqual(["wakeup", "c1"]);
    // 起草好了：在这一行下面展开
    await page.evaluate(() => { (window as unknown as { __草稿: Record<string, unknown> }).__草稿 = { "draft:wakeup:c1": { status: "done", value: "王总您好，报价单已发您邮箱。", startedAt: 0 } }; });
    await 画(page, 答完({ customers: 客户们.slice(0, 2) }));
    expect(await page.locator(".cli-inv-w .cli-draft").textContent()).toContain("王总您好");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("手机（390 触屏）：名字点了直接去详情、不出小卡；超长名字在涉及一行里折行不横滚", async () => {
  const { page, errors } = await 开({ 宽: 390, 触屏: true });
  try {
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);
    await 画(page, 答完());
    await page.locator(".cli-a .md-ent").first().tap();
    expect(await page.evaluate(() => (window as unknown as { __去: string }).__去)).toBe("/customers/c1");
    await page.waitForTimeout(400);
    expect(await page.locator(".peek").count()).toBe(0);
    expect(await 不横滚(page)).toBe(true);
    const 行 = await page.locator(".cli-inv").evaluate((e) => ({ r: e.getBoundingClientRect().right, sw: e.scrollWidth, cw: e.clientWidth }));
    expect(行.r).toBeLessThanOrEqual(390);
    expect(行.sw).toBeLessThanOrEqual(行.cw + 1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("手机（390 触屏）：小卡出不来，「涉及」那一行每个名字后面一颗「起草」（点击区 44），点了起草这一位；电脑上不摆", async () => {
  const { page, errors } = await 开({ 宽: 390, 触屏: true });
  try {
    await 画(page, 答完({ customers: 客户们.slice(0, 3) }));
    const 钮 = page.locator(".cli-inv .cli-inv-draft");
    expect(await 钮.count()).toBe(3);
    expect(await 钮.allTextContents()).toEqual(["起草", "起草", "起草"]);
    expect(await 钮.nth(1).getAttribute("aria-label")).toBe("起草跟进话术：某展具");
    for (const r of await 钮.evaluateAll((es) => es.map((e) => e.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height, r: r.right })))) {
      expect(r.w).toBeGreaterThanOrEqual(44);
      expect(r.h).toBeGreaterThanOrEqual(44);
      expect(r.r).toBeLessThanOrEqual(390);
    }
    // 起草钮不压着名字：名字和钮不重叠
    const 叠 = await page.locator(".cli-inv-i").evaluateAll((items) => items.some((it) => { const a = it.querySelector(".md-ent")!.getBoundingClientRect(), b = it.querySelector(".cli-inv-draft")!.getBoundingClientRect(); return a.right > b.left + 0.5 && a.bottom > b.top && b.bottom > a.top && a.left < b.right; }));
    expect(叠).toBe(false);
    await 钮.nth(1).tap();
    expect(await page.evaluate(() => (window as unknown as { __起草: unknown }).__起草)).toEqual(["wakeup", "c2"]);
    expect(await 不横滚(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  // 电脑（有悬停）：不摆这颗，起草在小卡里
  const pc = await 开();
  try {
    await 画(pc.page, 答完({ customers: 客户们.slice(0, 3) }));
    expect(await pc.page.locator(".cli-inv-draft").count()).toBe(0);
  } finally { await pc.page.close(); }
});

it("C11-A 只读被拒：一行带锁的说明（流着时认 say_read_only 那一步就出），追问里没有写的动作；只读但没要写：不出那一行", async () => {
  const { page, errors } = await 开();
  try {
    // 流着：步骤里有 say_read_only，正文还没出
    await 画(page, { status: "loading", startedAt: Date.now() - 2000, value: { steps: [{ type: "step", id: "t0", label: "say_read_only()", status: "done", at: Date.now() - 1000 }] } });
    expect(await page.locator(".cli-ro").textContent()).toBe("只读账号能问，不能让 AI 记录或修改");
    expect(await page.locator(".cli-ro .anticon-lock svg").count()).toBe(1);
    // 答完：服务端标记
    await 画(page, 答完({ 写不了: "管理员只能看", 拒了写: true }));
    expect(await page.locator(".cli-ro").count()).toBe(1);
    // 带锁那行在回答上面
    const [锁b, 答t] = await page.evaluate(() => [document.querySelector(".cli-ro")!.getBoundingClientRect().bottom, document.querySelector(".cli-a")!.getBoundingClientRect().top]);
    expect(锁b).toBeLessThanOrEqual(答t);
    const 追问 = await page.locator(".cli-next .cli-q").allTextContents();
    expect(追问.length).toBeGreaterThan(0);
    expect(追问.some((q) => /排一次跟进|记|改|删/.test(q))).toBe(false);
    // 只读、这一轮只是查：没有那一行，追问照样不给写的
    await 画(page, 答完({ 写不了: "管理员只能看" }));
    expect(await page.locator(".cli-ro").count()).toBe(0);
    expect((await page.locator(".cli-next .cli-q").allTextContents()).some((q) => q.includes("排一次跟进"))).toBe(false);
    // 能写的人照旧有「排一次跟进」
    await 画(page, 答完());
    expect((await page.locator(".cli-next .cli-q").allTextContents()).some((q) => q.includes("排一次跟进"))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("超时按 code 认：带 code=timeout 写「等了 N 秒没回来」；文案里有「超时」但没 code 不算", async () => {
  const { page, errors } = await 开();
  try {
    const 起 = Date.now() - 62_000;
    const 步 = [{ type: "step", id: "t0", label: "list_projects()", status: "running", at: 起 + 1000 }];
    await 画(page, { status: "error", error: "模型那边没回音", code: "timeout", startedAt: 起, endedAt: 起 + 60_000, value: { steps: 步 } });
    expect(await page.locator(".ais-tt").textContent()).toBe("等了 60 秒没回来");
    await 画(page, { status: "error", error: "AI 这次超时没回音，稍后再问一次试试", startedAt: 起, endedAt: 起 + 60_000, value: { steps: 步 } });
    expect(await page.locator(".ais-tt").textContent()).toBe("停在第 1 步：AI 这次超时没回音，稍后再问一次试试");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/** 一直按 Tab，直到焦点落到 sel 上（最多 40 下） */
async function Tab到(page: Page, sel: string) {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, sel)) return;
  }
  throw new Error(`Tab 不到 ${sel}`);
}
const 焦点 = (page: Page) => page.evaluate(() => { const e = document.activeElement as HTMLElement | null; return e ? (e.getAttribute("aria-label") || e.textContent || "").trim() : ""; });
const 开着的卡 = (page: Page) => page.locator(".ant-popover:not(.ant-popover-hidden) .peek");

it("#441 审查 2 键盘（1366）：Tab 到「涉及」里的名字出小卡，再 Tab 进卡里「起草跟进话术」、回车起草；Esc 关卡、焦点回名字；Tab 过卡尾到下一个名字", async () => {
  const { page, errors } = await 开();
  try {
    await 画(page, 答完({ customers: 客户们.slice(0, 2) }));
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    await Tab到(page, ".cli-inv .md-ent[data-peek='c1']");
    await expect.poll(() => 开着的卡(page).count()).toBe(1);
    expect(await 开着的卡(page).locator(".peek-n").textContent()).toBe("华东某展具公司");
    // 名字后面紧跟着就是卡里的东西：起草 → 打开客户
    await page.keyboard.press("Tab");
    expect(await 焦点(page)).toMatch(/^起草跟进话术/);
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => (window as unknown as { __起草: unknown }).__起草)).toEqual(["wakeup", "c1"]);
    expect(await 开着的卡(page).count(), "焦点在卡里，卡不关").toBe(1);
    // Esc：关卡，焦点回名字；按 Esc 不该再自己弹回来
    await page.keyboard.press("Escape");
    await expect.poll(() => 开着的卡(page).count()).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-peek"))).toBe("c1");
    await page.waitForTimeout(300);
    expect(await 开着的卡(page).count()).toBe(0);
    // 再 Tab：卡关着，直接到下一个名字，它的卡出来
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-peek"))).toBe("c2");
    await expect.poll(() => 开着的卡(page).locator(".peek-n").allTextContents()).toEqual(["某展具"]);
    // Tab 过这张卡的最后一项（打开客户）：卡关掉
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    expect(await 焦点(page)).toMatch(/^打开客户/);
    await page.keyboard.press("Tab");
    await expect.poll(() => 开着的卡(page).count()).toBe(0);
    // 鼠标点名字（不是键盘）不因为拿到焦点就出卡：照旧只看悬停
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("#441 审查 2 键盘（1366）：回答正文里的客户名 Tab 到也出小卡（负责人 / 状态 / 上次跟进），Esc 关", async () => {
  const { page, errors } = await 开();
  try {
    await 画(page, 答完());
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    await Tab到(page, ".cli-a .md-ent[data-peek='c1']");
    await expect.poll(() => 开着的卡(page).locator("dd").allTextContents()).toEqual(["销售甲", "跟进中", "11-19"]);
    await page.keyboard.press("Escape");
    await expect.poll(() => 开着的卡(page).count()).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-peek"))).toBe("c1");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("#441 审查 3：小卡「上次跟进」不是今年的带年份，今年的只写月-日；翻出来的历史轮次只给名字和「打开」，不摆当时的负责人 / 状态 / 上次跟进", async () => {
  const { page, errors } = await 开();
  try {
    const 今年 = new Date().getFullYear();
    const 们 = [
      { id: "c1", name: "华东某展具公司", followStatus: "跟进中", owner: "销售甲", lastFollowAt: `${今年 - 1}-03-04` },
      { id: "c2", name: "某展具", followStatus: "跟进中", owner: "销售乙", lastFollowAt: `${今年}-11-19` },
    ];
    await 画(page, 答完({ customers: 们 }));
    await page.locator(".cli-inv .md-ent").first().hover();
    await expect.poll(() => 开着的卡(page).locator("dd").allTextContents()).toEqual(["销售甲", "跟进中", `${今年 - 1}-03-04`]);
    await page.mouse.move(5, 880);
    await expect.poll(() => 开着的卡(page).count()).toBe(0);
    await page.locator(".cli-inv .md-ent").nth(1).hover();
    await expect.poll(() => 开着的卡(page).locator("dd").allTextContents()).toEqual(["销售乙", "跟进中", "11-19"]);
    await page.mouse.move(5, 880);
    await expect.poll(() => 开着的卡(page).count()).toBe(0);
    // 历史轮次（库里翻出来的）：小卡只有名字、起草和「打开」
    await 画(page, 答完({ customers: 们 }), { 历史: true });
    await page.locator(".cli-inv .md-ent").first().hover();
    const 卡 = 开着的卡(page);
    await 卡.waitFor();
    expect(await 卡.locator(".peek-n").textContent()).toBe("华东某展具公司");
    expect(await 卡.locator("dl").count()).toBe(0);
    expect(await 卡.getByRole("button", { name: /起草跟进话术/ }).count()).toBe(1);
    expect(await 卡.locator(".peek-go").textContent()).toContain("打开客户");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
