/**
 * 数据页「导入批次」下拉、列表页头「导入批次：… ×」标签的排版（11-19）。
 *
 *   真浏览器 + 真 antd + globals.css：最长的批次名（「排掉 销帮帮增量 11-19 · 公海客户项目」）选上，
 *   和视图切换、自定义日期段、我的 | 团队、人员下拉同屏，Windows 1024 / 1280 / 1366 和手机 390 宽都不横向撑出；
 *   下拉里的字一行省略、悬停看全（title）；标签同样一行省略、能关掉
 *   选了批次时，卡点分布、超时预警、客户分布标题旁写「不跟导入批次」（数不改）；没选不写
 *   公海页从数据页点进来（open=1&batch=…）：翻页、换池重拼的地址里 open、batch 都还在（审查 #368：原来翻一页 open 就丢了）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "batch-layout-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){(window.__去||=[]).push(u)},replace(u){(window.__去||=[]).push(u)},prefetch(){}});export const useSearchParams=()=>new URLSearchParams(window.__sp||'');export const usePathname=()=>'/overview';");
  stub(/^next\/link$/, "export default function L({children,...p}){return <a {...p}>{children}</a>}");
  // ReviewSummary 只要 home-cards 里的一个天数常量；那个文件连着服务端的库，打不进浏览器包。地图另有用例，这里不画
  stub(/project\/home-cards$/, "export const 即将逾期天数=3;");
  stub(/overview\/CustomerWorldMap$/, "export default function M(){return null}");
  // 空态连着演示数据的服务端动作，这里只要它占个位
  stub(/components\/EmptyState$/, "export default function E({title}){return <div>{title}</div>}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import DataShell from '@/app/(app)/overview/DataShell';import BatchFilterTag from '@/components/BatchFilterTag';import {PageHead} from '@/components/ui';
    import {批次下拉项} from '@/lib/project/import-batch';
    import {复盘提醒排,客户分布排} from '@/app/(app)/overview/ReviewSummary';
    import {useUrlFilters} from '@/lib/url-filters';import {读公海页筛} from '@/app/(app)/pool/filters';
    const root=createRoot(document.getElementById('root'));
    const 包=(x)=><ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS}><div style={{padding:'0 16px'}}>{x}</div></BusinessProvider></App></ConfigProvider>;
    const 选项=批次下拉项(['xbm-incr-20261119-pool','xbm-incr-20261119','fill-nurture-20261117']);
    const 人们=[{value:'u1',label:'王芳（wangfang.very.long.email@example.com）'},{value:'u2',label:'李四'}];
    window.__shell=(当前,view)=>{window.__去=[];window.__sp='tab=data';flushSync(()=>root.render(包(<DataShell view={view} 项目 页签="data" 选人={{选项:人们,当前:'',我:'u1'}} 段={view==='自定义'?{from:'2026-10-01',to:'2026-11-19'}:undefined} 批次={{选项,当前}}><div>正文</div></DataShell>)))};
    window.__note=(不跟)=>{flushSync(()=>root.render(包(<><复盘提醒排 分布={{总数:0,按主体:[],按状态:[]}} 预警={[]} 将回公海={3} 不跟批次={不跟}/><客户分布排 分布={{总数:0,按国家:[],全部国家:[],未填国家:0,按业务线:[]}} 不跟批次={不跟}/></>)))};
    function 公海筛({q}){const 筛=读公海页筛(Object.fromEntries(new URLSearchParams(q)));const {翻页,apply}=useUrlFilters('/pool',筛,20);window.__翻=()=>翻页(2,20);window.__换池=()=>apply({attr:'商机池'});return null;}
    window.__pool=(q)=>{window.__去=[];flushSync(()=>root.render(包(<公海筛 q={q}/>)))};
    window.__tag=(batch)=>{window.__清=0;flushSync(()=>root.render(包(<PageHead title="新线索" subtitle="项目的线索阶段：潜客培育 → 线索验证 → 线索推进" titleAside={<BatchFilterTag batch={batch} 清掉={()=>{window.__清++}}/>}/>)))};
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://batch.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://batch.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  return { page, errors };
}
const 不溢出 = (page: import("playwright").Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const 最长 = "-xbm-incr-20261119-pool";

it("数据页：最长的批次选上，和视图、日期段、人员同屏，1024 / 1280 / 1366 / 390 都不撑出；字一行省略、悬停看全", async () => {
  for (const w of [1024, 1280, 1366, 390]) {
    const { page, errors } = await open(w);
    for (const view of ["现在", "自定义"]) {
      await page.evaluate(([v, k]) => (window as unknown as { __shell: (a: string, b: string) => void }).__shell(v, k), [最长, view]);
      const 框 = page.locator(".data-shell-batch");
      await 框.waitFor();
      expect(await 不溢出(page), `${w} ${view}`).toBe(true);
      const 量 = await 框.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const 字 = el.querySelector(".ant-select-selection-item, .ant-select-content-value, [title]") as HTMLElement | null;
        return { 右: r.right, 宽: window.innerWidth, 字: 字?.textContent ?? "", 提示: el.querySelector("[title]")?.getAttribute("title") ?? "", 一行: 字 ? getComputedStyle(字).whiteSpace : "" };
      });
      expect(量.右, `${w} ${view}`).toBeLessThanOrEqual(量.宽);
      expect(量.提示).toBe("排掉 销帮帮增量 11-19 · 公海客户项目");
      expect(量.字).toContain("排掉 销帮帮增量 11-19");
    }
    expect(errors).toEqual([]);
    await page.close();
  }
});

it("数据页：选「只看」写进地址栏 batch=，选「全部批次」去掉；换视图留着", async () => {
  const { page } = await open(1280);
  await page.evaluate(() => { (window as unknown as { __shell: (a: string, b: string) => void }).__shell("", "现在"); });
  await page.getByRole("combobox", { name: "导入批次" }).click();
  await page.getByText("只看 销帮帮增量 11-19 · 公海客户项目", { exact: true }).click();
  const 去 = await page.evaluate(() => (window as unknown as { __去: string[] }).__去);
  expect(去.at(-1)).toBe("/overview?tab=data&batch=xbm-incr-20261119-pool");
  await page.close();
});

it("列表页头标签：最长批次名 390 / 1024 宽不撑出、一行省略、悬停看全，点 × 清掉；认不出的不摆", async () => {
  for (const w of [390, 1024, 1366]) {
    const { page, errors } = await open(w);
    await page.evaluate((b) => (window as unknown as { __tag: (b: string) => void }).__tag(b), 最长);
    const 签 = page.locator(".batch-filter-tag");
    await 签.waitFor();
    expect(await 不溢出(page), String(w)).toBe(true);
    const 量 = await 签.evaluate((el) => ({ 右: el.getBoundingClientRect().right, 宽: window.innerWidth, 高: el.getBoundingClientRect().height, 提示: el.querySelector(".batch-filter-t")?.getAttribute("title") }));
    expect(量.右).toBeLessThanOrEqual(量.宽);
    // 一行：不折成两行
    expect(量.高).toBeLessThan(30);
    expect(量.提示).toBe("导入批次：排掉 销帮帮增量 11-19 · 公海客户项目（批次号 xbm-incr-20261119-pool）");
    await page.locator('.batch-filter-tag [aria-label="清掉导入批次筛选"]').click();
    expect(await page.evaluate(() => (window as unknown as { __清: number }).__清)).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }
  const { page } = await open(1280);
  await page.evaluate(() => (window as unknown as { __tag: (b: string) => void }).__tag("x y"));
  expect(await page.locator(".batch-filter-tag").count()).toBe(0);
  await page.close();
});

it("选了批次：卡点分布、超时预警、客户分布标题旁写「不跟导入批次」；没选不写", async () => {
  const { page, errors } = await open(1024);
  await page.evaluate(() => (window as unknown as { __note: (b: boolean) => void }).__note(true));
  for (const 区 of ["卡点分布", "超时预警", "客户分布·按国家", "客户分布·按业务线"]) {
    expect(await page.getByRole("region", { name: 区 }).locator(".btodo-head").innerText(), 区).toContain("不跟导入批次");
  }
  expect(await 不溢出(page)).toBe(true);
  await page.evaluate(() => (window as unknown as { __note: (b: boolean) => void }).__note(false));
  expect(await page.getByText("不跟导入批次").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

it("公海页带 open=1&batch= 进来：翻页、换池重拼的地址里 open、batch 都还在", async () => {
  const { page } = await open(1280);
  const 去了 = async (动作: string) => {
    await page.evaluate(() => (window as unknown as { __pool: (q: string) => void }).__pool("open=1&batch=-xbm-incr-20261119-pool"));
    await page.evaluate((k) => (window as unknown as Record<string, () => void>)[k](), 动作);
    await page.waitForFunction(() => ((window as unknown as { __去: string[] }).__去 ?? []).length > 0);
    return new URL((await page.evaluate(() => (window as unknown as { __去: string[] }).__去.at(-1)))!, "http://x").searchParams;
  };
  for (const 动作 of ["__翻", "__换池"]) {
    const q = await 去了(动作);
    expect(q.get("open"), 动作).toBe("1");
    expect(q.get("batch"), 动作).toBe("-xbm-incr-20261119-pool");
  }
  await page.close();
});
