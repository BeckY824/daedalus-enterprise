/**
 * 录音点评 PR2（11-22）「传录音文件」界面（projects/[id]/CoachRecUpload.tsx、CoachTopics.tsx StartReviewButton）：
 *   - 开关关着（没有 数据.录音）：「发起点评 ▾」下拉和原来一样，只有写点评、录音点评两项，没有传录音文件
 *   - 开着：电脑下拉多一项「传录音文件」；手机 390 宽改成底部选择板，三项纵排、每项 ≥44 高（--hit-touch）
 *   - 传：选文件 → 显示名字、大小 → 开始上传 → 每片 PUT（5MB 一片）→ 传完 → 待提交卡；>20MB 提示连 Wi-Fi；>200MB 不让传
 *   - 断网：一片重试 3 次还不行就停下写「网络断了，已传 N%」，点「继续」从断的那片接着传（不重传已收的片）
 *   - 续传：草稿条「上次传到 N%」→「接着传」→ 选同一个文件只补没收到的片；选别的文件先问换不换
 *   - 手机 390 宽：传文件框整屏，底部按钮通栏、点得中；超长文件名、草稿条不横向撑出；框里、草稿条、待提交卡、删前确认条的按钮都 ≥44 高
 *   - 服务器忙（429）按 Retry-After 等，不算进 3 次重试；「继续」时原来那条已经是待提交 → 直接显示完成，不再传
 *   - 框里显示的本机文件名号码打码；字节数没有时写「—」
 * 网络用页面里的假 fetch（记下每次请求），重试间隔用假时钟快进。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "coach-rec-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷=(window.__刷??0)+1},push(){}});");
  stub(/coach-topic-actions$/, "export const 发主题动作=async()=>({ok:true});export const 回复主题动作=async()=>({ok:true});export const 关闭主题动作=async()=>({ok:true});export const 删主题动作=async()=>({ok:true});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import CoachTopics,{StartReviewButton} from '@/app/(app)/projects/[id]/CoachTopics';
    const root=createRoot(document.getElementById('root'));
    const 长项目='项目名很长'+'Y'.repeat(120);
    const 基=(录音)=>({们:[],能发:true,填写人:{id:'u1',name:'教练',身份:'销售教练'},负责人:{id:'u2',name:'负责人'},项目名:长项目,当前节点:'线索验证',待回复数:0,冻结:false,...(录音?{录音:{可录:true,...录音}}:{})});
    window.__render=(what,录音)=>root.render(<App><div className="card-like" style={{maxWidth:'min(560px, calc(100vw - 32px))',margin:'0 auto',padding:16,border:'1px solid #ddd'}}>{
      what==='form'?<StartReviewButton 数据={基(录音)} projectId='p1'/>:<CoachTopics 数据={基(录音)} projectId='p1'/>
    }</div></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const MB = 1024 * 1024;
/**
 * 页面里的假服务器：start 回一条新录音；chunk 记片号（失败名单里的片号一直回 503）；finish 回待提交；status 回 window.__已收
 */
const 假服务器 = () => {
  const MB = 1024 * 1024; // 在页面里跑：拿不到外面的常量
  const w = window as unknown as Record<string, unknown> & { __请求: string[]; __坏片: Set<number>; __已收: { 段: number; 片: number; 字节: number }[] };
  w.__请求 = [];
  w.__坏片 = new Set();
  w.__已收 = [];
  (w as Record<string, unknown>).__忙 = 0;
  (w as Record<string, unknown>).__已完 = false;
  const 回 = (状态: number, 体: unknown) => new Response(JSON.stringify(体), { status: 状态, headers: { "content-type": "application/json" } });
  const 录 = (x: object) => ({ id: "crec1", status: "上传中", sourceKind: "上传", 文件名: "x", 总字节: 0, 已收字节: 0, 已收片: [], 格式: null, 开始于: "", 更新于: "", 能听: false, ...x });
  window.fetch = (async (url: string, init?: RequestInit) => {
    const 法 = init?.method ?? "GET";
    w.__请求.push(`${法} ${url}`);
    if (url === "/api/coach-rec/start") { const b = JSON.parse(String(init!.body)); return 回(200, { ok: true, 录音: 录(b && { 文件名: b.fileName, 总字节: b.bytes }) }); }
    const m = /\/chunk\/1\/(\d+)$/.exec(url);
    if (m) {
      if ((w.__忙 as number) > 0) { (w as Record<string, unknown>).__忙 = (w.__忙 as number) - 1; return new Response(JSON.stringify({ error: "同时在传的太多" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } }); }
      if (w.__坏片.has(Number(m[1]))) return 回(503, { error: "忙" });
      w.__已收.push({ 段: 1, 片: Number(m[1]), 字节: (init!.body as Blob).size });
      return 回(200, { ok: true });
    }
    if (url.endsWith("/status")) {
      if (w.__已完) return 回(200, { ok: true, 录音: 录({ status: "待提交", 文件名: "通话录音.m4a", 总字节: 12 * MB, 已收字节: 12 * MB, 能听: true }) });
      return 回(200, { ok: true, 录音: 录({ 文件名: "通话录音.m4a", 总字节: 12 * MB, 已收片: w.__已收, 已收字节: w.__已收.reduce((a, x) => a + x.字节, 0) }) });
    }
    if (url.endsWith("/submit") || url.endsWith("/retry")) return 回(200, { ok: true, 录音: 录({ id: url.split("/")[3], status: "转写中", 文件名: "通话录音.m4a", 总字节: 12 * MB, 已收字节: 12 * MB, 更新于: "9999", 时长毫秒: 65_000 }) });
    if (url.endsWith("/finish")) return 回(200, { ok: true, 录音: 录({ status: "待提交", 文件名: "通话录音.m4a", 已收字节: 12 * MB, 能听: true }) });
    if (url.endsWith("/abandon")) return 回(200, { ok: true });
    return 回(404, { error: "没有" });
  }) as typeof fetch;
};

async function open(what: "list" | "form", 录音: unknown, width = 1366, 假钟 = false) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://crec.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://crec.test");
  if (假钟) await page.clock.install();
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.evaluate(假服务器);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([w, r]) => (window as unknown as { __render: (x: string, r: unknown) => void }).__render(w as string, r), [what, 录音] as const);
  return { page, errors };
}
const 请求们 = (page: Page) => page.evaluate(() => (window as unknown as { __请求: string[] }).__请求);
const 文件 = (name: string, 大小: number) => ({ name, mimeType: "audio/mp4", buffer: Buffer.alloc(大小, 1) });
const 点得中 = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit)) && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
});
const 按钮高 = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
const 没撑出 = (page: Page) => page.evaluate(() => {
  const 坏: string[] = [];
  if (document.documentElement.scrollWidth > window.innerWidth) 坏.push(`页面 ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
  for (const el of document.querySelectorAll<HTMLElement>(".crec-form, .crec-file, .crec-row, .crec-draft-row, .crec-pending, .crec-sheet-list, .card-like, .ant-modal-container, .ant-modal-content")) {
    if (el.scrollWidth > el.clientWidth + 1) 坏.push(`${el.className} ${el.scrollWidth} > ${el.clientWidth}`);
  }
  return 坏;
});

it("开关关着：下拉只有写点评、录音点评，没有传录音文件", async () => {
  const { page, errors } = await open("form", undefined);
  await page.getByTestId("coach-topic-new").click();
  await page.getByTestId("coach-review-write").waitFor();
  expect(await page.getByTestId("coach-review-upload").count()).toBe(0);
  expect(await page.locator(".rec-head-menu .ant-dropdown-menu-item").count()).toBe(2);
  expect(errors).toEqual([]);
  await page.close();
});

it("开着、电脑：下拉多一项传录音文件；选 12MB 文件 → 3 片 → 传完出待提交卡、刷新页面", async () => {
  const { page, errors } = await open("form", { 草稿们: [] }, 1280);
  await page.getByTestId("coach-topic-new").click();
  await page.getByTestId("coach-review-upload").click();
  await page.getByTestId("crec-upload").waitFor();
  expect(await page.getByTestId("crec-start").isDisabled()).toBe(true);
  await page.getByTestId("crec-file").setInputFiles(文件("通话录音.m4a", 12 * MB));
  expect(await page.getByTestId("crec-file-info").innerText()).toContain("12.0MB");
  await page.getByTestId("crec-start").click();
  await page.getByTestId("crec-pending").waitFor();
  expect(await 请求们(page)).toEqual(["POST /api/coach-rec/start", "PUT /api/coach-rec/crec1/chunk/1/0", "PUT /api/coach-rec/crec1/chunk/1/1", "PUT /api/coach-rec/crec1/chunk/1/2", "POST /api/coach-rec/crec1/finish"]);
  const 片们 = await page.evaluate(() => (window as unknown as { __已收: { 字节: number }[] }).__已收.map((x) => x.字节));
  expect(片们).toEqual([5 * MB, 5 * MB, 2 * MB]);
  expect(await page.getByTestId("crec-submit").isDisabled()).toBe(false); // 提交整理：录音可用（PR4）时能点
  expect(await page.evaluate(() => (window as unknown as { __刷?: number }).__刷)).toBe(1);
  expect(errors).toEqual([]);
  await page.close();
});

it("提交整理（PR4）：点了 POST submit、卡上变「正在转写」带服务端时长、删掉收起；整理失败的写原因、给重试整理；不可录时不出传录音文件、提交整理灰着", async () => {
  const 待 = { id: "crec2", status: "待提交", sourceKind: "上传", 文件名: "通话录音.m4a", 总字节: 12 * MB, 已收字节: 12 * MB, 已收片: [], 格式: "m4a", 开始于: "", 更新于: "1", 能听: false };
  const 败 = { ...待, id: "crec3", status: "整理失败", 错: "腾讯云读不了这个录音（格式或内容有问题）" };
  const { page, errors } = await open("list", { 草稿们: [待, 败] }, 1280);
  const 卡 = page.getByTestId("crec-pending");
  expect(await 卡.nth(1).getByTestId("crec-fail").innerText()).toBe("腾讯云读不了这个录音（格式或内容有问题）");
  await 卡.nth(0).getByTestId("crec-submit").click();
  await page.locator("[data-testid=crec-pending][data-status=转写中]").waitFor();
  expect(await 卡.nth(0).innerText()).toContain("正在转写，好了会通知你");
  expect(await 卡.nth(0).innerText()).toContain("1:05");
  expect(await 卡.nth(0).getByRole("button", { name: "删掉" }).count()).toBe(0);
  await 卡.nth(1).getByTestId("crec-retry").click();
  await page.locator("[data-testid=crec-pending][data-status=转写中]").nth(1).waitFor();
  expect(await 请求们(page)).toEqual(["POST /api/coach-rec/crec2/submit", "POST /api/coach-rec/crec3/retry"]);
  expect(errors).toEqual([]);
  await page.close();
  const 灰列 = await open("list", { 草稿们: [待], 可录: false }, 1280);
  expect(await 灰列.page.getByTestId("crec-submit").isDisabled()).toBe(true);
  await 灰列.page.close();
  const 灰 = await open("form", { 草稿们: [待], 可录: false }, 1280);
  await 灰.page.getByTestId("coach-topic-new").click();
  await 灰.page.getByTestId("coach-review-write").waitFor();
  expect(await 灰.page.getByTestId("coach-review-upload").count()).toBe(0);
  await 灰.page.close();
});

it("超过 200MB 不让传；超过 20MB 提示连 Wi-Fi", async () => {
  const { page } = await open("form", { 草稿们: [] }, 1280);
  await page.getByTestId("coach-topic-new").click();
  await page.getByTestId("coach-review-upload").click();
  await page.getByTestId("crec-file").setInputFiles(文件("大.m4a", 25 * MB));
  expect(await page.getByTestId("crec-file-info").innerText()).toContain("建议连 Wi-Fi");
  expect(await page.getByTestId("crec-start").isDisabled()).toBe(false);
  // 200MB 以上：不真造 200MB 的文件——塞一个 size 改大的假 File
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("[data-testid=crec-file]")!;
    const f = new File(["x"], "太大.m4a", { type: "audio/mp4" });
    Object.defineProperty(f, "size", { value: 201 * 1024 * 1024 });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(await page.getByRole("alert").first().innerText()).toContain("超过 200MB");
  expect(await page.getByTestId("crec-start").isDisabled()).toBe(true);
  await page.close();
});

it("断网：一片重试 3 次还不行就停下写已传几成；网好了点继续，只补没传的片", async () => {
  const { page } = await open("form", { 草稿们: [] }, 1280, true);
  await page.evaluate(() => (window as unknown as { __坏片: Set<number> }).__坏片.add(1));
  await page.getByTestId("coach-topic-new").click();
  await page.getByTestId("coach-review-upload").click();
  await page.getByTestId("crec-file").setInputFiles(文件("通话录音.m4a", 12 * MB));
  await page.getByTestId("crec-start").click();
  // 重试隔 2 / 5 / 15 秒：快进
  for (let i = 0; i < 4; i++) await page.clock.runFor(16_000);
  await page.getByTestId("crec-stopped").waitFor();
  expect(await page.getByTestId("crec-stopped").innerText()).toMatch(/网络断了，已传 41%/);
  const 坏的次数 = (await 请求们(page)).filter((r) => r.endsWith("/chunk/1/1")).length;
  expect(坏的次数).toBe(4);
  await page.evaluate(() => (window as unknown as { __坏片: Set<number> }).__坏片.clear());
  await page.getByTestId("crec-resume").click();
  await page.getByTestId("crec-pending").waitFor();
  const 后来 = (await 请求们(page)).slice(-4);
  expect(后来).toEqual(["GET /api/coach-rec/crec1/status", "PUT /api/coach-rec/crec1/chunk/1/1", "PUT /api/coach-rec/crec1/chunk/1/2", "POST /api/coach-rec/crec1/finish"]);
  await page.close();
});

it("服务器忙（429）按 Retry-After 等、不算进 3 次重试：连着忙 6 回照样传完", async () => {
  const { page } = await open("form", { 草稿们: [] }, 1280, true);
  await page.evaluate(() => { (window as unknown as { __忙: number }).__忙 = 6; });
  await page.getByTestId("coach-topic-new").click();
  await page.getByTestId("coach-review-upload").click();
  await page.getByTestId("crec-file").setInputFiles(文件("通话录音.m4a", 6 * MB));
  await page.getByTestId("crec-start").click();
  for (let i = 0; i < 8; i++) await page.clock.runFor(1_500);
  await page.getByTestId("crec-pending").waitFor();
  expect(await page.getByTestId("crec-stopped").count()).toBe(0);
  expect((await 请求们(page)).filter((r) => r.endsWith("/chunk/1/0")).length).toBe(7);
  await page.close();
});

it("「继续」时原来那条已经是待提交（上次传完的回话断了）：直接显示完成，不新开、不重传", async () => {
  const { page } = await open("form", { 草稿们: [] }, 1280, true);
  await page.evaluate(() => (window as unknown as { __坏片: Set<number> }).__坏片.add(1));
  await page.getByTestId("coach-topic-new").click();
  await page.getByTestId("coach-review-upload").click();
  await page.getByTestId("crec-file").setInputFiles(文件("通话录音.m4a", 12 * MB));
  await page.getByTestId("crec-start").click();
  for (let i = 0; i < 4; i++) await page.clock.runFor(16_000);
  await page.getByTestId("crec-stopped").waitFor();
  await page.evaluate(() => { (window as unknown as { __已完: boolean }).__已完 = true; });
  const 之前 = (await 请求们(page)).length;
  await page.getByTestId("crec-resume").click();
  await page.getByTestId("crec-pending").waitFor();
  expect((await 请求们(page)).slice(之前)).toEqual(["GET /api/coach-rec/crec1/status"]);
  expect(await page.getByTestId("crec-pending").innerText()).toContain("12.0MB");
  await page.close();
});

it("框里显示的本机文件名号码打码（安卓通话录音的写法）", async () => {
  const { page } = await open("form", { 草稿们: [] }, 1280);
  await page.getByTestId("coach-topic-new").click();
  await page.getByTestId("coach-review-upload").click();
  for (const 名 of ["通话录音-13812345678-20261122.m4a", "通话录音 13812345678 20261122093012.m4a", "record-13812345678.m4a"]) {
    await page.getByTestId("crec-file").setInputFiles(文件(名, 1 * MB));
    const 显示 = page.locator("[data-testid=crec-file-info] .crec-file-name");
    expect(await 显示.innerText()).not.toContain("13812345678");
    expect(await 显示.getAttribute("title")).not.toContain("13812345678");
  }
  await page.close();
});

it("草稿条续传：选同一个文件只补没收到的片；选别的文件先问换不换", async () => {
  const 草稿 = { id: "crec1", status: "上传中", sourceKind: "上传", 文件名: "通话录音.m4a", 总字节: 12 * MB, 已收字节: 5 * MB, 已收片: [{ 段: 1, 片: 0, 字节: 5 * MB }], 格式: "m4a", 开始于: "", 更新于: "", 能听: false };
  const { page } = await open("list", { 草稿们: [草稿] }, 1280);
  await page.evaluate(() => (window as unknown as { __已收: unknown[] }).__已收.push({ 段: 1, 片: 0, 字节: 5 * 1024 * 1024 }));
  expect(await page.getByTestId("crec-draft").innerText()).toContain("上次传到 41%");
  await page.getByTestId("crec-continue").click();
  await page.getByTestId("crec-file").setInputFiles(文件("别的.m4a", 3 * MB));
  expect(await page.getByRole("alert").first().innerText()).toContain("对不上");
  await page.getByTestId("crec-file").setInputFiles(文件("通话录音.m4a", 12 * MB));
  await page.getByTestId("crec-start").click();
  await page.getByTestId("crec-pending").waitFor();
  expect(await 请求们(page)).toEqual(["GET /api/coach-rec/crec1/status", "PUT /api/coach-rec/crec1/chunk/1/1", "PUT /api/coach-rec/crec1/chunk/1/2", "POST /api/coach-rec/crec1/finish"]);
  await page.close();
});

it("手机 390：底部选择板三项、每项 ≥44 高；传文件框整屏、底部按钮通栏点得中；超长名字不撑出", async () => {
  const { page, errors } = await open("form", { 草稿们: [] }, 390);
  await page.getByTestId("coach-topic-new").click();
  await page.getByTestId("coach-review-sheet").waitFor();
  const 项 = await page.locator(".crec-sheet-item").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(项.length).toBe(3);
  for (const h of 项) expect(h).toBeGreaterThanOrEqual(44);
  expect(await 没撑出(page)).toEqual([]);
  await page.locator(".crec-sheet-item").nth(1).click();
  await page.getByTestId("crec-upload").waitFor();
  await page.getByTestId("crec-file").setInputFiles(文件(`通话录音${"很长的名字".repeat(30)}.m4a`, 1 * MB));
  const 框 = await page.locator(".crec-modal :is(.ant-modal-container, .ant-modal-content)").evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }));
  expect(框.w).toBe(390);
  expect(框.h).toBeGreaterThanOrEqual(800);
  // 弹框打开的缩放动画走完再量点得中、量按钮高
  await page.waitForFunction(() => !document.querySelector(".crec-modal.ant-zoom-appear, .crec-modal.ant-zoom-enter"));
  // 「换一个文件」和底部「取消 / 开始上传」：390 宽都 ≥44 高
  const 框里 = await 按钮高(page, ".crec-form .ant-btn, .crec-modal .ant-modal-footer .ant-btn");
  expect(框里.length).toBe(3);
  for (const h of 框里) expect(h).toBeGreaterThanOrEqual(44);
  expect(await 点得中(page, "[data-testid=crec-start]")).toBe(true);
  expect(await 没撑出(page)).toEqual([]);
  expect(errors).toEqual([]);
  await page.close();
});

it("手机 390：草稿条、待提交卡超长名字不撑出，按钮点得中", async () => {
  const 长 = `通话录音${"很长的名字".repeat(30)}.m4a`;
  const 草稿们 = [
    { id: "crec1", status: "上传中", sourceKind: "上传", 文件名: 长, 总字节: 12 * MB, 已收字节: 5 * MB, 已收片: [], 格式: "m4a", 开始于: "", 更新于: "", 能听: false },
    { id: "crec2", status: "待提交", sourceKind: "上传", 文件名: 长, 总字节: 12 * MB, 已收字节: 12 * MB, 已收片: [], 格式: "m4a", 开始于: "", 更新于: "", 能听: true },
  ];
  const { page } = await open("list", { 草稿们: [...草稿们, { ...草稿们[1], id: "crec3", 总字节: null, 已收字节: 0 }] }, 390);
  expect(await page.getByTestId("crec-draft").count()).toBe(3);
  expect(await 没撑出(page)).toEqual([]);
  expect(await 点得中(page, "[data-testid=crec-continue]")).toBe(true);
  // 接着传 / 删掉、提交整理 / 删掉：390 宽都 ≥44 高
  const 高们 = await 按钮高(page, ".crec-drafts .ant-btn");
  expect(高们.length).toBe(6);
  for (const h of 高们) expect(h).toBeGreaterThanOrEqual(44);
  // 字节数没有的写「—」，不写 1KB
  expect(await page.getByTestId("crec-pending").nth(1).innerText()).toContain("待提交 · —");
  // 删前确认条的「取消 / 确认删掉」
  await page.getByTestId("crec-draft").first().getByRole("button", { name: "删掉" }).click();
  for (const h of await 按钮高(page, ".crec-draft .pd-del-band .ant-btn")) expect(h).toBeGreaterThanOrEqual(44);
  expect((await 按钮高(page, ".crec-draft .pd-del-band .ant-btn")).length).toBe(2);
  await page.close();
});

for (const w of [1024, 1280, 1366]) {
  it(`Windows ${w}：传文件框、草稿条超长名字不撑出，开始上传、接着传点得中`, async () => {
    const 长 = `通话录音${"很长的名字".repeat(30)}.m4a`;
    const { page } = await open("form", { 草稿们: [] }, w);
    await page.getByTestId("coach-topic-new").click();
    await page.getByTestId("coach-review-upload").click();
    await page.getByTestId("crec-file").setInputFiles(文件(长, 1 * MB));
    await page.waitForFunction(() => !document.querySelector(".crec-modal.ant-zoom-appear, .crec-modal.ant-zoom-enter"));
    expect(await 没撑出(page)).toEqual([]);
    expect(await 点得中(page, "[data-testid=crec-start]")).toBe(true);
    await page.close();
    const 草稿 = { id: "crec1", status: "上传中", sourceKind: "上传", 文件名: 长, 总字节: 12 * MB, 已收字节: 5 * MB, 已收片: [], 格式: "m4a", 开始于: "", 更新于: "", 能听: false };
    const l = await open("list", { 草稿们: [草稿] }, w);
    expect(await 没撑出(l.page)).toEqual([]);
    expect(await 点得中(l.page, "[data-testid=crec-continue]")).toBe(true);
    await l.page.close();
  });
}
