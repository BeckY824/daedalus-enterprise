/**
 * 客户记录页左边的名单（企业版）：名字上方从「来源」改成客户所在国家地区（11-04 用户）。拼法见 ent-clean-misc.test.ts B6。
 *
 *   名单宽 220：超长国家地区 + 状态标签不横撑、省略号收住，悬停 title 给全文；名字照旧在下一行
 *   1280 / 1366 名单常驻，1024 名单收进抽屉（globals.css 1213 门槛），这里量常驻的两档
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const 长地区 = "刚果民主共和国 上加丹加省利卡西市郊区工业园区二期";
const plugin: Plugin = { name: "roster-region", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){}});export const usePathname=()=>'/customers/c1';export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({children,prefetch,...p}){return <a {...p}>{children}</a>}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import CustomerRoster from '@/components/CustomerRoster';
    const 长名='某某超长国际贸易进出口集团股份有限公司华东区域分公司'.repeat(2);
    const 行=(id,name,source)=>({id,name,followStatus:'待跟进',custStatus:'意向客户',lastFollowAt:new Date().toISOString(),ownerName:'乙',lastNote:'聊过一次',mine:true,source,nextPlanAt:null});
    window.__render=()=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}>
      <CustomerRoster data={{total:3,客户状态:{顺序:['意向客户'],颜色:{'意向客户':'blue'}},rows:[行('c1',长名,${JSON.stringify(长地区)}),行('c2','星河电子','广东省 深圳市'),行('c3','无地址公司',null)]}}/>
    </BusinessProvider></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

it("名字上方是国家地区：超长不横撑、省略号收住、title 给全文，名字在下一行（1280 / 1366）", async () => {
  for (const w of [1280, 1366]) {
    const page = await browser.newPage({ viewport: { width: w, height: 768 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    try {
      await page.route("http://roster.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
      await page.goto("http://roster.test/customers/c1"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
      await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
      await page.locator(".roster-row").first().waitFor();
      const r = await page.evaluate(() => {
        const 名单 = document.querySelector(".pane-roster, aside")!.getBoundingClientRect();
        return [...document.querySelectorAll(".roster-row")].map(row => {
          const src = row.querySelector(".roster-src") as HTMLElement, n = row.querySelector(".roster-n") as HTMLElement;
          return { 地区: src.textContent?.replace("意向客户", ""), title: src.title, 收住: src.scrollWidth > src.clientWidth ? "省略" : "放得下",
            不出界: src.getBoundingClientRect().right <= 名单.right + 1, 名字在下: n.getBoundingClientRect().top >= src.getBoundingClientRect().bottom - 1 };
        });
      });
      expect(r[0]).toMatchObject({ 地区: "刚果民主共和国 上加丹加省利卡西市郊区工业园区二期", title: "刚果民主共和国 上加丹加省利卡西市郊区工业园区二期", 收住: "省略", 不出界: true, 名字在下: true });
      expect(r[1]).toMatchObject({ 地区: "广东省 深圳市", 收住: "放得下", 不出界: true, 名字在下: true });
      expect(r[2]).toMatchObject({ 地区: "", 不出界: true, 名字在下: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
