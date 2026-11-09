/**
 * 分配弹窗「待办一起转」的勾（11-09，P-转-10）：市场首次分给销售（X-18）不摆，也不传；别的情况照旧摆。
 * 判断来自服务端 项目分配线 的 市场转客户，界面和服务端看同一个结论。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-assign-tick", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){}});");
  stub(/assign-actions$/, `
    const 记=(n,回)=>async(...a)=>{(window.__调||=[]).push([n,...a]);return 回};
    export const 分配线索=记('分配线索',{ok:true}),批量自动分配=记('批量自动分配',{ok:true,结果:[]}),我分出去的线索=记('我分出去的线索',[]);
    export const 本月分配情况=async()=>[{userId:'u1',name:'王一',line:'内贸',配额:null,已分:0,加额:0,暂停:false}];
    export const 项目分配线=async()=>({线:'内贸',可选:['u1'],市场转客户:window.__市场转客户});
  `);
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import {AssignLeadModal} from '@/app/(app)/leads/AssignLead';
    function 壳(){const [lead,set]=React.useState(null);return <App><button onClick={()=>set({id:'p1',name:'某项目',ownerId:'m1',项目:true})}>开弹窗</button><AssignLeadModal lead={lead} 关={()=>set(null)}/></App>}
    window.__画=()=>createRoot(document.getElementById('root')).render(<壳/>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(市场转客户: boolean): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/leads");
  await page.addScriptTag({ content: bundle });
  await page.evaluate((v) => { const w = window as unknown as { __市场转客户: boolean; __画: () => void }; w.__市场转客户 = v; w.__画(); }, 市场转客户);
  await page.getByRole("button", { name: "开弹窗" }).click();
  await page.locator('[data-testid="assign-line-readonly"]', { hasText: "内贸" }).waitFor();
  return { page, errors };
}
const 勾的话 = "原负责人没做完的待办一起转给新负责人";

it("市场首次分给销售：不摆勾", async () => {
  const { page, errors } = await 打开(true);
  expect(await page.getByText(勾的话).count()).toBe(0);
  expect(errors).toEqual([]); await page.close();
});

it("别的情况：照旧摆勾，默认勾上", async () => {
  const { page, errors } = await 打开(false);
  await page.getByText(勾的话).waitFor();
  expect(await page.getByRole("checkbox", { name: 勾的话 }).isChecked()).toBe(true);
  expect(errors).toEqual([]); await page.close();
});
