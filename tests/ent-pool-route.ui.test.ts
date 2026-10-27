/**
 * 公海：多项目客户项目随客户整体转让（10-27 会议，服务端规则见 org-rules.test.ts / ent-pool-rules.test.ts）。
 *
 *   设置 → 「多项目客户的公海走法」只读说明，没有二选一的单选
 *   Windows 1024 / 1280 / 1366：设置页不横向撑出
 * 开关关闭时组织规则是 null，这张卡不出现。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "pool-route-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/blocker-actions$/, `const f=${空跑};export const 存卡点默认Action=f;`);
  stub(/\/projects\/actions$|\/ent-dict-actions$|\/commission-actions$/, `const f=${空跑};export const 加组员角色=f,改组员角色=f,加项目异常类别=f,改项目异常类别=f,改组织规则=f,预览超时回收=async()=>({ok:true,项目:[]}),改提成比例=f,加企业选项=f,改企业选项=f,存分配谁能用=f;`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import Settings from '@/app/(app)/settings/ProjectSettingsTab';
    import {默认卡点默认} from '@/lib/project/blocker-rules';import {默认组织规则} from '@/lib/project/org-rules';
    const root=createRoot(document.getElementById('root'));
    window.__render=(开)=>root.render(<App><div style={{maxWidth:640,padding:16}}><Settings 成员={[]} value={{角色们:[],类别们:[],组织规则:开?默认组织规则:null,持有:{},企业选项:null,卡点默认:默认卡点默认,提成比例:null,能改提成比例:false,挡:{字典:null,持有上限:null,节点时限:null,必填字段:null,阶段规则:null}}}/></div></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(开: boolean, width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://route.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://route.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(w => (window as unknown as { __render: (x: boolean) => void }).__render(w), 开);
  await page.locator(".ant-card").first().waitFor();
  return { page, errors };
}

it("多项目客户的公海走法：只读说明，没有二选一", async () => {
  const { page, errors } = await open(true);
  try {
    const 卡 = page.locator(".ant-card").filter({ hasText: "多项目客户的公海走法" });
    await 卡.waitFor();
    expect(await 卡.innerText()).toContain("项目随客户整体转让");
    expect(await 卡.locator("input[type=radio]").count()).toBe(0);
    expect(await page.locator("[aria-label='多项目客户公海']").count()).toBe(0);
    expect(await page.getByText("项目可转让").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("开关关闭（组织规则为 null）：没有这张卡", async () => {
  const { page, errors } = await open(false);
  try {
    expect(await page.getByText("多项目客户的公海走法").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：设置页不横向撑出", async (w) => {
  const { page } = await open(true, w);
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await page.close(); }
});
