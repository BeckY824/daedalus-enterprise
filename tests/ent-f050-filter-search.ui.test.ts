/**
 * F-050（11-25）：列表页筛选下拉除了点选，也能打字即时过滤选项（components/FilterSelect.tsx，各列表页、复盘页筛选行统一用它）。
 *
 *   选项多于 6 个：点开即聚焦到输入框，打字按包含过滤（不分大小写、去首尾空格），清空输入恢复全部
 *   键盘：打字后上下键挑、回车选上（值照旧走 onChange）、Esc 关
 *   没对上：「没有匹配的选项」
 *   选项不多于 6 个：不出输入框，照旧点选
 *   摆在外面选中后变「名：值 ×」标签（CustomFilters 外露项）照旧，标签里也能打字换值；收在「更多筛选」里的也能搜
 *   390 宽：点开打字页面不横滚
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-f050-filter-search", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {App, Space} from 'antd';
    import MotionTheme from '@/components/MotionTheme';
    import FilterSelect from '@/components/FilterSelect';
    import {useCustomFilters} from '@/components/CustomFilters';
    // 编造的名字：8 个负责人（多于 6 个，出输入框）、3 个状态（不出）
    const 人们=['李想','王一','王小二','Alice Wang','赵钱孙','周五','吴六','欧阳长长长长名字的同事'];
    function 页(){
      const [f,setF]=useState({owner:'',status:'',src:''});
      window.__值=f;
      const {外露,更多按钮}=useCustomFilters('f050-test',[
        {键:'owner',名:'负责人',宽:150,默认外露:true,有值:!!f.owner,渲染:(style)=><FilterSelect style={style} placeholder="全部负责人" allowClear aria-label="负责人" value={f.owner||undefined} onChange={(v)=>setF({...f,owner:v??''})} options={人们.map(x=>({value:'id-'+x,label:x}))}/>},
        {键:'status',名:'状态',宽:130,默认外露:true,有值:!!f.status,渲染:(style)=><FilterSelect style={style} placeholder="全部状态" allowClear aria-label="状态" value={f.status||undefined} onChange={(v)=>setF({...f,status:v??''})} options={['跟进中','已成交','已流失'].map(x=>({value:x,label:x}))}/>},
        {键:'src',名:'来源',宽:140,默认外露:false,有值:!!f.src,渲染:(style)=><FilterSelect style={style} placeholder="全部来源" allowClear aria-label="来源" value={f.src||undefined} onChange={(v)=>setF({...f,src:v??''})} options={['展会','官网','老客户介绍','广告','邮件','电话','社媒'].map(x=>({value:x,label:x}))}/>},
      ]);
      return <div style={{padding:16}}>
        <div className="list-bar"><Space wrap size={[10,10]}>{外露}{更多按钮}</Space></div>
      </div>;
    }
    createRoot(document.getElementById('root')).render(<MotionTheme><App><页/></App></MotionTheme>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(宽 = 1280): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 宽, height: 800 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://f050.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://f050.test/customers");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.getByText("全部负责人").waitFor();
  return { page, errors };
}
/** 下拉里看得见的那几行（antd 另有一份给读屏的 role=option，不算） */
const 看得见的项 = (page: Page) => page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").allInnerTexts();
const 值 = (page: Page) => page.evaluate(() => (window as unknown as { __值: Record<string, string> }).__值);

it("多于 6 个：点开即聚焦到输入框，打字按包含过滤（不分大小写、去首尾空格），清空输入恢复全部", async () => {
  const { page, errors } = await 打开();
  const 框 = page.getByRole("combobox", { name: "负责人" });
  await 框.click();
  await expect.poll(() => 框.evaluate((e) => e === document.activeElement)).toBe(true);
  expect(await 框.evaluate((e) => (e as HTMLInputElement).readOnly)).toBe(false);
  await expect.poll(() => 看得见的项(page).then((x) => x.length)).toBe(8);
  await page.keyboard.type("王");
  await expect.poll(() => 看得见的项(page)).toEqual(["王一", "王小二"]);
  await 框.fill("  wang ");
  await expect.poll(() => 看得见的项(page)).toEqual(["Alice Wang"]);
  await 框.fill("");
  await expect.poll(() => 看得见的项(page).then((x) => x.length)).toBe(8);
  // 只按值（id-…）比不该对上：比的是看得见的字
  await 框.fill("id-");
  await expect.poll(() => 看得见的项(page)).toEqual([]);
  expect(errors).toEqual([]);
  await page.context().close();
});

it("没对上写「没有匹配的选项」；Esc 关掉，值不变", async () => {
  const { page, errors } = await 打开();
  const 框 = page.getByRole("combobox", { name: "负责人" });
  await 框.click();
  await page.keyboard.type("不存在的人");
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").getByText("没有匹配的选项").waitFor();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").count()).toBe(0);
  expect((await 值(page)).owner).toBe("");
  // 再点开：上次的字清掉了，全部都在、不再写没有匹配
  await 框.click();
  await expect.poll(() => 看得见的项(page).then((x) => x.length)).toBe(8);
  expect(await page.getByText("没有匹配的选项").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.context().close();
});

it("键盘：打字后下键挑、回车选上（值照旧走 onChange），变成「负责人：…」标签；标签里也能打字换值", async () => {
  const { page, errors } = await 打开();
  const 框 = page.getByRole("combobox", { name: "负责人" });
  await 框.click();
  await page.keyboard.type("王");
  await expect.poll(() => 看得见的项(page)).toEqual(["王一", "王小二"]);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-active").allInnerTexts()).toEqual(["王小二"]);
  await page.keyboard.press("Enter");
  await expect.poll(() => 值(page).then((x) => x.owner)).toBe("id-王小二");
  await expect.poll(() => page.locator(".cf-chip").textContent()).toBe("负责人：王小二");
  // 标签照旧能点开换值，也能打字
  await page.getByRole("combobox", { name: "负责人" }).click();
  await page.keyboard.type("李");
  await expect.poll(() => 看得见的项(page)).toEqual(["李想"]);
  // 回车前等高亮落到对上的那一项（刚点开的一瞬高亮还在原来选中的那项上，人看得到高亮再按）
  await expect.poll(() => page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-active").allInnerTexts()).toEqual(["李想"]);
  await page.keyboard.press("Enter");
  await expect.poll(() => 值(page).then((x) => x.owner)).toBe("id-李想");
  await expect.poll(() => page.locator(".cf-chip").textContent()).toBe("负责人：李想");
  expect(errors).toEqual([]);
  await page.context().close();
});

it("不多于 6 个：不出输入框，照旧点选", async () => {
  const { page, errors } = await 打开();
  const 框 = page.getByRole("combobox", { name: "状态" });
  expect(await 框.evaluate((e) => (e as HTMLInputElement).readOnly)).toBe(true);
  await 框.click();
  await page.getByTitle("已成交", { exact: true }).last().click();
  await expect.poll(() => 值(page).then((x) => x.status)).toBe("已成交");
  expect(errors).toEqual([]);
  await page.context().close();
});

it("收在「更多筛选」里的也能搜", async () => {
  const { page, errors } = await 打开();
  await page.getByRole("button", { name: "更多筛选" }).click();
  const 框 = page.getByRole("combobox", { name: "来源" });
  await 框.click();
  await page.keyboard.type("客户");
  await expect.poll(() => 看得见的项(page)).toEqual(["老客户介绍"]);
  await page.keyboard.press("Enter");
  await expect.poll(() => 值(page).then((x) => x.src)).toBe("老客户介绍");
  expect(errors).toEqual([]);
  await page.context().close();
});

it("390 宽：点开打字、选上长名字，页面不横滚", async () => {
  const { page, errors } = await 打开(390);
  const 框 = page.getByRole("combobox", { name: "负责人" });
  await 框.click();
  await page.keyboard.type("欧阳");
  await expect.poll(() => 看得见的项(page)).toEqual(["欧阳长长长长名字的同事"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.locator(".cf-chip").textContent()).toContain("负责人：");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
  await page.context().close();
});
