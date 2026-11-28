/**
 * 发版不打断整条链路（O3 PR-C 第二阶段）：横幅亮 → 满足空闲条件 → 静默换（存好再刷新），在真浏览器里用假时钟跑。
 *   - 有未提交录入不换；撤掉（提交）后才换
 *   - 有弹层（自写浮层打 data-swap-busy、antd Popconfirm）不换；关掉才换
 *   - 非 GET 请求（保存）没回不换；回了才换
 *   - 滚动位置：换之后同地址 2 分钟内恢复；换地址、过期不恢复
 *   - 横幅「×」收起后照样按同样条件换
 * 「存好再刷新」的证据：刷新前事件 + 记位事件发出、sessionStorage 里有滚动记录、整页文档被重新请求一次。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
type 窗 = Window & { __sg: { 登记未提交(k: string): void; 撤未提交(k: string): void }; __刷新前?: number };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider,Popconfirm,Button} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import UpdateBanner from '@/components/UpdateBanner';import {useFormDraft} from '@/components/FormDraft';import {登记未提交,撤未提交} from '@/lib/swap-guard';
    window.__sg={登记未提交,撤未提交};
    function 草稿框(){const [t,setT]=React.useState('');useFormDraft({键:'测稿',值:{t},带回:(v)=>setT(String(v.t??''))});return <textarea data-testid="ta" value={t} onChange={e=>setT(e.target.value)}/>;}
    function 晚撑高(){const [h,setH]=React.useState(location.search.includes('late')?300:4000);React.useEffect(()=>{if(h<4000){const k=setTimeout(()=>setH(4000),1000);return()=>clearTimeout(k)}},[]);return <div style={{height:h}}/>;}
    window.addEventListener('crm:before-reload',()=>{sessionStorage.setItem('刷新前','1')});
    createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN}><App>
      <UpdateBanner 载入时="build-A"/>
      <草稿框/><晚撑高/>
      <div style={{height:location.search.includes('late')?300:4000}}>
        <Popconfirm title="确定？" okText="好" cancelText="不" getPopupContainer={()=>document.body}><Button data-testid="pc">删除</Button></Popconfirm>
      </div>
    </App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 点亮 = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("crm:stale-build")));
const 过 = (page: Page, 毫秒: number) => page.clock.runFor(毫秒);

async function 开(路径 = "/projects/p1", 假时钟 = true) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.setDefaultTimeout(5000);
  const 文档 = { 次: 0 };
  const 存 = { 放行: null as null | (() => void), 来过: 0 };
  await page.route("http://swap.test/api/version", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "build-B" }) }));
  await page.route("http://swap.test/api/save", async r => {
    存.来过++;
    await new Promise<void>(ok => { 存.放行 = ok; });
    await r.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.route("http://swap.test/b.js", r => r.fulfill({ contentType: "text/javascript", body: bundle }));
  await page.route("http://swap.test/projects/**", r => { 文档.次++; return r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div><script src='/b.js'></script>" }); });
  if (假时钟) await page.clock.install();
  await page.goto("http://swap.test" + 路径);
  await page.getByTestId("pc").waitFor();
  return { page, 文档, 存 };
}
/** 等整页重新载入一次（文档请求次数 +1 且新页起来） */
async function 换了(page: Page, 文档: { 次: number }, 前: number) {
  await expect.poll(() => 文档.次).toBe(前 + 1);
  await page.getByTestId("pc").waitFor();
}

it("有未提交录入不换；提交（撤掉）后、满足空闲条件才换，调的是「存好再刷新」", async () => {
  const { page, 文档 } = await 开();
  try {
    await 点亮(page);
    await page.getByTestId("update-bar").waitFor();
    await page.evaluate(() => (window as unknown as 窗).__sg.登记未提交("录入1"));
    await 过(page, 11 * 60_000);
    expect(文档.次).toBe(1);
    expect(await page.getByTestId("update-bar").count()).toBe(1);
    await page.evaluate(() => (window as unknown as 窗).__sg.撤未提交("录入1"));
    await 过(page, 6_000);
    await 换了(page, 文档, 1);
    expect(await page.evaluate(() => sessionStorage.getItem("刷新前"))).toBe("1");
    expect(await page.evaluate(() => sessionStorage.getItem("daedalus:换版滚动"))).toBeNull(); // 新页已读走并清掉
  } finally { await page.close(); }
});

it("空闲没到点不换：前台 9 分钟不动不换，到 10 分钟换", async () => {
  const { page, 文档 } = await 开();
  try {
    await 点亮(page);
    await page.getByTestId("update-bar").waitFor();
    await 过(page, 9 * 60_000);
    expect(文档.次).toBe(1);
    await 过(page, 61_000);
    await 换了(page, 文档, 1);
  } finally { await page.close(); }
});

it("有弹层不换：自写浮层（data-swap-busy）、antd Popconfirm 开着都挡；关掉才换", async () => {
  const { page, 文档 } = await 开();
  try {
    await 点亮(page);
    await page.getByTestId("update-bar").waitFor();
    // 自写浮层：只要打了统一标记
    await page.evaluate(() => { const d = document.createElement("div"); d.id = "自写"; d.setAttribute("data-swap-busy", ""); d.style.cssText = "position:fixed;top:100px;left:100px;width:50px;height:50px"; document.body.appendChild(d); });
    await 过(page, 11 * 60_000);
    expect(文档.次).toBe(1);
    await page.evaluate(() => document.getElementById("自写")!.remove());
    // antd Popconfirm 打开态（点一下按钮；点击会算「动静」，所以下面再过满 10 分钟）
    await page.getByTestId("pc").click();
    await page.locator(".ant-popover:not(.ant-popover-hidden)").waitFor();
    await 过(page, 11 * 60_000);
    expect(文档.次).toBe(1);
    await page.getByRole("button", { name: "不" }).click();
    await page.locator(".ant-popover-hidden, .ant-popover").first().waitFor({ state: "hidden" });
    await 过(page, 11 * 60_000);
    await 换了(page, 文档, 1);
  } finally { await page.close(); }
});

it("保存请求（POST）没回不换，回了才换", async () => {
  const { page, 文档, 存 } = await 开();
  try {
    await 点亮(page);
    await page.getByTestId("update-bar").waitFor();
    await page.evaluate(() => { (window as unknown as { __存: Promise<Response> }).__存 = fetch("/api/save", { method: "POST", body: "{}" }); });
    await expect.poll(() => 存.来过).toBe(1);
    await 过(page, 11 * 60_000);
    expect(文档.次).toBe(1);
    存.放行!();
    await page.evaluate(() => (window as unknown as { __存: Promise<Response> }).__存.then(r => r.text()));
    await 过(page, 6_000);
    await 换了(page, 文档, 1);
  } finally { await page.close(); }
});

it("横幅「×」收起后，仍按同样条件静默换（收起只是不看提示）", async () => {
  const { page, 文档 } = await 开();
  try {
    await 点亮(page);
    await page.getByTestId("update-bar").waitFor();
    await page.evaluate(() => (window as unknown as 窗).__sg.登记未提交("录入2"));
    await page.getByRole("button", { name: "先收起" }).click();
    expect(await page.getByTestId("update-bar").count()).toBe(0);
    await 过(page, 11 * 60_000);
    expect(文档.次).toBe(1);
    await page.evaluate(() => (window as unknown as 窗).__sg.撤未提交("录入2"));
    await 过(page, 6_000);
    await 换了(page, 文档, 1);
  } finally { await page.close(); }
});

it("滚动位置：同地址换版后恢复", async () => {
  const { page, 文档 } = await 开();
  try {
    await 点亮(page);
    await page.getByTestId("update-bar").waitFor();
    await page.evaluate(() => window.scrollTo(0, 700));
    await 过(page, 11 * 60_000);
    await 换了(page, 文档, 1);
    await page.clock.runFor(1_000);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(700);
  } finally { await page.close(); }
});

it("滚动位置：换了地址、超过 2 分钟的记录都不恢复", async () => {
  const { page } = await 开("/projects/p2", false);
  try {
    // 记的是别的地址
    await page.evaluate(() => { sessionStorage.setItem("daedalus:换版滚动", JSON.stringify({ at: Date.now(), 路径: "/projects/p1", 窗: 700, 们: [] })); });
    await page.reload();
    await page.getByTestId("pc").waitFor();
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => sessionStorage.getItem("daedalus:换版滚动"))).toBeNull();
    // 同地址但 3 分钟前
    await page.evaluate(() => { sessionStorage.setItem("daedalus:换版滚动", JSON.stringify({ at: Date.now() - 3 * 60_000, 路径: "/projects/p2", 窗: 700, 们: [] })); });
    await page.reload();
    await page.getByTestId("pc").waitFor();
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  } finally { await page.close(); }
});

it("滚动位置：内容晚撑高（1 秒后才够高）也能恢复", async () => {
  const { page } = await 开("/projects/p3?late=1", false);
  try {
    await page.evaluate(() => { sessionStorage.setItem("daedalus:换版滚动", JSON.stringify({ at: Date.now(), 路径: "/projects/p3?late=1", 窗: 1500, 们: [] })); });
    await page.reload();
    await page.getByTestId("pc").waitFor();
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 4000 }).toBe(1500);
  } finally { await page.close(); }
});

it("5 分钟内不二次换：换过一次后，落回旧进程又亮横幅，后台 60 秒不换，满 5 分钟才再换", async () => {
  const { page, 文档 } = await 开();
  try {
    await 点亮(page);
    await page.getByTestId("update-bar").waitFor();
    await 过(page, 11 * 60_000);
    await 换了(page, 文档, 1);
    await 点亮(page);
    await page.getByTestId("update-bar").waitFor();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await 过(page, 60_000);
    expect(文档.次).toBe(2);
    await 过(page, 5 * 60_000);
    await 换了(page, 文档, 2);
  } finally { await page.close(); }
});

it("恢复回来的旧草稿：没聚焦不挡换版；聚焦在框里（有字）才挡，失焦又放行", async () => {
  const { page, 文档 } = await 开("/projects/p4", false);
  try {
    await page.evaluate(() => { localStorage.setItem("daedalus:草稿:-:测稿", JSON.stringify({ at: Date.now(), v: { t: "上回没写完的话" } })); });
    await page.reload();
    await page.getByTestId("ta").waitFor();
    expect(await page.getByTestId("ta").inputValue()).toBe("上回没写完的话");
    await page.clock.install();
    await 点亮(page);
    await page.getByTestId("update-bar").waitFor();
    // 聚焦在有字的框里：挡
    await page.getByTestId("ta").focus();
    await 过(page, 11 * 60_000);
    expect(文档.次).toBe(2);
    // 失焦：不挡（恢复的草稿本身不算未提交）
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await 过(page, 11 * 60_000);
    await 换了(page, 文档, 2);
  } finally { await page.close(); }
});
