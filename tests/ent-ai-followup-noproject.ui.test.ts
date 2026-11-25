/**
 * 首页 AI 记沟通卡（企业版沟通必须挂项目，11-17 客户答复第 1 问 A「不能记，必须先建项目」）：
 *   这位客户没有我能挂的在推项目：卡上写明先建项目，确认点不了（不悄悄记到客户上）；
 *     我能新建项目 → 给「去建项目」，链到客户页并直接打开新建项目（?建项目=1）；不能 → 写「请联系负责人先建项目」
 *   待办卡不受影响（照样只挂客户）
 *   Windows 1024 / 1280 / 1366：那一句和入口不横向撑出卡片
 *   不足 4 个字（E-259 对齐 F-052）：开关「无意义沟通不能保存」开着说不能保存、确认不了；关着说不算有效沟通、照存；占位词两态都照存
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ai-followup-noproject", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  stub(/^next\/link$/, "export default function L({children,prefetch,...p}){return <a {...p}>{children}</a>}");
  stub(/^next\/dynamic$/, "export default ()=>()=>null;");
  stub(/customers\/\[id\]\/actions$/, 补全动作桩("src/app/(app)/customers/[id]/actions.ts", "export const 沟通可选项目=async()=>(window.__可选??{ok:true,项目们:[],能建项目:true});"));
  // F-052：AI 项目沟通卡（ProjectProposalFields）自己取无意义沟通开关；回 null 按默认（开着）
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通判定须知=async()=>null;", "async()=>null"));
  stub(/dashboard\/apply$/, "export const applyProposal=async p=>{window.__交=p;return{ok:true}};export const undoProposal=async()=>({ok:true});");
  stub(/card-scan\/originals$/, "export const 取走名片原图=()=>null,记下刚建的=()=>{},忘掉刚建的=()=>{};");
  stub(/attachment-upload$/, "export const 传附件=async()=>({ok:true});");
  stub(/customers\/RescueKey$/, "export default function R(){return null}");
  stub(/customers\/RepeatInquiryKey$/, "export default function R(){return null}");
  stub(/customers\/DedupeClaimKey$/, "export default function D(){return null}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import ProposalCard from '@/components/ProposalCard';
    const root=createRoot(document.getElementById('root'));
    window.__render=(补={})=>root.render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>
      <div className="cli-col"><ProposalCard proposal={{id:'p1',kind:'add_followup',customerId:'c1',customerName:'某某超长贸易进出口有限公司'.repeat(4),reason:'x',type:'PHONE',title:'',content:'电话聊了报价',occurredAt:'2026-11-17T09:00:00.000Z',...补}}/></div>
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number, 可选: unknown, 补: Record<string, unknown> = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://noproject.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://noproject.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(([可选, 补]) => { Reflect.set(window, "__可选", 可选); (window as unknown as { __render: (a: unknown) => void }).__render(补); }, [可选, 补] as const);
  await page.locator(".prop-ok").waitFor();
  return { page, errors };
}

it("没项目、我能建项目：写明先建项目 + 「去建项目」链到客户页直接开新建项目；确认点不了、不交（1024 / 1280 / 1366）", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page, errors } = await open(w, { ok: true, 项目们: [], 能建项目: true });
    try {
      const 说 = page.getByRole("note").filter({ hasText: "这位客户还没有项目，先建一个项目再记沟通" });
      await 说.waitFor();
      expect(await 说.getByRole("link", { name: "去建项目" }).getAttribute("href")).toBe("/customers/c1?建项目=1");
      expect(await page.locator(".prop-ok").isDisabled()).toBe(true);
      const 量 = await page.evaluate(() => {
        const 卡 = document.querySelector(".prop")!.getBoundingClientRect();
        const n = document.querySelector(".prop [role=note]")!.getBoundingClientRect();
        return { 页: document.documentElement.scrollWidth <= window.innerWidth, 句在卡里: n.right <= 卡.right + 1 };
      });
      expect(量).toEqual({ 页: true, 句在卡里: true });
      expect(await page.evaluate(() => Reflect.get(window, "__交") ?? null)).toBeNull();
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("没项目、我不能建项目：不给入口，写「请联系负责人先建项目」", async () => {
  const { page, errors } = await open(1280, { ok: true, 项目们: [], 能建项目: false });
  try {
    const 说 = page.getByRole("note").filter({ hasText: "这位客户还没有项目，先建一个项目再记沟通" });
    await 说.waitFor();
    expect(await 说.innerText()).toContain("请联系负责人先建项目");
    expect(await 说.getByRole("link").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("待办卡：没项目也不出这句，照样能确认", async () => {
  const { page, errors } = await open(1280, { ok: true, 项目们: [], 能建项目: true }, { type: "TASK" });
  try {
    expect(await page.getByText("先建一个项目再记沟通").count()).toBe(0);
    expect(await page.locator(".prop-ok").isDisabled()).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// E-259 对齐 F-052：AI 记沟通卡不足 4 个字按开关「无意义沟通不能保存」两态——开着（默认）不能确认，关着照存；占位词两态都照存
it("内容不足 4 个字（E-259「加微信」）开关开着：内容框下说不能保存、还差 1 个字，确认不了；够 4 个字那一行就没了（1024 / 1280 / 1366、390）", async () => {
  for (const w of [390, 1024, 1280, 1366]) {
    const { page, errors } = await open(w, { ok: true, 项目们: [{ id: "pj1", name: "某项目" }], 能建项目: true, 判定: { 拦: true } }, { content: "加微信" });
    try {
      const 行 = page.getByTestId("follow-meaning");
      await expect.poll(() => 行.innerText()).toBe("这样写会被判为无意义，不能保存：不足 4 个字，还差 1 个字");
      const 量 = await page.evaluate(() => {
        const 卡 = document.querySelector(".prop")!.getBoundingClientRect();
        const r = document.querySelector("[data-testid=follow-meaning]")!.getBoundingClientRect();
        return { 页: document.documentElement.scrollWidth <= window.innerWidth, 在卡里: r.right <= 卡.right + 1 };
      });
      expect(量).toEqual({ 页: true, 在卡里: true });
      expect(await page.locator(".prop-ok").isDisabled()).toBe(true);
      if (w === 1280) {
        const 框 = page.locator(".prop textarea").first();
        await 框.fill("加了微信");
        await 行.waitFor({ state: "detached" });
        await expect.poll(() => page.locator(".prop-ok").isDisabled()).toBe(false);
        // 只有表情 / 标点：同样判为无意义，确认不了
        await 框.fill("👍");
        await expect.poll(() => 行.innerText()).toBe("这样写会被判为无意义，不能保存：不足 4 个字，还差 4 个字");
        expect(await page.locator(".prop-ok").isDisabled()).toBe(true);
        // 占位词连写（够 4 个字也不算有效）：照存，只说不算有效沟通
        await 框.fill("已联系跟进");
        await expect.poll(() => 行.innerText()).toBe("只有「跟进」「已联系」这类占位词，不算有效沟通");
        await expect.poll(() => page.locator(".prop-ok").isDisabled()).toBe(false);
        await page.locator(".prop-ok").click();
        await page.waitForFunction(() => Reflect.get(window, "__交"));
        expect(await page.evaluate(() => (Reflect.get(window, "__交") as { content: string }).content)).toBe("已联系跟进");
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("内容不足 4 个字开关关着：只说不算有效沟通，照样能确认、原样交上去；只有零宽字符的还是存不了（1280）", async () => {
  const { page, errors } = await open(1280, { ok: true, 项目们: [{ id: "pj1", name: "某项目" }], 能建项目: true, 判定: { 拦: false } }, { content: "加微信" });
  try {
    const 行 = page.getByTestId("follow-meaning");
    await expect.poll(() => 行.innerText()).toBe("不足 4 个字，还差 1 个字，不算有效沟通");
    await expect.poll(() => page.locator(".prop-ok").isDisabled()).toBe(false);
    const 框 = page.locator(".prop textarea").first();
    // 只有零宽字符：空的照样拦（还差沟通内容）
    await 框.fill("\u200b");
    await expect.poll(() => page.locator(".prop-ok").isDisabled()).toBe(true);
    await 框.fill("加微信");
    await expect.poll(() => page.locator(".prop-ok").isDisabled()).toBe(false);
    await page.locator(".prop-ok").click();
    await page.waitForFunction(() => Reflect.get(window, "__交"));
    expect(await page.evaluate(() => (Reflect.get(window, "__交") as { content: string }).content)).toBe("加微信");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
