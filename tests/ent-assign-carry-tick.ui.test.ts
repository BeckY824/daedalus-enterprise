/**
 * 分配弹窗「待办一起转」的勾（11-09，P-转-10）：市场首次分给销售（X-18）不摆，也不传；别的情况照旧摆。
 * 判断来自服务端 项目分配线 的 市场转客户，界面和服务端看同一个结论。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-assign-tick", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){}});");
  stub(/assign-actions$/, `
    const 记=(n,回)=>async(...a)=>{(window.__调||=[]).push([n,...a]);return 回};
    export const 分配线索=记('分配线索',{ok:true}),批量自动分配=记('批量自动分配',{ok:true,结果:[]}),我分出去的线索=async()=>window.__分出去的||[];
    export const 本月分配情况=async()=>[{userId:'u1',name:'王一',line:'内贸',配额:null,已分:0,加额:0,暂停:false}];
    export const 项目分配线=async()=>window.__分配线空?null:({线:'内贸',可选:window.__可选空?[]:['u1'],市场转客户:window.__市场转客户});
    export const 分配带走的项目=async(...a)=>{(window.__调||=[]).push(['分配带走的项目',...a]);if(window.__带走失败)throw new Error('断网');return window.__带走||{项目数:0,项目:[]}};
  `);
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import {AssignLeadModal,AssignedOutButton,useBatchAutoAssign} from '@/app/(app)/leads/AssignLead';
    function 批量({选项,名}){const 分=useBatchAutoAssign(()=>'分了',选项);return <button onClick={()=>void 分(['p1','p2'],()=>{})}>{名}</button>}
    function 壳(){const [lead,set]=React.useState(null);return <App><button onClick={()=>set({id:'p1',name:'某项目',ownerId:'m1',项目:true})}>开弹窗</button><button onClick={()=>set({id:'l1',name:'老线索',ownerId:'m1'})}>开老线索</button><批量 选项={{项目:true}} 名="批量分项目"/><批量 名="批量分老线索"/><AssignLeadModal lead={lead} 关={()=>set(null)}/><AssignedOutButton/></App>}
    window.__画=()=>createRoot(document.getElementById('root')).render(<壳/>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(市场转客户: boolean): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/leads");
  await page.addScriptTag({ content: bundle });
  await page.evaluate((v) => { const w = window as unknown as { __市场转客户: boolean; __画: () => void }; w.__市场转客户 = v; w.__画(); }, 市场转客户);
  await page.getByRole("button", { name: "开弹窗" }).click();
  await page.locator('[data-testid="assign-line-readonly"]', { hasText: "内贸" }).waitFor();
  return { page, errors };
}
const 勾的话 = "原负责人没做完的待办一起转给新负责人";

it("市场首次分给销售：不摆勾", async () => {
  const { page, errors } = await 打开(true);
  expect(await page.getByText(勾的话).count()).toBe(0);
  expect(errors).toEqual([]); await page.close();
});

it("别的情况：照旧摆勾，默认勾上", async () => {
  const { page, errors } = await 打开(false);
  await page.getByText(勾的话).waitFor();
  expect(await page.getByRole("checkbox", { name: 勾的话 }).isChecked()).toBe(true);
  expect(errors).toEqual([]); await page.close();
});

const 长名 = "这是一个名字特别特别长的项目用来量随客户标签会不会被挤出列外面去一直写到放不下为止";
const 分出去的 = [
  { leadId: null, projectId: "p1", name: 长名, status: "线索 · 线索验证", convertedAt: null, customerId: "c1", 接手人: "王一", 当前负责人: "王一", line: "内贸", kind: "随客户", 分配时间: "2026-11-09T01:00:00.000Z", 随客户: true },
  { leadId: null, projectId: "p2", name: "自己分的那条", status: "线索 · 线索验证", convertedAt: null, customerId: "c1", 接手人: "王一", 当前负责人: "王一", line: "内贸", kind: "营销", 分配时间: "2026-11-09T01:00:00.000Z" },
];

for (const width of [1024, 1280, 1366]) {
  it(`我分出去的（${width} 宽）：随客户走的那行有标签，长名字截断、标签不被挤掉；分配的那行没有`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 800 } }); page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
    await page.goto("http://ent.test/leads");
    await page.addScriptTag({ content: bundle });
    await page.evaluate((v) => { const w = window as unknown as { __分出去的: unknown; __画: () => void }; w.__分出去的 = v; w.__画(); }, 分出去的);
    await page.getByRole("button", { name: "我分出去的" }).click();
    const 行1 = page.locator("tr", { hasText: "这是一个名字" });
    const 标签 = 行1.getByText("随客户", { exact: true });
    await 标签.waitFor();
    // 弹窗有入场缩放（antd zoom，从 0.2 倍放大）：标签一出现就量，会量到缩小中的尺寸（CI 上 1024 宽量到过 10.4 = 52 × 0.2）。
    // 等弹窗上的 ant-zoom-* 动画类撤掉、外框不再缩放再量
    await page.waitForFunction(() => {
      const m = document.querySelector<HTMLElement>(".ant-modal");
      return !!m && !/\bant-zoom-/.test(m.className) && Math.abs(m.getBoundingClientRect().width - m.offsetWidth) < 1;
    });
    expect(await page.locator("tr", { hasText: "自己分的那条" }).getByText("随客户", { exact: true }).count()).toBe(0);
    // 标签整个在这一格里，名字在标签前面截断
    const 量 = await 标签.evaluate((el) => {
      const 格 = el.closest("td")!.getBoundingClientRect();
      const 签 = el.getBoundingClientRect();
      const 名 = el.parentElement!.querySelector("[data-testid='out-name']") as HTMLElement;
      return { 格左: 格.left, 格右: 格.right, 签左: 签.left, 签右: 签.right, 签宽: 签.width, 名右: 名.getBoundingClientRect().right, 名截断: 名.scrollWidth > 名.clientWidth, 页宽: document.documentElement.scrollWidth, 窗宽: window.innerWidth };
    });
    expect(量.签宽).toBeGreaterThan(20);
    expect(量.签左).toBeGreaterThanOrEqual(量.格左);
    expect(量.签右).toBeLessThanOrEqual(量.格右);
    expect(量.名右).toBeLessThanOrEqual(量.签左);
    expect(量.名截断).toBe(true);
    expect(量.页宽).toBeLessThanOrEqual(量.窗宽);
    expect(await 行1.locator("[data-testid='out-name']").getAttribute("title")).toBe(长名);
    expect(errors).toEqual([]); await page.close();
  });
}

// P-转-07：市场首次分给销售（X-18）有项目一起转、或有同事项目留下时，分之前列出来；别的情况不弹
const 留下预览 = { 项目数: 1 }; // 同事项目只给个数（Even C4，4B）
const 带走预览 = { 项目数: 2, 项目: [{ name: "自己的项目", 客户: "某客户" }, { name: "公海的项目", 客户: "某客户", 负责人: "线索公海" }], 留下: 留下预览 };
type 窗 = { __带走?: unknown; __带走失败?: boolean; __画: () => void; __调?: unknown[][] };
async function 开页(设: { 带走?: unknown; 失败?: boolean }): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/leads");
  await page.addScriptTag({ content: bundle });
  await page.evaluate((v) => { const w = window as unknown as 窗; w.__带走 = v.带走; w.__带走失败 = v.失败; w.__画(); }, 设);
  return { page, errors };
}
const 调了 = (page: Page, 名: string) => page.evaluate((n) => ((window as unknown as 窗).__调 ?? []).filter((x) => x[0] === n), 名);
const 确认框 = (page: Page) => page.locator(".ant-modal-confirm");
const 选人再分 = async (page: Page) => {
  await page.locator("#toUserId").click();
  await page.locator(".ant-select-item-option", { hasText: "王一" }).click();
  await page.locator(".ant-modal-footer .ant-btn-primary").click();
};

it("分配弹窗·只有留在同事名下的项目：也弹，写明不跟着转，按钮叫「转」", async () => {
  const { page, errors } = await 开页({ 带走: { 项目数: 0, 项目: [], 留下: 留下预览 } });
  await page.getByRole("button", { name: "开弹窗" }).click();
  await page.locator('[data-testid="assign-line-readonly"]', { hasText: "内贸" }).waitFor();
  await 选人再分(page);
  await 确认框(page).locator(".ant-modal-confirm-title", { hasText: "1 个项目留在各自负责人名下" }).waitFor();
  const 字 = await 确认框(page).innerText();
  expect(字).toContain("有 1 个同事在推的项目，留在各自负责人名下，不跟着转");
  expect(字).not.toContain("王二");
  expect(字).not.toContain("这些项目的负责人会一起改成新负责人：");
  await 确认框(page).getByRole("button", { name: "转", exact: true }).click();
  await page.waitForFunction(() => ((window as unknown as 窗).__调 ?? []).some((x) => x[0] === "分配线索"));
  expect(errors).toEqual([]); await page.close();
});

it("分配弹窗·有项目一起转：先列出来，同事的另列一段；取消就不分；点「一起转」才分", async () => {
  const { page, errors } = await 开页({ 带走: 带走预览 });
  await page.getByRole("button", { name: "开弹窗" }).click();
  await page.locator('[data-testid="assign-line-readonly"]', { hasText: "内贸" }).waitFor();
  await 选人再分(page);
  await 确认框(page).locator(".ant-modal-confirm-title", { hasText: "会一起转走的 2 个项目" }).waitFor();
  const 框字 = await 确认框(page).innerText();
  expect(框字).toContain("这些项目的负责人会一起改成新负责人：");
  expect(框字).toContain("公海的项目（某客户 · 线索公海）");
  expect(框字).toContain("有 1 个同事在推的项目，留在各自负责人名下，不跟着转");
  expect(框字).not.toContain("王二");
  expect(await 调了(page, "分配带走的项目")).toEqual([["分配带走的项目", ["p1"], "u1"]]);
  await 确认框(page).locator(".ant-btn:not(.ant-btn-primary)").click();
  await 确认框(page).waitFor({ state: "detached" });
  expect(await 调了(page, "分配线索")).toEqual([]);
  // 弹窗还开着，再点一次，这回确定
  await page.locator(".ant-modal-footer .ant-btn-primary").click();
  await 确认框(page).getByRole("button", { name: "一起转" }).click();
  await page.waitForFunction(() => ((window as unknown as 窗).__调 ?? []).some((x) => x[0] === "分配线索"));
  expect((await 调了(page, "分配线索")).length).toBe(1);
  expect(errors).toEqual([]); await page.close();
});

it("分配弹窗·没有要转的、也没有留下的：不弹，直接分", async () => {
  const { page, errors } = await 开页({});
  await page.getByRole("button", { name: "开弹窗" }).click();
  await page.locator('[data-testid="assign-line-readonly"]', { hasText: "内贸" }).waitFor();
  await 选人再分(page);
  await page.waitForFunction(() => ((window as unknown as 窗).__调 ?? []).some((x) => x[0] === "分配线索"));
  expect(await 调了(page, "分配带走的项目")).toHaveLength(1);
  expect(await 确认框(page).count()).toBe(0);
  expect(errors).toEqual([]); await page.close();
});

it("分配弹窗·取预览失败不拦着（同客户页的约定）；老线索不问", async () => {
  const { page, errors } = await 开页({ 失败: true });
  await page.getByRole("button", { name: "开弹窗" }).click();
  await page.locator('[data-testid="assign-line-readonly"]', { hasText: "内贸" }).waitFor();
  await 选人再分(page);
  await page.waitForFunction(() => ((window as unknown as 窗).__调 ?? []).some((x) => x[0] === "分配线索"));
  expect(await 确认框(page).count()).toBe(0);
  expect(errors).toEqual([]); await page.close();

  const 老 = await 开页({ 带走: 带走预览 });
  await 老.page.getByRole("button", { name: "开老线索" }).click();
  await 老.page.locator(".ant-modal-footer .ant-btn-primary").waitFor();
  await 老.page.waitForTimeout(400); // 弹窗动画走完再点下拉
  await 选人再分(老.page);
  await 老.page.waitForFunction(() => ((window as unknown as 窗).__调 ?? []).some((x) => x[0] === "分配线索"));
  expect(await 调了(老.page, "分配带走的项目")).toEqual([]);
  expect(await 确认框(老.page).count()).toBe(0);
  expect(老.errors).toEqual([]); await 老.page.close();
});

it("分配弹窗·这条分不了（客户在公海、取不到）：提示刷新看看，不引去查组织架构；真没人才说组织架构", async () => {
  const 下拉提示 = async (page: Page) => {
    await page.locator("#toUserId").click();
    return page.locator(".ant-select-dropdown").last().innerText();
  };
  const 空 = await 开页({});
  await 空.page.evaluate(() => { (window as unknown as { __分配线空: boolean }).__分配线空 = true; });
  await 空.page.getByRole("button", { name: "开弹窗" }).click();
  await 空.page.locator('[data-testid="assign-line-readonly"]', { hasText: "取不到" }).waitFor();
  const 话 = await 下拉提示(空.page);
  expect(话).toContain("这条现在分不了");
  expect(话).not.toContain("组织架构");
  expect(空.errors).toEqual([]); await 空.page.close();

  const 没人 = await 开页({});
  await 没人.page.evaluate(() => { (window as unknown as { __可选空: boolean }).__可选空 = true; });
  await 没人.page.getByRole("button", { name: "开弹窗" }).click();
  await 没人.page.locator('[data-testid="assign-line-readonly"]', { hasText: "内贸" }).waitFor();
  expect(await 下拉提示(没人.page)).toContain("组织架构");
  expect(没人.errors).toEqual([]); await 没人.page.close();
});

it("批量自动分配·有项目一起转：先列出来，取消就不分；点「一起转」才分", async () => {
  const { page, errors } = await 开页({ 带走: 带走预览 });
  await page.getByRole("button", { name: "批量分项目" }).click();
  await 确认框(page).locator(".ant-modal-confirm-title", { hasText: "会一起转走的 2 个项目" }).waitFor();
  expect(await 调了(page, "分配带走的项目")).toEqual([["分配带走的项目", ["p1", "p2"]]]);
  await 确认框(page).locator(".ant-btn:not(.ant-btn-primary)").click();
  await 确认框(page).waitFor({ state: "detached" });
  expect(await 调了(page, "批量自动分配")).toEqual([]);
  await page.getByRole("button", { name: "批量分项目" }).click();
  await 确认框(page).getByRole("button", { name: "一起转" }).click();
  await page.waitForFunction(() => ((window as unknown as 窗).__调 ?? []).some((x) => x[0] === "批量自动分配"));
  expect(errors).toEqual([]); await page.close();
});

it("批量自动分配·没有要带走的同事项目、老线索：不弹，直接分", async () => {
  const { page, errors } = await 开页({});
  await page.getByRole("button", { name: "批量分项目" }).click();
  await page.waitForFunction(() => ((window as unknown as 窗).__调 ?? []).some((x) => x[0] === "批量自动分配"));
  expect(await 调了(page, "分配带走的项目")).toHaveLength(1);
  expect(errors).toEqual([]); await page.close();

  const 老 = await 开页({ 带走: 带走预览 });
  await 老.page.getByRole("button", { name: "批量分老线索" }).click();
  await 老.page.waitForFunction(() => ((window as unknown as 窗).__调 ?? []).some((x) => x[0] === "批量自动分配"));
  expect(await 调了(老.page, "分配带走的项目")).toEqual([]);
  expect(老.errors).toEqual([]); await 老.page.close();
});
