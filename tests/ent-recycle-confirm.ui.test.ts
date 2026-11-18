import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 补全动作桩 } from "./helpers/action-stubs";
/* PR10a ②：设置 →「客户回收」（客户三态）。
   原来关开关一点就存、改天数点保存就存（当晚全员按新天数重算）。现在：
   - 关开关先弹后果确认框（关掉后客户不再自动回收），不确认不存，开关还是开；
   - 开着时改天数先弹确认框（改了哪几项、今晚起对全员重算、约几位客户受影响），不确认不存；数不出来就不写数字；
   - 关着时改天数不重算任何人，一次存完不弹框（能一次做完的不加确认）。
   确认框认 role=dialog 和里面的字，不认 antd 类名。服务端动作换成假的：改组织规则 记下交了什么，预览客户回收 回 window.__预览 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "recycle-confirm", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});");
  stub(/projects\/actions$/, 补全动作桩("src/app/(app)/projects/actions.ts", `
    export const 改组织规则=async(改)=>{(window.__calls??=[]).push(['改组织规则',改]);return {ok:true,收回:0}};
    export const 预览客户回收=async(改)=>{(window.__calls??=[]).push(['预览客户回收',改]);if(window.__预览==='throw')throw new Error('x');return window.__预览};`));
  stub(/customers\/tri-state-actions$/, "export const 三态存占位词=async(词们)=>({ok:true,词们});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import RecycleTab from '@/app/(app)/settings/RecycleTab';import {默认三态规则} from '@/lib/project/org-rules';
    window.__render=(开,超时回收开)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><RecycleTab value={{三态:{...默认三态规则,开},超时回收开,挡:null,占位词:[]}}/></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(开: boolean, 预览: unknown = { ok: true, 预览: { 变: 12, 进公海: 3 } }, width = 1366, 超时回收开 = false): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://recycle.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://recycle.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.evaluate((x) => { (window as unknown as Record<string, unknown>).__预览 = x; }, 预览);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([a, c]) => (window as unknown as { __render: (x: boolean, y: boolean) => void }).__render(a, c), [开, 超时回收开] as const);
  await page.getByRole("switch").waitFor();
  return { page, errors };
}
type 调用 = [string, Record<string, unknown>];
const 调用们 = (page: Page) => page.evaluate(() => (window as unknown as { __calls?: unknown[] }).__calls ?? []) as Promise<调用[]>;
const 存了的 = async (page: Page) => (await 调用们(page)).filter((c) => c[0] === "改组织规则").map((c) => c[1]);
/** antd 两个字的按钮中间插空格：「保 存」 */
const 保存钮 = (page: Page) => page.getByRole("button", { name: /^保\s?存$/ });
const 开关 = (page: Page) => page.getByRole("switch", { name: /客户回收/ });
const 沉睡格 = (page: Page) => page.getByRole("spinbutton", { name: "内贸客户进入沉睡待定的天数" });
async function 改沉睡(page: Page, n: number) {
  await 沉睡格(page).fill(String(n));
  await 沉睡格(page).blur();
}

it("关开关：先弹后果确认框；点「再想想」不存、开关还开着；确认了才存", async () => {
  const { page, errors } = await open(true);
  try {
    await 开关(page).click();
    const 框 = page.getByRole("dialog", { name: "关掉客户回收？" });
    await 框.waitFor();
    expect(await 框.innerText()).toContain("关掉后客户不再自动回收");
    expect(await 框.innerText()).not.toContain("超时回收」开着");
    await 框.getByRole("button", { name: /^取\s?消$/ }).click();
    await 框.waitFor({ state: "detached" });
    expect(await 存了的(page)).toEqual([]);
    expect(await 开关(page).isChecked()).toBe(true);

    await 开关(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "确认关掉" }).click();
    // 成了框就关、不弹顶部提示（开关跟着服务端的值变）
    await page.getByRole("dialog").waitFor({ state: "detached" });
    expect(await 存了的(page)).toEqual([{ 三态: { 开: false } }]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("开开关：确认打开后在页签底部就地照实说「已打开客户回收，已开始计时」，不弹顶部提示", async () => {
  const { page, errors } = await open(false);
  try {
    await 开关(page).click();
    await page.getByRole("dialog", { name: "打开客户回收？" }).getByRole("button", { name: "确认打开" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    expect(await 存了的(page)).toEqual([{ 三态: { 开: true } }]);
    await page.locator(".set-note[role=status]").filter({ hasText: "已打开客户回收，已开始计时" }).waitFor();
    expect(await page.locator(".ant-message").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("关开关时旧「超时回收」开着：确认框里说清会改回按项目超时回收", async () => {
  const { page } = await open(true, undefined, 1366, true);
  try {
    await 开关(page).click();
    const 框 = page.getByRole("dialog", { name: "关掉客户回收？" });
    await 框.waitFor();
    expect(await 框.innerText()).toContain("改回按项目超时回收");
  } finally { await page.close(); }
});

it("开着时改天数：先数会变几位再弹确认框；点「再想想」不存；确认了才存新天数", async () => {
  const { page, errors } = await open(true);
  try {
    await 改沉睡(page, 60);
    await 保存钮(page).click();
    const 框 = page.getByRole("dialog", { name: "改客户回收天数？" });
    await 框.waitFor();
    const 字 = await 框.innerText();
    expect(字).toContain("内贸客户进入沉睡待定：90 → 60 天");
    expect(字).toContain("今晚（北京时间 0 点后）起按新天数对全员重算");
    expect(字).toContain("约 12 位客户的状态会变，其中约 3 位会到期自动进客户公海");
    // 预览交的就是要存的那份
    expect((await 调用们(page)).filter((c) => c[0] === "预览客户回收").map((c) => (c[1].三态 as { 内贸: { 沉睡: number } }).内贸.沉睡)).toEqual([60]);
    await 框.getByRole("button", { name: /^取\s?消$/ }).click();
    await 框.waitFor({ state: "detached" });
    expect(await 存了的(page)).toEqual([]);
    await 保存钮(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "确认修改" }).click();
    // 按钮内反馈（PR9）：保存键里亮「已保存」，不弹顶部提示
    await page.getByRole("button", { name: /已保存/ }).waitFor();
    const [存] = await 存了的(page);
    expect(存).toMatchObject({ 三态: { 内贸: { 沉睡: 60, 待回收: 180, 进公海: 30 }, 外贸: { 沉睡: 90, 待回收: 180, 进公海: 30 } } });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("数不出来（预览出错）：确认框照弹、不写数字；没有客户会变时照实说", async () => {
  const { page } = await open(true, "throw");
  try {
    await 改沉睡(page, 60);
    await 保存钮(page).click();
    const 框 = page.getByRole("dialog", { name: "改客户回收天数？" });
    await 框.waitFor();
    expect(await 框.innerText()).not.toMatch(/约 \d+ 位/);
    expect(await 框.innerText()).not.toContain("没有客户的状态会变");
  } finally { await page.close(); }
  const b = await open(true, { ok: true, 预览: { 变: 0, 进公海: 0 } });
  try {
    await 改沉睡(b.page, 60);
    await 保存钮(b.page).click();
    await b.page.getByRole("dialog", { name: "改客户回收天数？" }).getByText("按现在的数据，没有客户的状态会变。").waitFor();
  } finally { await b.page.close(); }
});

it("预览被服务端挡（没权限）：直接说那句，不弹确认、不存", async () => {
  const { page } = await open(true, { ok: false, error: "客户三态规则只有系统管理员能改" });
  try {
    await 改沉睡(page, 60);
    await 保存钮(page).click();
    await page.getByRole("alert").filter({ hasText: "客户三态规则只有系统管理员能改" }).waitFor();
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await 存了的(page)).toEqual([]);
  } finally { await page.close(); }
});

it("关着时改天数：不重算任何人，一次存完、不弹框、不去数", async () => {
  const { page } = await open(false);
  try {
    await 改沉睡(page, 60);
    await 保存钮(page).click();
    // 按钮内反馈（PR9）：保存键里亮「已保存」，不弹顶部提示
    await page.getByRole("button", { name: /已保存/ }).waitFor();
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect((await 调用们(page)).map((c) => c[0])).toEqual(["改组织规则"]);
  } finally { await page.close(); }
});

it("确认框在 Windows 常见宽度（1024 / 1280 / 1366）不溢出、页面不横滚", async () => {
  for (const w of [1024, 1280, 1366]) {
    const { page } = await open(true, { ok: true, 预览: { 变: 12345, 进公海: 678 } }, w);
    try {
      // 两套六个数全改，确认框里那一句最长
      for (const 格 of await page.getByRole("spinbutton").all()) { await 格.fill("200"); await 格.blur(); }
      await 保存钮(page).click();
      const 框 = page.getByRole("dialog", { name: "改客户回收天数？" });
      await 框.waitFor();
      const r = await 框.evaluate((el) => {
        const b = el.getBoundingClientRect();
        // 框里每个字块都不超出框
        const 超出 = [...el.querySelectorAll("div")].some((d) => d.scrollWidth > d.clientWidth + 1 && getComputedStyle(d).overflowX !== "visible");
        return { 左: b.left, 右: b.right, 底: b.bottom, 超出 };
      });
      expect(r.左).toBeGreaterThanOrEqual(0);
      expect(r.右).toBeLessThanOrEqual(w);
      expect(r.超出).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await 框.getByRole("button", { name: /^取\s?消$/ }).click();
      await 开关(page).click();
      const 关框 = page.getByRole("dialog", { name: "关掉客户回收？" });
      await 关框.waitFor();
      const k = await 关框.evaluate((el) => { const b = el.getBoundingClientRect(); return [b.left, b.right]; });
      expect(k[0]).toBeGreaterThanOrEqual(0);
      expect(k[1]).toBeLessThanOrEqual(w);
    } finally { await page.close(); }
  }
}, 60_000);
