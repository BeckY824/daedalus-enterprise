/**
 * 切换视图的挑人框（AppShell 账号菜单「以某人的视角查看」→ ViewAsPicker，11-12 第二轮审查 1）：
 *   宽屏（左栏 shell）、小屏（顶栏）两个分支各挂一份——点菜单那一项，正好弹出一个挑人框，不多不少；
 *   切换中首页对话栏写一句「视角查看时不显示对方的 AI 对话」（对话本身服务端不回，见 ent-view-as-scan.test.ts）
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-view-as-picker", setup(b) {
  b.onResolve({ filter: /^next\/(navigation|link)$/ }, a => ({ path: a.path, namespace: "fixture" }));
  b.onResolve({ filter: /(^|\/)(WhatsNew|UpdateRow|FeedbackButton|AiCost|RailResizer|LeadFullNotices|RecordView|ProjectDetail|NoticeBell|AiDock)$/ }, a => ({ path: a.path, namespace: "empty-child" }));
  // 对话栏引的 "use server" 文件换成空壳（不把库打进浏览器包）
  b.onResolve({ filter: /^\.\/threads$/ }, a => ({ path: a.path, namespace: "threads" }));
  b.onLoad({ filter: /.*/, namespace: "threads" }, () => ({ contents: "export async function 重命名对话(){return {ok:true}} export async function 删除对话(){return {ok:true}}" }));
  b.onLoad({ filter: /.*/, namespace: "empty-child" }, () => ({ contents: "export default function Empty(){return null} export function AiMeterBar(){return null}" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ resolveDir: process.cwd(), contents: a.path === "next/link"
    ? `import React from 'react';export default function Link({href,onClick,prefetch,unstable_dynamicOnHover,children,...p}){return React.createElement('a',{...p,href,onClick:e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.__route=href}}},children)}`
    : `export const useRouter=()=>({push:p=>window.__route=p,refresh:()=>{}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);` }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import Shell from '@/components/AppShell';
    import ConversationList from '@/app/(app)/dashboard/ConversationList';import {切换视图Provider} from '@/components/ViewAsContext';
    const root=createRoot(document.getElementById('root'));window.__route='';window.__换=[];
    const 名单=[{角色:'sales',名:'业务员',人:[{id:'u1',name:'测试甲',说明:'一部'},{id:'u2',name:'测试乙',说明:''}]}];
    window.__render=(在看)=>root.render(<App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}><Shell user={{id:在看?'u1':'qa',name:在看?'测试甲':'总管',email:'qa@example.test',role:'ADMIN',title:''}} workspace={{name:'工作区'}} desktop={false} 反馈去向="none" 企业版项目={true} 企业版={true} pane={null} ai={null} 要跟={{逾期:0,今天:0}}
      视图名单={名单} 视图换人={async(id)=>{window.__换.push(id);return {ok:false,error:'测试'}}} 视图退出={async()=>({ok:true})} 正在视图={在看?{名:'测试甲',身份:'业务员 / 一部'}:null}><div>正文</div></Shell></BusinessProvider></App>);
    window.__对话=(在看)=>root.render(<App><切换视图Provider value={在看}><ConversationList rows={[]} /></切换视图Provider></App>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(width: number, 调: string, 参: boolean): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 800 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => void d.dismiss());
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/customers");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([f, a]) => (window as unknown as Record<string, (a: boolean) => void>)[f as string](a as boolean), [调, 参] as const);
  return { page, errors };
}

const 挑人框 = (page: Page) => page.locator(".ant-modal").filter({ hasText: "以某人的视角查看（只读）" });

for (const [名, 宽] of [["宽屏", 1280], ["小屏", 390]] as const) {
  for (const 在看 of [false, true]) {
    it(`${名}（${宽}）${在看 ? "切换中「换一个人的视角」" : "「以某人的视角查看」"}：点菜单弹出正好一个挑人框，选人走 视图换人`, async () => {
      const { page, errors } = await 打开(宽, "__render", 在看);
      try {
        expect(await page.locator(".ant-modal").count()).toBe(0);
        await page.getByRole("button", { name: /账号菜单/ }).click();
        await page.getByRole("menuitem", { name: 在看 ? "换一个人的视角" : "以某人的视角查看" }).click();
        await 挑人框(page).waitFor();
        expect(await 挑人框(page).count()).toBe(1);
        expect(await page.locator(".ant-modal:visible").count()).toBe(1);
        expect(await page.getByRole("combobox", { name: "选一位成员" }).count()).toBe(1);
        await page.getByRole("combobox", { name: "选一位成员" }).click();
        await page.locator(".ant-select-item-option").filter({ hasText: "测试乙" }).click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __换: string[] }).__换)).toEqual(["u2"]);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    });
  }
}

it("首页对话栏：切换中写「视角查看时不显示对方的 AI 对话」，平时照旧", async () => {
  for (const 在看 of [true, false]) {
    const { page, errors } = await 打开(1280, "__对话", 在看);
    try {
      await page.locator(".pane-empty").waitFor();
      expect(await page.locator(".pane-empty").innerText()).toBe(在看 ? "视角查看时不显示对方的 AI 对话" : "还没有问过什么。在右边问一句，这里就会留下一条。");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});
