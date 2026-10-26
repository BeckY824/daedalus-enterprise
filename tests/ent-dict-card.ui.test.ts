/** 设置 → 项目模式 → 企业选项字典（2026-10-26）：切换种类看各自的选项、加一个、停用一个；窄屏不横向撑出页面。服务端动作换成内存假实现。 */
import { afterAll, beforeAll, it, expect } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "stub-actions", setup(b) {
  b.onResolve({ filter: /\/projects\/actions$|\/ent-dict-actions$|^next\/navigation$/ }, (a) => ({ path: a.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `
    const 空=async()=>({ok:true});
    export const 加组员角色=空, 改组员角色=空, 加项目异常类别=空, 改项目异常类别=空, 改组织规则=空, 预览超时回收=async()=>({ok:true,项目:[]});
    export const 加企业选项=async(kind,name)=>{window.__opts[kind].push({id:'n'+name,name,active:true,用的人:0});window.__rerender();return{ok:true}};
    export const 改企业选项=async(id,patch)=>{for(const xs of Object.values(window.__opts))for(const x of xs)if(x.id===id)Object.assign(x,patch);window.__rerender();return{ok:true}};
    export const useRouter=()=>({refresh(){}});` }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{App}from'antd';import C from'@/app/(app)/settings/ProjectSettingsTab';
    import{字典种类们,字典定义}from'@/lib/enterprise/dict-kinds';
    window.__opts=Object.fromEntries(字典种类们.map(k=>[k,字典定义[k].默认.map((name,i)=>({id:k+i,name,active:true,用的人:0}))]));
    const root=createRoot(document.getElementById('root'));
    window.__rerender=()=>root.render(<App><div style={{maxWidth:640,padding:16}}><C 成员={[]} value={{角色们:[],类别们:[],组织规则:null,持有:{},企业选项:JSON.parse(JSON.stringify(window.__opts)),挡:{字典:null,持有上限:null,节点时限:null,必填字段:null}}}/></div></App>);
    window.__rerender();`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120000);
afterAll(async () => { await browser?.close(); });
it("切换种类、加选项、停用；375 宽不横向撑出", async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await page.route("http://dict.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://dict.test");
  await page.addScriptTag({ content: bundle });
  await page.getByText("企业选项 · 分配方式").waitFor();
  expect(await page.getByText("自拓自持").count()).toBe(1);
  await page.getByText("回收原因", { exact: true }).click();
  await page.getByText("企业选项 · 回收原因").waitFor();
  expect(await page.getByText("销售离职").count()).toBe(1);
  await page.getByLabel("新选项名").fill("客户搬迁");
  await page.getByRole("button", { name: /加\s*上/ }).last().click();
  await page.getByText("客户搬迁").waitFor();
  // 停用「其他」：按钮变成「启用」
  const 行 = page.locator("div").filter({ hasText: /^其他/ }).last();
  await 行.getByRole("button", { name: /停\s*用/ }).click();
  await page.getByRole("button", { name: /确\s*定|停\s*用/ }).last().click().catch(() => {});
  await page.waitForFunction(() => (window as unknown as { __opts: Record<string, { name: string; active: boolean }[]> }).__opts.recycle.find((x) => x.name === "其他")?.active === false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
  await page.close();
});
