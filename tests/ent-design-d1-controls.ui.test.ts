import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* D1 · 设计语言 11-21：输入框、数字框、日期框、中栏名单搜索框（静 / 悬停 / 聚焦）、禁用框、只读框、蓝标签和灰标签在真浏览器里量一遍。
   用真的 lib/theme.ts（ConfigProvider）+ antd 控件；样式表照 app/layout.tsx 的顺序注入：globals → antd-dark → dark */
const 样式 = ["globals.css", "antd-dark.css", "dark.css"];

type 控件样 = Record<string, string>;
let browser: Browser, bundle: string;

beforeAll(async () => {
  bundle = (await build({
    stdin: {
      contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider,Input,InputNumber,DatePicker,Tag} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {themeConfig} from '@/lib/theme';
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN} theme={themeConfig}><App><main className='main app-content' style={{padding:16,background:'var(--panel)'}}>
      <div style={{display:'grid',gap:12,width:320}}>
        <Input id='k-in' placeholder='输入框'/>
        <InputNumber id='k-num' style={{width:'100%'}}/>
        <DatePicker id='k-date' style={{width:'100%'}}/>
        <Input id='k-dis' disabled defaultValue='禁用'/>
        <Input id='k-ro' readOnly defaultValue='只读'/>
        <aside className='pane'><div className='pane-search' id='k-pane'><input id='k-pane-in' placeholder='搜姓名、最近一句'/></div></aside>
        <div><Tag id='k-blue' color='blue'>蓝</Tag><Tag id='k-plain'>灰</Tag></div>
      </div>
    </main></App></ConfigProvider>);`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    bundle: true, write: false, format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 量(): Promise<控件样> {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(5000);
  try {
    await page.route("http://d1-controls.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
    await page.goto("http://d1-controls.test");
    for (const f of 样式) await page.addStyleTag({ path: path.resolve("src/app", f) });
    await page.addScriptTag({ content: bundle });
    await page.locator("#k-blue").waitFor();
    await page.mouse.move(1300, 880);
    await page.waitForTimeout(300);
    const 框 = (sel: string) => page.evaluate((sel) => {
      const e = document.querySelector(sel)!;
      const 外 = e.closest(".ant-input-number, .ant-picker, .pane-search") ?? e;
      const c = getComputedStyle(外);
      return { 框: c.borderTopColor, 底: c.backgroundColor, 影: c.boxShadow };
    }, sel);
    const 结果: 控件样 = {};
    const 记 = (前缀: string, v: Record<string, string>) => { for (const [k, x] of Object.entries(v)) 结果[`${前缀}.${k}`] = x; };
    for (const [名, sel] of [["输入框", "#k-in"], ["数字框", "#k-num"], ["日期框", "#k-date"], ["名单搜索框", "#k-pane-in"]] as const) {
      记(`${名}.静`, await 框(sel));
      await page.hover(sel);
      await page.waitForTimeout(400); // antd 框色 0.2s 过渡
      记(`${名}.悬停`, { 框: (await 框(sel)).框 });
      await page.mouse.move(1300, 880);
      await page.focus(sel);
      await page.waitForTimeout(400);
      const 焦 = await 框(sel);
      记(`${名}.聚焦`, { 框: 焦.框, 影: 焦.影 });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.waitForTimeout(400);
    }
    记("禁用框", await 框("#k-dis"));
    记("只读框", await 框("#k-ro"));
    for (const id of ["k-blue", "k-plain"]) {
      记(`标签.${id}`, await page.locator(`#${id}`).evaluate((e) => ({ 底: getComputedStyle(e).backgroundColor, 字: getComputedStyle(e).color })));
    }
    return 结果;
  } finally {
    await page.close();
  }
}

it("输入类控件白底 + --field-line、悬停 #86868b、聚焦主色光晕；禁用框照 antd 原样（不挂新规则），只读框和输入框同一套", async () => {
  const 现 = await 量();
  for (const 名 of ["输入框", "数字框", "日期框", "名单搜索框"]) {
    expect(现[`${名}.静.框`], 名).toBe("rgb(199, 199, 204)");
    expect(现[`${名}.静.底`], 名).toBe("rgb(255, 255, 255)");
    expect(现[`${名}.悬停.框`], 名).toBe("rgb(134, 134, 139)");
    expect(现[`${名}.聚焦.框`], 名).toBe("rgb(10, 102, 216)");
    expect(现[`${名}.聚焦.影`], 名).toMatch(/0\.18\)? 0px 0px 0px 3px$/);
  }
  // 禁用：main 上就是 antd 原样（框 #d9d9d9、底 --hover），D1 不动
  expect([现["禁用框.框"], 现["禁用框.底"], 现["禁用框.影"]]).toEqual(["rgb(217, 217, 217)", "rgb(236, 236, 238)", "none"]);
  // 只读：能选中复制，看起来和输入框一样是个格子
  expect([现["只读框.框"], 现["只读框.底"]]).toEqual(["rgb(199, 199, 204)", "rgb(255, 255, 255)"]);
  // 标签：蓝的也落成中性灰 --tag-bg / --tag-fg
  expect(现["标签.k-blue.底"]).toBe("rgb(236, 236, 238)");
  expect(现["标签.k-blue.字"]).toBe("rgb(66, 66, 69)");
}, 60_000);
