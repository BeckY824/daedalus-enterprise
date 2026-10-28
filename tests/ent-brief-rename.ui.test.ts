/**
 * 企业版「简报」改名「智能总结」（10-27 会议：「将简报功能名称改为智能总结」）。
 *
 *   客户页 AI 面板：企业版按钮写「生成智能总结」，开关关（个人版、团队版）照旧「生成简报」
 *   服务端：简报名() 和设置页 AI 用量里那一行跟着开关走
 *   Windows 1024 / 1280 / 1366：按钮变长了也不横向撑出
 * 改的只是叫法，功能键（brief）、日志、提示词都不动。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

vi.mock("@/lib/prisma", () => ({ prisma: { auditLog: { groupBy: async () => [{ entityId: "brief", _count: { _all: 3 } }] } } }));

describe("服务端叫法", () => {
  const 原 = process.env.CRM_ENTERPRISE;
  afterEach(() => { if (原 === undefined) delete process.env.CRM_ENTERPRISE; else process.env.CRM_ENTERPRISE = 原; });

  it("企业版叫智能总结，AI 用量那一行也是；次数照旧按 brief 记", async () => {
    process.env.CRM_ENTERPRISE = "1";
    const { 简报名, aiUsageThisMonth } = await import("@/lib/ai-usage");
    expect(简报名()).toBe("智能总结");
    const 行 = (await aiUsageThisMonth()).find((u) => u.feature === "brief")!;
    expect(行).toEqual({ feature: "brief", label: "智能总结", count: 3 });
  });

  it("开关关：还叫简报 / 临战简报", async () => {
    delete process.env.CRM_ENTERPRISE;
    const { 简报名, aiUsageThisMonth } = await import("@/lib/ai-usage");
    expect(简报名()).toBe("简报");
    expect((await aiUsageThisMonth()).find((u) => u.feature === "brief")!.label).toBe("临战简报");
  });
});

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "brief-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/research\/actions$/, "export const 最近背调=async()=>null,背调价目=async()=>({可用:false,原因:''}),认号码动作=async()=>null,存背调到客户=async()=>({ok:true,id:'x'}),认联系方式=async()=>({email:'',phone:''}),新建客户并存背调=async()=>({ok:true}),找同名客户=async()=>[];");
  stub(/\/(dashboard|channels)\/ai$/, "export const draftWakeup=async()=>({ok:true,message:''}),draftInvite=async()=>({ok:true,message:''});");
  stub(/research\/(ResearchRun|ResearchPerson)$/, "export default function Empty(){return null}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import AiPanel from '@/app/(app)/customers/[id]/AiPanel';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const root=createRoot(document.getElementById('root'));
    window.__render=(企业)=>root.render(<App><BusinessProvider value={DEFAULT_BUSINESS}><div style={{width:360}}>
      <AiPanel customerId='c1' customerName={'某某超长客户名有限公司'.repeat(4)} 档案={null} fingerprint='f' signed={false} hasRecords {...(企业?{简报叫:'智能总结'}:{})}/>
    </div></BusinessProvider></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(企业: boolean, width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://brief.test/**", r => r.request().url().endsWith("/api/ai/meter") ? r.fulfill({ status: 404, body: "" }) : r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://brief.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(e => (window as unknown as { __render: (x: boolean) => void }).__render(e), 企业);
  await page.locator(".rec-ai").waitFor();
  return { page, errors };
}

it("客户页 AI 面板：企业版「生成智能总结」，没有「简报」二字", async () => {
  const { page, errors } = await open(true);
  try {
    expect(await page.getByRole("button", { name: /生成智能总结/ }).count()).toBe(1);
    expect(await page.locator(".rec-ai").innerText()).not.toContain("简报");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("开关关：照旧「生成简报」", async () => {
  const { page, errors } = await open(false);
  try {
    expect(await page.getByRole("button", { name: /生成简报/ }).count()).toBe(1);
    expect(await page.locator(".rec-ai").innerText()).not.toContain("智能总结");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：按钮不横向撑出、点得中", async (w) => {
  const { page } = await open(true, w);
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const box = (await page.getByRole("button", { name: /生成智能总结/ }).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    const 点中 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box.x + box.width / 2, box.y + box.height / 2]);
    expect(点中).toContain("生成智能总结");
  } finally { await page.close(); }
});
