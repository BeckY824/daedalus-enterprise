/**
 * 外壳与其余页：顶部提示换成原处反馈（原型 g.save / g.notice「改后」：状态在原处变，不弹顶部提示；错误照样看得见）。
 *
 *   收藏星（FavoriteStar）：没存上 → 星退回去，原因浮在星正上方（role=alert），不弹顶部提示
 *   问答框选文件（AskFiles）：读不了 → 文件签那一排出一枚红签写原因，✕ 收掉；读成了不出
 *   面板历史（DockThreads）：翻不出 / 那条对话已经不在 → 原因写在下拉第一行，下拉不关
 *   复制（lib/clipboard useCopy）：成了 / 不成的那句浮在刚点的那颗键正上方（status / alert），1024 宽不横向溢出
 *   保存键（SaveButton）没存上：原因浮在键上方，那 4 秒里弹框照样按 Esc 关得掉（原来强制打开的 Tooltip 占住了 Esc）
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-fill-a-inline-notice", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/dashboard\/threads$/, "export const 列对话=async()=>{if(window.__翻不出)throw new Error('x');return [{id:'t1',title:'问过的一条',lastAskedAt:new Date().toISOString()}]};export const 读对话=async()=>null;");
  stub(/lib\/thread-history$/, "export const 载入历史=()=>{};");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {App, Modal} from 'antd';
    import SaveButton from '@/components/SaveButton';
    import FavoriteStar from '@/components/FavoriteStar';
    import AskFiles from '@/components/AskFiles';
    import DockThreads from '@/components/DockThreads';
    import {useCopy} from '@/lib/clipboard';
    function 拷键(){const 拷=useCopy();return <button type="button" style={{marginLeft:900}} onClick={()=>拷('华东展具','已复制电话')}>复制电话</button>}
    function 文件(){const [f,setF]=useState([]);return <div className="cli-tools"><AskFiles files={f} onChange={setF}/></div>}
    function 框(){const [开,set开]=useState(true);window.__框开=开;return <Modal open={开} title="编辑资料" onCancel={()=>set开(false)} footer={<SaveButton 做={async()=>({ok:false,error:'名额已满，先退回几个再保存这一位客户的资料'})}/>}>内容</Modal>}
    window.__框=()=>createRoot(document.getElementById('root2')).render(<App><框/></App>);
    window.__画=()=>createRoot(document.getElementById('root')).render(<App>
      <div style={{padding:80}}>
        <FavoriteStar 初值={false} 切换={async()=>window.__星不行?{ok:false,error:'收藏夹满了，先拿掉几位'}:{ok:true,收藏了:true}}/>
        <文件/>
        <div className="dock-head"><DockThreads scope="customers"/></div>
        <拷键/>
      </div>
    </App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(o: { width?: number; init?: string } = {}): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: o.width ?? 1280, height: 700 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  if (o.init) await page.addInitScript(o.init);
  // localhost 才是安全上下文；clipboard 用桩
  await page.route("http://localhost:9/**", r => r.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset='utf-8'><div id='root'></div><div id='root2'></div>" }));
  await page.goto("http://localhost:9/customers");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as { __画: () => void }).__画());
  await page.getByRole("button", { name: "收藏到左栏" }).waitFor();
  return { page, errors };
}
const 无顶部提示 = async (page: Page) => expect(await page.locator(".ant-message-notice").count()).toBe(0);

it("收藏星没存上：星退回去，原因浮在星上方（alert），不弹顶部提示", async () => {
  const { page, errors } = await 打开({ init: "window.__星不行=true" });
  const 星 = page.getByRole("button", { name: "收藏到左栏" });
  await 星.click();
  const 因 = page.getByRole("alert").filter({ hasText: "收藏夹满了，先拿掉几位" });
  await 因.waitFor();
  expect(await 星.getAttribute("aria-pressed")).toBe("false");
  // 浮在星的正上方
  const [框星, 框因] = await Promise.all([星.boundingBox(), 因.boundingBox()]);
  expect(框因!.y + 框因!.height).toBeLessThanOrEqual(框星!.y + 1);
  await 无顶部提示(page);
  expect(errors).toEqual([]);
  await page.close();
});

it("选的文件读不了：红签写原因、✕ 收掉；读成了出文件签", async () => {
  const { page, errors } = await 打开();
  const 选 = page.locator("input[type=file]");
  await 选.setInputFiles({ name: "照片.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  const 红签 = page.locator(".cli-file-bad[role=alert]");
  await 红签.waitFor();
  expect((await 红签.innerText()).length).toBeGreaterThan(0);
  await 无顶部提示(page);
  await 红签.getByRole("button", { name: "知道了" }).click();
  await expect.poll(() => 红签.count()).toBe(0);
  await 选.setInputFiles({ name: "纪要.txt", mimeType: "text/plain", buffer: Buffer.from("下周三再约") });
  await page.getByRole("button", { name: "移除 纪要.txt" }).waitFor();
  expect(await 红签.count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

it("面板历史：那条对话已经不在 → 原因写在下拉第一行、那条拿掉、下拉不关；翻不出也写在下拉里", async () => {
  const { page, errors } = await 打开();
  await page.getByRole("button", { name: "这一页的历史对话" }).click();
  await page.getByText("问过的一条").click();
  const 因 = page.getByRole("alert").filter({ hasText: "这条对话已经不在了" });
  await 因.waitFor();
  expect(await page.getByText("问过的一条").count()).toBe(0);
  await 无顶部提示(page);
  await page.close();

  const b = await 打开({ init: "window.__翻不出=true" });
  await b.page.getByRole("button", { name: "这一页的历史对话" }).click();
  await b.page.getByRole("alert").filter({ hasText: "翻不出这一页的历史" }).waitFor();
  await 无顶部提示(b.page);
  expect([...errors, ...b.errors]).toEqual([]);
  await b.page.close();
});

it("复制：那句浮在刚点的键正上方；不成用 alert；1024 宽不横向溢出", async () => {
  for (const 成 of [true, false]) {
    const init = 成
      ? "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}})"
      : "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('拒绝')}}});document.execCommand=()=>false";
    const { page, errors } = await 打开({ width: 1024, init });
    const 键 = page.getByRole("button", { name: "复制电话" });
    await 键.click();
    const 话 = page.getByRole(成 ? "status" : "alert").filter({ hasText: 成 ? "已复制电话" : "复制不了，请手动选中复制" });
    await 话.waitFor();
    const [框键, 框话] = await Promise.all([键.boundingBox(), 话.boundingBox()]);
    expect(框话!.y + 框话!.height).toBeLessThanOrEqual(框键!.y + 1);
    expect(Math.abs(框话!.x + 框话!.width / 2 - (框键!.x + 框键!.width / 2))).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await 无顶部提示(page);
    // 自己收
    await expect.poll(() => 话.count(), { timeout: 6000 }).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }
});

it("保存键没存上：原因浮在键上方、不出窗口；这 4 秒里弹框照样按 Esc 关得掉", async () => {
  const { page, errors } = await 打开();
  await page.evaluate(() => (window as unknown as { __框: () => void }).__框());
  const 框 = page.getByRole("dialog", { name: "编辑资料" });
  await 框.waitFor();
  await 框.getByRole("button", { name: /^保 ?存$/ }).click();
  const 键 = 框.getByRole("button", { name: "没保存上" });
  await 键.waitFor();
  const 因 = page.getByRole("tooltip").filter({ hasText: "名额已满" });
  await 因.waitFor();
  const [键盒, 因盒] = await Promise.all([键.boundingBox(), 因.boundingBox()]);
  expect(因盒!.y + 因盒!.height).toBeLessThanOrEqual(键盒!.y + 1);
  expect(因盒!.x).toBeGreaterThanOrEqual(8);
  expect(因盒!.x + 因盒!.width).toBeLessThanOrEqual(1280 - 8 + 1);
  expect(await 键.getAttribute("aria-describedby")).toBeTruthy();
  // 还在「没保存上」那 4 秒里：Esc 关框
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __框开: boolean }).__框开)).toBe(false);
  await 框.waitFor({ state: "hidden" });
  await 无顶部提示(page);
  expect(errors).toEqual([]);
  await page.close();
});

it("背调进度文案不带省略号（原型 dt.research「进度文案去省略号」）：components/research 里给人看的字不以「…」收尾", () => {
  const 目录 = path.resolve("src/components/research");
  const 带的: string[] = [];
  for (const f of readdirSync(目录).filter((x) => x.endsWith(".tsx"))) {
    readFileSync(path.join(目录, f), "utf8").split("\n").forEach((行, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(行) || /placeholder=/.test(行)) return;
      if (/…\s*(["'`]|<\/)/.test(行)) 带的.push(`${f}:${i + 1} ${行.trim()}`);
    });
  }
  expect(带的).toEqual([]);
});
