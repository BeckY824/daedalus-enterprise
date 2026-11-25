/**
 * 项目详情的中栏名单（ProjectRoster）在手机宽度打不开（小修 11-25）：
 *   原因：AppShell 手机那套只给客户详情、首页挂中栏槽位，项目详情页头那颗「显示项目列表」把抽屉开关置成开，
 *         可名单根本没挂上，点了什么都不出。修：手机上 /projects/<id> 也挂（关着是一只抽屉，不占地方）
 *   390：点页头那颗 → 左抽屉出名单，行在屏内、页面不横滚；点一行关抽屉；手机上打开不抢焦点（不弹键盘）
 *   768 / 1024 / 1280：照旧点开抽屉（1366 及以下项目名单默认收进抽屉，lib/roster.ts 项目名单门槛）
 * 真浏览器 + 真 antd + 真 globals.css + 真 AppShell / ProjectRoster / PaneToggle；页面换成只摆页头那颗按钮的假项目页
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser;
let 包: string;

const 插件: Plugin = { name: "ent-project-roster-phone", setup(b) {
  b.onResolve({ filter: /^next\/(navigation|link)$/ }, (a) => ({ path: a.path, namespace: "fixture" }));
  b.onResolve({ filter: /(^|\/)(WhatsNew|UpdateRow|FeedbackButton|AiCost|RailResizer|AwaitAssignTodo|RecordView|ProjectDetail|NoticeBell|DockThreads|HomeChat)$/ }, (a) => ({ path: a.path, namespace: "empty-child" }));
  b.onLoad({ filter: /.*/, namespace: "empty-child" }, () => ({ contents: "export default function Empty(){return null} export function AiMeterBar(){return null}" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ resolveDir: process.cwd(), contents: a.path === "next/link"
    ? `import React from 'react';export default function Link({href,onClick,prefetch,unstable_dynamicOnHover,children,...p}){return React.createElement('a',{...p,href,onClick:e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.__route=href}}},children)}`
    : `export const useRouter=()=>({push:p=>window.__route=p,refresh:()=>{},prefetch:()=>{}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);` }));
} };

beforeAll(async () => {
  const r = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", plugins: [插件], stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import Shell from '@/components/AppShell';
    import ProjectRoster from '@/components/ProjectRoster';import PaneToggle from '@/components/PaneToggle';
    window.__route='';
    const 长='华东超长名字展览展示器材制造与进出口贸易集团股份有限公司上海分公司第二事业部';
    const 行=(i)=>({id:'pj'+i,name:(i===1?长:'项目')+i,阶段:i%2?'商机':'线索',进程:'需求确认',结局:null,pooled:false,customerName:'客户'+i,lastType:null,lastMethod:null,lastAt:null,lastNote:'聊了报价'+长,nextAt:null,nextText:null});
    const 名单=<ProjectRoster data={{rows:Array.from({length:12},(_,i)=>行(i+1)),取到上限:false}}/>;
    function 项目页(){return <div className="proj-wrap"><div className="proj-head"><PaneToggle 栏="roster" 位置="主区" 名="项目列表"/><div className="page-head"><h1>{长}</h1></div></div></div>;}
    createRoot(document.getElementById('root')).render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <Shell user={{id:'qa',name:'测试同事',email:'qa@example.test',role:'SALES',title:''}} workspace={{name:'工作区'}} desktop={false} 反馈去向="none"
        企业版项目={true} 企业版={true} pane={名单} ai={null} 要跟={{逾期:0,今天:0}} 收藏={[]} 项目收藏={[]}
        全局搜索={async()=>({客户:[],项目:[],联系人:[]})}><项目页/></Shell>
    </BusinessProvider></App>);` } });
  包 = r.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(宽: number): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 宽, height: 800 }, ...(宽 < 768 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://ent.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><div id='root'></div>" }));
  await page.goto("http://ent.test/projects/pj1");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: 包 });
  await page.getByRole("button", { name: "显示项目列表" }).waitFor();
  return { page, errors };
}

describe("项目详情：手机上也能打开中栏项目名单", () => {
  it("390：点页头「显示项目列表」→ 左抽屉出名单，行在屏内、不横滚、不抢焦点；点一行关上", async () => {
    const { page, errors } = await 开(390);
    try {
      await page.getByRole("button", { name: "显示项目列表" }).click();
      const 抽屉 = page.locator(".pane-drawer .ant-drawer-content-wrapper");
      await 抽屉.waitFor({ state: "visible" });
      await page.waitForTimeout(450);
      const 行 = 抽屉.locator(".roster-row");
      expect(await 行.count()).toBeGreaterThan(0);
      const 量 = await page.evaluate(() => {
        const w = document.querySelector(".pane-drawer .ant-drawer-content-wrapper")!.getBoundingClientRect();
        const r = document.querySelector(".pane-drawer .roster-row")!.getBoundingClientRect();
        const a = document.activeElement;
        return { 页: document.documentElement.scrollWidth <= window.innerWidth, 抽屉在屏内: w.left >= 0 && w.right <= window.innerWidth, 行在抽屉里: r.right <= w.right + 1, 搜索框没抢焦点: !(a instanceof HTMLInputElement) };
      });
      expect(量).toEqual({ 页: true, 抽屉在屏内: true, 行在抽屉里: true, 搜索框没抢焦点: true });
      const 去 = await 行.nth(1).getAttribute("href");
      expect(去).toMatch(/^\/projects\/pj\d+$/);
      await 行.nth(1).click();
      await 抽屉.waitFor({ state: "hidden" });
      expect(await page.evaluate(() => Reflect.get(window, "__route"))).toBe(去);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("768 / 1024 / 1280：照旧点开抽屉出名单（不回退）", async () => {
    for (const w of [768, 1024, 1280]) {
      const { page, errors } = await 开(w);
      try {
        await page.getByRole("button", { name: "显示项目列表" }).click();
        const 抽屉 = page.locator(".pane-drawer .ant-drawer-content-wrapper");
        await 抽屉.waitFor({ state: "visible" });
        expect(await 抽屉.locator(".roster-row").count(), String(w)).toBeGreaterThan(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), String(w)).toBe(true);
        expect(errors).toEqual([]);
      } finally { await page.context().close(); }
    }
  });
});
