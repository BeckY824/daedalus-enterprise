import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* 11-04 排版闸门（#183）：客户详情左栏电话改成就地改后，号码链接套进了单行省略的格（is-line：nowrap + ellipsis），
   省略号截在链接里、链接自己照样宽出格 19px（1024 / 1280 / 1366 都红）。换样子显示的值（电话链接）不走单行省略，放不下就换行。
   用真 InlineField + globals.css，左栏窄到装不下一整串号码 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "inline-phone", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^\.\.\/actions$/, "export const patchCustomer=async()=>({ok:true});");
  stub(/^\.\.\/useTransferConfirm$/, "export const useTransferConfirm=()=>async()=>true;");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import InlineField from '@/app/(app)/customers/[id]/InlineField';
    const 拨=(v)=><a href={'tel:'+v.replace(/[^\\d+]/g,'')}>{v}</a>;
    createRoot(document.getElementById('root')).render(<App><div className='rec-page'><aside className='rec-rail rec-card rec-rail-blocks' style={{width:190}}>
      <InlineField 空时横线 customerId='a' field='phone' label='电话' value='+44 20 7946 1000' 显示={拨}/>
      <InlineField 空时横线 customerId='a' field='school' label='公司' value={'很长的公司名字'.repeat(4)}/>
    </aside></div></App>);`, resolveDir: process.cwd(), loader: "jsx" },
    bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

it("左栏窄：电话链接不宽出格、照旧能拨；别的单行值照旧省略", async () => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
  try {
    await page.route("http://inline-phone.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
    await page.goto("http://inline-phone.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
    const 号 = page.locator(".rec-field[data-field=phone] .rec-field-v a[href^='tel:']");
    await 号.waitFor();
    const [链, 格] = await Promise.all([号.boundingBox(), page.locator(".rec-field[data-field=phone] .rec-field-v").boundingBox()]);
    expect(链!.x + 链!.width).toBeLessThanOrEqual(格!.x + 格!.width + 1);
    expect(await 号.getAttribute("href")).toBe("tel:+442079461000");
    expect(await page.locator(".rec-field[data-field=school] .rec-field-v").evaluate(e => e.classList.contains("is-line") && getComputedStyle(e).textOverflow)).toBe("ellipsis");
  } finally { await page.close(); }
});
