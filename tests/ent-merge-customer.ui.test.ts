import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* 合并客户第一批 · 界面（11-25，customers/[id]/MergeHost.tsx）：真组件 + globals.css + merge.css，只桩掉 merge-actions。钉的是：
   搜候选 → 并排预览：来源 / 创建人不同的格标红，要勾「已核对」才能点合并，两家一样时不出勾选；同名联系人先配上、不替人勾「是同一个人」；
   后果框列明订单阶段项目、回款笔数；成了撤销条写明 30 天内可整单撤回；拦下的只摆原因、合并点不了；
   合成联系人、项目换客户（预览列明订单阶段、回款、沟通、项目联系人；后果框；撤销 = 撤销换客户）；
   768 / 1024 / 1199 / 1280 / 1440 / 390 不横滚，手机两家改成上下两段，40 个汉字的客户名一行省略；暗色标红跟 token */
let browser: Browser, bundle: string;
const 长名 = "超长的测试客户名称用来看会不会撑破".repeat(2) + "出来的测试四"; // 40 个汉字
const 动作 = `
  const 记=(...a)=>(window.__调??=[]).push(a);
  export const 搜合并候选=async(id,词)=>{记('搜',id,词);return window.__候选??[]};
  export const 预览合并=async(a,b)=>{记('预览',a,b);return {ok:true,预览:window.__预览}};
  export const 合并客户=async(a,b,o)=>{记('合并',a,b,o);return window.__合并结果??{ok:true,mergeId:'m1',条数:{},合成:0}};
  export const 撤回合并单=async(id)=>{记('撤回',id);return {ok:true,没还原:[]}};
  export const 合成两位联系人=async(留,并)=>{记('合成',留,并);return {ok:true,mergeId:'m2'}};
  export const 预览项目换客户=async(p,t)=>{记('换预览',p,t);return {ok:true,预览:window.__换预览}};
  export const 给项目换客户=async(p,t)=>{记('换',p,t);return {ok:true,沟通:4,挂靠:2,logId:'L1'}};
  export const 撤销换客户=async(id)=>{记('撤销换',id);return {ok:true}};
  export const 能并同事的=async()=>window.__管===true;`;
const plugin: Plugin = { name: "merge-customer", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)merge-actions$/, 补全动作桩("src/app/(app)/customers/merge-actions.ts", 动作));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(u){window.__去=u},replace(){},prefetch(){}});export const usePathname=()=>'/customers/a';");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import MergeHost from '@/app/(app)/customers/[id]/MergeHost';import {合并桥} from '@/app/(app)/customers/[id]/merge-bridge';
    function 壳({请求}){const [r,setR]=React.useState(请求);window.__开=(x)=>setR({...x,次:Date.now()});
      return <合并桥.Provider value={{请求:r,收:()=>setR(null)}}><MergeHost customerId="a" 客户名=${JSON.stringify(长名)}/></合并桥.Provider>}
    window.__render=(请求)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><壳 请求={{...请求,次:1}}/></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 行 = (格: string, 留下: string, 并掉: string, 红 = false) => ({ 格, 留下, 并掉, 不同: 留下 !== 并掉, ...(红 && 留下 !== 并掉 ? { 标红: true } : {}) });
const 预览 = (改: object = {}) => ({
  能并: true, 原因: [], 要勾选: true, 补空: ["客户简称", "客户地址"],
  并排: [
    行("客户名称", 长名, 长名.replace("测试四", "测试五")), 行("客户编号", "NO.00001", "NO.00012"), 行("负责人", "QA", "QA"),
    行("来源渠道", "展会", "官网", true), 行("渠道触点", "", "", true), 行("创建人", "QA", "同事乙", true), 行("业务线", "内贸", ""),
  ],
  条数: { 联系人: 2, 项目: 5, 订单项目: 2, 回款: 3, 沟通: 17, 待办: 1, 跟进计划: 2, 关联客户: 0, 项目关联: 0, 撞号记录: 0 },
  联系人们: {
    留下: [{ id: "a1", name: "张三", position: "采购", 关键: true, 号: ["138****0001"] }, { id: "a2", name: "李四", position: null, 关键: false, 号: [] }],
    并掉: [{ id: "b1", name: "张三", position: "采购经理", 关键: true, 号: ["139****0002"] }, { id: "b2", name: "王五".repeat(12), position: "超长的职务名称".repeat(4), 关键: false, 号: ["137****0003", "wx_long_id_for_test"] }],
  },
  ...改,
});

async function open(width: number, 请求: object, 设: Record<string, unknown> = {}, 暗 = false) {
  const page = await browser.newPage({ viewport: { width, height: width < 768 ? 844 : 900 }, colorScheme: 暗 ? "dark" : "light" }); page.setDefaultTimeout(5000);
  const 错: string[] = [];
  page.on("pageerror", e => 错.push(String(e)));
  page.on("console", m => { if (m.type() === "error") 错.push(m.text()); });
  await page.route("http://merge.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://merge.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ path: path.resolve("src/app/(app)/customers/merge.css") });
  if (暗) { await page.addStyleTag({ path: path.resolve("src/app/dark.css") }); await page.evaluate(() => document.documentElement.setAttribute("data-mode", "dark")); }
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => Object.assign(window, x), { __候选: [{ id: "b", name: 长名.replace("测试四", "测试五"), 编号: "NO.00012", 负责人: "QA" }], __预览: 预览(), ...设 });
  await page.evaluate((r) => (window as unknown as { __render: (r: object) => void }).__render(r), 请求);
  return { page, 错 };
}
const 调 = (page: Page) => page.evaluate(() => (window as unknown as { __调?: unknown[][] }).__调 ?? []);
const 横滚 = (page: Page) => page.evaluate(() => [document.documentElement.scrollWidth > innerWidth,
  [...document.querySelectorAll(".mrg-modal .ant-modal-body, .mrg-body, .mrg-cmp, .mrg-ppl")].some(e => e.scrollWidth > e.clientWidth + 1)]);
const 截图 = (page: Page, 名: string) => process.env.MERGE_SHOT_DIR ? page.screenshot({ path: path.join(process.env.MERGE_SHOT_DIR, 名) }) : Promise.resolve();

async function 到预览(page: Page) {
  await page.getByLabel("搜客户").fill("测试");
  await page.getByTestId("merge-candidate").first().click();
  await page.getByTestId("merge-row").first().waitFor();
}

it("合并客户：搜 → 并排预览标红 → 勾已核对才能合并 → 同名先配上、勾「是同一个人」→ 后果框列明订单项目和回款 → 撤销条写 30 天内可撤回", async () => {
  const { page, 错 } = await open(1280, { 种: "客户" });
  try {
    await page.getByLabel("搜客户").fill("测试");
    const 候选 = page.getByTestId("merge-candidate");
    await 候选.first().waitFor();
    expect(await 候选.innerText()).toContain("NO.00012 · QA");
    await 候选.first().click();
    await page.getByTestId("merge-row").first().waitFor();
    expect(await 调(page)).toEqual([["搜", "a", "测试"], ["预览", "a", "b"]]);
    // 标红：来源渠道、创建人（不同的）标红，渠道触点（两家一样）不标；红字用 --danger-text
    const 红们 = await page.locator(".mrg-cmp-r.is-red .mrg-cmp-k").allInnerTexts();
    expect(红们).toEqual(["来源渠道", "创建人"]);
    const 色 = await page.evaluate(() => {
      const 探 = document.createElement("div"); 探.style.color = "var(--danger-text)"; document.body.appendChild(探);
      const r = [getComputedStyle(document.querySelector(".mrg-cmp-r.is-red .mrg-cmp-b")!).color, getComputedStyle(探).color]; 探.remove(); return r;
    });
    expect(色[0]).toBe(色[1]);
    // 40 个汉字的客户名一行省略、悬停看全
    const 名格 = page.locator(".mrg-cmp-r").nth(1).locator(".mrg-cmp-b .mrg-one");
    expect(await 名格.evaluate((e) => [getComputedStyle(e).textOverflow, e.scrollWidth > e.clientWidth, e.getAttribute("title")?.length])).toEqual(["ellipsis", true, 40]);
    expect(await page.locator(".mrg-body").innerText()).toContain("留下这家空着的客户简称、客户地址");
    // 没勾「已核对」合并点不了
    const 合并 = page.getByTestId("merge-go");
    expect(await 合并.isDisabled()).toBe(true);
    await page.getByTestId("merge-check").getByText("已核对，按留下那家的来源和创建人").click();
    expect(await 合并.isDisabled()).toBe(false);
    // 联系人：同名「张三」先配上，「是同一个人」不替人勾；王五没配，勾不了
    const 人们 = page.getByTestId("merge-contact");
    expect(await 人们.count()).toBe(2);
    expect(await 人们.nth(0).locator(".ant-select-content, .ant-select-selection-item").first().innerText()).toContain("张三");
    const 同 = (i: number) => 人们.nth(i).locator(".mrg-ppl-same input");
    expect(await 同(0).isChecked()).toBe(false);
    expect(await 同(1).isDisabled()).toBe(true);
    await 人们.nth(0).getByText("是同一个人").click();
    expect(await 横滚(page)).toEqual([false, false]);
    await 截图(page, "合并-预览-1280.png");
    await 合并.click();
    const 框 = page.locator(".csq");
    await 框.waitFor();
    const 话 = await 框.innerText();
    expect(话).toContain("5 个项目（其中订单阶段 2 个）、回款 3 笔");
    expect(话).toContain("1 对联系人合成一位");
    expect(话).toContain("30 天内可在「历史变更」里整单撤回（要你本人、且这家仍归你负责，否则找系统管理员）");
    await 框.locator(".csq-foot .ant-btn-primary").click();
    await page.locator(".undo-bar").waitFor();
    expect(await page.locator(".undo-t").innerText()).toMatch(/^已把「.+」并进来，30 天内可在「历史变更」里整单撤回$/);
    expect((await 调(page)).find((x) => x[0] === "合并")).toEqual(["合并", "a", "b", { 已核对: true, 同一个人: [{ 留: "a1", 并: "b1" }] }]);
    // 框关了
    await page.waitForFunction(() => !document.querySelector(".mrg-modal .ant-modal-container"));
    // 撤销 = 撤回合并单
    await page.locator(".undo-btn").last().click();
    await page.waitForFunction(() => ((window as unknown as { __调?: unknown[][] }).__调 ?? []).some((x) => x[0] === "撤回"));
    expect((await 调(page)).find((x) => x[0] === "撤回")).toEqual(["撤回", "m1"]);
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("两家来源、创建人一样：不出「已核对」勾选，直接能点合并；拦下的只摆原因、合并点不了、没有联系人明细", async () => {
  const 一样 = 预览({ 要勾选: false, 并排: [行("来源渠道", "展会", "展会", true), 行("创建人", "QA", "QA", true)] });
  const { page, 错 } = await open(1280, { 种: "客户" }, { __预览: 一样 });
  try {
    await 到预览(page);
    expect(await page.getByTestId("merge-check").count()).toBe(0);
    expect(await page.locator(".mrg-cmp-r.is-red").count()).toBe(0);
    expect(await page.getByTestId("merge-go").isDisabled()).toBe(false);
    // 换一家 → 拦下的
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__预览 = { 能并: false, 原因: ["「乙」名下有 1 个同事负责、还没结束的项目，不能直接合并；请找系统管理员代并", "两家业务线不同（内贸 / 外贸），不能合并"], 并排: [], 条数: null, 要勾选: false, 补空: [], 联系人们: { 留下: [], 并掉: [] } }; });
    await page.getByRole("button", { name: "换一家" }).click();
    await page.getByLabel("搜客户").fill("乙");
    await page.getByTestId("merge-candidate").first().click();
    await page.locator(".mrg-why").waitFor();
    expect(await page.locator(".mrg-why").innerText()).toContain("两家业务线不同");
    expect(await page.getByTestId("merge-contact").count()).toBe(0);
    expect(await page.getByTestId("merge-go").isDisabled()).toBe(true);
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("各宽度不横滚；手机 390 两家改成上下两段（留下在上、并进来在下，各带小标签）、联系人配对拆两行", async () => {
  for (const 宽 of [768, 1024, 1199, 1280, 1440, 390]) {
    const { page, 错 } = await open(宽, { 种: "客户" });
    try {
      await 到预览(page);
      expect(await 横滚(page), `${宽}`).toEqual([false, false]);
      const [a, b2] = await Promise.all([page.locator(".mrg-cmp-r.is-red .mrg-cmp-a").first().boundingBox(), page.locator(".mrg-cmp-r.is-red .mrg-cmp-b").first().boundingBox()]);
      if (宽 < 768) {
        expect(b2!.y).toBeGreaterThan(a!.y + a!.height - 1);
        expect(await page.locator(".mrg-cmp-r.is-red .mrg-cmp-tag").first().isVisible()).toBe(true);
        expect(await page.locator(".mrg-cmp-h").isVisible()).toBe(false);
        const [人, 选] = await Promise.all([page.locator(".mrg-ppl-b").first().boundingBox(), page.locator(".mrg-ppl-sel").first().boundingBox()]);
        expect(选!.y).toBeGreaterThan(人!.y + 人!.height - 1);
        await 截图(page, "合并-预览-390.png");
      } else {
        expect(Math.abs(b2!.y - a!.y)).toBeLessThanOrEqual(1);
        expect(b2!.x).toBeGreaterThan(a!.x + a!.width - 1);
      }
      expect(错).toEqual([]);
    } finally { await page.close(); }
  }
}, 120_000);

it("暗色：标红那几行的底和字跟 token 走，不是写死的浅色", async () => {
  const { page } = await open(1280, { 种: "客户" }, {}, true);
  try {
    await 到预览(page);
    const 色 = await page.evaluate(() => {
      const 探 = (v: string, p: string) => { const d = document.createElement("div"); d.style.setProperty(p, `var(${v})`); document.body.appendChild(d); const x = getComputedStyle(d).getPropertyValue(p); d.remove(); return x; };
      const r = document.querySelector(".mrg-cmp-r.is-red")!;
      return { 底: [getComputedStyle(r).backgroundColor, 探("--danger-bg", "background-color")], 字: [getComputedStyle(r.querySelector(".mrg-cmp-b")!).color, 探("--danger-text", "color")] };
    });
    expect(色.底[0]).toBe(色.底[1]);
    expect(色.字[0]).toBe(色.字[1]);
    expect(色.底[0]).not.toBe("rgb(254, 242, 242)");
    await 截图(page, "合并-预览-暗.png");
  } finally { await page.close(); }
}, 60_000);

it("和另一位合成：挑另一位、定留谁 → 合成两位联系人(留, 并)；成了撤销条写 30 天内可撤回", async () => {
  const 人 = (id: string, name: string) => ({ id, name, 职务: null, 关键: false, 号: null });
  const { page, 错 } = await open(390, { 种: "联系人", 留: 人("c1", "张三"), 们: [人("c1", "张三"), 人("c2", "张 三"), 人("c3", "李四".repeat(15))] });
  try {
    const 钮 = page.getByTestId("contact-merge-go");
    await 钮.waitFor();
    expect(await 钮.isDisabled()).toBe(true);
    await page.getByText("张 三", { exact: true }).click();
    await page.getByText("留下「张 三」").click();
    expect(await page.locator(".mrg-out").innerText()).toContain("「张三」进回收站；30 天内可在「历史变更」里整单撤回");
    expect(await 横滚(page)).toEqual([false, false]);
    await 钮.click();
    await page.locator(".undo-bar").waitFor();
    expect(await page.locator(".undo-t").innerText()).toBe("已把「张三」合成进「张 三」，30 天内可在「历史变更」里整单撤回");
    expect((await 调(page)).find((x) => x[0] === "合成")).toEqual(["合成", "c2", "c1"]);
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("项目换客户：搜目标 → 预览列明订单阶段、回款几笔、几条沟通、几位项目联系人挂靠过去 → 后果框 → 换；撤销 = 撤销换客户（按这次日志反着做，不是再换一次）", async () => {
  const { page, 错 } = await open(1280, { 种: "项目", projectId: "p1", 名: "超长的项目名称".repeat(6) }, { __换预览: { 能换: true, 原因: [], 条数: { 沟通: 4, 回款: 3, 订单: true, 联系人: 2 } } });
  try {
    await page.getByLabel("搜客户").fill("测试");
    await page.getByTestId("merge-candidate").first().click();
    const 单 = page.getByTestId("move-list");
    await 单.waitFor();
    const 话 = await 单.innerText();
    expect(话).toContain("这是订单阶段的项目");
    expect(话).toContain("3 笔回款跟着项目走");
    expect(话).toContain("4 条沟通挪到");
    expect(话).toContain("2 位项目联系人挂靠到");
    expect(await 横滚(page)).toEqual([false, false]);
    await page.getByTestId("move-go").click();
    const 框 = page.locator(".csq");
    await 框.waitFor();
    expect(await 框.innerText()).toContain("换完 8 秒内可撤销；过后不单独撤回，换错了再换回来");
    await 框.getByRole("button", { name: "换客户" }).click();
    await page.locator(".undo-bar").waitFor();
    expect((await 调(page)).find((x) => x[0] === "换")).toEqual(["换", "p1", "b"]);
    await page.locator(".undo-btn").last().click();
    await page.waitForFunction(() => ((window as unknown as { __调?: unknown[][] }).__调 ?? []).some((x) => x[0] === "撤销换"));
    expect((await 调(page)).find((x) => x[0] === "撤销换")).toEqual(["撤销换", "L1"]);
    expect((await 调(page)).filter((x) => x[0] === "换")).toHaveLength(1);
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("搜不到：不是系统管理员写明只列自己负责、不在公海的、要并同事的找系统管理员；系统管理员照旧，后果框也不补谁能撤", async () => {
  const { page, 错 } = await open(390, { 种: "客户" }, { __候选: [] });
  try {
    await page.getByLabel("搜客户").fill("没有的");
    const 空 = page.getByTestId("merge-cand-empty");
    await 空.waitFor();
    expect(await 空.innerText()).toBe("只列你负责、不在公海的客户；要并同事的客户请找系统管理员");
    expect(await 横滚(page)).toEqual([false, false]);
    expect(错).toEqual([]);
  } finally { await page.close(); }
  const 管 = await open(1280, { 种: "客户" }, { __候选: [], __管: true });
  try {
    await 管.page.getByLabel("搜客户").fill("没有的");
    const 空 = 管.page.getByTestId("merge-cand-empty");
    await 空.waitFor();
    expect(await 空.innerText()).toBe("没搜到能选的客户");
    await 管.page.evaluate((c) => Object.assign(window, { __候选: c }), [{ id: "b", name: "乙", 编号: "NO.00012", 负责人: "QA" }]);
    await 管.page.getByLabel("搜客户").fill("乙");
    await 管.page.getByTestId("merge-candidate").first().click();
    await 管.page.getByTestId("merge-check").getByText("已核对，按留下那家的来源和创建人").click();
    await 管.page.getByTestId("merge-go").click();
    const 框 = 管.page.locator(".csq");
    await 框.waitFor();
    const 话 = await 框.innerText();
    expect(话).toContain("30 天内可在「历史变更」里整单撤回");
    expect(话).not.toContain("否则找系统管理员");
    expect(管.错).toEqual([]);
  } finally { await 管.page.close(); }
}, 60_000);

it("手机 390：联系人配对下拉打开后，长「名字 · 职务」不撑出屏（下拉限宽、选项一行省略、悬停看全）", async () => {
  const 长人 = { id: "a3", name: "欧阳".repeat(10), position: "超长的职务名称用来撑宽下拉".repeat(4), 关键: false, 号: [] };
  const p = 预览();
  const { page, 错 } = await open(390, { 种: "客户" }, { __预览: { ...p, 联系人们: { ...p.联系人们, 留下: [...p.联系人们.留下, 长人] } } });
  try {
    await 到预览(page);
    await page.locator(".mrg-ppl-sel").nth(1).click();
    const 下拉 = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
    await 下拉.waitFor();
    const 长项 = 下拉.locator(".ant-select-item-option").filter({ hasText: "欧阳" });
    await 长项.waitFor();
    const 量 = await page.evaluate(() => {
      const d = document.querySelector(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")!.getBoundingClientRect();
      return { 页: document.documentElement.scrollWidth, 视: innerWidth, 左: d.left, 右: d.right };
    });
    expect(量.页).toBeLessThanOrEqual(量.视);
    expect(量.左).toBeGreaterThanOrEqual(0);
    expect(量.右).toBeLessThanOrEqual(量.视);
    const 字 = 长项.locator(".ant-select-item-option-content");
    expect(await 字.evaluate((e) => [getComputedStyle(e).textOverflow, e.scrollWidth > e.clientWidth])).toEqual(["ellipsis", true]);
    expect(await 长项.getAttribute("title")).toContain("超长的职务名称");
    await 截图(page, "合并-配对下拉-390.png");
    expect(错).toEqual([]);
  } finally { await page.close(); }
}, 60_000);
