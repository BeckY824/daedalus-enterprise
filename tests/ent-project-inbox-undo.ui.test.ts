/**
 * 项目页顶上两块收件箱（原型 pr.invite / pr.verify，11-15，P-界面-40「一步完成、可撤销」）：
 *   拒绝邀请：这一条马上收起、计数跟着变，6 秒内点「撤销」= 服务端什么都没收到；6 秒后才真的交上去
 *   判有效：同样一步完成、可撤销；「补一句」不再等计时，开说明框，写完点确定才交（带说明）
 *   判无效：照旧先弹框确认
 * 用 Playwright 的假时钟拨 6 秒，不真等
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "inbox-undo", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 记 = "(n)=>async(...a)=>{(window.__calls||(window.__calls=[])).push([n,...a]);return {ok:true}}";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/^\.\/actions$/, `const r=${记};export const 回项目邀请=r('回邀请'),市场复核Action=r('市场复核'),总管理终判Action=r('总管理终判');`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import InviteInbox from '@/app/(app)/projects/InviteInbox';import VerifyInbox from '@/app/(app)/projects/VerifyInbox';
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购项目第二期';
    createRoot(document.getElementById('root')).render(<App>
      <InviteInbox 邀请们={[
        {id:'m1',projectId:'p1',项目:'甲项目'+长,负责人:'组长甲',邀请人:'乙',角色:null,createdAt:'2026-11-14T01:00:00.000Z'},
        {id:'m2',projectId:'p2',项目:'乙项目',负责人:'组长乙',邀请人:'丙',角色:'售后支撑',createdAt:'2026-11-13T01:00:00.000Z'},
      ]}/>
      <VerifyInbox 们={[
        {projectId:'v1',项目:'待复核一',负责人:'甲',步:'市场复核',无效原因:'联系方式无效',初判说明:null,复核说明:null,异议说明:null,更新于:'2026-11-14T01:00:00.000Z'},
        {projectId:'v2',项目:'待复核二',负责人:'乙',步:'总管理终判',无效原因:null,初判说明:null,复核说明:null,异议说明:'不同意',更新于:'2026-11-14T01:00:00.000Z'},
      ]}/>
    </App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.clock.install();
  await page.route("http://inbox.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://inbox.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.getByText("待我回的项目组邀请（2）").waitFor();
  return { page, errors };
}
const 调用 = (page: Page) => page.evaluate(() => (window as unknown as { __calls?: unknown[][] }).__calls ?? []);

it("拒绝邀请：一步收起、计数变；6 秒内撤销 = 没交；再拒一次，6 秒后才交（拒绝）", async () => {
  const { page, errors } = await open();
  try {
    await page.getByRole("button", { name: /^拒\s*绝$/ }).first().click();
    await page.getByText("待我回的项目组邀请（1）").waitFor();
    expect(await page.getByRole("button", { name: /^拒\s*绝$/ }).count()).toBe(1);
    await page.getByText("已拒绝「甲项目", { exact: false }).waitFor();
    await page.locator(".undo-bar .undo-btn").dispatchEvent("click");
    await page.getByText("待我回的项目组邀请（2）").waitFor();
    await page.clock.runFor(7000);
    expect(await 调用(page)).toEqual([]);
    // 再拒一次：到点才交
    await page.getByRole("button", { name: /^拒\s*绝$/ }).first().click();
    await page.clock.runFor(5000);
    expect(await 调用(page)).toEqual([]);
    await page.clock.runFor(1500);
    await page.waitForFunction(() => ((window as unknown as { __calls?: unknown[] }).__calls ?? []).length > 0);
    expect(await 调用(page)).toEqual([["回邀请", "m1", false]]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("判有效：一步收起，6 秒后才交（不带说明）；「补一句」开说明框，写完确定才交、带说明；判无效照旧先弹框", async () => {
  const { page, errors } = await open(1024);
  try {
    await page.getByTestId("verify-row-v1").getByRole("button", { name: "判有效" }).click();
    await page.getByText("待复核的线索（1）").waitFor();
    expect(await page.getByTestId("verify-row-v1").count()).toBe(0);
    expect(await 调用(page)).toEqual([]);
    await page.clock.runFor(6500);
    await page.waitForFunction(() => ((window as unknown as { __calls?: unknown[] }).__calls ?? []).length > 0);
    expect(await 调用(page)).toEqual([["市场复核", "v1", true, ""]]);
    // 总管理终判那一条：补一句
    await page.getByTestId("verify-row-v2").getByRole("button", { name: "判有效" }).click();
    // 提示条进出场时位置在挪（上一条正收起），按「稳定」等会被假时钟卡住：直接派发点击
    await page.locator('[data-undo="verify-v2"]').getByRole("button", { name: "补一句" }).dispatchEvent("click");
    const 框 = page.getByRole("dialog", { name: "判有效" });
    await 框.waitFor();
    await 框.getByLabel("复核说明").fill("电话打通了");
    await page.clock.runFor(7000);
    expect((await 调用(page)).length).toBe(1); // 开着说明框不自动交
    await 框.getByRole("button", { name: /确\s*定/ }).click();
    await page.waitForFunction(() => ((window as unknown as { __calls?: unknown[] }).__calls ?? []).length > 1);
    expect((await 调用(page))[1]).toEqual(["总管理终判", "v2", true, "电话打通了"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("判无效：先弹确认框，不点确定不交", async () => {
  const { page, errors } = await open();
  try {
    await page.getByTestId("verify-row-v1").getByRole("button", { name: "判无效" }).click();
    await page.getByRole("dialog", { name: "判无效" }).waitFor();
    await page.clock.runFor(7000);
    expect(await 调用(page)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
