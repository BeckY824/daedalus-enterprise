import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* 暗黑下 antd 分段控件选中字、页签未选中字（11-22 修 main 上原有的缺陷）：
   lib/theme.ts 里 Segmented / Tabs 的字色是写死的浅色墨色 palette.ink #1d1d1f，skins/shared.css 暗黑那条只换了轨道和选中底，
   字还是 #1d1d1f，压在暗底上看不见（/overview「团队 / 看板」「卡点 / 沟通 / 数据」）。
   修：shared.css 同一条里把这几项接到 --ink。量：现状暗黑下是暗黑的 --ink；现状浅色一个像素不变；换皮主题跟着它自己的 --ink 走
   用真的 lib/theme.ts（ConfigProvider）+ globals.css + dark.css + skins/*.css */
let browser: Browser, bundle: string;

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider,Segmented,Tabs} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {themeConfig} from '@/lib/theme';
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN} theme={themeConfig}><App><main className='main app-content' style={{padding:16}}>
      <Segmented id='seg' options={['团队','看板']} defaultValue='团队'/>
      <Tabs id='tabs' defaultActiveKey='a' items={[{key:'a',label:'卡点',children:'一'},{key:'b',label:'沟通',children:'二'},{key:'c',label:'数据',children:'三'}]}/>
    </main></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 量(属性: { skin?: string; mode?: string }) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const 根 = `${属性.skin ? ` data-skin="${属性.skin}"` : ""}${属性.mode ? ` data-mode="${属性.mode}"` : ""}`;
  await page.route("http://dark-tabs.test/**", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html${根}><meta charset='utf-8'><style>body{margin:0;background:var(--page-bg)}</style><div id='root'></div></html>` }));
  await page.goto("http://dark-tabs.test");
  for (const f of ["globals.css", "skins/shared.css", "skins/pixel.css", "skins/tech.css", "skins/luxe.css", "skins/ledger.css", "dark.css"]) await page.addStyleTag({ path: path.resolve("src/app", f) });
  await page.addScriptTag({ content: bundle });
  await page.locator("#tabs .ant-tabs-tab").first().waitFor();
  const r = await page.evaluate(() => {
    const 字 = (sel: string) => getComputedStyle(document.querySelector(sel)!).color;
    const s = document.createElement("span"); s.style.color = "var(--ink)"; document.body.append(s); const ink = getComputedStyle(s).color; s.remove();
    return {
      ink,
      段选中: 字("#seg .ant-segmented-item-selected"),
      签未选: 字("#tabs .ant-tabs-tab:not(.ant-tabs-tab-active) .ant-tabs-tab-btn"),
      签选中: 字("#tabs .ant-tabs-tab-active .ant-tabs-tab-btn"),
    };
  });
  await page.close();
  expect(errors).toEqual([]);
  return r;
}

it("现状暗黑：分段选中字、页签未选中 / 选中字都是暗黑的 --ink（不是浅色的 #1d1d1f）", async () => {
  const r = await 量({ skin: "now", mode: "dark" });
  expect(r.ink).toBe("rgb(232, 234, 238)");
  expect(r.段选中).toBe(r.ink);
  expect(r.签未选).toBe(r.ink);
  expect(r.签选中).toBe(r.ink);
});

it("现状浅色：照旧是 #1d1d1f（这次不动浅色）", async () => {
  const r = await 量({ skin: "now", mode: "light" });
  for (const k of ["段选中", "签未选", "签选中"] as const) expect(r[k], k).toBe("rgb(29, 29, 31)");
});

it("换皮主题（浅色、暗黑）：跟着各自的 --ink 走", async () => {
  for (const skin of ["pixel", "tech", "luxe", "ledger"])
    for (const mode of ["light", "dark"]) {
      const r = await 量({ skin, mode });
      for (const k of ["段选中", "签未选", "签选中"] as const) expect(r[k], `${skin} ${mode} ${k}`).toBe(r.ink);
    }
});
