/**
 * 录音点评 PR5（11-22）确认框和沟通卡（projects/[id]/CoachRecConfirm.tsx、CoachRecUpload.tsx 草稿条、CoachTopics.tsx TopicItem）：
 *   - 待确认的草稿条「继续确认」→「确认录音点评」框：主题、要点带着 AI 起草的字（虚线框），转写默认收起、点开有「机器识别」小字
 *   - 发出 → POST send 带改过的主题要点；稍后再发：改过才 POST draft，没改直接关；不要了 → 先出「放弃这段录音？」再 abandon；按转写重新整理 → 先问再 retry
 *   - 整理失败（没转写）的给「自己写了发出」：两格空着、发出灰着，写了才能发
 *   - 地址带 crec=<编号>（「整理好了」通知点进来）：直接打开那一条，参数从地址上去掉
 *   - 沟通卡：录音点评标签、「录音 0:22」、能听的出播放、听不了的写一句；看转写全文
 *   - 手机 390 宽：确认框整屏、不横向撑出，底部按钮点得中
 * 网络用页面里的假 fetch（记下每次请求和请求体）。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "coach-rec-review-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷=(window.__刷??0)+1},push(){}});");
  stub(/coach-topic-actions$/, "export const 发主题动作=async()=>({ok:true});export const 回复主题动作=async()=>({ok:true});export const 关闭主题动作=async()=>({ok:true});export const 删主题动作=async()=>({ok:true});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

const 转写 = "(00:00) 说话人 1：报价单下周二前发过去。\n(00:05) 说话人 2：好的。";
const 录 = (x: object) => ({ id: "crec1", status: "待确认", sourceKind: "上传", 文件名: "面谈.m4a", 总字节: 300000, 已收字节: 300000, 已收片: [], 格式: "m4a", 开始于: "", 更新于: "", 能听: true, 时长毫秒: 22000, 错: null,
  确认: { 主题: "报价单下周二前发出", 要点: "【下一步建议】\n· 周二发报价单", 转写 }, ...x });
const 主题 = (x: object = {}) => ({ id: "t1", node: "线索验证", title: "回访客户", body: "【下一步建议】\n· 周二发报价单", status: "待回复", createdAt: "2026-11-22T10:00:00Z", closedAt: null,
  作者: { id: "u1", name: "教练", 身份: "销售教练" }, 关的人: null, 回复们: [], 能回: false, 能关: false, 能删: false, ...x });

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import CoachTopics from '@/app/(app)/projects/[id]/CoachTopics';
    const root=createRoot(document.getElementById('root'));
    window.__render=(数据)=>root.render(<App><div style={{maxWidth:'min(560px, calc(100vw - 32px))',margin:'0 auto',padding:16}}><CoachTopics 数据={数据} projectId='p1'/></div></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 假服务器 = () => {
  const w = window as unknown as { __请求: string[] };
  w.__请求 = [];
  window.fetch = (async (url: string, init?: RequestInit) => {
    w.__请求.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`.trim());
    const 回 = (window as unknown as { __回?: number }).__回;
    if (回) return new Response(JSON.stringify({ error: "这条录音点评已经发出了" }), { status: 回, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, id: "t9", 录音: {} }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
};

async function open(数据: unknown, width = 1366, 查询 = "") {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://crec.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto(`http://crec.test/p${查询}`);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.evaluate(假服务器);
  await page.addScriptTag({ content: bundle });
  await page.evaluate((d) => (window as unknown as { __render: (x: unknown) => void }).__render(d), 数据);
  return { page, errors };
}
const 请求们 = (page: Page) => page.evaluate(() => (window as unknown as { __请求: string[] }).__请求);
const 基 = (草稿们: unknown[], 们: unknown[] = []) => ({ 们, 能发: true, 填写人: { id: "u1", name: "教练", 身份: "销售教练" }, 负责人: { id: "u2", name: "负责人" }, 项目名: "甲的项目", 当前节点: "线索验证", 待回复数: 0, 冻结: false, 录音: { 草稿们, 可录: true } });

it("继续确认：带着 AI 起草的字；转写收起、点开有小字；改了发出 → send 带新的主题要点", async () => {
  const { page, errors } = await open(基([录({})]));
  await page.getByTestId("crec-confirm-open").click();
  const 框 = page.getByTestId("crec-confirm");
  await expect.poll(() => 框.getByLabel("主题").inputValue()).toBe("报价单下周二前发出");
  expect(await 框.getByLabel("要点").inputValue()).toBe("【下一步建议】\n· 周二发报价单");
  expect(await 框.locator(".crec-ai").count()).toBeGreaterThanOrEqual(2);
  expect(await page.getByTestId("crec-confirm-transcript").count()).toBe(0);
  await page.getByTestId("crec-confirm-transcript-toggle").click();
  expect(await page.getByTestId("crec-confirm-transcript").textContent()).toBe(转写);
  expect(await 框.textContent()).toContain("机器识别，可能有错字，以录音为准");
  await 框.getByLabel("主题").fill("改过的主题");
  await page.getByTestId("crec-confirm-send").click();
  await expect.poll(() => 请求们(page)).toEqual([`POST /api/coach-rec/crec1/send ${JSON.stringify({ title: "改过的主题", body: "【下一步建议】\n· 周二发报价单" })}`]);
  await expect.poll(() => page.getByTestId("crec-confirm").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

it("稍后再发：没改直接关、改了才存；不要了先问再删；按转写重新整理先问再 retry", async () => {
  const { page } = await open(基([录({})]));
  await page.getByTestId("crec-confirm-open").click();
  await page.getByTestId("crec-confirm-later").click();
  await expect.poll(() => page.getByTestId("crec-confirm").count()).toBe(0);
  expect(await 请求们(page)).toEqual([]);
  await page.getByTestId("crec-confirm-open").click();
  await page.getByTestId("crec-confirm").getByLabel("要点").fill("自己改的");
  await page.getByTestId("crec-confirm-later").click();
  await expect.poll(() => 请求们(page)).toEqual([`POST /api/coach-rec/crec1/draft ${JSON.stringify({ title: "报价单下周二前发出", body: "自己改的" })}`]);
  await page.getByTestId("crec-confirm-open").click();
  await page.getByTestId("crec-confirm-drop").click();
  expect(await page.getByRole("group", { name: "放弃这段录音？" }).textContent()).toContain("已录 0:22");
  await page.getByTestId("crec-confirm-drop-ok").click();
  await expect.poll(async () => (await 请求们(page)).at(-1)).toBe("POST /api/coach-rec/crec1/abandon {}");
  await page.getByTestId("crec-confirm-open").click();
  await page.getByTestId("crec-confirm-transcript-toggle").click();
  await page.getByTestId("crec-confirm-redo").click();
  await page.getByTestId("crec-confirm-redo-ok").click();
  await expect.poll(async () => (await 请求们(page)).at(-1)).toBe("POST /api/coach-rec/crec1/retry {}");
  await page.close();
});

it("点 × / 按 Esc 关框时存草稿：服务端回 409（别处已经发出、删了）也关框、刷新；点「稍后再发」回 409 留在框里写原因", async () => {
  const { page, errors } = await open(基([录({})]));
  await page.evaluate(() => { (window as unknown as { __回?: number }).__回 = 409; });
  await page.getByTestId("crec-confirm-open").click();
  await page.getByTestId("crec-confirm").getByLabel("要点").fill("改了");
  await page.locator(".crec-confirm .ant-modal-close").click();
  await expect.poll(() => page.getByTestId("crec-confirm").count()).toBe(0);
  expect((await 请求们(page)).at(-1)).toContain("POST /api/coach-rec/crec1/draft");
  expect(await page.evaluate(() => (window as unknown as { __刷?: number }).__刷)).toBe(1);
  // Esc 同样
  await page.getByTestId("crec-confirm-open").click();
  await page.getByTestId("crec-confirm").getByLabel("要点").fill("又改了");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.getByTestId("crec-confirm").count()).toBe(0);
  // 稍后再发（按钮）回 409：框留着、写原因
  await page.getByTestId("crec-confirm-open").click();
  await page.getByTestId("crec-confirm").getByLabel("要点").fill("再改");
  await page.getByTestId("crec-confirm-later").click();
  await page.getByTestId("crec-confirm").getByRole("alert").filter({ hasText: "已经发出了" }).waitFor();
  expect(errors).toEqual([]);
  await page.close();
});

it("整理失败（没转写）：「自己写了发出」两格空着、发出灰着，写了才能发；提示写为什么", async () => {
  const { page } = await open(基([录({ status: "整理失败", 错: "转写超过 3 小时没出结果", 确认: { 主题: "", 要点: "", 转写: null } })]));
  await page.getByTestId("crec-confirm-open").click();
  const 框 = page.getByTestId("crec-confirm");
  expect(await page.getByTestId("crec-confirm-hint").textContent()).toBe("转写超过 3 小时没出结果");
  expect(await 框.locator(".crec-ai").count()).toBe(0);
  expect(await page.getByTestId("crec-confirm-transcript-toggle").count()).toBe(0);
  expect(await page.getByTestId("crec-confirm-send").isDisabled()).toBe(true);
  await 框.getByLabel("主题").fill("自己写");
  await 框.getByLabel("要点").fill("要点");
  expect(await page.getByTestId("crec-confirm-send").isDisabled()).toBe(false);
  await page.close();
});

it("地址带 crec=<编号>：直接打开那一条，参数从地址上去掉；别的编号不开", async () => {
  const { page } = await open(基([录({})]), 1366, "?crec=crec1&x=1");
  await expect.poll(() => page.getByTestId("crec-confirm").count()).toBe(1);
  expect(page.url()).toBe("http://crec.test/p?x=1");
  await page.close();
  const b = await open(基([录({})]), 1366, "?crec=other");
  await b.page.waitForTimeout(200);
  expect(await b.page.getByTestId("crec-confirm").count()).toBe(0);
  await b.page.close();
});

it("沟通卡：录音点评标签、录音时长、能听出播放、听不了写一句、看转写全文；没录音的主题和原来一样", async () => {
  const { page } = await open(基([], [
    主题({ 录音: { id: "crec1", 时长毫秒: 22000, 能听: true, 转写, 音频没了: false } }),
    主题({ id: "t2", title: "听不了的", 录音: { id: "crec2", 时长毫秒: 65000, 能听: false, 转写, 音频没了: false } }),
    主题({ id: "t3", title: "写的点评" }),
  ]));
  const 卡们 = page.getByTestId("coach-topic");
  expect(await 卡们.count()).toBe(3);
  expect(await 卡们.nth(0).getByTestId("coach-topic-rec").textContent()).toBe("录音点评");
  expect(await 卡们.nth(0).textContent()).toContain("录音 0:22");
  expect(await 卡们.nth(0).locator("audio").getAttribute("src")).toBe("/api/coach-rec/crec1/audio");
  expect(await 卡们.nth(1).locator("audio").count()).toBe(0);
  expect(await 卡们.nth(1).textContent()).toContain("原声只有发起人和项目负责人能听");
  expect(await 卡们.nth(1).textContent()).toContain("录音 1:05");
  await 卡们.nth(0).getByTestId("coach-topic-transcript-toggle").click();
  expect(await 卡们.nth(0).getByTestId("coach-topic-transcript").textContent()).toBe(转写);
  expect(await 卡们.nth(0).textContent()).toContain("机器识别，可能有错字，以录音为准");
  expect(await 卡们.nth(2).getByTestId("coach-topic-rec").count()).toBe(0);
  expect(await 卡们.nth(2).getByTestId("coach-topic-rec-box").count()).toBe(0);
  await page.close();
});

it("手机 390 宽：确认框整屏、不横向撑出，发出按钮点得中；长转写在框里滚", async () => {
  const 长 = Array.from({ length: 200 }, (_, i) => `(00:${String(i % 60).padStart(2, "0")}) 说话人 1：${"很长的一句话".repeat(8)}`).join("\n");
  const { page } = await open(基([录({ 确认: { 主题: "报价", 要点: "· 要点", 转写: 长 } })]), 390);
  await page.getByTestId("crec-confirm-open").click();
  await page.getByTestId("crec-confirm-transcript-toggle").click();
  // 等弹出动画走完再量
  await expect.poll(() => page.evaluate(() => document.querySelector(".crec-confirm .ant-modal-container, .crec-confirm .ant-modal-content")!.getBoundingClientRect().width)).toBeGreaterThanOrEqual(389);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const 中 = await page.getByTestId("crec-confirm-send").evaluate((el) => {
    el.scrollIntoView();
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { 中: !!hit && (hit === el || el.contains(hit)), 高: Math.round(r.height) };
  });
  expect(中.中).toBe(true);
  expect(中.高).toBeGreaterThanOrEqual(44);
  await page.close();
});
