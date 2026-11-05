/**
 * 回收站相关的两处提示（11-05，服务端规则见 ent-import-trash.test.ts / ent-soft-delete.test.ts）：
 *   导入确认那一步：号码在回收站的几行单独数出来、列行号、说怎么捞回；「跳过（已有）」不把它们算进去
 *   导完那一步：同样报出几条、怎么捞回
 *   「从回收站捞回」：号码已不在回收站（别人先捞了 / 彻底删了）用提醒样式，不用成功样式；捞成了照旧成功样式
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "import-trash-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^\.\/number-actions$/, "export const 从回收站捞回=async()=>window.__捞回;");
  stub(/^\.\/import-actions$/, "export {};");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import RescueKey from '@/app/(app)/customers/RescueKey';
    import {确认,回收站提示} from '@/app/(app)/customers/import-steps';
    const root=createRoot(document.getElementById('root'));
    const 看={新建:1,已在库里:1,可补空:1,补空:0,跳过:3,说不清:0,进不了:0,合掉几行:0,待复核:[],挡下:[],回收站里:2,回收站行号:[2,5],没对上的列名:[]};
    window.__render=()=>root.render(<ConfigProvider locale={zhCN}><App>
      <div id="confirm"><确认 看={看} 重复行="跳过" set重复行={()=>{}} b={DEFAULT_BUSINESS}/></div>
      <div id="done"><回收站提示 几行={2} b={DEFAULT_BUSINESS} 导完/></div>
      <RescueKey 类型="手机号" 值="13800000001" 捞回了={q=>{window.__新结论=q}}/>
    </App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(捞回: unknown) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://trash.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://trash.test"); await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => { Reflect.set(window, "__捞回", x); (window as unknown as { __render: () => void }).__render(); }, 捞回);
  await page.getByTestId("rescue-from-trash").waitFor();
  return { page, errors };
}

it("确认那一步：单独数出号码在回收站几行、列行号、说怎么捞回；导完那一步同样报", async () => {
  const { page, errors } = await open({ ok: true, 提示: "x", 查: { ok: true, 状态: "首次录入" } });
  try {
    const 确认 = page.locator("#confirm");
    const 数 = await 确认.locator(".ant-space-item").allInnerTexts();
    expect(数.map(s => s.replace(/\s+/g, " ").trim())).toEqual(["1 新建", "1 跳过（已有）", "2 号码在回收站", "0 进不来"]);
    const 提示 = 确认.getByTestId("import-in-trash");
    expect(await 提示.getAttribute("class")).toContain("ant-alert-warning");
    const 字 = await 提示.innerText();
    expect(字).toContain("有 2 行的号码在回收站里，这几行不新建");
    expect(字).toContain("第 2 行、第 5 行");
    expect(字).toContain("从回收站捞回");
    const 导完 = await page.locator("#done").getByTestId("import-in-trash").innerText();
    expect(导完).toContain("2 条的号码在回收站里，没有新建");
    expect(导完).toContain("从回收站捞回");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("捞回时号码已不在回收站：提醒样式、写明已不在回收站，不出成功样式；新结论照样交出去", async () => {
  const { page, errors } = await open({ ok: true, 已不在: true, 提示: "这个号码已不在回收站里了（可能刚被别人捞回，或已彻底删除），按最新的查重结果来", 查: { ok: true, 状态: "我的通讯录已有" } });
  try {
    await page.getByTestId("rescue-from-trash").click();
    await page.locator(".ant-popconfirm .ant-btn-primary").click();
    await page.locator(".ant-message-warning").waitFor();
    expect(await page.locator(".ant-message-warning").innerText()).toContain("已不在回收站");
    expect(await page.locator(".ant-message-success").count()).toBe(0);
    expect(await page.evaluate(() => Reflect.get(window, "__新结论"))).toMatchObject({ 状态: "我的通讯录已有" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("捞成了：照旧成功样式", async () => {
  const { page } = await open({ ok: true, 提示: "已从回收站捞回 1 位客户（连同联系人、项目、跟进）", 查: { ok: true, 状态: "我的通讯录已有" } });
  try {
    await page.getByTestId("rescue-from-trash").click();
    await page.locator(".ant-popconfirm .ant-btn-primary").click();
    await page.locator(".ant-message-success").waitFor();
    expect(await page.locator(".ant-message-warning").count()).toBe(0);
  } finally { await page.close(); }
});
