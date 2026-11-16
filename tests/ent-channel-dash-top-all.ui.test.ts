import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* 渠道看板线索榜「展开全部」（员工反馈 #5）：Windows 1024 / 1280 / 1366 宽，主栏 = 视口扣掉左栏 220 和页边距；
   12 个渠道、名字很长：收起摆 5 个 + 「展开全部（共 12 个渠道）」，展开摆 12 个，列表自己滚、不横向溢出，按钮、名字点得中；切档跟着换数 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "chan-dash-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ChannelDash from '@/app/(app)/channels/ChannelDash';
    const 空={线索:0,已判定:0,有效:0,商机:0,订单:0,成交:[],投入:[],起线索:0,起有效:0,起转商机:0};
    const 渠道们=Array.from({length:13},(_,i)=>({id:'c'+i,name:'超长渠道名'+'很'.repeat(60)+i,attr:null,channelOwnerName:'—',投入数:1}));
    // 全部：c0..c11 各 i+1 条（c12 没有）；本月：只有 c0..c6
    const 份=(n)=>Object.fromEntries(渠道们.map((c,i)=>[c.id,i<n?{...空,线索:i+1,起线索:i+1}:空]));
    const 底数={本月:份(7),本季:份(7),全部:份(12)};
    window.__calls=[];
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App>
      <ChannelDash 渠道们={渠道们} 底数={底数} 筛了负责人={false} 能录={false} 看详情={(id)=>window.__calls.push(id)}/>
    </App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const 主栏 = width - 220 - 48;
  await page.route("http://dash.test/**", r => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><div id='root' style='width:${主栏}px;padding:0 24px;margin-left:220px'></div>` }));
  await page.goto("http://dash.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.getByTestId("chan-dash-top").waitFor();
  return { page, errors, 右界: 220 + 24 + 主栏 };
}

it.each([1024, 1280, 1366])("Windows %ipx：收起 5 个，展开全部 12 个，长名字不撑宽、列表自己滚，按钮点得中", async (w) => {
  const { page, errors, 右界 } = await open(w);
  try {
    const 榜 = page.getByTestId("chan-dash-top");
    const 行数 = () => 榜.locator("li").count();
    expect(await 行数()).toBe(5);
    const 钮 = page.getByTestId("chan-dash-top-more");
    expect(await 钮.innerText()).toBe("展开全部（共 12 个渠道）");
    const 点得中 = async () => {
      const b = (await 钮.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(右界);
      return page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid=chan-dash-top-more]") != null, [b.x + b.width / 2, b.y + b.height / 2]);
    };
    expect(await 点得中()).toBe(true);
    await 钮.click();
    expect(await 行数()).toBe(12);
    expect(await page.getByText("线索排行（全部 12 个渠道）").isVisible()).toBe(true);
    // 从多到少：第一行 c11（12 条），最后一行 c0（1 条）；没线索的 c12 不列
    expect(await 榜.locator("li").first().locator("button").getAttribute("title")).toMatch(/11$/);
    expect(await 榜.locator("li").last().locator("button").getAttribute("title")).toMatch(/很0$/);
    const 量 = await 榜.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight }));
    expect(量.sw).toBeLessThanOrEqual(量.cw + 1);
    expect(量.ch).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // 最后一行滚进来后名字点得中、打开那个渠道
    const 末 = 榜.locator("li").last().locator("button");
    await 末.scrollIntoViewIfNeeded();
    const mb = (await 末.boundingBox())!;
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("title") ?? "", [mb.x + Math.min(20, mb.width / 2), mb.y + mb.height / 2])).toMatch(/很0$/);
    await 末.click();
    expect(await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls)).toEqual(["c0"]);
    expect(await 点得中()).toBe(true);
    await 钮.click();
    expect(await 行数()).toBe(5);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("跟档走：本月只有 7 个渠道有线索，展开就是 7 个", async () => {
  const { page, errors } = await open(1280);
  try {
    await page.getByText("本月", { exact: true }).click();
    const 钮 = page.getByTestId("chan-dash-top-more");
    expect(await 钮.innerText()).toBe("展开全部（共 7 个渠道）");
    await 钮.click();
    expect(await page.getByTestId("chan-dash-top").locator("li").count()).toBe(7);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
