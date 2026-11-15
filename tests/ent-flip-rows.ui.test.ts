/**
 * ov.table：按负责人表点表头排序，行从旧位置滑到新位置（FLIP）；减弱动态、超过 50 行不做动画，直接换。
 * 认元素用 role / 文字（列头、行里的名字）。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {Table} from 'antd';
    import FlipRows from '@/components/FlipRows';
    window.__画=(n)=>{
      const 行=Array.from({length:n},(_,i)=>({id:'u'+i,name:'某某超长名字的负责人'+i,v:n-i}));
      createRoot(document.getElementById('root')).render(<FlipRows><Table size="small" rowKey="id" pagination={false} dataSource={行}
        columns={[{title:'负责人',dataIndex:'name'},{title:'线索',dataIndex:'v',sorter:(a,b)=>a.v-b.v}]}/></FlipRows>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(n: number, 少动 = false): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 少动 ? "reduce" : "no-preference" });
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/"); await page.addScriptTag({ content: bundle });
  await page.evaluate((k) => (window as unknown as { __画: (k: number) => void }).__画(k), n);
  await page.getByText("某某超长名字的负责人0").waitFor();
  return page;
}
const 排序后动画数 = async (page: Page) => {
  await page.evaluate(() => { const w = window as unknown as { __动: number }; w.__动 = 0; const 原 = Element.prototype.animate; Element.prototype.animate = function (...a) { if (this.tagName === "TR") w.__动++; return 原.apply(this, a); }; });
  await page.getByRole("columnheader", { name: /线索/ }).click();
  return page.evaluate(() => (window as unknown as { __动: number }).__动 ?? 0);
};

it("点表头排序：挪了位置的行带一段滑动", async () => {
  const page = await 打开(6);
  expect(await 排序后动画数(page)).toBeGreaterThan(0);
  await page.close();
});
it("减弱动态：直接换，不滑", async () => {
  const page = await 打开(6, true);
  expect(await 排序后动画数(page)).toBe(0);
  await page.close();
});
it("超过 50 行：不做动画", async () => {
  const page = await 打开(51);
  expect(await 排序后动画数(page)).toBe(0);
  await page.close();
});
