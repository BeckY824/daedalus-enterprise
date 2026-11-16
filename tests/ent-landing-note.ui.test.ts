/**
 * 跳到另一页时带过去的一句（lib/landing-note.ts + components/LandingNote.tsx；原型 g.notice「改后」不弹顶部提示）。
 * 第一处用它的：嵌在客户页的项目详情里最后一个我负责的项目走了，回客户列表时说「这位客户下已经没有你负责的项目了」。
 *
 *   落地那页（按路径，不看查询串）在原处写一句（role=status），「知道了」收掉；离开那页也清；别的页不说
 *   整页刷新落地也认（sessionStorage）；30 秒后过期；存储被禁时站内跳转照样靠内存
 *   客户列表接上了它（源码）；项目详情那处不再弹 message
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import LandingNote from '@/components/LandingNote';import {留落地话} from '@/lib/landing-note';
    const root=createRoot(document.getElementById('root'));
    window.__留=留落地话;
    window.__画=(路径)=>root.render(路径?<div><LandingNote 路径={路径}/><p>列表</p></div>:<p>别处</p>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(预存?: string, 禁存储 = false): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1024, height: 700 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://note.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://note.test/customers");
  if (预存) await page.evaluate((v) => sessionStorage.setItem("crm:landing-note", v), 预存);
  if (禁存储) await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("禁"); }; Storage.prototype.getItem = () => { throw new Error("禁"); }; Storage.prototype.removeItem = () => { throw new Error("禁"); }; });
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  return { page, errors };
}
const 调 = (page: Page, 名: string, ...参: unknown[]) => page.evaluate(([n, a]) => (window as unknown as Record<string, (...x: unknown[]) => void>)[n as string](...(a as unknown[])), [名, 参] as const);
const 话 = "这位客户下已经没有你负责的项目了，已回到客户列表";

it("站内跳过去：落地那页原处说一句（status），「知道了」收掉；再回来不说第二遍；别的页不说", async () => {
  const { page, errors } = await 打开();
  await 调(page, "__留", "/customers?pool=1", 话);
  await 调(page, "__画", "/projects");
  await page.getByText("列表", { exact: true }).waitFor();
  expect(await page.getByRole("status").count(), "别的页不说").toBe(0);
  await 调(page, "__画", "/customers");
  const 句 = page.getByRole("status").filter({ hasText: 话 });
  await 句.waitFor();
  await 句.getByRole("button", { name: "知道了" }).click();
  expect(await page.getByRole("status").count()).toBe(0);
  await 调(page, "__画", null);
  await page.getByText("别处").waitFor();
  await 调(page, "__画", "/customers");
  await page.getByText("列表", { exact: true }).waitFor();
  expect(await page.getByRole("status").count()).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem("crm:landing-note"))).toBeNull();
  // 离开那页（不点知道了）也清
  await 调(page, "__留", "/customers", 话);
  await 调(page, "__画", "/customers");
  await page.getByRole("status").waitFor();
  await 调(page, "__画", null);
  await page.getByText("别处").waitFor();
  await 调(page, "__画", "/customers");
  await page.getByText("列表", { exact: true }).waitFor();
  expect(await page.getByRole("status").count()).toBe(0);
  expect(await page.locator(".ant-message-notice").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

it("整页刷新落地也认（sessionStorage）；过期的、坏的不说；存储被禁时站内跳转照样说", async () => {
  const 新 = await 打开(JSON.stringify({ 到: "/customers", 话, 至: Date.now() + 20_000 }));
  await 调(新.page, "__画", "/customers");
  await 新.page.getByRole("status").filter({ hasText: 话 }).waitFor();
  await 新.page.close();
  for (const 坏 of [JSON.stringify({ 到: "/customers", 话, 至: Date.now() - 1 }), "{坏", JSON.stringify({ 到: 1 })]) {
    const x = await 打开(坏);
    await 调(x.page, "__画", "/customers");
    await x.page.getByText("列表", { exact: true }).waitFor();
    expect(await x.page.getByRole("status").count(), 坏).toBe(0);
    expect(x.errors).toEqual([]);
    await x.page.close();
  }
  const 禁 = await 打开(undefined, true);
  await 调(禁.page, "__留", "/customers", 话);
  await 调(禁.page, "__画", "/customers");
  const 句 = 禁.page.getByRole("status").filter({ hasText: 话 });
  await 句.waitFor();
  await 句.getByRole("button", { name: "知道了" }).click();
  expect(await 禁.page.getByRole("status").count()).toBe(0);
  expect(禁.errors).toEqual([]);
  await 禁.page.close();
});

it("接线（源码）：客户列表摆 LandingNote；项目详情回客户列表那一下留落地话、不再弹 message", () => {
  expect(readFileSync(path.resolve("src/app/(app)/customers/CustomersView.tsx"), "utf8")).toMatch(/<LandingNote 路径="\/customers" \/>/);
  const 详情 = readFileSync(path.resolve("src/app/(app)/projects/[id]/ProjectDetail.tsx"), "utf8");
  expect(详情).toMatch(/留落地话\(嵌入\.走后去\.到, 嵌入\.走后去\.说法\);\s*router\.push\(嵌入\.走后去\.到\)/);
  expect(详情).not.toMatch(/message\.(success|error|info|warning|open|loading)\(/);
});
