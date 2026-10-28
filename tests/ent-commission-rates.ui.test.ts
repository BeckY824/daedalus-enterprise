/**
 * 设置 → 提成比例：内贸 / 外贸 / 不限三行（10-27 会议，服务端规则见 enterprise-commission.test.ts）。
 *
 *   三行各有底价、溢价两个输入；说明里写按负责人的业务线取、两边都做的用不限
 *   只改内贸一格，保存交上去的是完整三套，外贸和不限原样
 *   不能改的人：输入全灰、没有保存
 *   Windows 1024 / 1280 / 1366：卡片不横向撑出，保存点得中
 * 开关关闭时页面传 提成比例=null，卡片不出（ent-blocker-no-deadline.ui.test.ts 等传的就是 null）。
 *
 * 10-28 按人设置（服务端规则见 enterprise-commission-per-user.test.ts）：
 *   每个销售一行两个输入，单设过的有值，没设的空着、灰字是他业务线那一套
 *   只交改了的人；清空 = 交 null（跟业务线）
 *   不能改的人：输入全灰、没有保存
 *   名字很长：省略号，不把行撑出；1024 / 1280 不横向撑出，保存点得中
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "rates-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/blocker-actions$/, `export const 存卡点默认Action=${空跑};`);
  stub(/\/projects\/actions$|\/ent-dict-actions$|\/commission-actions$/, `const f=${空跑};export const 加组员角色=f,改组员角色=f,加项目异常类别=f,改项目异常类别=f,改组织规则=f,预览超时回收=async()=>({ok:true,项目:[]}),改提成比例=async x=>{window.__存=x;return{ok:true,变了:true}},改按人提成比例=async x=>{window.__按人=x;return{ok:true,变了:true}},加企业选项=f,改企业选项=f,存分配谁能用=f;`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import Settings from '@/app/(app)/settings/ProjectSettingsTab';import {默认卡点默认} from '@/lib/project/blocker-rules';
    const root=createRoot(document.getElementById('root'));
    const 比例={内贸:{底价比例:2,溢价比例:30},外贸:{底价比例:3,溢价比例:40},不限:{底价比例:2,溢价比例:30}};
    const 长名='欧阳超级无敌长名字销售同学（华东大区第三组）zhangsan.very.long.email@example.com';
    const 按人提成={人们:[{id:'u1',name:'张三',范围:'内贸'},{id:'u2',name:长名,范围:'外贸'},{id:'u3',name:'李四',范围:'不限'}],比例:{u1:{底价比例:5}}};
    window.__render=({能改,宽,按人})=>root.render(<App><div style={{maxWidth:宽,padding:16}}><Settings 成员={[]} value={{角色们:[],类别们:[],组织规则:null,持有:{},企业选项:null,卡点默认:默认卡点默认,提成比例:比例,能改提成比例:能改,按人提成:按人?按人提成:null,挡:{字典:null,持有上限:null,节点时限:null,必填字段:null,阶段规则:null}}}/></div></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(能改: boolean, width = 1366, 宽: number | string = "none", 按人 = false) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://rates.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://rates.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(x => (window as unknown as { __render: (x: unknown) => void }).__render(x), { 能改, 宽, 按人 });
  const 卡 = page.locator(".ant-card").filter({ hasText: "提成比例" }).filter({ hasText: "不限" }).filter({ hasNotText: "按人设置" });
  await 卡.waitFor();
  const 按人卡 = page.locator(".ant-card").filter({ hasText: "提成比例 · 按人设置" });
  return { page, errors, 卡, 按人卡 };
}
const 套 = ["内贸", "外贸", "不限"];

it("三行各两个输入，值对得上；说明写了按负责人业务线、两边都做用不限", async () => {
  const { page, errors, 卡 } = await open(true);
  try {
    for (const k of 套) for (const x of ["底价", "溢价"]) expect(await 卡.getByLabel(`${k} ${x}提成比例`).count()).toBe(1);
    expect(await 卡.getByLabel("外贸 溢价提成比例").inputValue()).toBe("40.00");
    const t = await 卡.innerText();
    expect(t).toContain("按项目负责人的业务线");
    expect(t).toContain("两边都做或没设业务线的用「不限」");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("只改内贸底价：保存交上去的是完整三套，外贸、不限原样", async () => {
  const { page, errors, 卡 } = await open(true);
  try {
    const 存 = 卡.getByRole("button", { name: /保\s*存/ });
    expect(await 存.isDisabled()).toBe(true);
    const 格 = 卡.getByLabel("内贸 底价提成比例");
    await 格.fill("1.5"); await 格.blur();
    expect(await 存.isDisabled()).toBe(false);
    await 存.click();
    await page.waitForFunction(() => Reflect.get(window, "__存"));
    expect(await page.evaluate(() => Reflect.get(window, "__存"))).toEqual({
      内贸: { 底价比例: 1.5, 溢价比例: 30 }, 外贸: { 底价比例: 3, 溢价比例: 40 }, 不限: { 底价比例: 2, 溢价比例: 30 },
    });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("清空一格：提示是哪一套，保存灰掉", async () => {
  const { page, 卡 } = await open(true);
  try {
    const 格 = 卡.getByLabel("外贸 溢价提成比例");
    await 格.fill(""); await 格.blur();
    expect(await 卡.innerText()).toMatch(/外贸：/);
    expect(await 卡.getByRole("button", { name: /保\s*存/ }).isDisabled()).toBe(true);
  } finally { await page.close(); }
});

it("不能改的人：六格全灰，没有保存，写着谁能改", async () => {
  const { page, 卡 } = await open(false);
  try {
    expect(await 卡.locator("input:disabled").count()).toBe(6);
    expect(await 卡.getByRole("button", { name: /保\s*存/ }).count()).toBe(0);
    expect(await 卡.innerText()).toContain("只有老板、总管理员能改");
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：卡片不横向撑出（含 640 窄栏），保存点得中", async (w) => {
  for (const 宽 of ["none", 640]) {
    const { page, 卡 } = await open(true, w, 宽);
    try {
      const 格 = 卡.getByLabel("不限 溢价提成比例");
      await 格.fill("31"); await 格.blur();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await 卡.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      const btn = 卡.getByRole("button", { name: /保\s*存/ });
      await btn.scrollIntoViewIfNeeded();
      const box = (await btn.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(w);
      const 点中 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box.x + box.width / 2, box.y + box.height / 2]);
      expect(点中).toBe(await btn.textContent());
    } finally { await page.close(); }
  }
});

it("没给按人数据（开关关闭 / 不是企业版）：按人设置卡不出", async () => {
  const { page, 按人卡 } = await open(true);
  try { expect(await 按人卡.count()).toBe(0); } finally { await page.close(); }
});

it("按人设置：每人一行两个输入；单设过的有值，没设的空着、灰字是他业务线那一套", async () => {
  const { page, errors, 按人卡 } = await open(true, 1366, "none", true);
  try {
    await 按人卡.waitFor();
    expect(await 按人卡.locator("input").count()).toBe(6);
    expect(await 按人卡.getByLabel("张三 底价提成比例").inputValue()).toBe("5.00");
    expect(await 按人卡.getByLabel("张三 溢价提成比例").inputValue()).toBe("");
    expect(await 按人卡.getByLabel("张三 溢价提成比例").getAttribute("placeholder")).toBe("30");
    expect(await 按人卡.getByLabel("李四 底价提成比例").getAttribute("placeholder")).toBe("2");
    const t = await 按人卡.innerText();
    expect(t).toContain("比上面按业务线的那一套优先");
    expect(t).toContain("留空跟外贸");
    expect(t).toContain("已单设 1 人");
    expect(await 按人卡.getByRole("button", { name: /保\s*存/ }).isDisabled()).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("按人设置：只交改了的人；清空交 null（跟业务线）", async () => {
  const { page, errors, 按人卡 } = await open(true, 1366, "none", true);
  try {
    await 按人卡.waitFor();
    const 李四溢价 = 按人卡.getByLabel("李四 溢价提成比例");
    await 李四溢价.fill("35"); await 李四溢价.blur();
    const 张三底价 = 按人卡.getByLabel("张三 底价提成比例");
    await 张三底价.fill(""); await 张三底价.blur();
    const 存 = 按人卡.getByRole("button", { name: /保\s*存/ });
    expect(await 存.isDisabled()).toBe(false);
    await 存.click();
    await page.waitForFunction(() => Reflect.get(window, "__按人"));
    expect(await page.evaluate(() => Reflect.get(window, "__按人"))).toEqual({
      u1: { 底价比例: null, 溢价比例: null }, u3: { 底价比例: null, 溢价比例: 35 },
    });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("按人设置：不能改的人六格全灰、没有保存", async () => {
  const { page, 按人卡 } = await open(false, 1366, "none", true);
  try {
    await 按人卡.waitFor();
    expect(await 按人卡.locator("input:disabled").count()).toBe(6);
    expect(await 按人卡.getByRole("button", { name: /保\s*存/ }).count()).toBe(0);
    expect(await 按人卡.innerText()).toContain("只有老板、总管理员能改");
  } finally { await page.close(); }
});

it.each([1024, 1280])("按人设置 Windows %ipx（含 640 窄栏）：长名字省略不撑出，保存点得中", async (w) => {
  for (const 宽 of ["none", 640]) {
    const { page, 按人卡 } = await open(true, w, 宽, true);
    try {
      await 按人卡.waitFor();
      const 格 = 按人卡.getByLabel("张三 溢价提成比例");
      await 格.fill("31"); await 格.blur();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await 按人卡.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      const 名 = 按人卡.locator("span[title^='欧阳超级无敌长名字']");
      expect(await 名.evaluate(el => el.getBoundingClientRect().width <= 160 && el.scrollWidth > el.clientWidth)).toBe(true);
      const btn = 按人卡.getByRole("button", { name: /保\s*存/ });
      await btn.scrollIntoViewIfNeeded();
      const box = (await btn.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(w);
      const 点中 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box.x + box.width / 2, box.y + box.height / 2]);
      expect(点中).toBe(await btn.textContent());
    } finally { await page.close(); }
  }
});
