/**
 * 联系人搜索（前端改版逐块确认 ls.ct.search）：边打字边筛——手上这一批先按字在本地筛掉对不上的，
 * 不等 300ms 停顿和服务端；服务端那一趟回来之前表不转圈（DataList 不给加载中），旧行留着淡一点。
 */
import { beforeAll, afterAll, it, expect } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "contacts-type", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  // push 永远不回来：模拟服务端那一趟还在路上
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){return new Promise(()=>{})},refresh(){}});");
  stub(/components\/DataList$/, "export default function D(p){return <><div data-testid='rows' data-loading={String(!!p.加载中)}>{p.行.map(x=><div key={x.id}>{x.name}</div>)}</div>{p.筛选}</>}");
  stub(/\/ContactForm$/, "export default function F(){return null}");
  stub(/\/useContactRemoval$/, "export const useContactRemoval=()=>({彻底删(){}});");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import Contacts from '@/app/(app)/contacts/ContactsView';
    const base={position:null,phone:null,email:null,wechat:null,isPrimary:false,remark:null,updatedAt:new Date().toISOString(),未归属:false,原来:null,customerId:'c',school:null,ownerName:'甲',ownerId:'a',ownerEmail:'a'};
    const rows=[{...base,id:'1',name:'王采购',customerName:'蓝湾科技'},{...base,id:'2',name:'李财务',customerName:'星河乐园',phone:'13800001111'},{...base,id:'3',name:'张总',customerName:'蓝湾科技'}];
    createRoot(document.getElementById('root')).render(<App><Contacts rows={rows} 总数={3} keyword="" 学员们={[]} users={[{id:'a',name:'甲',email:'a'}]}/></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

it("打字就在手上这批里筛（姓名 / 电话 / 客户），表不转圈；清空回到全部", async () => {
  const page = await browser.newPage(); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ct.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ct.test"); await page.addScriptTag({ content: bundle });
  const 行 = page.getByTestId("rows");
  await expect.poll(() => 行.innerText()).toBe("王采购\n李财务\n张总");
  const 框 = page.getByPlaceholder(/姓名 \/ 电话/);
  await 框.fill("蓝湾");
  expect(await 行.innerText()).toBe("王采购\n张总");
  await 框.fill("1380000");
  expect(await 行.innerText()).toBe("李财务");
  await page.waitForTimeout(400); // 停顿过了、服务端那一趟发出去还没回来
  expect(await 行.getAttribute("data-loading")).toBe("false");
  expect(await 行.innerText()).toBe("李财务");
  await 框.fill("");
  await expect.poll(() => 行.innerText()).toBe("王采购\n李财务\n张总");
  expect(errors).toEqual([]); await page.close();
});
