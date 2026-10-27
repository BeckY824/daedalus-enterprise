/**
 * 设置 → 组织架构：业务角色多选（10-27 会议，服务端见 ent-multi-role.test.ts）。
 *
 *   兼两个角色的人显示两个标签；再加一个，交上去是规整的逗号串
 *   清空（删掉最后一个）不交
 *   非老板：选项里没有总管理、管理员；老板有
 *   Windows 1024 / 1280 / 1366：多个标签不横向撑出，角色框点得中
 * 组织架构这一屏只有企业版有（开关关时设置里没这个标签，见 enterprise-org-actions.test.ts 的开关关闭用例）。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const 长名 = "某某超长名字的业务员".repeat(3);
const plugin: Plugin = { name: "multi-role-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^\.\/OrgSyncCard$|^\.\/LeadAssignCard$/, "export default function C(){return null}");
  stub(/^\.\/org-actions$/, `const f=${空跑};export const 建部门=f,改部门=f,删部门=f,设规则=f,设字段权限=f,设改权限=f,设成员=async(id,改)=>{(window.__交??=[]).push([id,改]);return{ok:true}};`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import OrgTab from '@/app/(app)/settings/OrgTab';
    const root=createRoot(document.getElementById('root'));
    const 长=${JSON.stringify(长名)};
    const 人=(id,name,bizRole)=>({id,name,deptId:null,bizRole,line:null,managerId:null,dottedManagerId:null,自动上级:null});
    window.__render=({是老板})=>root.render(<App><div style={{maxWidth:1100}}><OrgTab value={{
      部门:[],成员:[人('a',长,'sales_mgr,marketing_mgr'),人('b','小王','sales')],能改:true,是老板,
      规则开着:{按组织看客户:false,线索分配:false,字段权限:false,交接要确认:false},字段权限:{},字段权限挡:null,改权限:{},线索分配:null}}/></div></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(是老板: boolean, width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://role.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://role.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(x => (window as unknown as { __render: (x: { 是老板: boolean }) => void }).__render(x), { 是老板 });
  await page.getByTestId("org-members").waitFor();
  return { page, errors };
}
const 交了 = (page: import("playwright").Page) => page.evaluate(() => (Reflect.get(window, "__交") ?? []) as [string, { bizRole?: string }][]);
const 角色框 = (page: import("playwright").Page, id: string) => page.getByTestId(`org-member-${id}`).locator(".ant-select-multiple");
const 展开 = async (page: import("playwright").Page, name: string) => { await page.getByLabel(`${name} 的角色`).click(); await page.locator(".ant-select-dropdown:visible .ant-select-item-option").first().waitFor(); };

it("兼两个角色显示两个标签；再加一个，交上去是规整的逗号串", async () => {
  const { page, errors } = await open(true);
  try {
    const 框 = 角色框(page, "a");
    expect(await 框.locator(".ant-select-selection-item").allInnerTexts()).toEqual(["销售管理", "市场管理"]);
    await 展开(page, 长名);
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: /^销售成员$/ }).click();
    await page.waitForFunction(() => Reflect.get(window, "__交"));
    expect(await 交了(page)).toEqual([["a", { bizRole: "sales_mgr,sales,marketing_mgr" }]]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("删掉最后一个角色：不交", async () => {
  const { page, errors } = await open(true);
  try {
    const 框 = 角色框(page, "b");
    await 框.locator(".ant-select-selection-item-remove").click();
    await page.waitForTimeout(300);
    expect(await 交了(page)).toEqual([]);
    expect(await 框.locator(".ant-select-selection-item").allInnerTexts()).toEqual(["销售成员"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("非老板的选项里没有总管理、管理员；老板有", async () => {
  for (const [是老板, 有] of [[false, 0], [true, 1]] as const) {
    const { page, errors } = await open(是老板);
    try {
      await 展开(page, "小王");
      const 选项 = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
      await 选项.filter({ hasText: "市场管理" }).first().waitFor(); // allInnerTexts 不等，负载高时下拉还没渲染完会读到空
      const 字 = await 选项.allInnerTexts();
      expect(字.filter(t => t === "总管理").length).toBe(有);
      expect(字.filter(t => t === "管理员").length).toBe(有);
      expect(字).toContain("市场管理");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it.each([1024, 1280, 1366])("Windows %ipx：多个标签和超长名字不横向撑出，角色框点得中", async (w) => {
  const { page } = await open(false, w);
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await 角色框(page, "a").scrollIntoViewIfNeeded();
    const box = (await 角色框(page, "a").boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(w);
    const 点中 = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[data-testid='org-member-a'] .ant-select-multiple"), [box.x + box.width / 2, box.y + box.height / 2]);
    expect(点中).toBe(true);
  } finally { await page.close(); }
});
