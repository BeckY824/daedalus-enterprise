/**
 * PR2 全局外壳观感（原型 前端改版-逐块确认 g.nav / g.cmdk / g.menu / g.numbers / g.empty + 骨架；规则 P-界面-38）。
 * 真浏览器 + 真 antd + 真 globals.css，量的是「看起来怎样」：
 *   弹层   从触发处 .97 缩放 + 淡入、100ms；减弱动态下只淡入、一点不缩放；离场淡出
 *   悬停   进入即时、离开 150ms（按钮、表格行）
 *   左栏   Windows 常见的 1024 / 1280 / 1366 宽，超长收藏名不把左栏撑出、页面不横滚、每一项点得到它自己
 *   ⌘K     高亮是同一块底色在行间走；超长公司名 / 项目名不撑出横滚；行数超过上限就不做滑动（防掉帧）
 *   数字   变了从旧数滚到新数，第一次直接是数；减弱动态下直接到位
 *   空状态 标题、说明、按钮依次进来；减弱动态下不位移只淡入
 *   骨架   读屏念「正在加载」；减弱动态下不扫光
 * 认元素尽量用 role / 文字；只有我们自己的类（rail、cmdk、skel）才按类找，不认 antd 的内部类名。
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { 重排上限 } from "@/lib/motion";

const 长公司 = "华东超长名字展览展示器材制造与进出口贸易集团股份有限公司上海分公司第二事业部";
const 长项目 = "二〇二六年度长三角区域多城市巡回展会特装展台设计搭建与现场运营整体服务项目（二期）";

let browser: Browser;
let 壳包: string;
let 件包: string;

const 打包选项 = { bundle: true, write: false as const, format: "iife" as const, jsx: "automatic" as const, alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" as const };

/** AppShell 用的假 next / 空子件（同 ent-rail-mini.ui.test.ts） */
const 壳插件: Plugin = { name: "ent-shell-look", setup(b) {
  b.onResolve({ filter: /^next\/(navigation|link)$/ }, (a) => ({ path: a.path, namespace: "fixture" }));
  b.onResolve({ filter: /(^|\/)(WhatsNew|UpdateRow|FeedbackButton|AiCost|RailResizer|AwaitAssignTodo|RecordView|ProjectDetail|NoticeBell|AiDock)$/ }, (a) => ({ path: a.path, namespace: "empty-child" }));
  b.onLoad({ filter: /.*/, namespace: "empty-child" }, () => ({ contents: "export default function Empty(){return null} export function AiMeterBar(){return null}" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ resolveDir: process.cwd(), contents: a.path === "next/link"
    ? `import React from 'react';export default function Link({href,onClick,prefetch,unstable_dynamicOnHover,children,...p}){return React.createElement('a',{...p,href,onClick:e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.__route=href}}},children)}`
    : `export const useRouter=()=>({push:p=>window.__route=p,refresh:()=>{}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);` }));
} };

/** 组件页：EmptyState 引了服务端动作（演示数据），换成假的 */
const 件插件: Plugin = { name: "ent-shell-look-parts", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({push(){},refresh(){},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可用:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  const 壳 = await build({ ...打包选项, plugins: [壳插件], stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import MotionTheme from '@/components/MotionTheme';
    import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';import Shell from '@/components/AppShell';
    window.__route='';window.desktopNav={onGo:()=>()=>{},setCustomerLabel:async()=>true};
    const 长公司=${JSON.stringify(长公司)}, 长项目=${JSON.stringify(长项目)};
    const 一条=(组,i,名)=>({id:组+i,name:名,附注:'负责人 '+'欧阳'.repeat(6),去:'/'+组+'/'+i});
    window.__搜=async(q)=>{
      if(q.startsWith('多')){const n=Number(window.__多??60);const xs=Array.from({length:n},(_,i)=>一条('customers',i,'第'+i+'家'+长公司));return {客户:q.length>2?xs.reverse():xs,项目:[],联系人:[]};}
      if(q.includes('华东'))return {客户:[一条('customers',1,长公司),一条('customers',2,'华东展具')],项目:[一条('projects',1,长项目)],联系人:[]};
      return {客户:[],项目:[],联系人:[]};
    };
    createRoot(document.getElementById('root')).render(<MotionTheme><App><BusinessProvider value={{...DEFAULT_BUSINESS,projectMode:true}}>
      <Shell user={{id:'qa',name:'一个名字特别特别长的同事欧阳'.repeat(2),email:'qa@example.test',role:'ADMIN',title:''}} workspace={{name:'工作区'}} desktop={false} 反馈去向="none"
        企业版项目={true} 企业版={true} pane={null} ai={null} 要跟={{逾期:3,今天:120}} 收藏={[{id:'c1',name:长公司},{id:'c2',name:'甲'}]} 项目收藏={[{id:'p1',name:长项目}]}
        全局搜索={(q)=>window.__搜(q)}><div>正文</div></Shell>
    </BusinessProvider></App></MotionTheme>);` } });
  壳包 = 壳.outputFiles[0].text;

  const 件 = await build({ ...打包选项, plugins: [件插件], stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React, {useState} from 'react';import {createRoot} from 'react-dom/client';import {App, Button, Dropdown, Input, InputNumber, Modal, Table, Tooltip} from 'antd';
    import MotionTheme from '@/components/MotionTheme';
    import Skeleton from '@/components/Skeleton';import EmptyState from '@/components/EmptyState';import CountUp from '@/components/CountUp';
    function 数(){const [v,set]=useState(1200);window.__set=set;return <b data-testid="num"><CountUp 值={v} 记号="kpi:test" 只滚变化/></b>;}
    function 弹窗(){const [开,set开]=useState(false);window.__弹=()=>set开(true);return <Modal open={开} title="编辑客户" onCancel={()=>set开(false)}><p>弹窗正文</p></Modal>;}
    function 页(){const [空,set空]=useState(false);window.__空=()=>set空(true);return <div style={{padding:40}}>
      <Dropdown trigger={['click']} menu={{items:[{key:'a',label:'编辑'},{key:'b',label:'转让给同事'},{key:'c',label:'退回公海'}]}}><Button>更多操作</Button></Dropdown>
      <Tooltip title="提示内容"><Button>悬停看提示</Button></Tooltip>
      <Table rowKey="k" dataSource={[{k:1,n:'甲公司'},{k:2,n:'乙公司'}]} columns={[{title:'名称',dataIndex:'n'}]} pagination={false}/>
      <Input aria-label="客户名称" placeholder="客户名称"/>
      <Input aria-label="手机号" status="error"/>
      <InputNumber aria-label="金额"/>
      <Button onClick={()=>window.__弹?.()}>打开弹窗</Button>
      <弹窗/>
      <Skeleton 行={5}/>
      <数/>
      {空 && <EmptyState title="今天没有待办" hint="下一次跟进可以在沟通里一起定" demo={false} primary={{label:'加一条待办',onClick(){}}}/>}
    </div>;}
    createRoot(document.getElementById('root')).render(<MotionTheme><App><页/></App></MotionTheme>);` } });
  件包 = 件.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(包: string, { 宽 = 1280, 址 = "/customers", 少动 = false } = {}): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 宽, height: 800 }, reducedMotion: 少动 ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://ent.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto(`http://ent.test${址}`);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  // 记下每一次 CSS 动画开头那一刻：谁、什么关键帧、多长、原点、那一帧的 transform（弹层只活 100ms，事后量不到）
  await page.evaluate(() => {
    const w = window as unknown as { __动: unknown[] };
    w.__动 = [];
    document.addEventListener("animationstart", (e) => {
      const el = e.target as HTMLElement;
      const cs = getComputedStyle(el);
      const 记 = { 名: e.animationName, 时长: cs.animationDuration, 原点: cs.transformOrigin, 变换: cs.transform, 有菜单: !!el.querySelector("[role=menu]"), 有提示: !!el.querySelector("[role=tooltip]") || el.getAttribute("role") === "tooltip", 半路变换: "" };
      w.__动.push(记);
      requestAnimationFrame(() => { 记.半路变换 = getComputedStyle(el).transform; });
    }, true);
  });
  await page.addScriptTag({ content: 包 });
  return { page, errors };
}
type 动 = { 名: string; 时长: string; 原点: string; 变换: string; 有菜单: boolean; 有提示: boolean; 半路变换: string };
const 动画们 = (page: Page) => page.evaluate(() => (window as unknown as { __动: 动[] }).__动);

describe("弹层（P-界面-38：从触发处 .97、100ms；减弱动态只淡入）", () => {
  it("下拉菜单：进场 crm-pop-in、100ms、原点在左上（挨着按钮那一角），开头那一帧是缩着的；关掉时淡出", async () => {
    const { page, errors } = await 开(件包);
    try {
      await page.getByRole("button", { name: "更多操作" }).click();
      await page.getByRole("menuitem", { name: "转让给同事" }).waitFor();
      await expect.poll(async () => (await 动画们(page)).filter((a) => a.有菜单).length).toBeGreaterThan(0);
      const 进 = (await 动画们(page)).find((a) => a.有菜单)!;
      expect(进.名).toBe("crm-pop-in");
      expect(进.时长).toBe("0.1s");
      expect(进.原点.startsWith("0px 0px")).toBe(true);
      // 事件到的时候已经走了一小段：缩放落在 [.97, 1) 之间就是「从 .97 长出来」，不是 antd 原来的 scaleY(.8)
      const [a, , , d] = (/^matrix\(([^)]*)\)$/.exec(进.变换)?.[1] ?? "1,0,0,1").split(",").map(Number);
      const 缩 = { a, d };
      expect(缩.a, `开头那一帧应该是缩着的：${进.变换}`).toBeGreaterThanOrEqual(0.969);
      expect(缩.a).toBeLessThan(0.999);
      expect(缩.d, "等比缩放，不是只压竖向").toBeCloseTo(缩.a, 5);
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await 动画们(page)).some((a) => a.有菜单 && a.名 === "crm-pop-out")).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("减弱动态：下拉、提示都只淡入，进场的每一帧都没有缩放", async () => {
    const { page, errors } = await 开(件包, { 少动: true });
    try {
      await page.getByRole("button", { name: "更多操作" }).click();
      await page.getByRole("menuitem", { name: "编辑" }).waitFor();
      await page.getByRole("button", { name: "悬停看提示" }).hover();
      await page.getByRole("tooltip").filter({ hasText: "提示内容" }).waitFor();
      await expect.poll(async () => (await 动画们(page)).filter((a) => a.有菜单 || a.有提示).length).toBeGreaterThanOrEqual(2);
      await page.waitForTimeout(50);
      const 进们 = (await 动画们(page)).filter((a) => (a.有菜单 || a.有提示) && /in$/.test(a.名));
      expect(进们.length).toBeGreaterThanOrEqual(2);
      for (const a of 进们) {
        expect(a.名).toBe("crm-pop-fade-in");
        expect(a.变换, "开头那一帧不许缩放").toBe("none");
        expect(a.半路变换, "半路也不许缩放").toBe("none");
      }
      // 菜单还是正常大小、点得到
      const 框 = await page.getByRole("menu").boundingBox();
      expect(框!.width).toBeGreaterThan(60);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });
});

describe("悬停：进入即时、离开 150ms", () => {
  it("按钮：平时底色过渡 150ms、缩放 120ms；指上去底色那一项变 0（缩放不受影响）", async () => {
    const { page } = await 开(件包);
    try {
      const 钮 = page.getByRole("button", { name: "悬停看提示" });
      const 时长 = () => 钮.evaluate((el) => getComputedStyle(el).transitionDuration);
      expect(await 时长()).toBe("0.15s, 0.12s");
      await 钮.hover();
      expect(await 时长()).toBe("0s, 0.12s");
    } finally { await page.context().close(); }
  });

  it("表格行：只变底色不缩放，指上去 0、移开 150ms", async () => {
    const { page } = await 开(件包);
    try {
      const 格 = page.getByRole("cell", { name: "甲公司" });
      const 读 = () => 格.evaluate((el) => ({ 时长: getComputedStyle(el).transitionDuration, 属性: getComputedStyle(el).transitionProperty, 缩放: getComputedStyle(el.parentElement!).scale }));
      expect(await 读()).toEqual({ 时长: "0.15s, 0.15s", 属性: "background-color, border-color", 缩放: "none" });
      await 格.hover();
      expect((await 读()).时长).toBe("0s");
    } finally { await page.context().close(); }
  });
});

describe("左栏（g.nav）：Windows 常见宽度不溢出", () => {
  for (const 宽 of [1024, 1280, 1366]) {
    it(`${宽} 宽：超长收藏名、超长账号名不把左栏撑出，页面不横滚，每一项点得到它自己`, async () => {
      const { page, errors } = await 开(壳包, { 宽 });
      try {
        const 栏 = page.getByRole("navigation", { name: "主导航" });
        await 栏.waitFor();
        await page.getByText(长公司).first().waitFor({ state: "attached" });
        const 量 = await 栏.evaluate((nav) => {
          const 右 = nav.getBoundingClientRect().right;
          const 项 = [...nav.querySelectorAll<HTMLElement>("a, button")].filter((el) => el.offsetParent !== null);
          return {
            出界: 项.filter((el) => el.getBoundingClientRect().right > 右 + 0.5).map((el) => el.getAttribute("aria-label") ?? el.textContent?.slice(0, 20)),
            点不到: 项.filter((el) => {
              const r = el.getBoundingClientRect();
              if (r.width < 1 || r.height < 1 || r.bottom > innerHeight || r.top < 0) return false;
              const 中 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return !(中 && (el === 中 || el.contains(中)));
            }).map((el) => el.getAttribute("aria-label") ?? el.textContent?.slice(0, 20)),
            栏横滚: nav.scrollWidth > nav.clientWidth + 1,
            项数: 项.length,
          };
        });
        expect(量.项数).toBeGreaterThan(5);
        expect(量.出界, `${宽}`).toEqual([]);
        expect(量.点不到, `${宽}`).toEqual([]);
        expect(量.栏横滚, `${宽}`).toBe(false);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        // 选中底块就一块，压在「客户」那一项里；明亮下是白块 + 一层很薄的阴影，浮在浅灰左栏上（11-23 底色开关删了，回到原样）
        expect(await 栏.evaluate((nav) => [...nav.querySelectorAll(".rail-on-bg")].map((x) => x.parentElement?.getAttribute("aria-label")?.split("，")[0]))).toEqual(["客户"]);
        const 底块 = await 栏.evaluate((nav) => { const cs = getComputedStyle(nav.querySelector(".rail-on-bg")!); return { 底: cs.backgroundColor, 影: cs.boxShadow }; });
        expect(底块.底).toBe("rgb(255, 255, 255)");
        expect(底块.影).not.toBe("none");
        expect(errors).toEqual([]);
      } finally { await page.context().close(); }
    });
  }
});

describe("⌘K（g.cmdk）", () => {
  async function 开单(page: Page) {
    await page.getByRole("navigation", { name: "主导航" }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event("cmdbar:open")));
    await page.getByRole("dialog").waitFor();
    return page.getByRole("dialog").getByRole("textbox");
  }
  const 高亮在哪 = (page: Page) => page.getByRole("dialog").evaluate((d) => [...d.querySelectorAll(".cmdk-on-bg")].map((x) => x.closest("button")?.querySelector("b")?.textContent ?? ""));

  it("1024 宽：高亮是同一块底色，↓ 走到下一行；超长公司名、项目名省略，不撑出横滚、点得到", async () => {
    const { page, errors } = await 开(壳包, { 宽: 1024 });
    try {
      const 框 = await 开单(page);
      expect(await 高亮在哪(page)).toEqual(["首页"]);
      await 框.press("ArrowDown");
      expect(await 高亮在哪(page)).toEqual(["复盘"]);
      await 框.fill("华东");
      const 长行 = page.getByRole("button", { name: new RegExp(长公司.slice(0, 10)) });
      await 长行.waitFor();
      await page.getByRole("button", { name: new RegExp(长项目.slice(0, 10)) }).waitFor();
      await page.waitForTimeout(400);
      expect((await 高亮在哪(page)).length).toBe(1);
      const 量 = await page.getByRole("dialog").evaluate((d) => {
        const 单 = d.querySelector<HTMLElement>(".cmdk-list")!;
        const 右 = 单.getBoundingClientRect().right;
        const 行 = [...单.querySelectorAll<HTMLElement>("button")];
        return {
          单横滚: 单.scrollWidth > 单.clientWidth + 1,
          出界: 行.filter((b) => b.getBoundingClientRect().right > 右 + 0.5).length,
          点不到: 行.filter((b) => { const r = b.getBoundingClientRect(); const 中 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(中 && b.contains(中)); }).length,
          省略: 行.filter((b) => { const n = b.querySelector("b")!; return n.scrollWidth > n.clientWidth; }).length,
        };
      });
      expect(量).toMatchObject({ 单横滚: false, 出界: 0, 点不到: 0 });
      expect(量.省略, "超长名字应该省略号收住").toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("弹窗毛玻璃：平时半透明 + 背后模糊；系统减少透明度、低配机（lite-fx）退回实色、不模糊", async () => {
    const { page, errors } = await 开(壳包, { 宽: 1280 });
    try {
      await 开单(page);
      await page.waitForTimeout(300);
      /** 从我们自己的 .cmdk 往上找第一层有底色的：那就是弹窗面板 */
      const 面板 = () => page.evaluate(() => {
        let el: HTMLElement | null = document.querySelector(".cmdk");
        while (el && getComputedStyle(el).backgroundColor === "rgba(0, 0, 0, 0)") el = el.parentElement;
        const cs = getComputedStyle(el!);
        return { 底: cs.backgroundColor, 糊: cs.backdropFilter };
      });
      const 平时 = await 面板();
      expect(平时.糊).toContain("blur(20px)");
      expect(平时.底).toMatch(/^(rgba\(255, 255, 255, 0\.8|color\(srgb 1 1 1 \/ 0\.8)/);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
      expect(await 面板()).toEqual({ 底: "rgb(255, 255, 255)", 糊: "none" });
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });
      expect((await 面板()).糊).toContain("blur(20px)");
      await page.evaluate(() => document.documentElement.classList.add("lite-fx"));
      expect(await 面板()).toEqual({ 底: "rgb(255, 255, 255)", 糊: "none" });
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });

  it(`打字筛选：留下的行滑到新位置；超过 ${重排上限} 行就整批硬换、不做滑动`, async () => {
    const { page, errors } = await 开(壳包);
    try {
      const 框 = await 开单(page);
      await page.waitForTimeout(300);
      /** 改完字的下一帧，有几行带着位移（motion 的 layout 动画在行上写 transform） */
      const 改字后在动的 = async (字: string) => {
        await page.evaluate(() => {
          const w = window as unknown as { __位移: number[] };
          w.__位移 = [];
          const 量 = () => w.__位移.push([...document.querySelectorAll<HTMLElement>(".cmdk-item")].filter((x) => x.style.transform && x.style.transform !== "none").length);
          requestAnimationFrame(() => { 量(); requestAnimationFrame(量); });
        });
        await 框.fill(字);
        await page.waitForTimeout(120);
        return Math.max(...(await page.evaluate(() => (window as unknown as { __位移: number[] }).__位移)));
      };
      // 「计划」只剩跟进计划一行：它从第 9 行滑到第 1 行
      expect(await 改字后在动的("计划")).toBeGreaterThan(0);
      await page.getByRole("button", { name: /跟进计划/ }).waitFor();
      // 60 家：翻个顺序，一行都不滑
      await 框.fill("多多");
      await page.getByRole("button", { name: /第59家/ }).waitFor();
      expect(await page.locator(".cmdk-item").count()).toBeGreaterThan(重排上限);
      await page.waitForTimeout(400);
      await 框.fill("多多多");
      await expect.poll(() => page.locator(".cmdk-item button b").nth(0).textContent()).toMatch(/^第59家/);
      const 在动 = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".cmdk-item")].filter((x) => x.style.transform && x.style.transform !== "none").length);
      expect(在动).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.context().close(); }
  });
});

describe("静态质感（g.feel）", () => {
  it("输入框（设计 D1）：平时白底 + --field-line 框；聚焦白底 + 主色框；报错红框", async () => {
    const { page } = await 开(件包);
    try {
      const 读 = (名: string) => page.getByRole(名 === "金额" ? "spinbutton" : "textbox", { name: 名 }).evaluate((el) => {
        const 框 = (el.closest("[class*='-outlined']") ?? el) as HTMLElement;
        const cs = getComputedStyle(框);
        return { 底: cs.backgroundColor, 框线: cs.borderTopColor, 宽: cs.borderTopWidth };
      });
      const 平时 = await 读("客户名称");
      expect(平时.底).toBe("rgb(255, 255, 255)");
      expect(平时.框线, "--field-line #c7c7cc").toBe("rgb(199, 199, 204)");
      expect(平时.宽, "框线宽度不变，尺寸一像素不动").toBe("1px");
      expect((await 读("金额")).底).toBe("rgb(255, 255, 255)");
      await page.getByRole("textbox", { name: "客户名称" }).focus();
      // antd 的框自带过渡，等它走完
      await expect.poll(async () => (await 读("客户名称")).框线).not.toBe("rgb(199, 199, 204)");
      const 聚焦 = await 读("客户名称");
      expect(聚焦.底).toBe("rgb(255, 255, 255)");
      const 报错 = await 读("手机号");
      expect(报错.底).toBe("rgb(255, 255, 255)");
      const [r, g, b] = 报错.框线.match(/\d+/g)!.map(Number);
      expect(r > 180 && g < 100 && b < 100, `报错框线是红色：${报错.框线}`).toBe(true);
    } finally { await page.context().close(); }
  });

  it("浮层和弹窗带 0.5px 发丝描边的阴影（弹窗外壳 antd 6 叫 container，也吃到）", async () => {
    const { page } = await 开(件包);
    try {
      await page.getByRole("button", { name: "打开弹窗" }).click();
      await page.getByRole("dialog").getByText("弹窗正文").waitFor();
      const 影 = await page.getByText("弹窗正文").evaluate((el) => {
        let x: HTMLElement | null = el as HTMLElement;
        while (x && getComputedStyle(x).boxShadow === "none") x = x.parentElement;
        return x ? getComputedStyle(x).boxShadow : "none";
      });
      expect(影).toMatch(/^rgba\(0, 0, 0, 0\.08\) 0px 0px 0px 0\.5px/);
    } finally { await page.context().close(); }
  });
});

describe("数字、空状态、骨架", () => {
  it("数字：第一次直接是数；变了从旧数滚到新数（半路是中间的数）；减弱动态直接到位", async () => {
    const { page } = await 开(件包);
    try {
      const 数 = page.getByTestId("num");
      expect(await 数.textContent()).toBe("1200");
      await page.evaluate(() => (window as unknown as { __set: (n: number) => void }).__set(1300));
      const 半路: string[] = [];
      for (let i = 0; i < 6; i++) { 半路.push((await 数.textContent())!); await page.waitForTimeout(25); }
      expect(半路.some((t) => Number(t) > 1200 && Number(t) < 1300), 半路.join(",")).toBe(true);
      await expect.poll(() => 数.textContent()).toBe("1300");
      expect(await 数.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toBeDefined();
    } finally { await page.context().close(); }
    const 少 = await 开(件包, { 少动: true });
    try {
      await 少.page.getByTestId("num").waitFor();
      await 少.page.evaluate(() => (window as unknown as { __set: (n: number) => void }).__set(1300));
      expect(await 少.page.getByTestId("num").textContent()).toBe("1300");
    } finally { await 少.page.context().close(); }
  });

  it("空状态：标题、说明、按钮依次进来（6px 上浮）；减弱动态下不位移、只淡入", async () => {
    for (const 少动 of [false, true]) {
      const { page, errors } = await 开(件包, { 少动 });
      try {
        await page.getByRole("button", { name: "更多操作" }).waitFor();
        await page.evaluate(() => (window as unknown as { __空: () => void }).__空());
        const 标题 = page.getByText("今天没有待办");
        await 标题.waitFor();
        const 读 = () => page.evaluate(() => {
          const t = [...document.querySelectorAll("div")].find((d) => d.textContent === "今天没有待办")!;
          const 按 = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("加一条待办"))!.parentElement!;
          const y = (el: Element) => new DOMMatrix(getComputedStyle(el).transform).m42;
          return { 标题y: y(t), 按钮y: y(按), 按钮透明: Number(getComputedStyle(按).opacity) };
        });
        const 起 = await 读();
        if (少动) {
          expect(起.标题y).toBe(0);
          expect(起.按钮y).toBe(0);
        } else {
          expect(起.按钮y, "按钮排在后面，开头还在 6px 下面").toBeGreaterThan(0);
          expect(起.按钮y).toBeLessThanOrEqual(6);
          expect(起.按钮透明).toBeLessThan(1);
        }
        await expect.poll(async () => (await 读()).按钮透明).toBe(1);
        expect((await 读()).按钮y).toBe(0);
        expect(errors).toEqual([]);
      } finally { await page.context().close(); }
    }
  });

  it("骨架：读屏念「正在加载」、五条灰条宽度三档轮着；减弱动态下不扫光", async () => {
    for (const 少动 of [false, true]) {
      const { page } = await 开(件包, { 少动 });
      try {
        const 骨 = page.getByRole("status", { name: "正在加载" });
        await 骨.waitFor();
        const 量 = await 骨.evaluate((el) => {
          const 条 = [...el.children] as HTMLElement[];
          const 宽 = el.getBoundingClientRect().width;
          return { 条数: 条.length, 比: 条.map((c) => Math.round((c.getBoundingClientRect().width / 宽) * 100)), 动: getComputedStyle(条[0]).animationName, 读屏藏: 条.every((c) => c.getAttribute("aria-hidden") === "true") };
        });
        expect(量.条数).toBe(5);
        expect(量.比).toEqual([100, 86, 72, 100, 86]);
        expect(量.读屏藏).toBe(true);
        expect(量.动).toBe(少动 ? "none" : "skel-sweep");
      } finally { await page.context().close(); }
    }
  });
});
