/**
 * 换皮主题 × 基础控件的量法（tests/ent-design-d1-skins.ui.test.ts 用）。
 *
 * D1 · 设计语言 11-21 只改现状主题，用户定「换皮主题不动」：这里把输入框、数字框、日期框、名单搜索框、蓝标签
 * 在某个主题下的静态 / 悬停 / 聚焦样子量出来，测试拿它和 main 上量的值逐项比。
 * 不依赖 vitest：给一个源码根（默认本仓库），也能拿去量别的版本（比如 git archive 出来的 main）。
 * 样式表照 app/layout.tsx 的顺序注入：globals → skins/shared → 各主题 → dark。
 */
import { build } from "esbuild";
import path from "node:path";
import type { Browser } from "playwright";

export const 主题样式 = ["app/globals.css", "app/skins/shared.css", "app/skins/pixel.css", "app/skins/tech.css", "app/skins/luxe.css", "app/skins/ledger.css", "app/dark.css"];

/** 打包夹具：真的 lib/theme.ts（ConfigProvider）+ antd 控件。src 指向要量的那份源码 */
export async function 打包(src: string): Promise<string> {
  return (await build({
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
    alias: { "@": src }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  })).outputFiles[0].text;
}

export type 控件样 = Record<string, string>;

/** 在某个主题下量一遍。skin 为空 = 现状主题 */
export async function 量(browser: Browser, src: string, bundle: string, skin: string | null): Promise<控件样> {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(5000);
  try {
    await page.route("http://skin-controls.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
    await page.goto("http://skin-controls.test");
    if (skin) await page.evaluate((s) => document.documentElement.setAttribute("data-skin", s), skin);
    for (const f of 主题样式) await page.addStyleTag({ path: path.join(src, f) });
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
