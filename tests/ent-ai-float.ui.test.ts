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
 *   排版   11-15：开浮窗、问过、收起，正文框 / 正文可滚高 / 客户页三栏的框和可滚高一个像素都不动（图3 截断那次的回归）
 *   一条   图4：没问过时就是一条输入框（≤120 高），说明和快捷项手在浮窗上才摆；问过向上长，最多 60% 屏高
 *   拖动   把手 / 头一行空白处拖，四边留 8；刷新记得、双击复位、窗口缩小收回；方向键挪；存储不能用照样拖
 * 认元素用 role / 文字；只有我们自己的类（dock-float、ai-fab）才按类找。
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { 打开AI浮窗, 登记打开AI浮窗, 打开智能总结, 登记智能总结, 有智能总结, 订阅智能总结 } from "@/lib/ai-float";

let browser: Browser;
let 包: string;

const 插件: Plugin = { name: "ent-ai-float", setup(b) {
  b.onResolve({ filter: /^next\/(navigation|link)$/ }, (a) => ({ path: a.path, namespace: "fixture" }));
  b.onResolve({ filter: /(^|\/)(WhatsNew|UpdateRow|FeedbackButton|AiCost|RailResizer|LeadFullNotices|RecordView|ProjectDetail|NoticeBell|DockThreads)$/ }, (a) => ({ path: a.path, namespace: "empty-child" }));
  b.onLoad({ filter: /.*/, namespace: "empty-child" }, () => ({ contents: "export default function Empty(){return null} export function AiMeterBar(){return null}" }));
  b.onResolve({ filter: /dashboard\/HomeChat$/ }, (a) => ({ path: a.path, namespace: "homechat" }));
  b.onLoad({ filter: /.*/, namespace: "homechat" }, () => ({ resolveDir: process.cwd(), loader: "jsx", contents: `
    import React from 'react';import {useThread,addTurn} from '@/lib/home-thread';import {runJob} from '@/lib/ai-jobs';
    import AiQuickAsks from '@/components/AiQuickAsks';
    export default function HomeChat({scope,空屏快捷}){
      const t=useThread(scope);
      window.__问=(q)=>addTurn(scope,{question:q,kind:'ask'});
      window.__跑=(q)=>{const x=addTurn(scope,{question:q,kind:'ask'});runJob('home:'+x.id,()=>new Promise(r=>{window.__完=()=>r({ok:true,value:1})}));};
      return <div className={'cli cli-narrow'+(t.length?'':' cli-empty')}><div className="cli-col">
        {t.map(x=><p key={x.id}>{x.question} 的回答</p>)}
        {!t.length && 空屏快捷 && <AiQuickAsks 项={空屏快捷} 问={(q)=>addTurn(scope,{question:q,kind:'ask'})}/>}
        <div className={'cli-composer'+(t.length?' cli-composer-sticky':'')}>
          <div className="cli-input cli-input-rich"><textarea aria-label="问一句" rows={1} placeholder="问一位客户，或问一个数"/>
            <div className="cli-bar2"><div className="cli-bar2-l"><button type="button" className="cli-tool" aria-label="更多入口">+</button></div>
              <div className="cli-bar2-r"><button type="button" className="mp-btn" aria-label="模型：auto">auto</button><button type="button" className="cli-send" aria-label="问">↑</button></div></div></div>
          <div className="cli-hints"><span><kbd>Enter</kbd> 发送 · <kbd>Shift+Enter</kbd> 换行 · <kbd>/</kbd> 命令</span><span>免费次数还剩 20 次 · 每问用 1 次</span></div>
        </div>
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
    import {登记详情名} from '@/lib/page-rows';import {登记智能总结} from '@/lib/ai-float';
    window.__route='';
    const 长='华东超长名字展览展示器材制造与进出口贸易集团股份有限公司上海分公司第二事业部';
    function 页(){return <div>
      <div style={{display:'flex',alignItems:'center',gap:8}}><b style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{长}</b><Button type="primary">新建客户</Button><Button>导入</Button></div>
      {Array.from({length:40},(_,i)=><div key={i} style={{padding:'8px 0',borderBottom:'1px solid #eee'}}>第{i}家{长}</div>)}
      <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:12}}><Button>上一页</Button><Button>下一页</Button></div>
    </div>;}
    function 客户页(){const [开,set]=React.useState(0);React.useEffect(()=>{登记详情名(长);const a=登记智能总结(()=>set(n=>n+1));return ()=>{登记详情名(null);a();};},[]);
      // 照客户详情页（RecordView）的外形：.rec-page 里页头 + 三栏各自滚（.main 定高一屏）。图3 截断就出在这种页上
      const 栏=(名,n)=><div className={名}>{Array.from({length:n},(_,i)=><div key={i} className="rec-sec" style={{padding:'10px 0',borderBottom:'1px solid #eee'}}>{名}第{i}条</div>)}</div>;
      return <div className="rec-page"><div className="page-head" style={{display:'flex',gap:8}}><b style={{flex:1}}>{长}</b><Button type="primary">页头按钮</Button></div>
        {开>0 && <div role="dialog" aria-label="智能总结抽屉">生成智能总结（第{开}次打开）</div>}
        <div className="rec">{栏('rec-rail',30)}{栏('rec-col',40)}{栏('rec-right',30)}</div></div>;}
    createRoot(document.getElementById('root')).render(<MotionTheme><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <Shell user={{id:'qa',name:'测试同事',email:'qa@example.test',role:'ADMIN',title:''}} workspace={{name:'工作区'}} desktop={false} 反馈去向="none"
        企业版项目={true} 企业版={true} pane={null} ai={{models:[]}} 要跟={{逾期:0,今天:0}} 收藏={[]} 项目收藏={[]}
        全局搜索={async()=>({客户:[],项目:[],联系人:[]})}>{location.pathname.startsWith('/customers/')?<客户页/>:<页/>}</Shell>
    </BusinessProvider></App></MotionTheme>);` } });
  包 = r.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(宽 = 1280, 少动 = false, 址 = "/customers"): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 宽, height: 800 }, reducedMotion: 少动 ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://ent.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto(`http://ent.test${址}`);
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

describe("lib/ai-float：智能总结入口（扣额度的付费入口不能丢）", () => {
  it("没登记不摆、点了 false；客户页登记后订阅的人收到通知、点了走登记的那个（原抽屉）；卸掉后又没有", () => {
    let 通知 = 0;
    const 退订 = 订阅智能总结(() => { 通知++; });
    expect(有智能总结()).toBe(false);
    expect(打开智能总结()).toBe(false);
    let 开抽屉 = 0;
    const 取消 = 登记智能总结(() => { 开抽屉++; });
    expect(通知).toBe(1);
    expect(有智能总结()).toBe(true);
    expect(打开智能总结()).toBe(true);
    expect(开抽屉).toBe(1);
    取消();
    expect(通知).toBe(2);
    expect(有智能总结()).toBe(false);
    退订();
  });

  it("接线（源码）：客户页把「开原 AiPanel 抽屉」登记给浮窗；HomeChat 窄模式空屏的快捷项走 Composer 的 问()", () => {
    const 客户页 = readFileSync(path.resolve("src/app/(app)/customers/[id]/RecordView.tsx"), "utf8");
    expect(客户页).toMatch(/登记智能总结\(\(\) => setAI抽屉开着\(true\)\)/);
    expect(客户页).toMatch(/open=\{AI抽屉开着\}[\s\S]{0,200}<AiPanel/);
    const 对话 = readFileSync(path.resolve("src/app/(app)/dashboard/HomeChat.tsx"), "utf8");
    expect(对话).toMatch(/<AiQuickAsks 项=\{空屏快捷\} 问=\{\(q\) => composerRef\.current\?\.问\(q\)\} \/>/);
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
      const 空着高 = await 浮窗(page).evaluate((d) => d.getBoundingClientRect().height);
      await page.evaluate(() => (window as unknown as { __问: (q: string) => void }).__问("Nordic Fun 现在卡在哪？"));
      await page.getByText("Nordic Fun 现在卡在哪？ 的回答").waitFor();
      const [高, 底] = await 浮窗(page).evaluate((d) => [d.getBoundingClientRect().height, innerHeight - d.getBoundingClientRect().bottom]);
      expect(高, "问过之后向上长成对话（随内容，最高 60% 屏高）").toBeGreaterThan(空着高 + 20);
      expect(高).toBeLessThanOrEqual(800 * 0.6 + 1);
      expect(底, "底不动").toBeLessThan(40);
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

  it("客户页（dt.ai）：空屏三颗快捷项；「总结这位客户」开原智能总结抽屉、浮窗收回球；另两颗直接发问句；别的页不摆", async () => {
    const { page, errors } = await 开(1280, false, "/customers/c1");
    try {
      await 打开(page);
      const 组 = page.getByRole("group", { name: "快捷提问" });
      expect(await 组.getByRole("button").allTextContents()).toEqual(["总结这位客户", "起草跟进话术", "现在卡在哪"]);
      expect(await page.locator(".dock-float-ctx").textContent()).toContain("客户 · ");
      await 组.getByRole("button", { name: "总结这位客户" }).click();
      expect(await page.getByRole("dialog", { name: "智能总结抽屉" }).textContent()).toContain("第1次打开");
      await page.getByRole("button", { name: "打开 AI 对话" }).waitFor();
      expect(await page.getByRole("complementary", { name: "AI 对话" }).count(), "浮窗收回球，不和抽屉叠").toBe(0);
      await page.getByRole("button", { name: "打开 AI 对话" }).click();
      await page.waitForTimeout(400);
      await page.getByRole("group", { name: "快捷提问" }).getByRole("button", { name: "现在卡在哪" }).click();
      await page.getByText(/现在卡在哪？ 的回答$/).waitFor();
      expect(await page.getByText(/^华东超长名字.*现在卡在哪？ 的回答$/).count()).toBe(1);
      expect(await page.getByRole("group", { name: "快捷提问" }).count(), "问过之后不摆").toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
    const 列表 = await 开(1280);
    try {
      await 打开(列表.page);
      expect(await 列表.page.getByRole("group", { name: "快捷提问" }).count(), "列表页不摆").toBe(0);
    } finally { await 列表.page.context().close(); }
  });

  /* 教练点评改版 PR1（11-21）：客户页页头「AI」按钮去掉了。手机没有浮窗，页头 AI 原来开的是智能总结抽屉；
     去掉后手机靠浮标点开的铺满屏面板进智能总结——铺满屏那支也摆同一份快捷项，「总结这位客户」开原抽屉、面板收起不叠 */
  it("手机 390 客户页：浮标点开铺满屏面板，空屏也有「总结这位客户」等三颗；点了开原智能总结抽屉、面板收起；列表页不摆", async () => {
    const { page, errors } = await 开(390, false, "/customers/c1");
    try {
      await page.getByRole("button", { name: "打开 AI 对话" }).click();
      await page.getByRole("complementary", { name: "AI 面板" }).waitFor();
      const 组 = page.getByRole("group", { name: "快捷提问" });
      expect(await 组.getByRole("button").allTextContents()).toEqual(["总结这位客户", "起草跟进话术", "现在卡在哪"]);
      await 组.getByRole("button", { name: "总结这位客户" }).click();
      expect(await page.getByRole("dialog", { name: "智能总结抽屉" }).textContent()).toContain("第1次打开");
      expect(await page.getByRole("complementary", { name: "AI 面板" }).count(), "面板收起，不和抽屉叠").toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
    const 列表 = await 开(390);
    try {
      await 列表.page.getByRole("button", { name: "打开 AI 对话" }).click();
      await 列表.page.getByRole("complementary", { name: "AI 面板" }).waitFor();
      expect(await 列表.page.getByRole("group", { name: "快捷提问" }).count(), "列表页不摆").toBe(0);
    } finally { await 列表.page.context().close(); }
  });

  /* 11-15 用户（c1 上实点）：「右下角的悬浮点击之后，影响了显示的全部信息……不要影响原有排版」——图3 客户页三栏在浮窗上沿截断。
     原因：浮窗开着时正文底下按浮窗高让位的那条（.shell:has(.dock-float:not(.is-min)) .app-content…）比记录页「底下只留 22」那条更具体，
     记录页 .main 定高一屏，多出的一大截内边距把三栏整个压矮。现在开不开浮窗，正文、三栏一个像素都不动 */
  for (const 址 of ["/customers/c1", "/customers"]) {
    it(`开浮窗不动页面排版（${址}）：正文框、正文可滚高度、各栏框和可滚高度开前开后一样，页面不多出滚动`, async () => {
      const { page, errors } = await 开(1280, false, 址);
      try {
        const 量 = () => page.evaluate(() => {
          const 框 = (e: Element) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(","); };
          const main = document.querySelector("main")!;
          return {
            main: 框(main), main滚高: main.scrollHeight, 页滚高: document.documentElement.scrollHeight,
            栏: [...document.querySelectorAll(".rec > *")].map((e) => `${框(e)}|${e.scrollHeight}`),
            内边距: getComputedStyle(main).paddingBottom,
          };
        });
        // 进页那一下的淡入上移（3px）先落定：只等有限次的动画，浮标的呼吸是无限循环
        await page.evaluate(() => Promise.all(document.getAnimations().filter((x) => x.effect?.getTiming().iterations !== Infinity).map((x) => x.finished.catch(() => {}))));
        const 前 = await 量();
        if (址 !== "/customers") expect(前.栏.length, "三栏的样子摆出来了").toBe(3);
        await 打开(page);
        expect(await 量()).toEqual(前);
        // 问过之后长成对话、缩成一行，也都不动
        await page.evaluate(() => (window as unknown as { __问: (q: string) => void }).__问("现在卡在哪？"));
        await page.waitForTimeout(400);
        expect(await 量()).toEqual(前);
        await page.getByRole("button", { name: "收起 AI 对话" }).click();
        await page.waitForTimeout(450);
        expect(await 量()).toEqual(前);
        expect(errors).toEqual([]);
      } finally { await page.context().close(); }
    });
  }

  /* 排版闸门「AI栏常驻」（11-15 整合后量出来的）：设置这类不摆浮标的页，⌘J 照样叫得出浮窗；叫出来时正文底下也要留那一截，
     不然滚到底最后几行（设置左栏的回收站、操作日志，表单的保存）压在浮窗下面。有浮标的页开不开都是同一截（上一条） */
  it("没有浮标的页（/settings）⌘J 叫出浮窗：正文底下也留出那一截，滚到底最后一行在浮窗上面；收起后回原样", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 680 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(5000);
    try {
      await page.route("http://ent.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
      await page.goto("http://ent.test/settings");
      await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
      await page.addScriptTag({ content: 包 });
      await page.getByRole("button", { name: "下一页" }).waitFor();
      expect(await page.getByRole("button", { name: "打开 AI 对话" }).count(), "设置页不摆浮标").toBe(0);
      const 底 = () => page.evaluate(() => getComputedStyle(document.querySelector("main")!).paddingBottom);
      const 关着 = await 底();
      await page.keyboard.press("Control+j");
      await page.getByRole("complementary", { name: "AI 对话" }).waitFor();
      await page.waitForTimeout(450);
      expect(await 底()).toBe("160px");
      await page.evaluate(() => { for (const e of document.querySelectorAll<HTMLElement>("*")) if (e.scrollHeight > e.clientHeight + 1) e.scrollTop = e.scrollHeight; window.scrollTo(0, document.documentElement.scrollHeight); });
      await page.waitForTimeout(200);
      const [键, 窗] = await Promise.all([page.getByRole("button", { name: "下一页" }).boundingBox(), 浮窗(page).boundingBox()]);
      expect(键!.y + 键!.height, "滚到底，最后一行的按钮在浮窗上沿之上").toBeLessThanOrEqual(窗!.y);
      await page.getByRole("button", { name: "收起 AI 对话" }).click();
      await page.waitForTimeout(450);
      expect(await 底()).toBe(关着);
    } finally { await ctx.close(); }
  });

  it("图4 那样一条：没问过时只是一条输入框（头一行 + 输入 + 一排小键），不过 140 高；快捷键说明、快捷项手不在浮窗上时不摆", async () => {
    const { page, errors } = await 开(1280, false, "/customers/c1");
    try {
      await 打开(page);
      const 框 = () => 浮窗(page).evaluate((d) => d.getBoundingClientRect().height);
      // 一开光标就在输入框里：快捷项、说明摆着
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("问一句");
      expect(await page.getByRole("group", { name: "快捷提问" }).isVisible()).toBe(true);
      expect(await page.getByText("免费次数还剩 20 次 · 每问用 1 次").isVisible()).toBe(true);
      // 手离开（点到页头的空白、鼠标挪开）：只剩一条
      await page.mouse.move(5, 790);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      expect(await page.getByRole("group", { name: "快捷提问" }).isVisible()).toBe(false);
      expect(await page.getByText("免费次数还剩 20 次 · 每问用 1 次").isVisible()).toBe(false);
      const 一条 = await 框();
      expect(一条).toBeLessThanOrEqual(120);
      // 输入框不自带框：浮窗本身就是那条框
      expect(await page.locator(".dock-float .cli-input").evaluate((e) => getComputedStyle(e).borderTopColor)).toBe("rgba(0, 0, 0, 0)");
      // 问过之后向上长，最多 60% 屏高，里面自己滚
      await page.evaluate(() => { for (let i = 0; i < 30; i++) (window as unknown as { __问: (q: string) => void }).__问(`第${i}问`); });
      await page.waitForTimeout(300);
      const 长 = await 浮窗(page).evaluate((d) => ({ 高: d.getBoundingClientRect().height, 底: innerHeight - d.getBoundingClientRect().bottom, 滚: (d.querySelector(".dock-body") as HTMLElement).scrollHeight > (d.querySelector(".dock-body") as HTMLElement).clientHeight }));
      expect(长.高).toBeLessThanOrEqual(800 * 0.6 + 1);
      expect(长.底, "底不动、向上长").toBeLessThan(40);
      expect(长.滚).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("拖动：按把手拖到哪停哪，拖不出窗口（四边留 8）；头一行空白处也能拖，按在输入框上不拖；松手不滑（left/bottom 不过渡）", async () => {
    const { page, errors } = await 开(1280, false, "/customers/c1");
    try {
      await 打开(page);
      const 框 = () => 浮窗(page).evaluate((d) => { const r = d.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; });
      const 把手 = page.getByRole("button", { name: /拖动 AI 对话框/ });
      const 起 = await 框();
      const g = (await 把手.boundingBox())!;
      // 往左上拖 200 / 300
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2 - 100, g.y + g.height / 2 - 150, { steps: 4 });
      await page.mouse.move(g.x + g.width / 2 - 200, g.y + g.height / 2 - 300, { steps: 4 });
      await page.mouse.up();
      const 中 = await 框();
      expect(中.x - 起.x).toBe(-200);
      expect(中.y - 起.y).toBe(-300);
      expect(await 浮窗(page).evaluate((d) => getComputedStyle(d).transitionProperty)).not.toMatch(/left|bottom|translate|all/);
      // 拖过头：停在左上角，四边至少 8
      const g2 = (await 把手.boundingBox())!;
      await page.mouse.move(g2.x + 5, g2.y + 5);
      await page.mouse.down();
      await page.mouse.move(-400, -400, { steps: 6 });
      await page.mouse.up();
      expect(await 框()).toMatchObject({ x: 8, y: 8 });
      // 往右下拖过头：右、下也留 8
      const g3 = (await 把手.boundingBox())!;
      await page.mouse.move(g3.x + 5, g3.y + 5);
      await page.mouse.down();
      await page.mouse.move(3000, 3000, { steps: 6 });
      await page.mouse.up();
      const 右下 = await 框();
      expect(1280 - 右下.r).toBe(8);
      expect(800 - 右下.b).toBe(8);
      // 头一行空白处也能拖
      const sp = (await page.locator(".dock-float-sp").boundingBox())!;
      await page.mouse.move(sp.x + sp.width / 2, sp.y + sp.height / 2);
      await page.mouse.down();
      await page.mouse.move(sp.x + sp.width / 2 - 120, sp.y + sp.height / 2 - 60, { steps: 4 });
      await page.mouse.up();
      const 空白拖 = await 框();
      expect(空白拖.r).toBe(1280 - 8 - 120);
      expect(空白拖.b).toBe(800 - 8 - 60);
      // 按在输入框上拖：是选字，不挪
      const ta = (await page.getByRole("textbox", { name: "问一句" }).boundingBox())!;
      await page.mouse.move(ta.x + 10, ta.y + 5);
      await page.mouse.down();
      await page.mouse.move(ta.x - 200, ta.y - 200, { steps: 4 });
      await page.mouse.up();
      expect(await 框()).toEqual(空白拖);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("位置按人记住：刷新后还在原处；双击把手回到默认位置（记的也清掉）；窗口缩小时收回窗口里", async () => {
    const { page, errors } = await 开(1280, false, "/customers/c1");
    try {
      await 打开(page);
      const 框 = () => 浮窗(page).evaluate((d) => { const r = d.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; });
      const 默认 = await 框();
      const 把手 = page.getByRole("button", { name: /拖动 AI 对话框/ });
      const g = (await 把手.boundingBox())!;
      await page.mouse.move(g.x + 5, g.y + 5);
      await page.mouse.down();
      await page.mouse.move(-400, -400, { steps: 6 });
      await page.mouse.up();
      expect(await 框()).toMatchObject({ x: 8, y: 8 });
      expect(await page.evaluate(() => localStorage.getItem("ai-float-pos:qa"))).toBeTruthy();
      // 刷新（同一个人、同一台）：还在左上角
      await page.reload();
      await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
      await page.addScriptTag({ content: 包 });
      await 打开(page);
      expect(await 框()).toMatchObject({ x: 8, y: 8 });
      // 窗口缩小：拖到右下再缩，收回窗口里；放大回去不乱跑
      const g2 = (await 把手.boundingBox())!;
      await page.mouse.move(g2.x + 5, g2.y + 5);
      await page.mouse.down();
      await page.mouse.move(3000, 3000, { steps: 6 });
      await page.mouse.up();
      await page.setViewportSize({ width: 1024, height: 640 });
      await page.waitForTimeout(200);
      const 缩 = await 框();
      expect(1024 - 缩.r).toBeGreaterThanOrEqual(8);
      expect(640 - 缩.b).toBeGreaterThanOrEqual(8);
      expect(缩.x).toBeGreaterThanOrEqual(8);
      expect(缩.y).toBeGreaterThanOrEqual(8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(200);
      // 双击把手：回默认（居中在正文里、贴底）
      await 把手.dblclick();
      expect(await 框()).toEqual(默认);
      expect(await page.evaluate(() => localStorage.getItem("ai-float-pos:qa"))).toBeNull();
      expect(await 浮窗(page).evaluate((d) => d.hasAttribute("data-moved"))).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("键盘：把手能 Tab 到，方向键一下挪 16、Shift 一下挪 64，挪了也记住；localStorage 不能用时照样能拖、不报错", async () => {
    const { page, errors } = await 开(1280, true, "/customers/c1");
    try {
      await 打开(page);
      const 框 = () => 浮窗(page).evaluate((d) => { const r = d.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; });
      const 起 = await 框();
      const 把手 = page.getByRole("button", { name: /拖动 AI 对话框/ });
      await 把手.focus();
      await page.keyboard.press("ArrowLeft");
      expect(await 框()).toEqual({ x: 起.x - 16, y: 起.y });
      await page.keyboard.press("Shift+ArrowUp");
      expect(await 框()).toEqual({ x: 起.x - 16, y: 起.y - 64 });
      expect(JSON.parse((await page.evaluate(() => localStorage.getItem("ai-float-pos:qa")))!)).toMatchObject({ left: 起.x - 16 });
      // 减弱动态：挪就是挪，不过渡
      expect(await 浮窗(page).evaluate((d) => getComputedStyle(d).transitionProperty)).toBe("opacity");
      // 存储被禁（无痕 / 策略）：读写都抛，照样能挪
      await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("禁"); }; Storage.prototype.getItem = () => { throw new Error("禁"); }; Storage.prototype.removeItem = () => { throw new Error("禁"); }; });
      await page.keyboard.press("ArrowRight");
      expect(await 框()).toEqual({ x: 起.x, y: 起.y - 64 });
      await 把手.dblclick();
      expect(await 框()).toEqual(起);
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
        // 顶上那屏：页头的按钮、左栏一个都不压（默认位置）
        const 顶上 = await page.evaluate(() => {
          const main = document.querySelector("main")!;
          main.scrollTop = 0; window.scrollTo(0, 0);
          const d = document.querySelector<HTMLElement>(".dock-float")!.getBoundingClientRect();
          const 按钮们 = [...document.querySelectorAll<HTMLElement>("main button, .rail a, .rail button, .rail")].filter((b) => b.offsetParent);
          return 按钮们.filter((b) => { const r = b.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0 && r.top < 200 && r.left < d.right && r.right > d.left && r.top < d.bottom && r.bottom > d.top; }).map((b) => b.textContent || b.className);
        });
        expect(顶上).toEqual([]);
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
