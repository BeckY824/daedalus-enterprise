import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* 疑似重复清单第二阶段 · 界面（12-15 第三批 C，customers/dupes/DupesView.tsx + MergeHost 的 MergePairDialog）：真组件 + globals.css + merge.css + dupes.css，只桩掉服务端动作。钉的是：
   合并框带预选：一开就是两家并排预览、不出搜索框；
   清单两个页签、每组「合并」「不是同一个人」；标完出撤销条、点撤销调撤销标记；已标页签列「撤销标记」；
   只读身份两颗按钮置灰、悬停写原因；390 宽一组一张卡、不横滚 */
let browser: Browser, bundle: string;
const 动作 = `
  const 记=(...a)=>(window.__调??=[]).push(a);
  export const 搜合并候选=async(id,词)=>{记('搜',id,词);return []};
  export const 预览合并=async(a,b)=>{记('预览',a,b);return {ok:true,预览:window.__预览}};
  export const 能并同事的=async()=>true;`;
const 标动作 = `
  const 记=(...a)=>(window.__调??=[]).push(a);
  export const 标为不是同一个人=async(ids)=>{记('标',ids);return {ok:true,对们:['a__b']}};
  export const 撤销不是同一个人标记=async(ids)=>{记('撤标',ids);return {ok:true,撤了:ids.length}};`;
const plugin: Plugin = { name: "dupe-list", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)merge-actions$/, 补全动作桩("src/app/(app)/customers/merge-actions.ts", 动作));
  stub(/(^|\/)dupe-actions$/, 补全动作桩("src/app/(app)/customers/dupe-actions.ts", 标动作));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){(window.__调??=[]).push(['刷新'])},push(u){window.__去=u},replace(){},prefetch(){}});export const usePathname=()=>'/customers/dupes';");
  stub(/^next\/link$/, "import React from 'react';export default function Link({href,onClick,prefetch,unstable_dynamicOnHover,children,...p}){return React.createElement('a',{...p,href,onClick:e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.__去=href}}},children)}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import DupesView from '@/app/(app)/customers/dupes/DupesView';import {MergePairDialog} from '@/app/(app)/customers/[id]/MergeHost';
    import {切换视图Provider} from '@/components/ViewAsContext';
    window.__渲清单=(p)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><切换视图Provider value={!!p.切换}><DupesView 清单={p.清单} 已标={p.已标??null} 只读原因={p.只读原因??null}/></切换视图Provider></App></ConfigProvider>);
    window.__渲合并框=()=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><MergePairDialog 留下={{id:'a',name:'同名测试客户'}} 并掉={{id:'b',name:'同名测试客户',编号:'NO.00012',负责人:'QA'}} 关={()=>{window.__关=true}}/></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 行 = (格: string, 留下: string, 并掉: string) => ({ 格, 留下, 并掉, 不同: 留下 !== 并掉 });
const 预览 = {
  能并: true, 原因: [], 要勾选: false, 补空: [],
  并排: [行("客户名称", "同名测试客户", "同名测试客户"), 行("客户编号", "NO.00001", "NO.00012"), 行("负责人", "QA", "QA")],
  条数: { 联系人: 1, 项目: 2, 订单项目: 0, 回款: 0, 沟通: 3, 待办: 0, 跟进计划: 0, 关联客户: 0, 项目关联: 0, 撞号记录: 0 },
  联系人们: { 留下: [{ id: "a1", name: "张三", position: null, 关键: false, 号: [] }], 并掉: [{ id: "b1", name: "张三", position: null, 关键: false, 号: [] }] },
};
const 成员 = (id: string, 编号: string, 我的 = true) => ({ id, 名: "同名测试客户", 编号, 负责人: "QA", 在公海: false, 我的, 建档: 1_700_000_000_000, 项目数: 2, 要申请: false });
const 清单 = {
  组们: [
    { 键: "g1", 们: [成员("a", "NO.00001"), 成员("b", "NO.00012")], 留下: "a", 并掉: "b" },
    { 键: "g2", 们: [成员("c", "NO.00020"), 成员("d", "NO.00021"), 成员("e", "NO.00022")], 留下: "c", 并掉: "d" },
  ],
  共: 2, 页: 1, 每页: 20, 管: false,
};
const 已标 = [{ id: "x__y", 两家: [{ id: "x", 名: "已标测试客户", 负责人: "QA" }, { id: "y", 名: "已标测试客户", 负责人: null }], 谁标: "QA", 标于: 1_700_000_000_000 }];

async function open(width: number, 渲: "清单" | "合并框", 参: Record<string, unknown> = {}) {
  const page = await browser.newPage({ viewport: { width, height: width < 768 ? 844 : 900 } }); page.setDefaultTimeout(5000);
  const 错: string[] = [];
  page.on("pageerror", e => 错.push(String(e)));
  page.on("console", m => { if (m.type() === "error") 错.push(m.text()); });
  await page.route("http://dupe.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://dupe.test");
  for (const f of ["src/app/globals.css", "src/app/(app)/customers/merge.css", "src/app/(app)/customers/dupes/dupes.css"]) await page.addStyleTag({ path: path.resolve(f) });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => Object.assign(window, x), { __预览: 预览 });
  await page.evaluate(([k, p]) => (window as unknown as Record<string, (p: unknown) => void>)[k as string](p), [渲 === "清单" ? "__渲清单" : "__渲合并框", { 清单, ...参 }] as const);
  return { page, 错 };
}
const 调 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? []);

it("合并框带预选：一开就是两家并排预览，不出搜索框，预览只读一次", async () => {
  const { page, 错 } = await open(1280, "合并框");
  try {
    await page.getByTestId("merge-row").first().waitFor();
    expect(await page.getByLabel("搜客户").count()).toBe(0);
    expect(await page.getByTestId("merge-candidate").count()).toBe(0);
    expect(await page.locator(".mrg-body").innerText()).toContain("NO.00012");
    expect((await 调(page)).filter((x) => x[0] === "预览")).toEqual([["预览", "a", "b"]]);
    expect((await 调(page)).some((x) => x[0] === "搜")).toBe(false);
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("清单：两个页签、每组「合并」「不是同一个人」；点合并开预选框；标完出撤销条、撤销调撤销标记", async () => {
  const { page, 错 } = await open(1280, "清单");
  try {
    await page.getByTestId("dupe-group").first().waitFor();
    const 页签 = await page.locator(".dp-tabs").innerText();
    expect(页签).toContain("待处理 2 组");
    expect(页签).toContain("已标不是同一个人");
    expect(await page.getByTestId("dupe-group").count()).toBe(2);
    expect(await page.getByTestId("dupe-merge").count()).toBe(2);
    expect(await page.getByTestId("dupe-not-same").count()).toBe(2);
    expect(await page.getByTestId("dupe-member").count()).toBe(5);
    // 合并 → 预选框，一开就是预览
    await page.getByTestId("dupe-merge").first().click();
    await page.getByTestId("merge-row").first().waitFor();
    expect(await page.getByLabel("搜客户").count()).toBe(0);
    expect((await 调(page)).find((x) => x[0] === "预览")).toEqual(["预览", "a", "b"]);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".mrg-modal .ant-modal-container"));
    // 不是同一个人 → 标 → 撤销条 → 撤销
    await page.getByTestId("dupe-not-same").first().click();
    await page.locator(".undo-bar").waitFor();
    expect(await page.locator(".undo-t").innerText()).toBe("已标「同名测试客户」这 2 家不是同一个人，不再列出");
    expect((await 调(page)).find((x) => x[0] === "标")).toEqual(["标", ["a", "b"]]);
    await page.locator(".undo-btn").last().click();
    await page.waitForFunction(() => ((window as unknown as { __调?: unknown[][] }).__调 ?? []).some((x) => x[0] === "撤标"));
    expect((await 调(page)).find((x) => x[0] === "撤标")).toEqual(["撤标", ["a__b"]]);
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("已标页签：列已标的对，每行「撤销标记」，点了调撤销；切页签走路由", async () => {
  const { page, 错 } = await open(1280, "清单", { 已标 });
  try {
    await page.getByTestId("dupe-marked").first().waitFor();
    expect(await page.getByTestId("dupe-group").count()).toBe(0);
    expect(await page.getByTestId("dupe-marked").innerText()).toContain("QA标的");
    await page.getByTestId("dupe-undo-mark").click();
    await page.waitForFunction(() => ((window as unknown as { __调?: unknown[][] }).__调 ?? []).some((x) => x[0] === "撤标"));
    expect((await 调(page)).find((x) => x[0] === "撤标")).toEqual(["撤标", ["x__y"]]);
    await page.locator(".dp-tabs").getByText("待处理 2 组").click();
    await page.waitForFunction(() => (window as unknown as { __去?: string }).__去 !== undefined);
    expect(await page.evaluate(() => (window as unknown as { __去?: string }).__去)).toBe("/customers/dupes");
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("只读身份：两颗按钮置灰、悬停写原因；已标页签的「撤销标记」同样置灰；切换视图也算", async () => {
  for (const [名, 参, 原因] of [
    ["只读管理员", { 只读原因: "你的身份是只读，不能改" }, "你的身份是只读，不能改"],
    ["切换视图", { 切换: true }, "正在看别人的视角，只能看"],
  ] as const) {
    const { page, 错 } = await open(1280, "清单", 参);
    try {
      await page.getByTestId("dupe-group").first().waitFor();
      for (const id of ["dupe-merge", "dupe-not-same"]) {
        const 钮 = page.getByTestId(id).first();
        expect(await 钮.isDisabled(), `${名} ${id}`).toBe(true);
        expect(await 钮.locator("xpath=..").getAttribute("title"), `${名} ${id}`).toBe(原因);
      }
      await page.getByTestId("dupe-merge").first().click({ force: true }).catch(() => {});
      expect(await page.locator(".mrg-modal .ant-modal-container").count()).toBe(0);
      expect((await 调(page)).some((x) => x[0] === "标" || x[0] === "预览"), 名).toBe(false);
      expect(错).toEqual([]);
    } finally { await page.close(); }
  }
  const { page } = await open(1280, "清单", { 已标, 只读原因: "你的身份是只读，不能改" });
  try {
    await page.getByTestId("dupe-marked").first().waitFor();
    expect(await page.getByTestId("dupe-undo-mark").isDisabled()).toBe(true);
    expect(await page.getByTestId("dupe-undo-mark").locator("xpath=..").getAttribute("title")).toBe("你的身份是只读，不能改");
  } finally { await page.close(); }
}, 60_000);

it("390 宽：一组一张卡（上下排开）、按钮各占一行里的半边、不横滚；已标页签同样不横滚", async () => {
  for (const 参 of [{}, { 已标 }]) {
    const { page, 错 } = await open(390, "清单", 参);
    try {
      await page.locator(".dp-row").first().waitFor();
      expect(await page.evaluate(() => [document.documentElement.scrollWidth > innerWidth, [...document.querySelectorAll(".dp-page, .dp-list, .dp-row")].some((e) => e.scrollWidth > e.clientWidth + 1)])).toEqual([false, false]);
      const 卡 = await page.locator(".dp-row").evaluateAll((es) => es.map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width]; }));
      expect(卡.length).toBe("已标" in 参 ? 1 : 2);
      if (卡.length === 2) {
        expect(卡[1][1]).toBeGreaterThan(卡[0][1]);
        expect(Math.abs(卡[1][0] - 卡[0][0])).toBeLessThanOrEqual(1);
        const [合, 标] = await Promise.all([page.getByTestId("dupe-merge").first().boundingBox(), page.getByTestId("dupe-not-same").first().boundingBox()]);
        expect(Math.abs(合!.y - 标!.y)).toBeLessThanOrEqual(1);
        expect(标!.x).toBeGreaterThan(合!.x + 合!.width - 1);
      }
      expect(错).toEqual([]);
    } finally { await page.close(); }
  }
}, 60_000);
