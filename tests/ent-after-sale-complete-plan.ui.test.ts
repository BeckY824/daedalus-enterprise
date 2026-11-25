/**
 * 完成「下次回访」计划（售后回访 11-25，E-283；方案第十节第 15 条、入口清单 #47）：
 *   计划带着 afterSaleProjectId 且还能记（沟通可选项目 回 计划售后项目）：框里默认选中那个交付结清项目、锁着「售后回访」标，
 *     交上去 projectId = 它、带 售后回访——客户另有一个在推项目也不自动挂到在推的上（去掉这段就红：会自动挂到唯一的在推项目）；
 *   排的那个已核不过（售后计划失效）：退回普通选法（一个在推自动挂、不带标记），提示一句；
 *   普通计划、只有交付结清项目：不再「只完成」，列出交付结清组要人选，选了带标记
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "after-sale-complete-plan", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>null;", "async()=>null"));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  stub(/^\.\/actions$/, 补全动作桩("src/app/(app)/customers/[id]/actions.ts", "export const saveFollowUp=async x=>{window.__存=x;return{ok:true,id:'f1'}};export const 撤销记一笔=async()=>({ok:true});export const 沟通可选项目=async(c,计划)=>{window.__问=计划;return window.__可选};"));
  b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import CompletePlanModal from '@/app/(app)/customers/[id]/CompletePlanModal';
    window.__render=()=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>
      <CompletePlanModal plan={{id:'pl1',subject:'售后回访 · 已交付一号',method:'电话沟通',customerId:'c1'}} onClose={()=>{}} onDone={(r)=>{window.__完=r}}/>
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 在推 = [{ id: "p1", name: "在推一号" }];
const 售后 = [{ id: "d1", name: "已交付一号" }];
async function 开(可选: unknown): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://plan.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://plan.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => { Reflect.set(window, "__可选", x); (window as unknown as { __render: () => void }).__render(); }, 可选);
  await page.getByTestId("complete-plan-modal").waitFor();
  return { page, errors };
}
async function 存(page: Page): Promise<Record<string, unknown>> {
  await page.getByLabel("这次聊了什么").fill("回访了，用得挺好");
  await page.getByRole("button", { name: /保存并完成/ }).click();
  await page.waitForFunction(() => Reflect.get(window, "__存"));
  return page.evaluate(() => Reflect.get(window, "__存") as Record<string, unknown>);
}

it("下次回访计划：默认选中排它的交付结清项目、锁着标记，交上去挂它带售后回访（客户另有一个在推项目也不挂错）", async () => {
  const { page, errors } = await 开({ ok: true, 项目们: 在推, 能建项目: true, 售后, 计划售后项目: "d1" });
  try {
    expect(await page.evaluate(() => Reflect.get(window, "__问"))).toBe("pl1");
    await page.getByTestId("after-sale-lock").waitFor();
    expect(await page.locator(".done-plan-pick .ant-select-content").innerText()).toContain("已交付一号");
    const x = await 存(page);
    expect(x.projectId).toBe("d1");
    expect(x.售后回访).toBe(true);
    // 下次那条计划主题带「售后回访 · 项目名」
    expect((x.附带 as { plan: { subject: string } }).plan.subject.startsWith("售后回访 · 已交付一号 · ")).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("排的那个已核不过（售后计划失效）：提示一句，退回普通选法——唯一的在推项目自动挂、不带标记", async () => {
  const { page, errors } = await 开({ ok: true, 项目们: 在推, 能建项目: true, 售后: [], 售后计划失效: true });
  try {
    await expect.poll(() => page.getByRole("note").allInnerTexts()).toContain("这条计划排的售后回访项目已不能记（项目不是交付结清了、客户在公海，或你记不了）：请按普通沟通选项目");
    expect(await page.getByTestId("after-sale-lock").count()).toBe(0);
    const x = await 存(page);
    expect(x.projectId).toBe("p1");
    expect(x.售后回访).toBeUndefined();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("普通计划、只有交付结清项目：不再只完成，列出交付结清组要人选；不选报红，选了带标记", async () => {
  const { page, errors } = await 开({ ok: true, 项目们: [], 能建项目: true, 售后 });
  try {
    await page.getByRole("button", { name: /保存并完成/ }).waitFor();
    expect(await page.getByText("只把计划标为完成").count()).toBe(0);
    await page.getByLabel("这次聊了什么").fill("回访了");
    await page.getByRole("button", { name: /保存并完成/ }).click();
    await expect.poll(() => page.locator('[data-fk="项目"]').innerText()).toContain("请选一个关联项目");
    expect(await page.evaluate(() => Reflect.get(window, "__存"))).toBeUndefined();
    await page.locator(".done-plan-pick").click();
    await expect.poll(() => page.locator(".ant-select-item-group").allInnerTexts()).toEqual(["已交付结清 · 售后回访"]);
    await page.locator(".ant-select-item-option").filter({ hasText: "已交付一号" }).click();
    await page.getByTestId("after-sale-lock").waitFor();
    const x = await 存(page);
    expect(x.projectId).toBe("d1");
    expect(x.售后回访).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
