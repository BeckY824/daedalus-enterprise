import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* 暗黑下 antd 分段控件选中字、页签未选中字（11-22 修 main 上原有的缺陷）：
   lib/theme.ts 里 Segmented / Tabs 的字色是写死的浅色墨色 palette.ink #1d1d1f，antd-dark.css暗黑那条只换了轨道和选中底，
   字还是 #1d1d1f，压在暗底上看不见（/overview「团队 / 看板」「卡点 / 沟通 / 数据」）。
   修：同一条里把这几项接到 --ink；暗黑下分段选中底抬亮一档、比轨道亮（照 .cd-seg，规则在 globals.css）。量：暗黑下是暗黑的 --ink；浅色一个像素不变
   用真的 lib/theme.ts（ConfigProvider）+ globals.css + antd-dark.css + dark.css（照 app/layout.tsx 的顺序） */
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

async function 量(属性: { mode?: string }) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const 根 = 属性.mode ? ` data-mode="${属性.mode}"` : "";
  await page.route("http://dark-tabs.test/**", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html${根}><meta charset='utf-8'><style>body{margin:0;background:var(--page-bg)}</style><div id='root'></div></html>` }));
  await page.goto("http://dark-tabs.test");
  for (const f of ["globals.css", "antd-dark.css", "dark.css"]) await page.addStyleTag({ path: path.resolve("src/app", f) });
  await page.addScriptTag({ content: bundle });
  await page.locator("#tabs .ant-tabs-tab").first().waitFor();
  const r = await page.evaluate(() => {
    const 字 = (sel: string) => getComputedStyle(document.querySelector(sel)!).color;
    const s = document.createElement("span"); s.style.color = "var(--ink)"; document.body.append(s); const ink = getComputedStyle(s).color; s.remove();
    const 亮 = (c: string) => { const 分 = c.startsWith("color(") ? 1 : 255; const [r, g, b] = (c.replace(/^color\(srgb/, "").match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(x => x / 分).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    return {
      ink,
      选中底亮: 亮(getComputedStyle(document.querySelector("#seg .ant-segmented-item-selected")!).backgroundColor),
      轨道亮: 亮(getComputedStyle(document.querySelector("#seg")!).backgroundColor),
      段选中: 字("#seg .ant-segmented-item-selected"),
      签未选: 字("#tabs .ant-tabs-tab:not(.ant-tabs-tab-active) .ant-tabs-tab-btn"),
      签选中: 字("#tabs .ant-tabs-tab-active .ant-tabs-tab-btn"),
    };
  });
  await page.close();
  expect(errors).toEqual([]);
  return r;
}

it("暗黑：分段选中字、页签未选中 / 选中字都是暗黑的 --ink（不是浅色的 #1d1d1f）", async () => {
  const r = await 量({ mode: "dark" });
  expect(r.ink).toBe("rgb(232, 234, 238)");
  expect(r.段选中).toBe(r.ink);
  expect(r.签未选).toBe(r.ink);
  expect(r.签选中).toBe(r.ink);
  // 分段选中底比轨道亮（原来读 --panel，比轨道 --hover 还暗）
  expect(r.选中底亮).toBeGreaterThan(r.轨道亮);
});

it("浅色：照旧是 #1d1d1f（这次不动浅色）", async () => {
  const r = await 量({ mode: "light" });
  for (const k of ["段选中", "签未选", "签选中"] as const) expect(r[k], k).toBe("rgb(29, 29, 31)");
});

