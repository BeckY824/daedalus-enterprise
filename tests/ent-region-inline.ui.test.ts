/**
 * 客户详情「所在地区」就地改（原型 dt.field：失焦 / 回车即存，新值立刻显示；g.notice：没存上原因就地写，不弹顶部提示）
 *   存着的时候、刷新回来之前就摆刚改的（父组件每次给的是新对象，按值比，不按引用比）
 *   没存上：退回原来的，原因 role=alert 写在这一格下面
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, 包: string;
const 桩: Plugin = { name: "region", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷新=(window.__刷新??0)+1}});");
  stub(/^\.\.\/actions$/, "export const patchCustomerRegion=(id,v)=>new Promise((ok)=>{window.__交=v;window.__放=ok;});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  包 = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import RegionInlineField from '@/app/(app)/customers/[id]/RegionInlineField';
    const root=createRoot(document.getElementById('root'));
    function 页(){
      const [n,setN]=React.useState(0);
      window.__重画=()=>setN((x)=>x+1);
      // 父组件每次渲染给新对象（RecordView 就是这样传的）
      return <RegionInlineField customerId="c1" value={{addrCountry:'美国',addrProvince:null,addrCity:'Austin',addrDistrict:null}} />;
    }
    root.render(<页/>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开() {
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://region.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://region.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 包 });
  await page.getByRole("button", { name: "编辑所在地区" }).waitFor();
  return { page, errors };
}

it("回车存：存着的时候就摆新值，父组件重画（新对象）也不跳回旧值", async () => {
  const { page, errors } = await 开();
  try {
    await page.getByRole("button", { name: "编辑所在地区" }).click();
    await page.getByLabel("市").fill("Dallas");
    await page.getByLabel("市").press("Enter");
    await page.waitForFunction(() => Reflect.get(window, "__交"));
    expect(await page.evaluate(() => (Reflect.get(window, "__交") as { addrCity: string }).addrCity)).toBe("Dallas");
    const 格 = page.getByRole("button", { name: "编辑所在地区" });
    await expect.poll(() => 格.innerText()).toContain("Dallas");
    await page.evaluate(() => (Reflect.get(window, "__重画") as () => void)());
    expect(await 格.innerText()).toContain("Dallas");
    await page.evaluate(() => (Reflect.get(window, "__放") as (x: unknown) => void)({ ok: true }));
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__刷新"))).toBe(1);
    expect(await page.locator(".ant-message-notice").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("没存上：退回原来的，原因就地写在这一格下面（role=alert），不弹顶部提示", async () => {
  const { page, errors } = await 开();
  try {
    await page.getByRole("button", { name: "编辑所在地区" }).click();
    await page.getByLabel("市").fill("Dallas");
    await page.getByLabel("市").press("Enter");
    await page.waitForFunction(() => Reflect.get(window, "__交"));
    await page.evaluate(() => (Reflect.get(window, "__放") as (x: unknown) => void)({ ok: false, error: "你的角色改不了所在地区" }));
    await page.getByRole("alert").filter({ hasText: "你的角色改不了所在地区" }).waitFor();
    const 格 = page.getByRole("button", { name: "编辑所在地区" });
    expect(await 格.innerText()).toContain("Austin");
    expect(await 格.innerText()).not.toContain("Dallas");
    expect(await page.locator(".ant-message-notice").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
