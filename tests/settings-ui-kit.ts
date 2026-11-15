/**
 * 设置页 UI 用例共用：用 esbuild 把设置组件打成一包，server action 一律换成假的。
 * 假的怎么来：读真文件里 export 出去的名字，每个名字回 window.__act(名字, 参数)，没定义 __act 就回 { ok: true }。
 * 这样设置页引了几十个动作也不用逐个写 stub，每条用例只在 window.__act 里管自己关心的那几个。
 */
import { build, type Plugin } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Browser, Page } from "playwright";

const 服务端动作 = (src: string) => /^\s*(\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*["']use server["']/.test(src);

const plugin: Plugin = { name: "settings-stub", setup(b) {
  b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "next-nav", namespace: "fixture" }));
  // 文件开头写着 "use server" 的（server action 文件）：每个 export 换成假的
  b.onLoad({ filter: /\/src\/.*\.tsx?$/ }, (a) => {
    const src = readFileSync(a.path, "utf8");
    if (!服务端动作(src)) return undefined;
    const 名们 = new Set([...src.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+([\p{L}\p{N}_$]+)/gmu)].map((m) => m[1]));
    return { loader: "js", contents: [...名们].map((n) => `export const ${n}=async(...a)=>{(window.__calls??=[]).push([${JSON.stringify(n)},a]);return window.__act?window.__act(${JSON.stringify(n)},...a):{ok:true}};`).join("\n") };
  });
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", resolveDir: process.cwd(), contents: `
    export const useRouter=()=>({refresh(){(window.__refresh=(window.__refresh??0)+1)},push(){},back(){window.__back=(window.__back??0)+1},replace(){}});
    import {useSyncExternalStore} from 'react';
    // 同 Next：原生 replaceState / pushState 改了地址，useSearchParams 跟着变
    for(const k of ['replaceState','pushState']){const o=history[k].bind(history);history[k]=(...a)=>{o(...a);dispatchEvent(new Event('__nav'))};}
    const sub=(f)=>{addEventListener('__nav',f);return()=>removeEventListener('__nav',f)};
    export const useSearchParams=()=>{const q=useSyncExternalStore(sub,()=>location.search);return new URLSearchParams(q)};
    export const usePathname=()=>location.pathname;
    export const redirect=()=>{};` }));
} };

/** 打包：entry 是一段 tsx，里面自己挂 window.__render */
export async function 打包(entry: string): Promise<string> {
  return (await build({ stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("src") }, loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, banner: { js: "var process=globalThis.process??{env:{}};" }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
}

/** 开一页：挂好 globals.css 和设置页的样式、打好的包，调 window.__render(props) */
export async function 开页(browser: Browser, bundle: string, props: unknown, width = 1366, query = ""): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 860 } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://settings.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto(`http://settings.test/settings${query}`);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ path: path.resolve("src/app/(app)/settings/settings.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((p) => (window as unknown as { __render: (x: unknown) => void }).__render(p), props);
  return { page, errors };
}

export const 调用们 = (page: Page) => page.evaluate(() => (window as unknown as { __calls?: [string, unknown[]][] }).__calls ?? []);
