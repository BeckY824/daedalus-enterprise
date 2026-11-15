/**
 * 首页输入框观感（前端改版逐块确认 home.hero / home.ask）：
 *   示例飞进输入框：克隆从原处飞到框里（aria-hidden、点不到），飞完拆掉、原来那颗重新显出来；减弱动态不飞
 *   拖文件进框：框亮起、说「松开即带上文件」；松开把文件交给同一个加文件函数；没给加文件函数（不支持附件的入口）不亮
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React, {useState} from 'react';import {createRoot} from 'react-dom/client';
    import AskBox from '@/components/AskBox';
    import {飞进去} from '@/app/(app)/dashboard/home-look';
    import {现状动效} from '@/lib/motion';
    window.__飞=(少动)=>飞进去(document.getElementById('q'),document.querySelector('textarea'),现状动效,少动);
    function 框({能拖}){const [v,setV]=useState('');const [收,set收]=useState('');
      return <div style={{padding:80}}><button id="q" className="cli-q">今天该跟谁</button>
        <AskBox value={v} onChange={setV} onSubmit={()=>{}} placeholder="问一句" 栏左={<span>左</span>} on拖文件={能拖?(f)=>set收(f.name):undefined}/>
        <div id="got">{收}</div></div>;}
    window.__画=(能拖)=>createRoot(document.getElementById('root')).render(<框 能拖={能拖}/>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(能拖 = true): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.setContent("<meta charset='utf-8'><div id='root'></div>"); await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (x: boolean) => void }).__画(x), 能拖);
  await page.getByRole("textbox").waitFor();
  return { page, errors };
}

async function 拖(page: Page, 种类: string[]) {
  await page.evaluate((evs) => {
    const box = document.querySelector("textarea")!.parentElement!;
    const dt = new DataTransfer(); dt.items.add(new File(["a,b"], "名单.csv", { type: "text/csv" }));
    for (const t of evs) box.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, 种类);
}

it("示例飞进输入框：飞的时候有一个 aria-hidden 的克隆，飞完拆掉、原来那颗显回来", async () => {
  const { page, errors } = await 打开();
  const 飞 = page.evaluate(() => (window as unknown as { __飞: (s: boolean) => Promise<void> }).__飞(false));
  await page.waitForFunction(() => document.querySelectorAll(".cli-q-fly[aria-hidden='true']").length === 1);
  expect(await page.locator("#q").evaluate((el) => el.style.visibility)).toBe("hidden");
  await 飞;
  expect(await page.locator(".cli-q-fly").count()).toBe(0);
  expect(await page.locator("#q").evaluate((el) => el.style.visibility)).toBe("");
  await page.evaluate(() => (window as unknown as { __飞: (s: boolean) => Promise<void> }).__飞(true));
  expect(await page.locator(".cli-q-fly").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

it("拖文件进框：亮起、说松开即带上；松开交给加文件函数，框恢复", async () => {
  const { page, errors } = await 打开();
  await 拖(page, ["dragenter", "dragover"]);
  expect(await page.getByText("松开即带上文件").count()).toBe(1);
  expect(await page.locator("textarea").evaluate((el) => el.parentElement!.classList.contains("is-drop"))).toBe(true);
  await 拖(page, ["drop"]);
  expect(await page.locator("#got").innerText()).toBe("名单.csv");
  expect(await page.getByText("松开即带上文件").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

it("不支持附件的入口（没给加文件函数）：拖进来不亮", async () => {
  const { page } = await 打开(false);
  await 拖(page, ["dragenter", "dragover"]);
  expect(await page.getByText("松开即带上文件").count()).toBe(0);
  await page.close();
});
