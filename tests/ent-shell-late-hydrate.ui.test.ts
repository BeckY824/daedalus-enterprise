/**
 * 壳上晚到的数（11-26，components/LateCount.tsx）不许把钮一起压在 Suspense 兜底里（11-26 审查）：
 * 硬刷新时服务端先吐壳、数没到的那几块是 Suspense 兜底；兜底那段在数到之前**不水合**，包在里面的钮要等人去碰，
 * 点一下 React 19 才放弃等服务端、整块改客户端重画（所以光点得动还不够，下面另核服务端那段里钮在兜底外面）。
 * 所以手机顶栏的日历钮、铃铛钮（电脑左栏顶 + 手机顶栏）要在 <晚到> 外面，只有角上的数在里面。
 *
 * 这里照真的走一遍：先在浏览器里服务端渲染（react-dom/server 流，数的 Promise 一直不到，只拿壳那一段 HTML），
 * 再由一个本地 HTTP 服务把这段 HTML 吐给第二个页面、**连接一直不关**（同硬刷新时流还开着：document 还在 loading，
 * React 才会把挂着的兜底当「等服务端」留着不水合；文档已经加载完的话 React 直接改判客户端重画，测不出来），
 * 页面里 hydrateRoot，Promise 还是没到——这时点铃铛要能开抽屉、点日历要能跳；而且水合没报可恢复错误
 * （报了 React 会把那块改成客户端重画，钮就「碰巧」能点）。
 * 数到了之后（客户端重画同一棵树、数已到）角上有数、钮不挪位。
 * 手机宽的顶栏服务端本来不出（useNarrow 服务端按宽屏），水合后才挂；这里照样钉它数没到时可点、可读。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string; let 壳HTML: string; let server: Server; let 根址: string;
/** 还开着的页面响应：用例结束时才关 */
const 开着的: ServerResponse[] = [];
const plugin: Plugin = { name: "shell-late-hydrate", setup(b) {
  b.onResolve({ filter: /^next\/(navigation|link)$/ }, a => ({ path: a.path, namespace: "fixture" }));
  b.onResolve({ filter: /(^|\/)notice-actions$/ }, a => ({ path: a.path, namespace: "notice-actions" }));
  b.onResolve({ filter: /(^|\/)(UpdateRow|WhatsNew|AiTasks|AiDock|FeedbackButton|AiCost|RailResizer|RecordView|ProjectDetail|GiveUpDialog)$/ }, a => ({ path: a.path, namespace: "empty-child" }));
  b.onLoad({ filter: /.*/, namespace: "empty-child" }, () => ({ contents: "export default function Empty(){return null} export function AiMeterBar(){return null}" }));
  b.onLoad({ filter: /.*/, namespace: "notice-actions" }, () => ({ contents: "export const 读我的通知=async()=>({行们:[],未读:0});export const 读未读通知数=async()=>0;export const 标已读=async()=>0;export const 全部标已读=async()=>0;" }));
  // useRouter 回同一个对象（同 Next）：每次新对象会让壳里的 NavGoProvider 每画一次换值，上下文一变就把没水合的兜底强行改客户端重画
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ resolveDir: process.cwd(), contents: a.path === "next/link"
    ? `import React from 'react';export default function Link({href,onClick,prefetch,children,...p}){return React.createElement('a',{...p,href,onClick:e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.__route=href}}},children)}`
    : `const 路由={push:p=>window.__route=p,refresh:()=>{}};export const useRouter=()=>路由;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);` }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `import React from 'react';import {hydrateRoot,createRoot} from 'react-dom/client';import {renderToReadableStream} from 'react-dom/server';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import Shell from '@/components/AppShell';
    window.desktopNav={onGo:()=>()=>{},setCustomerLabel:async()=>true};
    window.__要跟=new Promise(r=>{window.__给要跟=r});window.__未读=new Promise(r=>{window.__给未读=r});
    const 壳=(要跟,未读)=><BusinessProvider value={DEFAULT_BUSINESS}><Shell user={{id:'qa',name:'QA',email:'qa@example.test',role:'ADMIN',title:'管理员'}} workspace={{name:'QA工作区'}} desktop={false} 反馈去向="none" 企业版 企业版项目 pane={null} ai={null} 要跟={要跟} 通知未读={未读}><div>页面</div></Shell></BusinessProvider>;
    window.__恢复错=[];
    (async()=>{
      if(window.__模式==='ssr'){
        // 服务端那一段：数一直不到，流只吐到壳（兜底）为止；读到一段时间没新块就收（不 cancel，免得把挂着的边界改判）
        const s=await renderToReadableStream(壳(window.__要跟,window.__未读),{onError:()=>{}});
        const rd=s.getReader();const dec=new TextDecoder();let html='';
        for(;;){const t=await Promise.race([rd.read(),new Promise(r=>setTimeout(()=>r(null),300))]);if(!t||t.done)break;html+=dec.decode(t.value);}
        window.__html=html;return;
      }
      window.__loading=document.readyState;
      hydrateRoot(document.getElementById('root'),壳(window.__要跟,window.__未读),{onRecoverableError:e=>window.__恢复错.push(String(e&&e.message||e))});
      window.__水合了=true;
      // 数到了以后客户端那一棵（router.refresh 之类重画时数已到）：另开一个根画，看角上的数
      window.__画到了=(要跟,未读)=>{const el=document.getElementById('root2');el.style.display='';createRoot(el).render(壳(Promise.resolve(要跟),Promise.resolve(未读)))};
    })();`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
  const 先渲 = await browser.newPage();
  await 先渲.setContent("<meta charset='utf-8'><div id='root'></div>");
  await 先渲.addScriptTag({ content: `window.__模式='ssr';${bundle}` });
  壳HTML = await (await 先渲.waitForFunction(() => (window as unknown as { __html?: string }).__html)).jsonValue() as string;
  await 先渲.close();
  const 样式 = readFileSync(path.resolve("src/app/globals.css"), "utf8");
  server = createServer((req, res) => {
    if (req.url === "/b.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(bundle); return; }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    // 不 end：流还开着（document.readyState 停在 loading），同硬刷新时数还没到
    res.write(`<!doctype html><meta charset='utf-8'><style>${样式}</style><body><div id='root'>${壳HTML}</div><div id='root2' style='display:none'></div><script>window.__模式='hydrate'</script><script src='/b.js'></script>`);
    开着的.push(res);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  根址 = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);
afterAll(async () => {
  for (const r of 开着的) r.end();
  await browser?.close();
  await new Promise((ok) => server?.close(ok));
});

async function open(width: number): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 850 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${根址}/dashboard`, { waitUntil: "commit" });
  await page.waitForFunction(() => (window as unknown as { __水合了?: boolean }).__水合了 === true);
  expect(await 窗<string>(page, "__loading")).toBe("loading");
  // 让水合跑完（hydrateRoot 是并发的，分片做）
  await page.waitForTimeout(300);
  return { page, errors };
}
const 窗 = <T,>(page: Page, k: string) => page.evaluate((k) => (window as unknown as Record<string, unknown>)[k], k) as Promise<T>;

it("手机宽：数没到（兜底还在、没水合）时日历钮、铃铛钮已水合可点；水合不出错", async () => {
  const { page, errors } = await open(390);
  try {
    const 根 = page.locator("#root");
    const 日历 = 根.getByRole("button", { name: /^跟进计划/ });
    expect(await 日历.getAttribute("aria-label")).toBe("跟进计划");
    await 日历.click();
    expect(await 窗<string>(page, "__route")).toBe("/follow-ups/plans");
    await 根.locator(".m-top").getByRole("button", { name: /^通知/ }).click();
    await expect.poll(() => page.locator(".notice-drawer .ant-drawer-title").first().textContent()).toBe("通知");
    expect(await 窗<string[]>(page, "__恢复错")).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("电脑宽：数没到时左栏顶的铃铛已水合可点；数到了的那一棵角上有数，钮和没数时同一位置", async () => {
  const { page, errors } = await open(1280);
  try {
    // 服务端那段里铃铛角上的数还是挂着的兜底（$? = 等服务端）：钮在它外面
    expect(壳HTML).toMatch(/aria-label="通知"[^>]*>[\s\S]*?<\/button><!--\$\?-->/);
    const 铃 = page.locator("#root .rail-top").getByRole("button", { name: /^通知/ });
    const 前 = await 铃.boundingBox();
    expect(await page.locator("#root .rail-top .late-badge .ant-badge-count").count()).toBe(0);
    await 铃.click();
    await expect.poll(() => page.locator(".notice-drawer .ant-drawer-title").first().textContent()).toBe("通知");
    expect(await 窗<string[]>(page, "__恢复错")).toEqual([]);

    // 数到了的那一棵：同一位置（root2 换到 root 的位置上量）
    await page.evaluate(() => { document.getElementById("root")!.style.display = "none"; (window as unknown as { __画到了: (a: unknown, b: number) => void }).__画到了({ 逾期: 1, 今天: 2 }, 7); });
    const 铃2 = page.locator("#root2 .rail-top").getByRole("button", { name: /^通知/ });
    await expect.poll(() => page.locator("#root2 .rail-top .late-badge .ant-badge-count").innerText()).toBe("7");
    await expect.poll(() => 铃2.getAttribute("aria-label")).toBe("通知，7 条未读");
    expect(await 铃2.boundingBox()).toEqual(前);
    // 红数收在铃铛钮的右上角里面（H-新11，不压出 32 的钮）
    const 钮框 = (await 铃2.boundingBox())!; const 数框 = (await page.locator("#root2 .rail-top .late-badge .ant-badge-count").boundingBox())!;
    expect(数框.x + 数框.width).toBeLessThanOrEqual(钮框.x + 钮框.width + 0.5);
    expect(数框.y).toBeGreaterThanOrEqual(钮框.y - 0.5);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
