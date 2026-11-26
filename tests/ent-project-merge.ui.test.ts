import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* 合并客户第二批 2a · 「并进另一个项目」框（customers/[id]/MergeHost.tsx ProjectMergeDialog）：真组件 + globals.css + merge.css，只桩掉 merge-actions。钉的是：
   打开就读候选（项目合并候选(被并的)）→ 选择框可输入搜 → 预览（预览项目合并(留下, 被并)）列明挪什么、结束为重复线索、不退还已占线索名额；被并项目的组员不能勾、只提示留在原项目（E-331）
   → 后果框写「这个项目将结束为重复线索，不退还已占线索名额，30 天内可撤回」→ 合并项目(留下, 被并) → 撤销条；撤销 = 撤回项目合并单；
   拦下的原因原样摆、并过去点不了；执行时被拦，原因写在后果框里、框不关；没候选写明为什么；
   1280 / 390 不横滚，390 框底按钮、选择框 ≥ 44，长项目名一行省略、悬停看全 */
let browser: Browser, bundle: string;
const 长名 = "超长的测试项目名称用来看会不会撑破".repeat(2) + "出来的项目四"; // 40 个汉字
const 动作 = `
  const 记=(...a)=>(window.__调??=[]).push(a);
  export const 项目合并候选=async(id)=>{记('候选',id);return window.__候选??[]};
  export const 预览项目合并=async(a,b)=>{记('预览',a,b);return {ok:true,预览:window.__预览}};
  export const 合并项目=async(a,b)=>{记('合并',a,b);return window.__合并结果??{ok:true,mergeId:'pm1',条数:{}}};
  export const 撤回项目合并单=async(id)=>{记('撤回',id);return {ok:true,没还原:[]}};
  export const 能并同事的=async()=>window.__管===true;`;
const plugin: Plugin = { name: "project-merge", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)merge-actions$/, 补全动作桩("src/app/(app)/customers/merge-actions.ts", 动作));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__去=u},replace(){},prefetch(){}});export const usePathname=()=>'/customers/a';");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import MergeHost from '@/app/(app)/customers/[id]/MergeHost';import {合并桥} from '@/app/(app)/customers/[id]/merge-bridge';
    function 壳({请求}){const [r,setR]=React.useState(请求);
      return <合并桥.Provider value={{请求:r,收:()=>setR(null)}}><MergeHost customerId="a" 客户名=""/></合并桥.Provider>}
    window.__render=(请求)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><壳 请求={{...请求,次:1}}/></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 候选 = [{ id: "pa", name: 长名, node: "初步接触" }, { id: "pc", name: "另一条展会线索", node: "需求确认" }];
const 预览 = (改: object = {}) => ({
  能并: true, 原因: [], 留下: { id: "pa", name: 长名 }, 并掉: { id: "pb", name: "重复的那条线索" },
  条数: { 沟通: 5, 附件: 2, 录音: 0, 点评: 1, 联系人: 3, 关联客户: 1, 卡点: 0 },
  组员: [{ userId: "u1", name: "组员甲" }, { userId: "u2", name: "组员乙".repeat(10) }, { userId: "u3", name: "组员丙" }],
  // 号码相同也要提示（E-331）：两位尾号一样
  联系人: { 留下: [{ id: "c1", name: "联系人甲", 尾号: "1234" }], 并掉: [{ id: "c2", name: "联系人乙".repeat(8), 尾号: "1234" }] },
  ...改,
});
const 请求 = { 种: "并项目", projectId: "pb", 名: "重复的那条线索" };

async function open(width: number, 设: Record<string, unknown> = {}) {
  const page = await browser.newPage({ viewport: { width, height: width < 768 ? 844 : 900 } }); page.setDefaultTimeout(5000);
  const 错: string[] = [];
  page.on("pageerror", e => 错.push(String(e)));
  page.on("console", m => { if (m.type() === "error") 错.push(m.text()); });
  await page.route("http://pmerge.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://pmerge.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ path: path.resolve("src/app/(app)/customers/merge.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => Object.assign(window, x), { __候选: 候选, __预览: 预览(), ...设 });
  await page.evaluate((r) => (window as unknown as { __render: (r: object) => void }).__render(r), 请求);
  return { page, 错 };
}
const 调 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? []);
const 横滚 = (page: Page) => page.evaluate(() => [document.documentElement.scrollWidth > innerWidth,
  [...document.querySelectorAll(".mrg-modal .ant-modal-body, .mrg-body, .mrg-ppl")].some(e => e.scrollWidth > e.clientWidth + 1)]);
const 截图 = (page: Page, 名: string) => process.env.MERGE_SHOT_DIR ? page.screenshot({ path: path.join(process.env.MERGE_SHOT_DIR, 名) }) : Promise.resolve();

/** 在选择框里输入词搜，点名字含 词 的那个选项 */
async function 选(page: Page, 词: string) {
  const 框 = page.getByLabel("留下的项目");
  await 框.click();
  await page.keyboard.type(词);
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: 词 }).first().click();
  // 选了就收起，不压着下面的预览
  await page.waitForFunction(() => ![...document.querySelectorAll(".ant-select-dropdown")].some((e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== "hidden" && !e.classList.contains("ant-select-dropdown-hidden")));
}

for (const 宽 of [1280, 1024, 768, 390]) {
  it(`${宽}：读候选 → 输入搜、选留下的 → 预览列明挪什么、结束为重复线索；组员只提示留在原项目、没有勾选 → 后果框 → 合并项目(留下, 被并) → 撤销条；撤销 = 撤回项目合并单`, async () => {
    const { page, 错 } = await open(宽);
    try {
      const 钮 = page.getByTestId("pmerge-go");
      await page.getByLabel("留下的项目").waitFor();
      expect(await 钮.isDisabled()).toBe(true);
      expect((await 调(page))[0]).toEqual(["候选", "pb"]);
      // 输入搜：只剩名字对得上的那一个
      await page.getByLabel("留下的项目").click();
      await page.keyboard.type("展会");
      const 项 = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
      await expect.poll(() => 项.count()).toBe(1);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace");
      await 选(page, "超长");
      const 单 = page.getByTestId("pmerge-list");
      await 单.waitFor();
      expect((await 调(page)).find((x) => x[0] === "预览")).toEqual(["预览", "pa", "pb"]);
      const 话 = await 单.innerText();
      expect(话).toContain("5 条沟通、2 个附件、1 条点评");
      expect(话).not.toContain("录音");
      expect(话).toContain("3 位项目联系人、1 位关联客户一起过去");
      expect(话).toContain("这个项目将结束为重复线索，不退还已占线索名额");
      // 长项目名一行省略、悬停看全
      const 行 = page.getByTestId("pmerge-move").locator(".mrg-one");
      expect(await 行.evaluate((e) => [getComputedStyle(e).textOverflow, e.scrollWidth > e.clientWidth, e.getAttribute("title")])).toEqual(["ellipsis", true, `「重复的那条线索」 → 「${长名}」`]);
      // 组员（E-331 必改 3）：不并进留下的项目，框里只一句提示、没有勾选
      expect(话).toContain("3 位组员留在这个项目里，随项目结束、留痕，不并进留下的项目；不在那边项目组的看不到挪过去的沟通");
      expect(await page.locator(".mrg-modal .ant-checkbox").count()).toBe(0);
      // 联系人核实（E-331）：两边各有一位、号码尾号相同也提示；只是提示，「合成」不是按钮
      const 核 = page.getByTestId("pmerge-核实");
      expect(await 核.innerText()).toContain(`留下的项目有 联系人甲（尾号 1234），这个项目有 ${"联系人乙".repeat(8)}（尾号 1234）：这两位可能是同一个人，确认后可在客户详情里合成`);
      expect(await 核.locator("button, a, [role=button]").count()).toBe(0);
      expect(await 横滚(page)).toEqual([false, false]);
      if (宽 < 768) {
        const 高 = await page.evaluate(() => [...document.querySelectorAll(".mrg-foot .ant-btn, .mrg-psel")].map((e) => Math.round(e.getBoundingClientRect().height)));
        expect(高.every((h) => h >= 44), String(高)).toBe(true);
      }
      await 截图(page, `并项目-预览-${宽}.png`);
      expect(await 钮.isDisabled()).toBe(false);
      await 钮.click();
      const 框 = page.locator(".csq");
      await 框.waitFor();
      const 框话 = await 框.innerText();
      expect(框话).toContain(`把「重复的那条线索」并进「${长名}」？`);
      expect(框话).toContain("3 位组员留在这个项目里");
      expect(框话).toContain("这两位可能是同一个人，确认后可在客户详情里合成");
      expect(框话).not.toContain("加进");
      expect(框话).toContain("这个项目将结束为重复线索，不退还已占线索名额，30 天内可撤回（要你本人、且留下的项目仍归你负责，否则找系统管理员）");
      await 框.getByRole("button", { name: "并过去" }).click();
      await page.locator(".undo-bar").waitFor();
      expect(await page.locator(".undo-t").innerText()).toBe(`已把「重复的那条线索」并进「${长名}」，30 天内可在「历史变更」里撤回`);
      expect((await 调(page)).find((x) => x[0] === "合并")).toEqual(["合并", "pa", "pb"]);
      await page.waitForFunction(() => !document.querySelector(".mrg-modal .ant-modal-container"));
      await page.locator(".undo-btn").last().click();
      await page.waitForFunction(() => ((window as unknown as { __调?: unknown[][] }).__调 ?? []).some((x) => x[0] === "撤回"));
      expect((await 调(page)).find((x) => x[0] === "撤回")).toEqual(["撤回", "pm1"]);
      expect(错).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);

  it(`${宽}：拦下的原因原样摆、并过去点不了；没候选写明为什么`, async () => {
    const 因 = ["「重复的那条线索」线索验证判过有效，不能并掉；要并请把它留下、并另一个", "这位客户正在转让交接中，等接手人确认或撤回交接后再并"];
    const { page, 错 } = await open(宽, { __预览: 预览({ 能并: false, 原因: 因, 条数: null, 组员: [] }) });
    try {
      await 选(page, "展会");
      const 警 = page.locator(".mrg-why");
      await 警.waitFor();
      const 话 = await 警.innerText();
      for (const x of 因) expect(话).toContain(x);
      expect(await page.getByTestId("pmerge-list").count()).toBe(0);
      expect(await page.getByTestId("pmerge-go").isDisabled()).toBe(true);
      expect(await 横滚(page)).toEqual([false, false]);
      await 截图(page, `并项目-拦下-${宽}.png`);
      expect(错).toEqual([]);
    } finally { await page.close(); }
    const 空 = await open(宽, { __候选: [] });
    try {
      await 空.page.getByTestId("pmerge-empty").waitFor();
      expect(await 空.page.getByTestId("pmerge-empty").innerText()).toContain("没有同一位负责人在推的别的项目");
      expect(await 空.page.getByLabel("留下的项目").count()).toBe(0);
      expect(await 空.page.getByTestId("pmerge-go").isDisabled()).toBe(true);
      expect(空.错).toEqual([]);
    } finally { await 空.page.close(); }
  }, 60_000);
}

for (const 宽 of [1280, 390]) it(`[E-331] ${宽}：已签合同、到商机 / 订单的候选灰着列、不能选，旁边写原因；全是灰的写一句点开看原因`, async () => {
  const 灰 = [
    { id: "pd", name: "已经签了合同的那个项目".repeat(3), node: "签约", 不能: "已签合同的项目不能合并" },
    { id: "pe", name: "到了商机阶段的项目", node: "需求确认", 不能: "到商机 / 订单的项目暂不能合并" },
  ];
  const { page, 错 } = await open(宽, { __候选: [...候选, ...灰] });
  try {
    await page.getByLabel("留下的项目").click();
    const 项 = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
    await expect.poll(() => 项.count()).toBe(4);
    const 禁 = 项.filter({ has: page.locator(".mrg-popt-no") });
    expect(await 禁.count()).toBe(2);
    for (let i = 0; i < 2; i++) {
      const x = 禁.nth(i);
      expect(await x.evaluate((e) => e.classList.contains("ant-select-item-option-disabled"))).toBe(true);
      expect(await x.locator(".mrg-popt-no").innerText()).toBe(灰[i].不能);
      // 名称一行省略，原因整句露着
      const [名宽, 名满, 因右, 框右, 字] = await x.evaluate((e) => {
        const n = e.querySelector(".mrg-one")!, r = e.querySelector(".mrg-popt-no")!;
        return [n.clientWidth, n.scrollWidth, r.getBoundingClientRect().right, e.getBoundingClientRect().right, parseFloat(getComputedStyle(n).fontSize)];
      });
      // 名称至少露 7 个字（窄屏原因折到下一行），不被原因挤没
      expect(名宽).toBeGreaterThanOrEqual(字 * 7);
      if (i === 0) expect(名满).toBeGreaterThan(名宽);
      expect(因右).toBeLessThanOrEqual(框右 + 0.5);
    }
    await 禁.first().dispatchEvent("click");
    await page.waitForTimeout(200);
    expect((await 调(page)).some((x) => x[0] === "预览")).toBe(false);
    expect(await page.getByTestId("pmerge-go").isDisabled()).toBe(true);
    expect(await page.getByTestId("pmerge-allgrey").count()).toBe(0);
    expect(await 横滚(page)).toEqual([false, false]);
    await 截图(page, `并项目-灰候选-${宽}.png`);
    expect(错).toEqual([]);
  } finally { await page.close(); }
  const 全灰 = await open(宽, { __候选: 灰 });
  try {
    await 全灰.page.getByTestId("pmerge-allgrey").waitFor();
    expect(await 全灰.page.getByTestId("pmerge-allgrey").innerText()).toBe("没有能选的项目，点开看各自为什么不能并。");
    expect(await 全灰.page.getByTestId("pmerge-empty").count()).toBe(0);
    expect(await 全灰.page.getByTestId("pmerge-go").isDisabled()).toBe(true);
    expect(全灰.错).toEqual([]);
  } finally { await 全灰.page.close(); }
}, 60_000);

it("[E-331] 联系人核实：只有一边有人（或被并的那位留下那边也有）不提示；多位写「这几位里」、每边最多列 3 位；没留号码照写", async () => {
  const 人 = (n: number, 前: string) => Array.from({ length: n }, (_, i) => ({ id: `${前}${i}`, name: `${前}${i}`, 尾号: i ? `00${i}0` : "" }));
  for (const [联系人, 有] of [
    [{ 留下: 人(1, "甲"), 并掉: [] }, false],
    [{ 留下: [], 并掉: 人(2, "乙") }, false],
    [undefined, false],
    [{ 留下: 人(4, "甲"), 并掉: 人(1, "乙") }, true],
  ] as const) {
    const { page, 错 } = await open(1280, { __预览: 预览({ 联系人 }) });
    try {
      await 选(page, "展会");
      await page.getByTestId("pmerge-list").waitFor();
      expect(await page.getByTestId("pmerge-核实").count(), JSON.stringify(联系人)).toBe(有 ? 1 : 0);
      if (有) expect(await page.getByTestId("pmerge-核实").innerText()).toContain("留下的项目有 甲0（没留号码）、甲1（尾号 0010）、甲2（尾号 0020） 等 4 位，这个项目有 乙0（没留号码）：这几位里可能有同一个人，确认后可在客户详情里合成");
      expect(错).toEqual([]);
    } finally { await page.close(); }
  }
}, 60_000);

it("执行时被拦（预览后情况变了）：原因写在后果框里、框不关、不出撤销条；系统管理员的后果框不补谁能撤", async () => {
  const { page, 错 } = await open(1280, { __管: true, __合并结果: { ok: false, error: "「重复的那条线索」在等市场复核，判完再并" } });
  try {
    await 选(page, "展会");
    await page.getByTestId("pmerge-list").waitFor();
    await page.getByTestId("pmerge-go").click();
    const 框 = page.locator(".csq");
    await 框.waitFor();
    expect(await 框.innerText()).not.toContain("否则找系统管理员");
    await 框.getByRole("button", { name: "并过去" }).click();
    await 框.locator(".csq-err").waitFor();
    expect(await 框.locator(".csq-err").innerText()).toContain("在等市场复核，判完再并");
    expect(await page.locator(".undo-bar").count()).toBe(0);
    expect(await page.locator(".mrg-modal .ant-modal-container").count()).toBe(1);
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);
