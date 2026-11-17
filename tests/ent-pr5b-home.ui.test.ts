/**
 * PR5b 剩余行为 · 复盘 / 全局（原型 ov.todo、g.save、空状态长按）：
 *   ov.todo：勾一下直接完成，不弹顶部提示；底部撤销条点「撤销」= 改回未完成（反着做）
 *   被挡（ok:false）：勾退回去，原因写在列表标题旁，不提示成功、不出撤销条
 *   清除演示数据：后果写在框里，按住 1.2 秒才清；不按满不清；没清成原因写在框里，不弹顶部提示
 *   1024 宽 + 超长原因 / 超长客户名：不横向溢出
 * 认元素用 role / 文字；不认 antd 内部类名（.ant-message 只用来断言「没有」）。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "pr5b-home", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "const 记=()=>{};export const useRouter=()=>({push:记,refresh(){},replace:记});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "const 记=(n)=>(window.__调||(window.__调=[])).push(n);export const 查演示数据状态=async()=>({可用:true,可灌:false,有权限:true,空库:false,已灌:true});export const 灌一套演示数据=async()=>({ok:true});export const 清除演示数据=async()=>{记('清除');return window.__挡?{ok:false,error:window.__挡}:{ok:true}};");
  stub(/customers\/\[id\]\/actions$/, "const 记=(n,id,v)=>(window.__调||(window.__调=[])).push(n+':'+id+':'+v);const 回=()=>window.__挡?{ok:false,error:window.__挡}:{ok:true};export const toggleTask=async(id,v)=>{记('task',id,v);return 回()};export const completePlan=async(id,v=true)=>{记('plan',id,v);return 回()};");
  stub(/projects\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", "export const 记项目沟通Action=async()=>({ok:true});"));
  stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;export const 我常用的沟通方式=async()=>window.__习惯??null;", "async()=>null"));
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import BoardTodos from '@/app/(app)/overview/BoardTodos';
    import {DemoDataSection} from '@/components/EmptyState';
    import {BusinessProvider} from '@/lib/business-client';
    import {DEFAULT_BUSINESS} from '@/lib/business-config';
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域销售中心';
    const 行=(n)=>Array.from({length:n},(_,i)=>({
      key:(i%2?'plan:':'task:')+i, kind:i%2?'plan':'task', id:String(i), 时间:'2026-10-2'+i+'T09:00:00.000Z', 明确钟点:true,
      内容:'第'+i+'条：'+长+'的方案回访', customerId:'c'+i, customerName:长+i, projectName:null,
      ownerId:'u1', ownerName:'负责人', 组:'今天', 去:'/projects/p'+i,
    }));
    window.__画=(o)=>{
      const 数={计数:{overdue:0,today:4,week:0,all:4}, 总数:4, 页:1, 行:行(4)};
      createRoot(document.getElementById('root')).render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
        {o==='demo'?<DemoDataSection/>:<BoardTodos 数={数} 卡="all" 布局="list" 只看自己={false} 看全员={true}/>}
      </BusinessProvider></App>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(o: string, width = 1024, 挡: string | null = null): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/overview");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.evaluate((x) => { (window as unknown as { __挡: string | null }).__挡 = x; }, 挡);
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (o: string) => void }).__画(x), o);
  return page;
}
const 调了 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: string[] }).__调 ?? []);
const 横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

it("ov.todo：勾一下直接完成、不弹顶部提示；撤销条点撤销 = 改回未完成", async () => {
  const page = await 打开("todos");
  await page.getByRole("checkbox", { name: /完成「第0条/ }).click();
  await page.getByText(/已完成「第0条/).waitFor();
  expect(await page.locator(".ant-message-notice").count()).toBe(0);
  expect(await 调了(page)).toEqual(["task:0:true"]);
  await page.getByRole("button", { name: "撤销" }).click();
  await expect.poll(() => 调了(page)).toEqual(["task:0:true", "task:0:false"]);
  await page.close();
});

it("ov.todo 被挡：原因写在列表上，不提示成功、不出撤销条；1024 宽超长原因不横滚", async () => {
  const 原因 = "这条待办已经被同事完成了，" + "刷新看看最新的情况".repeat(8);
  const page = await 打开("todos", 1024, 原因);
  await page.getByRole("checkbox", { name: /完成「第1条/ }).click();
  await page.getByRole("alert").filter({ hasText: "已经被同事完成" }).waitFor();
  expect(await page.getByText(/已完成「/).count()).toBe(0);
  expect(await page.getByRole("button", { name: "撤销" }).count()).toBe(0);
  expect(await page.locator(".ant-message-notice").count()).toBe(0);
  expect(await page.getByRole("checkbox", { name: /完成「第1条/ }).isChecked()).toBe(false);
  expect(await 横滚(page)).toBeLessThanOrEqual(0);
  await page.close();
});

it("清除演示数据：长按 HoldConfirm，按不满不清；按满才清", async () => {
  const page = await 打开("demo");
  await page.getByRole("button", { name: "清除演示数据" }).click();
  const 键 = page.getByRole("button", { name: "按住 清除演示数据" });
  await 键.waitFor();
  // 点一下（不按住）不清
  await 键.click();
  await page.waitForTimeout(300);
  expect(await 调了(page)).toEqual([]);
  // 按住 1.2 秒以上才清
  const 盒 = (await 键.boundingBox())!;
  await page.mouse.move(盒.x + 盒.width / 2, 盒.y + 盒.height / 2);
  await page.mouse.down(); await page.waitForTimeout(1500); await page.mouse.up();
  await expect.poll(() => 调了(page)).toEqual(["清除"]);
  expect(await page.locator(".ant-message-notice").count()).toBe(0);
  await page.close();
});

it("清除演示数据被挡：原因写在框里、不提示成功", async () => {
  const page = await 打开("demo", 1024, "只有管理员能清除演示数据");
  await page.getByRole("button", { name: "清除演示数据" }).click();
  const 键 = page.getByRole("button", { name: "按住 清除演示数据" });
  const 盒 = (await 键.boundingBox())!;
  await page.mouse.move(盒.x + 盒.width / 2, 盒.y + 盒.height / 2);
  await page.mouse.down(); await page.waitForTimeout(1500); await page.mouse.up();
  await page.getByRole("alert").filter({ hasText: "只有管理员能清除演示数据" }).waitFor();
  expect(await page.locator(".ant-message-notice").count()).toBe(0);
  expect(await page.getByRole("dialog").count()).toBe(1);
  await page.close();
});
