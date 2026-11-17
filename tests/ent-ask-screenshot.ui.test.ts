/**
 * 首页对话框带截图问（2026-11-17）：真浏览器里钉住输入框和附件那几下（识别本身打桩，见 tests/ask-screenshot.test.ts）。
 *
 *   框里 ⌘V / Ctrl+V 粘一张截图（剪贴板里只有图）→ 交给 on粘图、不往框里塞东西；粘字照旧进框、不当图收
 *   回形针选一张图 → 文件签那一排出「正在认图里的字…」（role=status）→ 认完出文件签；认不出 → 红签写原因
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-ask-screenshot", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/lib\/card-scan\/cloud$/, "export const 走网页登录=()=>{};export const 服务器预热=async()=>true;");
  // 认字等一个放行信号，好看到识别中的状态
  stub(/lib\/card-scan\/ocr$/, `export const 切成块=async(f)=>({块们:[f],截了:false});export const 认图里的字=async(f,进)=>{进('正在认图里的字…');await new Promise(r=>{window.__放行=r});
    if(window.__认不出)return [];return [{text:'下周三再约',score:.9,side:0,cx:10,cy:10,w:50,h:20}]};`);
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import AskBox from '@/components/AskBox';
    import AskFiles from '@/components/AskFiles';
    window.__粘的图=[];window.__粘的字=[];
    function 框(){const [q,setQ]=useState('');return <AskBox value={q} onChange={setQ} onSubmit={()=>{}} placeholder="问一句"
      onPaste={e=>window.__粘的字.push(e.clipboardData.getData('text'))} on粘图={f=>window.__粘的图.push(f.name)}/>}
    function 文件(){const [f,setF]=useState([]);window.__文件=f;return <div className="cli-tools"><AskFiles files={f} onChange={setF}/></div>}
    window.__画=()=>createRoot(document.getElementById('root')).render(<div style={{padding:40}}><框/><文件/></div>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://localhost:9/**", r => r.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://localhost:9/dashboard");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as { __画: () => void }).__画());
  await page.getByPlaceholder("问一句").waitFor();
  return { page, errors };
}

/** 在框里发一次 paste：字、图（png）二选一或都带 */
const 粘 = (page: Page, o: { 字?: string; 图?: boolean }) => page.evaluate(({ 字, 图 }) => {
  const dt = new DataTransfer();
  if (字) dt.setData("text/plain", 字);
  if (图) dt.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "image.png", { type: "image/png" }));
  const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
  document.querySelector("textarea")!.dispatchEvent(ev);
  return ev.defaultPrevented;
}, o);

it("粘截图交给 on粘图、拦下默认；粘字（哪怕也带图）照旧走 onPaste、不拦", async () => {
  const { page, errors } = await 打开();
  expect(await 粘(page, { 图: true })).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __粘的图: string[] }).__粘的图)).toEqual(["image.png"]);
  expect(await 粘(page, { 字: "张三\t13800000000", 图: true })).toBe(false);
  expect(await 粘(page, { 字: "一段话" })).toBe(false);
  const w = await page.evaluate(() => ({ 图: (window as unknown as { __粘的图: string[] }).__粘的图, 字: (window as unknown as { __粘的字: string[] }).__粘的字 }));
  expect(w.图).toEqual(["image.png"]);
  expect(w.字).toEqual(["张三\t13800000000", "一段话"]);
  expect(errors).toEqual([]);
  await page.close();
});

it("回形针选图：识别中出状态，认完出文件签；认不出写红签", async () => {
  for (const 认不出 of [false, true]) {
    const { page, errors } = await 打开();
    if (认不出) await page.evaluate(() => { (window as unknown as { __认不出: boolean }).__认不出 = true; });
    expect(await page.locator("input[type=file]").getAttribute("accept")).toContain(".png");
    await page.locator("input[type=file]").setInputFiles({ name: "微信截图.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
    await page.getByRole("status").filter({ hasText: "正在认图里的字" }).waitFor();
    await page.evaluate(() => (window as unknown as { __放行: () => void }).__放行());
    if (认不出) {
      await page.locator(".cli-file-bad[role=alert]").filter({ hasText: "图里没认出文字" }).waitFor();
    } else {
      await page.getByRole("button", { name: "移除 微信截图.png" }).waitFor();
      const 文件 = await page.evaluate(() => (window as unknown as { __文件: { name: string; text: string }[] }).__文件);
      expect(文件[0].text).toContain("下周三再约");
    }
    expect(await page.getByRole("status").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }
});
