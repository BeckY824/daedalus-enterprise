/**
 * 计划页上打不开的事项（11-09）：进不了的客户、市场进不了详情的项目只写名字，不给链接；
 * 无空格长名字在 Windows 常见宽度下断行，不把整页撑出横向滚动（计划页 10-19 排版闸门同一个问题）。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const 长名 = "AlRashidTradingAndGeneralContractingFreeZoneAuthority".repeat(4);
const 项目长名 = "LongProjectNameWithoutAnySpaceAtAll".repeat(6);
// 只取计划页这一片的排版（整份 globals.css 要过 tailwind）；变量给够，别让 calc 失效
const 排版 = fs.readFileSync("src/app/globals.css", "utf8").replaceAll("\r\n", "\n").split("\n").filter((l) => /^\.plan/.test(l)).join("\n");

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-plans-superior", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){}});export const usePathname=()=>'/follow-ups/plans';");
  stub(/follow-method-actions$/, "export const 沟通方式选项=async()=>null;export const 发起主体选项=async()=>null;");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/(customers\/\[id\]\/|^\.\/)actions$/, "export const toggleTask=async()=>({ok:true}),completePlan=toggleTask,deletePlan=toggleTask,deleteTask=toggleTask,saveFollowUp=toggleTask,撤销记一笔=toggleTask;");
  stub(/customers\/\[id\]\/(PlanForm|TaskForm)$/, "export default function C(){return null}");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import PlansView from '@/app/(app)/follow-ups/plans/PlansView';
    const 老 = '2020-01-01T00:00:00.000Z';
    const 计划 = (id, c, name) => ({ id, subject: '回访' + id, plannedAt: 老, plannedHasTime: true, method: '电话沟通', updatedAt: 老, customerId: c, customerName: name, ownerId: 'u1', ownerName: '下属' });
    const 待办 = { id: 't1', title: '打电话', dueAt: 老, dueHasTime: true, updatedAt: 老, customerId: 'c-lost', customerName: ${JSON.stringify(长名)}, ownerId: 'u1', ownerName: '下属' };
    const 做完 = (k, c, name) => ({ key: k, kind: 'plan', 标题: '做完' + k, 方式: '电话沟通', 计划时间: 老, 完成时间: 老, customerId: c, customerName: name, ownerId: 'u1', ownerName: '下属' });
    window.__画 = () => createRoot(document.getElementById('root')).render(
      <ConfigProvider locale={zhCN}><App><BusinessProvider value={DEFAULT_BUSINESS} timeZone={null}>
        <PlansView meId="me" 全员 预选客户={null} 直接新建={false}
          plans={[计划('p1', 'c-lost', ${JSON.stringify(长名)}), 计划('p2', 'c-ok', '进得去的客户')]} tasks={[待办]}
          done={[做完('plan:d1', 'c-lost', ${JSON.stringify(长名)}), 做完('plan:d2', 'c-ok', '进得去的客户')]}
          项目下一步={[
            { key: 'project:p-lost', id: 'p-lost', 项目名: ${JSON.stringify(项目长名)}, 下一步: '进不了的下一步', 时间: 老, ownerId: 'u1', ownerName: '下属', 进不了: true },
            { key: 'project:p-ok', id: 'p-ok', 项目名: '进得去的项目', 下一步: '进得去的下一步', 时间: 老, ownerId: 'u1', ownerName: '下属' },
          ]}
          进不了的客户={['c-lost']} 改不了的客户={['c-lost']} />
      </BusinessProvider></App></ConfigProvider>
    );
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(宽 = 1280): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 宽, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><style>html,body{margin:0}#root{padding:16px;box-sizing:border-box}${排版}</style><div id='root'></div>` }));
  await page.goto("http://ent.test/follow-ups/plans");
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => { (window as unknown as { __画: () => void }).__画(); });
  await page.locator(".plan-row").first().waitFor();
  return { page, errors };
}
const 切已完成 = (page: Page) => page.getByText(/^已完成/).first().click();
/** 整页有没有被撑宽、每行的内容有没有伸出这一行 */
const 量 = (page: Page) => page.evaluate(() => {
  const 行们 = [...document.querySelectorAll(".plan-row")];
  return {
    行数: 行们.length,
    页: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    伸出: 行们.flatMap((r) => {
      const 边 = r.getBoundingClientRect().right;
      return [...r.querySelectorAll(".plan-row-s > *")].map((x) => x.getBoundingClientRect().right - 边).filter((d) => d > 1);
    }),
  };
});

it("进不了的客户：待办、已完成都只写名字，进得去的照旧是链接", async () => {
  const { page, errors } = await 打开();
  await page.getByText("回访p1").waitFor();
  expect(await page.locator('a[href="/customers/c-lost"]').count()).toBe(0);
  expect(await page.locator('a[href="/customers/c-ok"]').count()).toBe(1);
  expect(await page.getByText(长名).count()).toBe(2); // 计划、待办各一行
  await 切已完成(page);
  await page.getByText("做完plan:d1").waitFor();
  expect(await page.locator('a[href="/customers/c-lost"]').count()).toBe(0);
  expect(await page.locator('a[href="/customers/c-ok"]').count()).toBe(1);
  expect(errors).toEqual([]); await page.close();
});

it("进不了的客户那行：不给改、删，进得去的照旧给", async () => {
  const { page, errors } = await 打开();
  expect(await page.getByRole("button", { name: "改 回访p1" }).count()).toBe(0);
  expect(await page.getByRole("button", { name: "删除 回访p1" }).count()).toBe(0);
  expect(await page.getByRole("button", { name: "改 回访p2" }).count()).toBe(1);
  expect(errors).toEqual([]); await page.close();
});

it("改不了的客户那行：不给 ✓（计划、待办都是），进得去的照旧给；标题还对齐", async () => {
  const { page, errors } = await 打开();
  await page.getByRole("button", { name: "完成 回访p2" }).waitFor();
  expect(await page.getByRole("button", { name: "完成 回访p1" }).count()).toBe(0);
  expect(await page.getByRole("button", { name: "完成 打电话" }).count()).toBe(0);
  const 左 = (标题: string) => page.locator(".plan-row-t", { hasText: 标题 }).evaluate((e) => e.getBoundingClientRect().left);
  expect(await 左("回访p1")).toBe(await 左("回访p2"));
  expect(errors).toEqual([]); await page.close();
});

it("市场进不了详情的项目：下一步只写项目名，不给链接；进得去的照旧", async () => {
  const { page, errors } = await 打开();
  await page.getByText("进不了的下一步").waitFor();
  expect(await page.locator('a[href="/projects/p-lost"]').count()).toBe(0);
  expect(await page.getByText(项目长名).count()).toBe(1);
  expect(await page.locator('a[href="/projects/p-ok"]').count()).toBe(1);
  expect(errors).toEqual([]); await page.close();
});

for (const 宽 of [1024, 1280, 1366]) {
  it(`${宽} 宽：无空格长名字断行，不撑宽整页、不伸出这一行`, async () => {
    const { page, errors } = await 打开(宽);
    const 待办区 = await 量(page);
    expect(待办区.行数).toBeGreaterThan(0);
    expect(待办区).toMatchObject({ 页: 0, 伸出: [] });
    await 切已完成(page);
    await page.getByText("做完plan:d1").waitFor();
    expect(await 量(page)).toMatchObject({ 页: 0, 伸出: [] });
    expect(errors).toEqual([]); await page.close();
  });
}
