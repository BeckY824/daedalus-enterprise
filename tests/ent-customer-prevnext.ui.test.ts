/**
 * 客户详情「上一条 / 下一条」（E-332，customers/[id]/CustomerStep.tsx）：真组件 + globals.css，服务端动作换成桩。
 * 钉的是：
 *   - 从客户列表点进来：「← 回到客户列表」那一行右端两颗箭头，链到相邻两位；问服务端时带的是记住的那张列表地址和这一位的页码
 *   - 第一条「上一条」灰着、最后一条「下一条」灰着（disabled，读屏念「已是第一条 / 已是最后一条」）
 *   - 点箭头记下换到的那位在第几页（到了那边、刷新都认）
 *   - 没有列表上下文（直接开链接）、服务端说不在那一页：不摆
 *   - 手机 390：放得下、不横滚、点击区 36；并入提示同在这一行时箭头紧跟在它后面；电脑各档宽也不横滚
 * 顺序、可见范围的服务端那半见 tests/ent-customer-prevnext.test.ts
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "customer-prevnext", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^\.\/adjacent-actions$/, "export const 相邻客户=async(来源,id)=>{(window.__问||=[]).push([来源,id]);return window.__邻===undefined?null:window.__邻;};");
  stub(/^next\/link$/, "export default function L({href,prefetch,replace,scroll,onClick,...p}){return <a href={href} data-replace={replace?'1':undefined} onClick={e=>{e.preventDefault();onClick?.(e)}} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import BackToList from '@/components/BackToList';import CustomerStep from '@/app/(app)/customers/[id]/CustomerStep';
    import {记地址,记进入} from '@/lib/list-return';
    const w=window;
    if (w.__列表) 记地址('客户', w.__列表);
    if (w.__从) 记进入(w.__从);
    const id=location.pathname.split('/').pop();
    createRoot(document.getElementById('root')).render(
      <BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
        <div className="rec-page ui-v2">
          <div className="back-to-list-row">
            <BackToList />
            {w.__并入 && <span className="mrg-landed" data-testid="merged-note"><span className="mrg-landed-t">{w.__并入}</span></span>}
            <CustomerStep customerId={id} />
          </div>
        </div>
      </BusinessProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 设 = { id?: string; 从?: string; 列表?: string; 邻?: unknown; 并入?: string; 宽?: number; 预存?: string };
async function 开(设: 设): Promise<{ page: Page; errors: string[] }> {
  const 宽 = 设.宽 ?? 1280;
  const page = await browser.newPage({ viewport: { width: 宽, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://step.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><meta name='viewport' content='width=device-width'><div id='root'></div>" }));
  await page.goto(`http://step.test/customers/${设.id ?? "c2"}`);
  await page.evaluate((s) => {
    const w = window as unknown as Record<string, unknown>;
    w.__从 = s.从; w.__列表 = s.列表; w.__邻 = s.邻; w.__并入 = s.并入;
    if (s.预存) sessionStorage.setItem("crm:list-return-nav:v1", s.预存);
  }, 设);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ content: 宽 >= 768 ? "#root{margin-left:220px;padding:22px 26px}" : "#root{padding:12px 16px}" });
  await page.addScriptTag({ content: bundle });
  await page.locator("[data-testid=back-to-list]").waitFor();
  return { page, errors };
}
const 中间 = { 上: { id: "c1", page: 2 }, 下: { id: "c3", page: 3 } };
const 横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

it("从客户列表（第 2 页、按等级排）进来：两颗箭头链到相邻两位；问的是那张列表地址和第 2 页；点「下一条」记下换到的那位在第 3 页", async () => {
  const { page, errors } = await 开({ 从: "/customers", 列表: "/customers?sort=level-desc&page=2", 邻: 中间 });
  const 上 = page.getByTestId("rec-step-prev"), 下 = page.getByTestId("rec-step-next");
  await 下.waitFor();
  expect(await 上.evaluate((a) => ({ tag: a.tagName, href: a.getAttribute("href"), 名: a.getAttribute("aria-label"), 换: a.getAttribute("data-replace") }))).toEqual({ tag: "A", href: "/customers/c1", 名: "上一条客户", 换: "1" });
  expect(await 下.getAttribute("href")).toBe("/customers/c3");
  expect(await page.evaluate(() => (window as unknown as { __问: unknown }).__问)).toEqual([[{ href: "/customers?sort=level-desc&page=2", page: 2 }, "c2"]]);
  await 下.click();
  expect(JSON.parse(await page.evaluate(() => sessionStorage.getItem("crm:list-return-nav:v1") ?? "{}"))).toEqual({ href: "/customers?sort=level-desc&page=2", 位: { c2: 2, c3: 3 } });
  // 「回到客户列表」还回原来那张列表（筛选、排序、页码不动）
  expect(await page.getByTestId("back-to-list").getAttribute("href")).toBe("/customers?sort=level-desc&page=2");
  expect(errors).toEqual([]);
  await page.close();
});

it("第一条：「上一条」灰着；最后一条：「下一条」灰着", async () => {
  for (const [邻, 灰, 亮, 话] of [[{ 上: null, 下: { id: "c3", page: 1 } }, "rec-step-prev", "rec-step-next", "已是第一条"], [{ 上: { id: "c1", page: 1 }, 下: null }, "rec-step-next", "rec-step-prev", "已是最后一条"]] as const) {
    const { page, errors } = await 开({ 从: "/customers", 列表: "/customers", 邻 });
    await page.getByTestId(亮).waitFor();
    const g = page.getByTestId(灰);
    expect(await g.evaluate((b) => ({ tag: b.tagName, 灰: (b as HTMLButtonElement).disabled, 名: b.getAttribute("aria-label") }))).toEqual({ tag: "BUTTON", 灰: true, 名: 话 });
    // 灰的那颗字色淡（--text-faint），和亮的那颗不一样
    const 色 = async (t: string) => page.getByTestId(t).evaluate((x) => getComputedStyle(x).color);
    expect(await 色(灰)).not.toBe(await 色(亮));
    expect(errors).toEqual([]);
    await page.close();
  }
});

it("没有列表上下文（直接开链接、从别的页进来）：不摆箭头、不问服务端，记的来源清掉", async () => {
  for (const 从 of [undefined, "/projects/p1", "/pool"]) {
    const { page, errors } = await 开({ 从, 列表: "/customers?page=2", 邻: 中间, 预存: JSON.stringify({ href: "/customers?page=2", 位: { c9: 2 } }) });
    await page.waitForTimeout(200);
    expect(await page.getByTestId("rec-step").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __问?: unknown }).__问 ?? null)).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem("crm:list-return-nav:v1"))).toBe("");
    expect(errors).toEqual([]);
    await page.close();
  }
});

it("按箭头换过来的（前一页是客户详情、记的里有这一位）：照样摆，问的是这一位记下的那一页", async () => {
  const { page, errors } = await 开({ id: "c3", 从: "/customers/c2", 邻: { 上: { id: "c2", page: 2 }, 下: null }, 预存: JSON.stringify({ href: "/customers?sort=level-desc&page=2", 位: { c2: 2, c3: 3 } }) });
  await page.getByTestId("rec-step-prev").waitFor();
  expect(await page.evaluate(() => (window as unknown as { __问: unknown }).__问)).toEqual([[{ href: "/customers?sort=level-desc&page=2", page: 3 }, "c3"]]);
  expect(await page.getByTestId("rec-step-next").isDisabled()).toBe(true);
  expect(errors).toEqual([]);
  await page.close();
});

it("服务端说这一位不在那一页（数据变了）：不摆", async () => {
  const { page, errors } = await 开({ 从: "/customers", 列表: "/customers", 邻: null });
  await page.waitForFunction(() => ((window as unknown as { __问?: unknown[] }).__问 ?? []).length > 0);
  await page.waitForTimeout(100);
  expect(await page.getByTestId("rec-step").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

it("手机 390：长返回字 + 并入提示 + 两颗箭头一行放下、不横滚；箭头在屏内右端、点击区 36、那一行不长高", async () => {
  const { page, errors } = await 开({ 宽: 390, 从: "/customers", 列表: "/customers?keyword=" + "很长的关键词".repeat(6) + "&page=12", 邻: 中间, 并入: "NO.10001「某某超长名字的客户公司」已并入这位客户" });
  await page.getByTestId("rec-step-next").waitFor();
  expect(await 横滚(page)).toBe(false);
  const 量 = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    return { 行: r(".back-to-list-row"), 上: r("[data-testid=rec-step-prev]"), 下: r("[data-testid=rec-step-next]"), 并: r("[data-testid=merged-note]"), 宽: document.documentElement.clientWidth };
  });
  expect(量.下.right).toBeLessThanOrEqual(量.宽 - 16 + 0.5);
  expect(量.上.width).toBe(36);
  expect(量.下.height).toBe(36);
  expect(量.行.height).toBeLessThanOrEqual(24);
  // 并入提示在箭头左边，两颗箭头紧挨着它
  expect(量.并.right).toBeLessThanOrEqual(量.上.left);
  expect(量.上.left - 量.并.right).toBeLessThan(16);
  expect(errors).toEqual([]);
  await page.close();
});

it("电脑各档宽：箭头 24、靠这一行右端、不横滚", async () => {
  for (const 宽 of [768, 1024, 1199, 1200, 1280, 1440, 1536]) {
    const { page, errors } = await 开({ 宽, 从: "/customers", 列表: "/customers?page=3", 邻: 中间 });
    await page.getByTestId("rec-step-next").waitFor();
    expect(await 横滚(page), `${宽}`).toBe(false);
    const 量 = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      return { 行: r(".back-to-list-row"), 下: r("[data-testid=rec-step-next]") };
    });
    expect(量.下.width, `${宽}`).toBe(24);
    expect(Math.abs(量.行.right - 量.下.right), `${宽}`).toBeLessThan(1);
    expect(errors).toEqual([]);
    await page.close();
  }
});
