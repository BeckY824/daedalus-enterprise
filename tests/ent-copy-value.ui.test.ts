import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { maskPhone } from "@/lib/utils";
/* 电话、邮箱：普通文字 + 紧贴右边的小复制键（11-09 用户：超链接取消，右边加个可复制的按钮）。
   用真 CopyValue + InlineField + TruncTip + clipboard + globals.css。
   11-04 排版闸门（#183）的教训留着：左栏窄到装不下一整串号码时，省略号要打在文字上，什么都不能出格（1024 / 1280 / 1366）。
   客户服务器可能不是 https：http://copy-value.test 这个地址 Chromium 就没有 navigator.clipboard，走的是真的回退 */
let browser: Browser, bundle: string;
const 长号 = "+44 20 7946 1000 转 1234567890 分机 0987654321";
const 长邮箱 = "very.long.mailbox.name.for.purchasing.department@example-supplier-company-with-long-name.com";
const plugin: Plugin = { name: "copy-value", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^\.\.\/actions$/, "export const patchCustomer=async()=>({ok:true});");
  stub(/^\.\.\/useTransferConfirm$/, "export const useTransferConfirm=()=>async()=>true;");
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>'/c';");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import InlineField from '@/app/(app)/customers/[id]/InlineField';import TruncTip from '@/components/TruncTip';import CopyValue from '@/components/CopyValue';
    const 号=(v)=><CopyValue 叫法='电话' value={v}/>, 邮=(v)=><CopyValue 种类='邮箱' 叫法='邮箱' value={v}/>;
    createRoot(document.getElementById('root')).render(<App><TruncTip/><div className='rec-page'><aside className='rec-rail rec-card rec-rail-blocks' style={{width:190}}>
      <InlineField 空时横线 customerId='a' field='phone' label='电话' value=${JSON.stringify(长号)} 显示={号}/>
      <InlineField 空时横线 customerId='a' field='email' label='邮箱' value=${JSON.stringify(长邮箱)} 显示={邮}/>
      <InlineField 空时横线 customerId='a' field='wechat' label='打码' value='138****8001' 显示={号}/>
      <InlineField 空时横线 customerId='a' field='school' label='公司' value={'很长的公司名字'.repeat(4)}/>
    </aside></div>
    <div id='行' style={{width:190}} onClick={()=>{window.__行点了=true}}><CopyValue 种类='邮箱' 叫法='邮箱' value='a*b@example.com' style={{maxWidth:170}}/></div>
    <div id='占位'><CopyValue 叫法='电话' value='-'/></div>
    <div id='另写'><CopyValue 种类='邮箱' 叫法='负责人邮箱' value='owner@example.com' 文字='联系负责人：某某'/></div>
    </App>);`, resolveDir: process.cwd(), loader: "jsx" },
    bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

/** host 用 localhost 才是安全上下文、才有 navigator.clipboard；.test 没有 */
async function open(host: "localhost" | "copy-value.test", 先跑?: string, width = 1024) {
  const page = await browser.newPage({ viewport: { width, height: 700 } });
  page.setDefaultTimeout(5000);
  await page.route(`http://${host}/**`, r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  if (先跑) await page.addInitScript(先跑);
  await page.goto(`http://${host}/`);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.locator(".rec-field[data-field=phone] .copy-val-b").waitFor();
  return page;
}
const 记写入 = "window.__写=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(t)=>{window.__写.push(t)}}});";
const 写被拒 = "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('拒绝')}}});";
/** 老办法：copy 事件发生时看选中的是什么 */
const 记老办法 = "window.__老=[];document.addEventListener('copy',()=>{const a=document.activeElement;window.__老.push(a.value.slice(a.selectionStart,a.selectionEnd))});";
const 老办法也不行 = "document.execCommand=()=>false;";
const 值 = <T,>(page: Page, 名: string) => page.evaluate(n => (window as unknown as Record<string, T>)[n], 名);
const 键 = (page: Page, field: string) => page.locator(`.rec-field[data-field=${field}] .copy-val-b`);

it("服务端脱敏器打出来的号，不管多长都带 *（CopyValue 靠这个不给键；不带 * 就等于能复制）", () => {
  for (const 位数 of [1, 3, 6, 7, 10, 11, 12, 20, 47]) {
    const 打码 = maskPhone("1".repeat(位数));
    expect(打码).toContain("*");
    expect(打码).not.toContain("1".repeat(位数));
  }
});

it("不是链接：文字 + 复制键，有 aria-label；打码的号没有键，页面上也没有真号的来路", async () => {
  const page = await open("localhost", 记写入);
  try {
    expect(await page.locator("a").count()).toBe(0);
    expect(await 键(page, "phone").getAttribute("aria-label")).toBe("复制电话");
    expect(await 键(page, "email").getAttribute("aria-label")).toBe("复制邮箱");
    const 打码 = page.locator(".rec-field[data-field=wechat]");
    expect(await 打码.innerText()).toContain("138****8001");
    expect(await 打码.locator("button").count()).toBe(0);
    // 占位的「-」不是号码，不给键；邮箱里的 * 不算打码
    expect(await page.locator("#占位 button").count()).toBe(0);
    expect(await page.locator("#行 button").count()).toBe(1);
  } finally { await page.close(); }
});

it("复制的是完整值，不是屏幕上截断的那段；成功有提示、键变对勾；点键不进编辑，点这一行别处才进编辑", async () => {
  const page = await open("localhost", 记写入);
  try {
    // 真被截了
    expect(await page.locator(".rec-field[data-field=phone] .copy-val-t").evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true);
    await 键(page, "phone").click();
    await page.getByText("已复制电话").waitFor();
    expect(await 键(page, "phone").evaluate(e => e.classList.contains("is-done"))).toBe(true);
    await 键(page, "email").click();
    await expect.poll(() => 值<string[]>(page, "__写")).toEqual([长号, 长邮箱]);
    expect(await page.locator(".rec-field-editing").count()).toBe(0);
    // 键盘：焦点在键上按回车只复制，不进编辑
    await 键(page, "phone").focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await 值<string[]>(page, "__写")).length).toBe(3);
    expect(await page.locator(".rec-field-editing").count()).toBe(0);
    // 屏幕上写的字和复制的值分开（新建项目撞号提示那一处）
    expect(await page.locator("#另写 .copy-val-t").innerText()).toBe("联系负责人：某某");
    await page.locator("#另写 button").click();
    await expect.poll(async () => (await 值<string[]>(page, "__写")).at(-1)).toBe("owner@example.com");
    // 点键不算点外面这一行（列表一行点了开详情）
    await page.locator("#行 button").click();
    expect(await 值<boolean | undefined>(page, "__行点了")).toBeUndefined();
    // 点这一行别处照旧进编辑
    await page.locator(".rec-field[data-field=phone] .rec-field-k").click();
    await page.locator(".rec-field-editing[data-field=phone] input").waitFor();
  } finally { await page.close(); }
});

it("不是 https（没有 navigator.clipboard）：走老办法，复制到的还是完整值", async () => {
  const page = await open("copy-value.test", 记老办法);
  try {
    expect(await page.evaluate(() => window.isSecureContext || "clipboard" in navigator)).toBe(false);
    await 键(page, "email").click();
    await page.getByText("已复制邮箱").waitFor();
    expect(await 值<string[]>(page, "__老")).toEqual([长邮箱]);
    // 用完不留那个输入框，焦点回到键上
    expect(await page.locator("textarea").count()).toBe(0);
    expect(await 键(page, "email").evaluate(e => e === document.activeElement)).toBe(true);
  } finally { await page.close(); }
});

it("clipboard 有但被拒：也走老办法", async () => {
  const page = await open("localhost", 写被拒 + 记老办法);
  try {
    await 键(page, "phone").click();
    await page.getByText("已复制电话").waitFor();
    expect(await 值<string[]>(page, "__老")).toEqual([长号]);
  } finally { await page.close(); }
});

it("两条路都不通：明确说复制不了，键不变对勾", async () => {
  const page = await open("copy-value.test", 老办法也不行);
  try {
    await 键(page, "phone").click();
    await page.getByText("复制不了，请手动选中复制").waitFor();
    expect(await page.getByText("已复制电话").count()).toBe(0);
    expect(await 键(page, "phone").evaluate(e => e.classList.contains("is-done"))).toBe(false);
  } finally { await page.close(); }
});

it("左栏窄：1024 / 1280 / 1366 文字一行省略、键紧贴在格内能点到；别的单行值照旧省略；悬停看全文", async () => {
  for (const w of [1024, 1280, 1366]) {
    const page = await open("localhost", 记写入, w);
    try {
      for (const f of ["phone", "email"]) {
        const 量 = await page.locator(`.rec-field[data-field=${f}]`).evaluate(el => {
          const 格 = el.querySelector<HTMLElement>(".rec-field-v")!, 字 = el.querySelector<HTMLElement>(".copy-val-t")!, 键 = el.querySelector<HTMLElement>(".copy-val-b")!;
          const g = 格.getBoundingClientRect(), z = 字.getBoundingClientRect(), k = 键.getBoundingClientRect();
          const 点到 = document.elementFromPoint(k.left + k.width / 2, k.top + k.height / 2);
          const s = getComputedStyle(字);
          return { 格不出界: 格.scrollWidth <= 格.clientWidth + 1, 字截了: 字.scrollWidth > 字.clientWidth, 省略: s.textOverflow, 折行: s.whiteSpace, 不重叠: z.right <= k.left + 0.5, 紧贴: k.left - z.right <= 3, 键在格内: k.right <= g.right + 0.5, 键能点到: !!点到 && 键.contains(点到), 键宽: k.width, 键高: k.height };
        });
        expect(量, `宽 ${w} ${f}`).toEqual({ 格不出界: true, 字截了: true, 省略: "ellipsis", 折行: "nowrap", 不重叠: true, 紧贴: true, 键在格内: true, 键能点到: true, 键宽: 20, 键高: 20 });
      }
      expect(await page.locator(".rec-field[data-field=school] .rec-field-v").evaluate(e => e.classList.contains("is-line") && getComputedStyle(e).textOverflow)).toBe("ellipsis");
      // title 给全文；悬停：截了的出浮层、显示全文；移开收起
      expect(await page.locator(".rec-field[data-field=phone] .copy-val-t").getAttribute("title")).toBe(长号);
      const 浮 = page.locator("#trunc-tip");
      await page.locator(".rec-field[data-field=school] .rec-field-v").hover();
      await expect.poll(() => 浮.evaluate(e => e.classList.contains("is-on"))).toBe(true);
      expect(await 浮.textContent()).toBe("很长的公司名字".repeat(4));
      await page.locator(".rec-field[data-field=email] .copy-val-t").hover();
      await expect.poll(() => 浮.textContent()).toBe(长邮箱);
      await page.mouse.move(900, 500);
      await expect.poll(() => 浮.evaluate(e => e.classList.contains("is-on"))).toBe(false);
    } finally { await page.close(); }
  }
});
