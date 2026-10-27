/**
 * 列表表格的读屏（2026-10-27 整合-1026 第 8 条「新线索表格读屏取不到内容」）。
 *
 *   勾选框：antd 默认念英文「Select all / Select row」，换成「全选本页」「选中 + 这一行的名字」
 *   不可勾的行照旧 disabled，标签照样有
 *   操作列：表头原来是空的，补一个看不见、读屏念得到的「操作」
 *   头像 / 公司首字：装饰，aria-hidden，读屏不重复念首字
 *   DataList 不看企业版开关，个人版和团队版的列表是同一个组件：这里不设开关，测的就是开关关着的样子
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import fs from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "datalist-a11y", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import DataList from '@/components/DataList';
    import {CompanyLogo, UserCell} from '@/components/ui';
    const 行=[{id:'a',name:'甲公司',owner:'王一'},{id:'b',name:'乙公司',owner:'李二'},{id:'c',owner:'张三'},
      {id:'d',name:'超长名字有限公司'.repeat(8),owner:'欧阳'.repeat(10)}];
    const 列=[
      {title:'名称',key:'name',常驻:true,render:(_,r)=><span><CompanyLogo name={r.name??'无名'}/>{r.name??'—'}</span>},
      {title:'负责人',key:'owner',render:(_,r)=><UserCell name={r.owner}/>},
      {title:'',key:'act',常驻:true,render:()=><button type="button">编辑</button>},
    ];
    createRoot(document.getElementById('root')).render(<App>
      <DataList 页="a11y-test" 列={列} 行={行} 空库={false} 空态={{title:'空'}} 批量={()=>null} 不可勾={(r)=>r.id==='b'}/>
    </App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(宽 = 1280): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 宽, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://list.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://list.test/"); await page.addScriptTag({ content: bundle });
  // 只拿 globals.css 里那一条 .sr-only（整份 css 要过 tailwind，这里不跑）
  const 规则 = fs.readFileSync("src/app/globals.css", "utf8").match(/^\.sr-only \{[^}]*\}/m)?.[0];
  if (!规则) throw new Error("globals.css 里没有 .sr-only");
  await page.addStyleTag({ content: 规则 });
  await page.locator(".ant-table-row").first().waitFor();
  return { page, errors };
}

it("勾选框念中文：全选本页、选中 + 行名；叫不出名字的念「选中这一行」；不可勾的照旧不可勾", async () => {
  const { page, errors } = await 打开();
  await expect(page.getByRole("checkbox", { name: "全选本页" }).count()).resolves.toBe(1);
  await expect(page.getByRole("checkbox", { name: "选中 甲公司" }).isEnabled()).resolves.toBe(true);
  await expect(page.getByRole("checkbox", { name: "选中 乙公司" }).isDisabled()).resolves.toBe(true);
  await expect(page.getByRole("checkbox", { name: "选中这一行" }).count()).resolves.toBe(1);
  const 全部 = await page.getByRole("checkbox").evaluateAll(els => els.map(e => e.getAttribute("aria-label") ?? ""));
  expect(全部.some(t => /select|row/i.test(t))).toBe(false);
  // 勾上去照样能批量
  await page.getByRole("checkbox", { name: "选中 甲公司" }).check();
  await expect(page.locator(".list-sel").innerText()).resolves.toContain("已选 1 条");
  expect(errors).toEqual([]);
  await page.close();
});

it("操作列有读屏念得到、看不见的表头；头像和公司首字不进读屏", async () => {
  const { page } = await 打开();
  await expect(page.getByRole("columnheader", { name: "操作" }).count()).resolves.toBe(1);
  const 宽 = await page.locator(".ant-table-thead .sr-only").evaluate(e => e.getBoundingClientRect().width);
  expect(宽).toBeLessThanOrEqual(1);
  const 树 = await page.locator(".ant-table-tbody").ariaSnapshot();
  expect(树).toContain("甲公司");
  expect(树).toContain("王一");
  // 首字不单独念：「甲」「王」不该作为独立文字出现在格子里
  expect(树).not.toMatch(/text: 甲\s*$/m);
  expect(树).not.toMatch(/: 王\s*$/m);
  expect(await page.locator(".company-logo[aria-hidden='true']").count()).toBe(4);
  expect(await page.locator(".user-cell .ant-avatar[aria-hidden='true']").count()).toBe(4);
  await page.close();
});

it.each([1024, 1280, 1366])("%ipx：看不见的「操作」不撑宽页面，超长名字那一行的勾选框点得到", async (宽) => {
  const { page, errors } = await 打开(宽);
  const 量 = await page.evaluate(() => {
    const d = document.scrollingElement!;
    const 框 = document.querySelector("[aria-label^='选中 超长']")!.getBoundingClientRect();
    const 点到 = document.elementFromPoint(框.x + 框.width / 2, 框.y + 框.height / 2);
    return { 页: d.scrollWidth - d.clientWidth, 点到勾选框: !!点到?.closest(".ant-checkbox-wrapper, .ant-checkbox") };
  });
  expect(量.页).toBeLessThanOrEqual(0);
  expect(量.点到勾选框).toBe(true);
  expect(errors).toEqual([]);
  await page.close();
});
