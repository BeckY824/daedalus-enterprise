/**
 * 手机首页对话框的「+」（11-18 员工反馈「手机端对话框还不能添加截图」）：
 * 原来手机上「+」只有拍名片、查重，没有选截图的入口。现在多一项「截图 / 图片」：
 *   - 从相册选（input 只收图、可多选、不带 capture，不强制调相机）；拍名片那项照旧
 *   - 选了走和电脑同一条认图路（AskFiles → 认图成文本），选好的图进这一问的附件小签；几张同名的不互相顶掉
 *   - 375 / 390 宽：菜单和附件小签不出屏
 * 电脑上照旧叫「附件」、一次一个（ent-board-member.test.ts 钉菜单项）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "composer-plus-phone", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/(^|\/)CardScanKey$/, "export default function C(){return null}");
  stub(/(^|\/)DedupeKey$/, "export default function D(){return null}");
  stub(/^@\/lib\/ask-image$/, `
    export const 图片后缀=['.png','.jpg','.jpeg','.webp','.bmp'];export const 图片类型=['image/png','image/jpeg','image/webp','image/bmp'];
    export const 是图片文件=f=>/\\.(png|jpe?g|webp|bmp)$/i.test(f.name)||图片类型.includes(f.type);
    export const 认图成文本=async(f,进)=>{进('正在认图里的字…');window.__认=(window.__认||0)+1;return{text:'认出的字 '+f.name}};`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ComposerPlus from '@/app/(app)/dashboard/ComposerPlus';
    function 壳({拍照}){const [files,setFiles]=useState([]);window.__files=files;
      return <div className="cli-input cli-input-rich"><div className="cli-bar2"><div className="cli-bar2-l">
        <ComposerPlus 宽={false} 拍照={拍照} 在跑={false} files={files} setFiles={setFiles} 摆背调键={false} on切背调={()=>{}} 渠道名们={['展会']} on出卡={()=>{}} on存照片={()=>{}}/>
      </div></div></div>;}
    window.__render=(拍照)=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App><壳 拍照={拍照}/></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number, 拍照: boolean) {
  const page = await browser.newPage({ viewport: { width, height: 760 }, isMobile: 拍照, hasTouch: 拍照 }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://plus.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><meta name='viewport' content='width=device-width'><div id='root'></div>" }));
  await page.goto("http://plus.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __render: (x: boolean) => void }).__render(x), 拍照);
  await page.locator("button[aria-label='更多入口']").waitFor();
  return { page, errors };
}
/**
 * 点「+」后等菜单展开动画放完（.ant-dropdown 不再带 *-appear 类）。
 * 为什么（11-18 PR #347 单元测试 4/8 两次红、菜单项读到 []）：antd 展开动画的「start」那几帧把弹层缩成 0×0，
 * Playwright 的 :visible 认不到；「prepare」帧里它又是有尺寸的，所以 first().waitFor() 过了、紧接着 allInnerTexts() 赶上 start 帧就是空的。
 * 本机探针（每帧记一次）：prepare 121×104 → start 0×0 → active 渐显 → 约 250 ms 后去掉 appear 类；CI 机忙时 start 帧拖得更长
 */
async function 菜单开好(page: Page) {
  await page.locator("button[aria-label='更多入口']").click();
  await page.waitForFunction(() => {
    const 开着 = [...document.querySelectorAll(".ant-dropdown:not(.ant-dropdown-hidden)")];
    return 开着.length === 1 && !/-appear/.test(开着[0].className) && 开着[0].querySelectorAll(".ant-dropdown-menu-item").length > 0;
  });
  return page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item");
}
const 不出屏 = (sel: string) => `[...document.querySelectorAll(${JSON.stringify(sel)})].every(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=window.innerWidth+1})`;
const png = (name: string) => ({ name, mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) });

it("手机（375 / 390）：「+」里有「截图 / 图片」，拍名片照旧；从相册多选、不强制相机；选的图认完进附件小签，同名的不顶掉；不出屏", async () => {
  for (const w of [375, 390]) {
    const { page, errors } = await open(w, true);
    try {
      const 菜单 = await 菜单开好(page);
      expect(await 菜单.allInnerTexts()).toEqual(["截图 / 图片", "拍名片", "查重"]);
      expect(await page.evaluate(不出屏(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu"))).toBe(true);

      const 选图 = page.locator("input[type=file]");
      expect(await 选图.getAttribute("accept")).toMatch(/image\/png/);
      expect(await 选图.getAttribute("accept")).not.toMatch(/\.csv/);
      expect(await 选图.evaluate((e: HTMLInputElement) => e.multiple)).toBe(true);
      expect(await 选图.getAttribute("capture")).toBeNull();

      // 点「截图 / 图片」打开的就是这个选图框
      const [选择器] = await Promise.all([page.waitForEvent("filechooser"), 菜单.filter({ hasText: "截图 / 图片" }).click()]);
      expect(选择器.isMultiple()).toBe(true);
      await 选择器.setFiles([png("image.png"), png("image.png")]);
      await page.waitForFunction(() => (Reflect.get(window, "__files") as unknown[]).length === 2);
      expect(await page.locator(".cli-file .cli-file-n").allInnerTexts()).toEqual(["image.png", "image-2.png"]);
      const files = await page.evaluate(() => (Reflect.get(window, "__files") as { name: string; text: string; 图?: boolean }[]).map((f) => ({ name: f.name, text: f.text, 图: f.图 })));
      expect(files).toEqual([
        { name: "image.png", text: "认出的字 image.png", 图: true },
        { name: "image-2.png", text: "认出的字 image.png", 图: true },
      ]);
      expect(await page.evaluate(不出屏(".cli-file"))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("电脑上照旧：叫「附件」，文本和图都收、一次一个", async () => {
  const { page, errors } = await open(1280, false);
  try {
    const 菜单 = await 菜单开好(page);
    expect(await 菜单.allInnerTexts()).toEqual(["附件", "名片", "查重"]);
    const 选 = page.locator("input[type=file]");
    expect(await 选.getAttribute("accept")).toMatch(/\.csv/);
    expect(await 选.evaluate((e: HTMLInputElement) => e.multiple)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
