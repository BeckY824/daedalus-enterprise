/**
 * PR3 AI 浮窗（原型 前端改版-逐块确认 ai.open / ai.minimize / ai.ask / ai.away / ai.bg / ai.ctx、dt.ai；规则 P-界面-39，和 P-界面-31/32 合用）。
 * 真浏览器 + 真 antd + 真 globals.css + 真 AppShell / AiDock / AiFab；HomeChat、DockThreads 换成假的（它们引服务端动作），
 * 假 HomeChat 只照真的那样摆 .cli / .cli-empty / .cli-col / .cli-composer，问一句 = 往 home-thread 里加一轮。
 *   打开   点右下角浮标：对话框在正文的中间下方出现，正文不收窄（不是右栏），浮标让开
 *   −      右上角「−」收起：浮窗藏起来、读屏够不着，浮标回来；有对话时球上一个小点，再点原样回来
 *   别处   点正文：对话缩成一行（上一问 +「展开」），点「展开」恢复
 *   在做   收起时还在跑：球外圈转；跑完绿光一闪
 *   动效   减弱动态下只淡入：不缩放，透明度照样过渡
 *   毛玻璃 平时半透明 + 背后模糊；系统减少透明度、低配机 lite-fx 退回实色
 *   宽度   1024 / 1280 / 1366：浮窗不遮页头按钮、左栏、滚到底的分页按钮，页面不横滚
 * 认元素用 role / 文字；只有我们自己的类（dock-float、ai-fab）才按类找。
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 打开AI浮窗, 登记打开AI浮窗 } from "@/lib/ai-float";

let browser: Browser;
let 包: string;

const 插件: Plugin = { name: "ent-ai-float", setup(b) {
  b.onResolve({ filter: /^next\/(navigation|link)$/ }, (a) => ({ path: a.path, namespace: "fixture" }));
  b.onResolve({ filter: /(^|\/)(WhatsNew|UpdateRow|FeedbackButton|AiCost|RailResizer|LeadFullNotices|RecordView|ProjectDetail|NoticeBell|DockThreads)$/ }, (a) => ({ path: a.path, namespace: "empty-child" }));
  b.onLoad({ filter: /.*/, namespace: "empty-child" }, () => ({ contents: "export default function Empty(){return null} export function AiMeterBar(){return null}" }));
  b.onResolve({ filter: /dashboard\/HomeChat$/ }, (a) => ({ path: a.path, namespace: "homechat" }));
  b.onLoad({ filter: /.*/, namespace: "homechat" }, () => ({ resolveDir: process.cwd(), loader: "jsx", contents: `
    import React from 'react';import {useThread,addTurn} from '@/lib/home-thread';import {runJob} from '@/lib/ai-jobs';
    export default function HomeChat({scope}){
      const t=useThread(scope);
      window.__问=(q)=>addTurn(scope,{question:q,kind:'ask'});
      window.__跑=(q)=>{const x=addTurn(scope,{question:q,kind:'ask'});runJob('home:'+x.id,()=>new Promise(r=>{window.__完=()=>r({ok:true,value:1})}));};
      return <div className={'cli cli-narrow'+(t.length?'':' cli-empty')}><div className="cli-col">
        {t.map(x=><p key={x.id}>{x.question} 的回答</p>)}
        <div className={'cli-composer'+(t.length?' cli-composer-sticky':'')}><textarea aria-label="问一句" rows={2} style={{width:'100%'}}/></div>
      </div></div>;
    }` }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ resolveDir: process.cwd(), contents: a.path === "next/link"
    ? `import React from 'react';export default function Link({href,onClick,prefetch,unstable_dynamicOnHover,children,...p}){return React.createElement('a',{...p,href,onClick:e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.__route=href}}},children)}`
    : `export const useRouter=()=>({push:p=>window.__route=p,refresh:()=>{}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);` }));
} };

beforeAll(async () => {
  const r = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", plugins: [插件], stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App, Button} from 'antd';
    import MotionTheme from '@/components/MotionTheme';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import Shell from '@/components/AppShell';
    window.__route='';
    const 长='华东超长名字展览展示器材制造与进出口贸易集团股份有限公司上海分公司第二事业部';
    function 页(){return <div>
      <div style={{display:'flex',alignItems:'center',gap:8}}><b style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{长}</b><Button type="primary">新建客户</Button><Button>导入</Button></div>
      {Array.from({length:40},(_,i)=><div key={i} style={{padding:'8px 0',borderBottom:'1px solid #eee'}}>第{i}家{长}</div>)}
      <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:12}}><Button>上一页</Button><Button>下一页</Button></div>
    </div>;}
    createRoot(document.getElementById('root')).render(<MotionTheme><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <Shell user={{id:'qa',name:'测试同事',email:'qa@example.test',role:'ADMIN',title:''}} workspace={{name:'工作区'}} desktop={false} 反馈去向="none"
        企业版项目={true} 企业版={true} pane={null} ai={{models:[]}} 要跟={{逾期:0,今天:0}} 收藏={[]} 项目收藏={[]}
        全局搜索={async()=>({客户:[],项目:[],联系人:[]})}><页/></Shell>
    </BusinessProvider></App></MotionTheme>);` } });
  包 = r.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(宽 = 1280, 少动 = false): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 宽, height: 800 }, reducedMotion: 少动 ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://ent.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://ent.test/customers");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: 包 });
  await page.getByRole("button", { name: "打开 AI 对话" }).waitFor();
  return { page, errors };
}
const 浮窗 = (page: Page) => page.locator(".dock-float");
const 打开 = async (page: Page) => {
  await page.getByRole("button", { name: "打开 AI 对话" }).click();
  await page.getByRole("complementary", { name: "AI 对话" }).waitFor();
  await page.waitForTimeout(450);
};

describe("lib/ai-float：页里的按钮叫浮窗", () => {
  it("没登记返回 false（按钮照旧开抽屉）；登记了就打开、返回 true；取消后又是 false", () => {
    expect(打开AI浮窗()).toBe(false);
    let 开了 = 0;
    const 取消 = 登记打开AI浮窗(() => { 开了++; });
    expect(打开AI浮窗()).toBe(true);
    expect(开了).toBe(1);
    取消();
    expect(打开AI浮窗()).toBe(false);
  });
});

describe("AI 浮窗（P-界面-39）", () => {
  it("点右下角浮标：对话框出现在正文中间下方，正文不收窄，浮标让开；默认是收着的", async () => {
    const { page, errors } = await 开(1280);
    try {
      expect(await 浮窗(page).count(), "没点之前不挂浮窗").toBe(0);
      const 正文宽前 = await page.locator("main").evaluate((m) => m.getBoundingClientRect().width);
      await 打开(page);
      const 量 = await page.evaluate(() => {
        const d = document.querySelector<HTMLElement>(".dock-float")!.getBoundingClientRect();
        const m = document.querySelector("main")!.getBoundingClientRect();
        return { 中: d.left + d.width / 2, 正文中: m.left + m.width / 2, 底: innerHeight - d.bottom, 顶: d.top, 收窄: document.querySelector(".shell")!.classList.contains("shell-dock-open") };
      });
      expect(Math.abs(量.中 - 量.正文中), "水平居中在正文里").toBeLessThan(12);
      expect(量.底).toBeGreaterThanOrEqual(8);
      expect(量.底).toBeLessThan(40);
      expect(量.顶, "还没问过：只是一条输入框，在下半屏").toBeGreaterThan(500);
      expect(量.收窄).toBe(false);
      expect(await page.locator("main").evaluate((m) => m.getBoundingClientRect().width)).toBe(正文宽前);
      expect(await page.getByRole("button", { name: "打开 AI 对话" }).count()).toBe(0);
      await expect.poll(() => page.evaluate(() => document.activeElement === document.body || !!document.activeElement)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("右上角「−」收起：浮窗藏起来、读屏够不着、浮标回来；有对话时球上一个小点，再点对话原样回来", async () => {
    const { page, errors } = await 开(1280);
    try {
      await 打开(page);
      await page.evaluate(() => (window as unknown as { __问: (q: string) => void }).__问("Nordic Fun 现在卡在哪？"));
      await page.getByText("Nordic Fun 现在卡在哪？ 的回答").waitFor();
      const 高 = await 浮窗(page).evaluate((d) => d.getBoundingClientRect().height);
      expect(高, "问过之后向上长成对话").toBeGreaterThan(400);
      // − 在右上角
      const [框, 减] = await Promise.all([浮窗(page).boundingBox(), page.getByRole("button", { name: "收起 AI 对话" }).boundingBox()]);
      expect(框!.x + 框!.width - (减!.x + 减!.width)).toBeLessThan(24);
      expect(减!.y - 框!.y).toBeLessThan(24);
      await page.getByRole("button", { name: "收起 AI 对话" }).click();
      await page.waitForTimeout(450);
      expect(await 浮窗(page).evaluate((d) => ({ 看得见: getComputedStyle(d).visibility, inert: (d as HTMLElement).inert, 藏: d.getAttribute("aria-hidden") }))).toEqual({ 看得见: "hidden", inert: true, 藏: "true" });
      expect(await page.getByRole("complementary", { name: "AI 对话" }).count()).toBe(0);
      const 球 = page.getByRole("button", { name: "打开 AI 对话" });
      await 球.waitFor();
      expect(await page.locator(".ai-fab-dot").count(), "有对话：球上留一个小点").toBe(1);
      await 球.click();
      await page.waitForTimeout(450);
      expect(await page.getByText("Nordic Fun 现在卡在哪？ 的回答").isVisible()).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("点页面别处：对话缩成一行（上一问 +「展开」），点「展开」恢复", async () => {
    const { page, errors } = await 开(1280);
    try {
      await 打开(page);
      await page.evaluate(() => (window as unknown as { __问: (q: string) => void }).__问("本周要跟哪些客户"));
      await page.getByText("本周要跟哪些客户 的回答").waitFor();
      await page.locator("main").getByText("第3家", { exact: false }).first().click();
      const 展开 = page.getByRole("button", { name: "展开对话" });
      await 展开.waitFor();
      expect(await 展开.textContent()).toContain("本周要跟哪些客户");
      expect(await page.getByText("本周要跟哪些客户 的回答").isVisible()).toBe(false);
      expect(await page.getByRole("textbox", { name: "问一句" }).isVisible(), "输入框还在").toBe(true);
      await 展开.click();
      expect(await page.getByText("本周要跟哪些客户 的回答").isVisible()).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("收起时还在跑：球外圈转；跑完绿光一闪、留小点", async () => {
    const { page, errors } = await 开(1280);
    try {
      await 打开(page);
      await page.evaluate(() => (window as unknown as { __跑: (q: string) => void }).__跑("整理本周要跟的客户"));
      await page.getByRole("button", { name: "收起 AI 对话" }).click();
      const 球 = page.getByRole("button", { name: "AI 正在做，打开对话" });
      await 球.waitFor();
      expect(await page.locator(".ai-fab-ring").evaluate((r) => getComputedStyle(r).animationName)).toBe("fab-spin");
      await page.evaluate(() => (window as unknown as { __完: () => void }).__完());
      await page.getByRole("button", { name: "打开 AI 对话" }).waitFor();
      expect(await page.locator(".ai-fab-done").count()).toBe(1);
      expect(await page.locator(".ai-fab-dot").count()).toBe(1);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("减弱动态：浮窗只淡入，不缩放；透明度照样过渡", async () => {
    const { page, errors } = await 开(1280, true);
    try {
      await page.getByRole("button", { name: "打开 AI 对话" }).click();
      const 起 = await page.evaluate(() => new Promise<{ 缩放: string; 属性: string; 时长: string; 透明: number[] }>((ok) => {
        const 透明: number[] = [];
        const 量 = (n: number) => {
          const d = document.querySelector<HTMLElement>(".dock-float");
          if (d) 透明.push(Number(getComputedStyle(d).opacity));
          if (n > 0) requestAnimationFrame(() => 量(n - 1));
          else { const cs = getComputedStyle(d!); ok({ 缩放: cs.scale, 属性: cs.transitionProperty, 时长: cs.transitionDuration, 透明 }); }
        };
        量(30);
      }));
      expect(起.缩放).toBe("none");
      expect(起.属性).not.toMatch(/scale|transform|all/);
      expect(起.属性).toContain("opacity");
      expect(起.时长.split(",")[0].trim()).toBe("0.32s");
      // 中间有半透明的帧：是淡入，不是硬切
      expect(起.透明.some((o) => o > 0.02 && o < 0.98), `透明度序列 ${起.透明.join(",")}`).toBe(true);
      expect(起.透明.at(-1)).toBe(1);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("毛玻璃：平时半透明 + 背后模糊；系统减少透明度、低配机（lite-fx）退回实色、不模糊", async () => {
    const { page, errors } = await 开(1280);
    try {
      await 打开(page);
      const 面 = () => 浮窗(page).evaluate((d) => { const cs = getComputedStyle(d); return { 底: cs.backgroundColor, 糊: cs.backdropFilter }; });
      const 平时 = await 面();
      expect(平时.糊).toContain("blur(26px)");
      expect(平时.底).toMatch(/^(rgba\(255, 255, 255, 0\.72|color\(srgb 1 1 1 \/ 0\.72)/);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
      expect(await 面()).toEqual({ 底: "rgb(255, 255, 255)", 糊: "none" });
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });
      expect((await 面()).糊).toContain("blur(26px)");
      await page.evaluate(() => document.documentElement.classList.add("lite-fx"));
      expect(await 面()).toEqual({ 底: "rgb(255, 255, 255)", 糊: "none" });
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });

  for (const 宽 of [1024, 1280, 1366]) {
    it(`${宽} 宽：浮窗开着（输入框态、缩成一行）不遮页头按钮、左栏、滚到底的分页按钮；页面不横滚、浮窗不出界`, async () => {
      const { page, errors } = await 开(宽);
      try {
        await 打开(page);
        const 遮挡 = () => page.evaluate(() => {
          const 被遮: string[] = [];
          const 按钮们 = [...document.querySelectorAll<HTMLElement>("main button, .rail a, .rail button")].filter((b) => b.offsetParent);
          const main = document.querySelector("main")!;
          main.scrollTop = main.scrollHeight; window.scrollTo(0, document.body.scrollHeight);
          const d = document.querySelector<HTMLElement>(".dock-float")!.getBoundingClientRect();
          for (const b of 按钮们) {
            const r = b.getBoundingClientRect();
            if (r.bottom < 0 || r.top > innerHeight || r.width === 0) continue;
            // 按钮框和浮窗框有一点交叠就算遮（不只看中心那一点）
            if (r.left < d.right && r.right > d.left && r.top < d.bottom && r.bottom > d.top) 被遮.push(b.textContent || b.getAttribute("aria-label") || "?");
          }
          const 分页 = [...document.querySelectorAll("main button")].find((b) => b.textContent?.includes("下一页"))!.getBoundingClientRect();
          return { 被遮, 出界: d.left < 0 || d.right > innerWidth || d.bottom > innerHeight, 横滚: document.documentElement.scrollWidth > innerWidth, 分页在上: 分页.bottom <= d.top || 分页.right <= d.left || 分页.left >= d.right };
        });
        expect(await 遮挡()).toEqual({ 被遮: [], 出界: false, 横滚: false, 分页在上: true });
        await page.evaluate(() => (window as unknown as { __问: (q: string) => void }).__问("一个特别特别长的问题".repeat(8)));
        await page.locator("main").getByText("第1家", { exact: false }).first().click();
        await page.getByRole("button", { name: "展开对话" }).waitFor();
        await page.waitForTimeout(400);
        expect(await 遮挡()).toEqual({ 被遮: [], 出界: false, 横滚: false, 分页在上: true });
        expect(errors).toEqual([]);
      } finally { await page.context().close(); }
    });
  }
});
