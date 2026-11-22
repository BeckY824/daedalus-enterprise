/**
 * 设计语言 E6b · K1：深色提示框（antd Tooltip）里的链接，原来用品牌蓝压在深底上，对比只有 3.94:1，看不清。
 * 现在提示框里的链接跟提示框的字同色、加下划线认出是链接：对比 ≥ 4.5:1。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {ConfigProvider,Tooltip,Button,Typography} from 'antd';import {themeConfig} from '@/lib/theme';
    window.__render=()=>createRoot(document.getElementById('root')).render(<ConfigProvider theme={themeConfig}><div style={{padding:80}}>
      <Tooltip open title={<span>原负责人领不回，<a href="#x" data-k="a">看规则</a>，<Typography.Link href="#y" data-k="tl">看名单</Typography.Link>，<Button type="link" size="small" data-k="bl">去设置</Button></span>}><button>悬停</button></Tooltip>
    </div></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

/** 两个 rgb 色的对比度（WCAG），底色带透明的先压在白底上 */
function 对比(前: string, 后: string): number {
  const 数 = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
  const [r2, g2, b2, a2 = 1] = 数(后);
  const 底 = [r2, g2, b2].map((x) => x * a2 + 255 * (1 - a2));
  const [r1, g1, b1, a1 = 1] = 数(前);
  const 字 = [r1, g1, b1].map((x, i) => x * a1 + 底[i] * (1 - a1));
  const 亮 = (rgb: number[]) => { const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [L1, L2] = [亮(字), 亮(底)].sort((a, b) => b - a);
  return (L1 + 0.05) / (L2 + 0.05);
}

it("K1：提示框里的链接对比 ≥ 4.5:1，带下划线", async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 600 } }); page.setDefaultTimeout(5000);
  try {
    await page.route("http://tip.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><html><div id='root'></div></html>` }));
    await page.goto("http://tip.test/");
    await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
    await page.locator(".ant-tooltip [data-k=a]").waitFor();
    for (const k of ["a", "tl", "bl"]) {
      const { 字, 底, 线 } = await page.locator(`.ant-tooltip [data-k=${k}]`).evaluate((el) => {
        const 框 = el.closest(".ant-tooltip-container, .ant-tooltip-inner")!;
        return { 字: getComputedStyle(el).color, 底: getComputedStyle(框).backgroundColor, 线: getComputedStyle(el).textDecorationLine };
      });
      expect(对比(字, 底), `${k}：${字} on ${底}`).toBeGreaterThanOrEqual(4.5);
      expect(线, k).toContain("underline");
    }
  } finally { await page.close(); }
});
