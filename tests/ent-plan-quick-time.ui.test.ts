/**
 * 排一条计划（前端改版逐块确认 ls.pl.new；总表 P-界面-34「跟进计划的默认时间统一为 3 天后，可改」）：
 * 新建时计划时间默认 3 天后 9:00；时间框下面三个快捷「明天 / 3 天后 / 1 周后」，点了换到那天 9:00，当前那个亮着。
 * 「排下一次」照旧一周后（调用方给 默认天数=7），不受影响。
 */
import { beforeAll, afterAll, it, expect } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import dayjs from "dayjs";
let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "plan-quick", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/';");
  stub(/^\.\/actions$/, "export const savePlan=async()=>({ok:true,id:'n1'}),deletePlan=async()=>({ok:true});");
  stub(/^\.\/CustomerPick$/, "export default function P(){return null}");
  stub(/^@\/lib\/me-client$/, "export const useMe=()=>({id:'u1'});");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import PlanForm from '@/app/(app)/customers/[id]/PlanForm';
    window.__画=(天)=>createRoot(document.getElementById('root')).render(<App><PlanForm open onClose={()=>{}} onSaved={()=>{}} customerId="c1" record={null} {...(天?{默认天数:天}:{})}/></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(天?: number): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage(); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://plan.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://plan.test"); await page.addScriptTag({ content: bundle });
  await page.evaluate((t) => (window as unknown as { __画: (t?: number) => void }).__画(t), 天);
  await page.getByRole("dialog").waitFor();
  return { page, errors };
}
const 天后 = (n: number) => dayjs().add(n, "day").format("YYYY-MM-DD") + " 09:00";

it("新建默认 3 天后 9:00，「3 天后」亮着；点「明天」「1 周后」换到那天 9:00", async () => {
  const { page, errors } = await 打开();
  const 框 = page.getByRole("dialog").getByLabel("计划时间");
  expect(await 框.inputValue()).toBe(天后(3));
  const 组 = page.getByRole("group", { name: "快捷时间" });
  expect(await 组.getByRole("button", { name: "3 天后" }).getAttribute("aria-pressed")).toBe("true");
  await 组.getByRole("button", { name: "明天" }).click();
  await expect.poll(() => 框.inputValue()).toBe(天后(1));
  expect(await 组.getByRole("button", { name: "明天" }).getAttribute("aria-pressed")).toBe("true");
  expect(await 组.getByRole("button", { name: "3 天后" }).getAttribute("aria-pressed")).toBe("false");
  await 组.getByRole("button", { name: "1 周后" }).click();
  await expect.poll(() => 框.inputValue()).toBe(天后(7));
  expect(errors).toEqual([]); await page.close();
});

it("排下一次（默认天数=7）照旧一周后", async () => {
  const { page } = await 打开(7);
  expect(await page.getByRole("dialog").getByLabel("计划时间").inputValue()).toBe(天后(7));
  await page.close();
});
