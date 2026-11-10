/**
 * 主渠道表露出并能改「负责人」「渠道属性（获客方式）」（11-10，P-渠道-10 / P-渠道-11，迁移 118）。
 *
 *   表头多两列：负责人、渠道属性；没填的写「—」
 *   行上「编辑」弹窗里能选负责人、渠道属性，保存时交 ownerId / attr；清掉交 null
 *   拨开关不带这两样（服务端 不交 = 不动，不会被冲掉）
 *   1024 / 1280 / 1366 宽：超长主渠道名、超长人名、超长属性一行省略，弹窗不出视口、表格不横滚、页面不横滚
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "main-channel-owner-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},replace(){},prefetch(){}});");
  stub(/^\.\/actions$/, "export const saveMainChannel=async x=>{(window.__存=window.__存||[]).push(x);return{ok:true}},toggleMainChannel=async()=>({ok:true});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

const 长名 = "某某超长主渠道名".repeat(5);
const 长人 = "名字特别特别长的一位同事".repeat(3);
const 长属性 = "某某超长的渠道属性".repeat(4);
const users = [
  { id: "u1", name: "运营甲", email: "a@x" },
  { id: "u2", name: "运营乙", email: "b@x" },
  { id: "u3", name: 长人, email: "c@x" },
];
const 主渠道们 = [
  { id: "m1", name: "百度", allowSub: true, selfDev: false, category: "三方平台", active: true, sort: 1, ownerId: "u1", ownerName: "运营甲", attr: "公域引流" },
  { id: "m2", name: "没人管的主渠道", allowSub: true, selfDev: false, category: null, active: true, sort: 2, ownerId: null, ownerName: null, attr: null },
  { id: "m3", name: 长名, allowSub: true, selfDev: true, category: "三方平台", active: false, sort: 3, ownerId: "u3", ownerName: 长人, attr: 长属性 },
];

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import MainChannels from '@/app/(app)/channels/MainChannels';
    const root=createRoot(document.getElementById('root'));
    window.__render=(行,users)=>root.render(<ConfigProvider locale={zhCN}><App><MainChannels 主渠道们={行} users={users} 属性选项={['公域引流','主动自拓']} 子渠道数={new Map()} onClose={()=>{}}/></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://src.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://src.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(([x, u]) => (window as unknown as { __render: (x: unknown, u: unknown) => void }).__render(x, u), [主渠道们, users] as const);
  await page.locator(".ant-table-tbody tr.ant-table-row").first().waitFor();
  return { page, errors };
}
const 行 = (page: Page, 名: string) => page.locator(".ant-table-tbody tr.ant-table-row", { hasText: 名 }).first();
/** 弹窗开场动画放完（antd 放完会再落一次焦点，这之前点开的下拉会被抢焦点关掉；人手没这么快，只有测试要等） */
const 开完 = (弹窗: ReturnType<Page["locator"]>) => 弹窗.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => null))).then(() => new Promise((r) => setTimeout(r, 150))));
async function 选(page: Page, 弹窗: ReturnType<Page["locator"]>, 项: string, 值: string) {
  await 弹窗.locator(".ant-form-item", { hasText: 项 }).locator(".ant-select").click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: 值 }).first().click();
}
const 存的 = (page: Page) => page.evaluate(() => (window as unknown as { __存?: Record<string, unknown>[] }).__存 ?? []);

it("主渠道表有「负责人」「渠道属性」两列；填了的显示名字和属性，没填的写「—」", async () => {
  const { page, errors } = await open();
  try {
    const 表头 = (await page.locator(".ant-table-thead th").allInnerTexts()).map((t) => t.trim());
    const [人列, 属性列] = [表头.indexOf("负责人"), 表头.indexOf("渠道属性")];
    expect(人列).toBeGreaterThan(0);
    expect(属性列).toBeGreaterThan(0);
    expect(await 行(page, "百度").locator("td").nth(人列).innerText()).toBe("运营甲");
    expect(await 行(page, "百度").locator("td").nth(属性列).innerText()).toBe("公域引流");
    expect(await 行(page, "没人管的主渠道").locator("td").nth(人列).innerText()).toBe("—");
    expect(await 行(page, "没人管的主渠道").locator("td").nth(属性列).innerText()).toBe("—");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("「编辑」弹窗里选负责人、渠道属性，保存交 ownerId / attr；清掉交 null；拨开关不带这两样", async () => {
  const { page, errors } = await open();
  try {
    await 行(page, "没人管的主渠道").getByRole("button", { name: "编辑" }).click();
    const 弹窗 = page.locator(".ant-modal").filter({ hasText: "编辑：没人管的主渠道" });
    await 弹窗.waitFor();
    await 开完(弹窗);
    await 选(page, 弹窗, "负责人", "运营乙");
    await 选(page, 弹窗, "渠道属性", "主动自拓");
    await 弹窗.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(async () => (await 存的(page)).length).toBe(1);
    expect((await 存的(page))[0]).toMatchObject({ id: "m2", name: "没人管的主渠道", ownerId: "u2", attr: "主动自拓" });

    // 清掉：原来有负责人、属性的，清空后交 null
    await 行(page, "百度").getByRole("button", { name: "编辑" }).click();
    const 弹窗2 = page.locator(".ant-modal").filter({ hasText: "编辑：百度" });
    await 弹窗2.waitFor();
    await 开完(弹窗2);
    for (const 名 of ["负责人", "渠道属性"]) {
      const 框 = 弹窗2.locator(".ant-form-item", { hasText: 名 }).locator(".ant-select");
      await 框.hover();
      await 框.locator(".ant-select-clear").click();
    }
    await 弹窗2.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(async () => (await 存的(page)).length).toBe(2);
    expect((await 存的(page))[1]).toMatchObject({ id: "m1", ownerId: null, attr: null });

    // 拨开关：不带 ownerId / attr 两个键（服务端 不交 = 不动）
    await page.getByRole("switch", { name: "百度 支持自拓" }).click();
    await expect.poll(async () => (await 存的(page)).length).toBe(3);
    const 开关 = (await 存的(page))[2];
    expect(开关).toMatchObject({ id: "m1", selfDev: true });
    expect("ownerId" in 开关 || "attr" in 开关).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const width of [1024, 1280, 1366]) {
  it(`超长主渠道名 / 人名 / 属性一行省略，弹窗不出视口、表格和页面不横滚；编辑弹窗也不出视口（${width} 宽）`, async () => {
    const { page, errors } = await open(width);
    try {
      for (const t of [长名, 长人, 长属性]) {
        const 格 = page.locator(`.ant-table-tbody span[title="${t}"]`);
        expect(await 格.count()).toBe(1);
        expect(await 格.evaluate((el) => ({ 一行: el.getBoundingClientRect().height < 30, 省略: el.scrollWidth > el.clientWidth }))).toEqual({ 一行: true, 省略: true });
      }
      const 在视口里 = async (sel: ReturnType<Page["locator"]>) => { const b = await sel.boundingBox(); return !!b && b.x >= 0 && b.x + b.width <= width; };
      expect(await 在视口里(page.locator(".ant-modal").first())).toBe(true);
      expect(await page.locator(".ant-table-body").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      // 「已停用」标签、行尾两个按钮没被长名字挤出格子
      const 长行 = 行(page, 长名);
      const 行框 = (await 长行.boundingBox())!;
      for (const 件 of [长行.locator(".ant-tag", { hasText: "已停用" }), 长行.getByRole("button", { name: "编辑" }), 长行.getByRole("button", { name: "启用" })]) {
        const b = (await 件.boundingBox())!;
        expect(b.x >= 行框.x && b.x + b.width <= 行框.x + 行框.width + 1).toBe(true);
      }
      await 长行.getByRole("button", { name: "编辑" }).click();
      const 编辑窗 = page.locator(".ant-modal").filter({ hasText: "编辑：" });
      await 编辑窗.waitFor();
      expect(await 在视口里(编辑窗)).toBe(true);
      // 选着的超长人名、超长属性不把下拉框撑出弹窗
      const 窗框 = (await 编辑窗.boundingBox())!;
      for (const 框 of await 编辑窗.locator(".ant-select").all()) {
        const b = (await 框.boundingBox())!;
        expect(b.x >= 窗框.x && b.x + b.width <= 窗框.x + 窗框.width).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}
