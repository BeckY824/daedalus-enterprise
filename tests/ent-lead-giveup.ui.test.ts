/**
 * 项目页「放弃（豁免）」提示条和框（32H，projects/[id]/GiveUpBanner.tsx）+ 设置页组织规则里的开关：
 *   - 原因三选一（外出 / 忙不过来 / 其他），没有「线索无效 / 质量不达标」；框里写明线索无效走判无效，能跳到「线索验证」
 *   - 没选原因、选了其他没写一句：确认钮灰着；点确认调 放弃线索Action(项目, 原因, 补充)，失败把原因写在框里
 *   - 点不了（验证中、本月用过）：按钮灰着，提示条里写为什么
 *   - 电脑 1366、手机 390：不横向撑出
 *   - 设置 → 组织规则里有「销售主动放弃线索（豁免）」，默认关
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { 补全动作桩 } from "./helpers/action-stubs";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string, orgBundle: string;
const 空跑 = "async()=>({ok:true})";
const plugin: Plugin = { name: "giveup", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__refresh=(window.__refresh||0)+1},push(u){(window.__push||(window.__push=[])).push(u)}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^\.\/giveup-actions$/, 补全动作桩("src/app/(app)/projects/[id]/giveup-actions.ts",
    "export const 放弃线索Action=async(...a)=>{(window.__调用||(window.__调用=[])).push(a);return window.__回||{ok:true,接手人:'乙'}};"));
  stub(/^\.\/LeadAssignCard$/, "export default function C(){return null}");
  stub(/^\.\/FeishuConnectCard$/, "export default function F(){return null}");
  stub(/^\.\/FeishuPushSwitch$/, "export default function P(){return null}");
  stub(/^\.\/OrgSyncCard$/, "export default function S(){return null}");
  stub(/^\.\/org-actions$/, 补全动作桩("src/app/(app)/settings/org-actions.ts", `const f=${空跑};export const 建部门=f,改部门=f,删部门=f,设字段权限=f,设改权限=f,设市场部门=f,设只看某人=f,设回收站副手=f,设成员=f,设规则=f;`));
  stub(/^\.\.\/leads\/assign-actions$/, `export const 设不设配额=${空跑};export const 读线部门设置=async()=>({设的:{内贸:[],外贸:[]},还没勾:[],能改:true});export const 设线部门=${空跑};`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
const 打包 = async (contents: string) => (await build({
  stdin: { contents, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic",
  alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent",
})).outputFiles[0].text;
beforeAll(async () => {
  bundle = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import GiveUpBanner from '@/app/(app)/projects/[id]/GiveUpBanner';
    const root=createRoot(document.getElementById('root'));
    window.__render=({入口,有验证})=>root.render(<App><div style={{padding:16}}>
      <GiveUpBanner projectId="p1" 入口={入口} 打开判无效={有验证 ? () => { window.__验证开=(window.__验证开||0)+1; } : undefined}/>
    </div></App>);
  `);
  orgBundle = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import OrgTab from '@/app/(app)/settings/OrgTab';
    const root=createRoot(document.getElementById('root'));
    const 人=(id,name,bizRole)=>({id,name,deptId:null,bizRole,line:null,managerId:null,dottedManagerId:null});
    window.__render=()=>root.render(<App><OrgTab value={{
      部门:[],成员:[人('a','老板','director'),人('b','小王','sales')],能改:true,是老板:true,
      规则开着:{按组织看客户:false,线索分配:true,字段权限:false,市场复核:true,超时自动转:true,主动放弃:false},字段权限:{},字段权限挡:null,改权限:{},线索分配:null}}/></App>);
  `);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 入口 = { 可: boolean; 为什么?: string; 本月已用: boolean };
async function open(入口: 入口, o: { width?: number; 有验证?: boolean; 包?: string } = {}) {
  const width = o.width ?? 1366;
  const page = await browser.newPage({ viewport: { width, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://giveup.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://giveup.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: o.包 ?? bundle });
  await page.evaluate(x => (window as unknown as { __render: (x: unknown) => void }).__render(x), { 入口, 有验证: !!o.有验证 });
  return { page, errors };
}
const 调用们 = (page: Page) => page.evaluate(() => (window as unknown as { __调用?: unknown[][] }).__调用 ?? []);
const 能 = { 可: true, 本月已用: false };

it("原因三选一、没有线索无效 / 质量不达标；没选、选其他没写时确认钮灰着；确认调动作，提示条换成已放弃、不刷新本页（转走了就看不到了），点「知道了」回项目列表", async () => {
  const { page, errors } = await open(能);
  try {
    expect(await page.getByTestId("proj-giveup").innerText()).toContain("每人每月 1 次");
    await page.getByTestId("proj-giveup-open").click();
    const 框 = page.getByRole("dialog", { name: "放弃这条线索（豁免）" });
    await 框.waitFor();
    const 选项 = await 框.getByRole("radio").evaluateAll((els) => els.map((e) => (e.closest("label")?.textContent ?? "").trim()));
    expect(选项).toEqual(["外出", "忙不过来", "其他"]);
    expect(await 框.innerText()).not.toMatch(/质量不达标/);
    expect(await 框.getByTestId("proj-giveup-invalid-hint").innerText()).toContain("线索无效请走判无效");
    const 确认 = 框.getByRole("button", { name: "确认放弃" });
    expect(await 确认.isDisabled()).toBe(true);
    await 框.getByText("其他", { exact: true }).click();
    expect(await 确认.isDisabled()).toBe(true);
    await 框.getByTestId("proj-giveup-note").fill("下午去医院");
    expect(await 确认.isDisabled()).toBe(false);
    await 确认.click();
    await page.getByTestId("proj-giveup-done").waitFor();
    expect(await 调用们(page)).toEqual([["p1", "其他", "下午去医院"]]);
    // [审查 3] 不刷新本页：线索已经转走，刷新会落到看不到的页
    expect(await page.evaluate(() => (window as unknown as { __refresh?: number }).__refresh ?? 0)).toBe(0);
    expect(await page.getByTestId("proj-giveup-done").innerText()).toContain("转给了 乙");
    await page.getByTestId("proj-giveup-done").getByRole("button", { name: "知道了" }).click();
    expect(await page.evaluate(() => (window as unknown as { __push?: string[] }).__push)).toEqual(["/projects"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("[实操 2] 选「其他」写了补充又换成外出：补充框收起、内容清空，提交不带补充；再换回其他是空的", async () => {
  const { page, errors } = await open(能);
  try {
    await page.getByTestId("proj-giveup-open").click();
    const 框 = page.getByRole("dialog");
    await 框.getByText("其他", { exact: true }).click();
    await 框.getByTestId("proj-giveup-note").fill("号码有误");
    await 框.getByText("外出", { exact: true }).click();
    expect(await 框.getByTestId("proj-giveup-note").count()).toBe(0);
    await 框.getByText("其他", { exact: true }).click();
    expect(await 框.getByTestId("proj-giveup-note").inputValue()).toBe("");
    await 框.getByText("忙不过来", { exact: true }).click();
    await 框.getByRole("button", { name: "确认放弃" }).click();
    await page.getByTestId("proj-giveup-done").waitFor();
    expect(await 调用们(page)).toEqual([["p1", "忙不过来", ""]]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("转不出去：原因写在框里，框不关、不刷新", async () => {
  const { page, errors } = await open(能);
  try {
    await page.evaluate(() => { (window as unknown as { __回: unknown }).__回 = { ok: false, error: "这条转不出去：没有能接的人。没扣本月放弃次数，线索还在你手上" }; });
    await page.getByTestId("proj-giveup-open").click();
    const 框 = page.getByRole("dialog");
    await 框.getByText("外出", { exact: true }).click();
    await 框.getByRole("button", { name: "确认放弃" }).click();
    await 框.getByTestId("proj-giveup-error").waitFor();
    expect(await 框.getByTestId("proj-giveup-error").innerText()).toContain("没扣本月放弃次数");
    expect(await page.evaluate(() => (window as unknown as { __refresh?: number }).__refresh ?? 0)).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("[实操 3] 去判无效：项目有「线索验证」就关放弃框、直接打开「线索验证」弹框（面板在弹框里，页上找不到）；没有就在框里说先推进程", async () => {
  const 有 = await open(能, { 有验证: true });
  try {
    await 有.page.getByTestId("proj-giveup-open").click();
    await 有.page.getByTestId("proj-giveup-to-invalid").click();
    await 有.page.getByRole("dialog").waitFor({ state: "hidden" });
    expect(await 有.page.evaluate(() => (window as unknown as { __验证开?: number }).__验证开 ?? 0)).toBe(1);
    expect(await 有.page.getByTestId("proj-giveup-error").count()).toBe(0);
  } finally { await 有.page.close(); }
  const 没 = await open(能);
  try {
    await 没.page.getByTestId("proj-giveup-open").click();
    await 没.page.getByTestId("proj-giveup-to-invalid").click();
    expect(await 没.page.getByTestId("proj-giveup-error").innerText()).toContain("线索验证");
  } finally { await 没.page.close(); }
});

it("点不了（本月用过 / 验证中）：按钮灰着，写为什么", async () => {
  const { page, errors } = await open({ 可: false, 本月已用: true, 为什么: "每人每月只能放弃 1 次，本月已经用过了，下月 1 日起可再用" });
  try {
    expect(await page.getByTestId("proj-giveup-open").isDisabled()).toBe(true);
    expect(await page.getByTestId("proj-giveup-why").innerText()).toContain("本月已经用过了");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1366, 390])("%ipx：提示条和框不横向撑出", async (w) => {
  const { page } = await open(能, { width: w });
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const 条 = (await page.getByTestId("proj-giveup").boundingBox())!;
    expect(条.x + 条.width).toBeLessThanOrEqual(w);
    await page.getByTestId("proj-giveup-open").click();
    await page.getByRole("dialog").getByText("其他", { exact: true }).click();
    const 框 = (await page.getByRole("dialog").boundingBox())!;
    expect(框.x).toBeGreaterThanOrEqual(0);
    expect(框.x + 框.width).toBeLessThanOrEqual(w);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await page.close(); }
});

it("设置 → 组织规则：有「销售主动放弃线索（豁免）」，默认关", async () => {
  const { page, errors } = await open(能, { 包: orgBundle });
  try {
    await page.getByTestId("org-rules").waitFor();
    const 开关 = page.getByTestId("org-rule-lead-giveup");
    expect(await 开关.getAttribute("aria-label")).toBe("销售主动放弃线索（豁免）");
    expect(await 开关.isChecked()).toBe(false);
    expect(await page.getByTestId("org-rules").innerText()).toContain("每人每月 1 次");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
