/** 企业版字典下拉（10-27 批注，components/DictSelect.tsx）：能搜；选「其他」出一个必填框，给出去的是「其他：xxx」；外面清空跟着清 */
import { afterAll, beforeAll, it, expect } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{App}from'antd';import D from'@/components/DictSelect';
    window.__vals=[];
    function T(){const[v,setV]=useState(null);window.__clear=()=>setV(null);
      return <div style={{width:300,padding:16}}><D aria-label="回收原因" placeholder="回收原因" options={["超时未跟进","销售离职","其他"]} value={v} onChange={(x)=>{window.__vals.push(x);setV(x);}}/><div id="out">{String(v)}</div></div>;}
    createRoot(document.getElementById('root')).render(<App><T/></App>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120000);
afterAll(async () => { await browser?.close(); });
it("搜索、选其他要写、外面清空跟着清", async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 600 } });
  await page.route("http://dictsel.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://dictsel.test");
  await page.addScriptTag({ content: bundle });
  const 框 = page.getByLabel("回收原因", { exact: true });
  await 框.click();
  await 框.fill("离职");
  // 搜「离职」只剩一项
  await page.locator(".ant-select-item-option").first().waitFor();
  expect(await page.locator(".ant-select-item-option").count()).toBe(1);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.locator("#out").textContent()).toBe("销售离职");
  // 选其他：多一个框，没写给出去的是「其他」
  await page.keyboard.press("Escape");
  await 框.fill("其他");
  await page.locator(".ant-select-item-option", { hasText: "其他" }).click();
  await expect.poll(() => page.locator("#out").textContent()).toBe("其他");
  const 写 = page.getByLabel("回收原因：其他的具体内容");
  await 写.fill("客户搬家");
  await expect.poll(() => page.locator("#out").textContent()).toBe("其他：客户搬家");
  // 外面清空：下拉和补充框都清掉
  await page.evaluate(() => (window as unknown as { __clear: () => void }).__clear());
  await expect.poll(() => page.locator("#out").textContent()).toBe("null");
  expect(await 写.count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
}, 60000);
