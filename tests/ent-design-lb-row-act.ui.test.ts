/**
 * 设计语言 L-B · 行内动作 .row-act 一种款（D09；落地计划「.row-act 只在 L-B 改一次」）+「更多筛选（N）」写法（P-界面-12）。
 *
 *   现状主题：带字的 .row-act（领取、录投入、详情、恢复、展开……）是文字按钮——蓝字、不带框、透明底，悬停浅蓝底；禁用灰字不带框；
 *            只剩图标的 .row-act（⋯、编辑、停用，type="text"）不变；手机宽（390）点击区照旧 ≥44
 *   换皮主题（账簿）：照旧带框
 *   五页在用的 .row-act（渠道、客户列表、公海、成员表；跟进计划是 .plan-row-act 图标钮不在内）：行上不标红、不另设 type="primary"
 *   「更多筛选」：现状主题写「更多筛选（N）」，窄窗口只剩数字；换皮主题照旧「更多筛选 · N」
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "lb-row-act", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,Button,Select,Space} from 'antd';
    import {MoreOutlined} from '@ant-design/icons';
    import {useCustomFilters} from '@/components/CustomFilters';
    function 筛(){
      const 项=[['a','甲'],['b','乙'],['c','丙']].map(([键,名],i)=>({键,名,宽:120,默认外露:i===0,有值:i>0,渲染:(style)=><Select style={style} aria-label={名} value={i>0?'x':undefined} options={[{value:'x',label:'x'}]}/>}));
      const {外露,更多按钮}=useCustomFilters('lb-row-act-test',项);
      return <div className="list-bar"><Space wrap>{外露}{更多按钮}</Space></div>;
    }
    window.__画=()=>createRoot(document.getElementById('root')).render(<App><main style={{padding:16}}>
      <Space size={2}>
        <Button className="row-act" size="small" data-k="领取">领取</Button>
        <Button className="row-act" size="small" disabled data-k="禁用">领取</Button>
        <Button className="row-act" type="text" size="small" icon={<MoreOutlined/>} aria-label="更多操作" data-k="更多"/>
      </Space>
      <筛/>
    </main></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(width = 1366, skin?: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 700 }, hasTouch: width < 768 }); page.setDefaultTimeout(5000);
  await page.route("http://lb.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://lb.test/");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  if (skin) await page.evaluate((k) => { document.documentElement.dataset.skin = k; }, skin);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as { __画: () => void }).__画());
  await page.locator("[data-k=领取]").waitFor();
  return page;
}
const 色 = (page: Page, v: string) => page.evaluate((v) => { const d = document.createElement("i"); d.style.color = `var(${v})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, v);
const 样 = (page: Page, k: string) => page.locator(`[data-k=${k}]`).evaluate((e) => { const s = getComputedStyle(e); return { 框: s.borderTopColor, 底: s.backgroundColor, 字: s.color, 宽: e.getBoundingClientRect().width, 高: e.getBoundingClientRect().height }; });

it("现状主题：带字的 .row-act 蓝字、不带框、透明底；悬停浅蓝底；禁用灰字；图标钮不变", async () => {
  const page = await 打开();
  try {
    const 领 = await 样(page, "领取");
    expect(领.框).toBe("rgba(0, 0, 0, 0)");
    expect(领.底).toBe("rgba(0, 0, 0, 0)");
    expect(领.字).toBe(await 色(page, "--brand"));
    await page.locator("[data-k=领取]").hover(); await page.waitForTimeout(250);
    const 悬 = await 样(page, "领取");
    expect(悬.底).toBe(await 色(page, "--brand-bg"));
    expect(悬.框).toBe("rgba(0, 0, 0, 0)");
    const 禁 = await 样(page, "禁用");
    expect(禁.框).toBe("rgba(0, 0, 0, 0)");
    expect(禁.字).toBe(await 色(page, "--text-faint"));
    // 只剩图标的「⋯」不吃这一款（不是蓝字）
    expect((await 样(page, "更多")).字).not.toBe(await 色(page, "--brand"));
  } finally { await page.close(); }
});

it("390 触屏：.row-act 点击区照旧 ≥44", async () => {
  const page = await 打开(390);
  try {
    for (const k of ["领取", "更多"]) {
      const s = await 样(page, k);
      expect(s.宽, k).toBeGreaterThanOrEqual(44);
      expect(s.高, k).toBeGreaterThanOrEqual(44);
    }
  } finally { await page.close(); }
});

it("账簿主题：.row-act 照旧带框", async () => {
  const page = await 打开(1366, "ledger");
  try {
    expect((await 样(page, "领取")).框).not.toBe("rgba(0, 0, 0, 0)");
  } finally { await page.close(); }
});

it("「更多筛选（N）」：现状主题 1440 写全、1024 只剩数字；账簿主题照旧「更多筛选 · N」", async () => {
  const 钮字 = (page: Page) => page.getByRole("button", { name: /更多筛选/ }).innerText().then((t) => t.replace(/\s+/g, ""));
  let page = await 打开(1440);
  try { expect(await 钮字(page)).toBe("更多筛选（2）"); } finally { await page.close(); }
  page = await 打开(1024);
  try { expect(await 钮字(page)).toBe("2"); } finally { await page.close(); }
  page = await 打开(1440, "ledger");
  try { expect(await 钮字(page)).toBe("更多筛选·2"); } finally { await page.close(); }
});

it("五页在用的 .row-act：行上不标红、不另设 primary（一种款）", () => {
  const 文件 = ["src/app/(app)/channels/ChannelsView.tsx", "src/app/(app)/customers/CustomersView.tsx", "src/app/(app)/pool/PoolView.tsx", "src/app/(app)/settings/MembersTab.tsx"];
  let 数 = 0;
  for (const f of 文件) {
    const s = readFileSync(path.resolve(f), "utf8");
    // 每个 className="row-act" 所在的那个 JSX 开标签（到第一个不在花括号里的 > 为止，按行粗取前后 12 行足够）
    const 行 = s.split("\n");
    行.forEach((l, i) => {
      if (!l.includes('className="row-act"')) return;
      数++;
      const 段 = 行.slice(Math.max(0, i - 3), i + 10).join("\n");
      const 标签 = 段.slice(0, 段.indexOf(">", 段.indexOf('className="row-act"')) + 1);
      expect(标签, `${f}:${i + 1}`).not.toMatch(/\bdanger\b/);
      expect(标签, `${f}:${i + 1}`).not.toMatch(/type="primary"/);
    });
  }
  expect(数).toBeGreaterThanOrEqual(10);
});
