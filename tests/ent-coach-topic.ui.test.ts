/**
 * 教练主题界面（11-17，销售教练角色 PR3a，projects/[id]/CoachTopics.tsx）：
 *   - 没关的（待回复、已回复）钉在沟通卡身最上面；已关闭的收在「已关闭的主题 N 条」里，点开才看
 *   - 每条标「教练发起」、状态；进公海自动关的写「项目进公海，… 自动关闭」
 *   - 能回才有回复框；能关 / 能删才有按钮；关闭、删除先长出确认条
 *   - 发起框（11-21 教练点评改版 PR1：「发起点评 ▾」→「写点评」，原「发起主题」）：关联项目 / 节点 / 填写人锁定（不是输入框），会通知负责人；交上去只带主题和内容
 *   - 「录音点评」在下拉里灰着、点不动、第二行写「录音点评即将开放」，点了什么框都不开、什么动作都不调
 *   - Windows 1024 / 1280 / 1366：超长项目名、超长人名、超长主题和内容不横向撑出，「回复」「关闭」「发出」点得中
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "coach-topic-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷=(window.__刷??0)+1},push(){}});");
  stub(/coach-topic-actions$/, [
    "export const 发主题动作=async(id,x)=>{window.__发={id,x};return window.__发回??{ok:true}};",
    "export const 回复主题动作=async(id,b)=>{(window.__回??=[]).push([id,b]);return{ok:true}};",
    "export const 关闭主题动作=async(id)=>{(window.__关??=[]).push(id);return{ok:true}};",
    "export const 删主题动作=async(id)=>{(window.__删??=[]).push(id);return{ok:true}};",
  ].join(""));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import CoachTopics,{StartReviewButton} from '@/app/(app)/projects/[id]/CoachTopics';
    const root=createRoot(document.getElementById('root'));
    const 长名='销售教练'+'X'.repeat(50), 长项目='项目名很长'+'Y'.repeat(120), 长题='主题'+'很长'.repeat(19);
    const 长文='建议先问清预算'.repeat(30)+'Z'.repeat(200);
    const 条=(id,status,能,extra={})=>({id,node:'线索验证',title:长题+id,body:长文,status,createdAt:'2026-11-17T02:00:00.000Z',closedAt:status==='已关闭'?'2026-11-17T05:00:00.000Z':null,
      作者:{id:'u1',name:长名,身份:'销售教练'},关的人:null,回复们:[{id:'r'+id,name:'负责人'+'W'.repeat(40),body:'收到'+'N'.repeat(150),createdAt:'2026-11-17T03:00:00.000Z',是负责人:true}],
      能回:能,能关:能,能删:能,...extra});
    const 数据={们:[条('1','待回复',true),条('2','已回复',true),条('3','已关闭',false),条('4','已关闭',false,{关的人:'组长甲'})],能发:true,
      填写人:{id:'u1',name:长名,身份:'销售教练'},负责人:{id:'u2',name:'负责人'+'W'.repeat(40)},项目名:长项目,当前节点:'线索验证',待回复数:1,冻结:false};
    window.__render=(what)=>root.render(<App><div className="card-like" style={{maxWidth:'min(560px, calc(100vw - 32px))',margin:'0 auto',padding:16,border:'1px solid #ddd'}}>{
      what==='form'?<StartReviewButton 数据={数据} projectId='p1'/>:<CoachTopics 数据={数据}/>
    }</div></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(what: "list" | "form", width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://cth.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://cth.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((w) => (window as unknown as { __render: (x: string) => void }).__render(w), what);
  return { page, errors };
}

/** 点得中：按钮中心那一点最上面就是它（或它里面的字） */
const 点得中 = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
});
/** 横向没撑出：页面、每条主题、确认条都不出横向滚动 */
const 没撑出 = (page: Page) => page.evaluate(() => {
  const 坏: string[] = [];
  if (document.documentElement.scrollWidth > window.innerWidth) 坏.push(`页面 ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
  for (const el of document.querySelectorAll<HTMLElement>(".cth-item, .cth-acts, .cth-head, .cth-form-row, .pd-del-band, .card-like")) {
    if (el.scrollWidth > el.clientWidth + 1) 坏.push(`${el.className} ${el.scrollWidth} > ${el.clientWidth}`);
  }
  return 坏;
});

it("没关的钉在上面、已关闭的收起来；点开才看，进公海自动关的写清楚", async () => {
  const { page, errors } = await open("list");
  const 条们 = page.getByTestId("coach-topic");
  expect(await 条们.count()).toBe(2);
  expect(await 条们.nth(0).textContent()).toContain("待回复");
  expect(await 条们.nth(1).textContent()).toContain("已回复");
  for (let i = 0; i < 2; i++) expect(await 条们.nth(i).textContent()).toContain("教练发起");
  const 钮 = page.getByTestId("coach-topics-closed");
  expect(await 钮.textContent()).toBe("已关闭的主题 2 条");
  await 钮.click();
  expect(await 条们.count()).toBe(4);
  expect(await 条们.nth(2).textContent()).toMatch(/项目进公海，.*自动关闭/);
  expect(await 条们.nth(3).textContent()).toMatch(/组长甲 于 .* 关闭/);
  // 已关闭的没有回复框、没有按钮
  expect(await 条们.nth(2).locator("textarea, button").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

it("回复只交这一条；关闭、删除先长出确认条，确认了才调", async () => {
  const { page } = await open("list");
  const 第一条 = page.getByTestId("coach-topic").first();
  await 第一条.getByLabel("回复这个主题").fill("周三再电话确认");
  await 第一条.getByTestId("coach-topic-reply").click();
  await page.waitForFunction(() => (window as unknown as { __回?: unknown[] }).__回?.length === 1);
  expect(await page.evaluate(() => (window as unknown as { __回: unknown[] }).__回)).toEqual([["1", "周三再电话确认"]]);
  await 第一条.getByTestId("coach-topic-close").click();
  expect(await page.evaluate(() => (window as unknown as { __关?: unknown[] }).__关 ?? [])).toEqual([]);
  await 第一条.getByRole("button", { name: "确认关闭" }).click();
  await page.waitForFunction(() => (window as unknown as { __关?: unknown[] }).__关?.length === 1);
  await 第一条.getByRole("button", { name: "删除" }).click();
  expect(await 第一条.textContent()).toContain("删了谁都看不到，不能恢复");
  await 第一条.getByRole("button", { name: /^取\s?消$/ }).click();
  expect(await page.evaluate(() => (window as unknown as { __删?: unknown[] }).__删 ?? [])).toEqual([]);
  await page.close();
});

/** 「发起点评 ▾」→「写点评」：点开下拉、点第一项，等框出来 */
const 开写点评 = async (page: Page) => {
  await page.getByTestId("coach-topic-new").click();
  await page.getByRole("menuitem", { name: /^写点评/ }).click();
  await page.locator(".ant-modal").waitFor();
};

it("「发起点评 ▾」下拉：小标题当前项目（节点），写点评能点、录音点评灰着写原因；点录音点评什么都不发生", async () => {
  const { page, errors } = await open("form");
  const 钮 = page.getByTestId("coach-topic-new");
  expect((await 钮.innerText()).replace(/\s+/g, "")).toBe("发起点评");
  await 钮.click();
  const 菜单 = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) ul.rec-head-menu").last();
  await 菜单.waitFor();
  expect(await 菜单.locator(".ant-dropdown-menu-item-group-title").innerText()).toMatch(/^当前项目：项目名很长Y+（线索验证）$/);
  const 项 = 菜单.getByRole("menuitem");
  expect(await 项.count()).toBe(2);
  expect((await 项.nth(0).innerText()).replace(/\s+/g, " ")).toBe("写点评 打字写，和原来的「发起主题」一样");
  expect(await 项.nth(0).getAttribute("aria-disabled")).not.toBe("true");
  const 录音 = 项.nth(1);
  expect((await 录音.innerText()).replace(/\s+/g, " ")).toBe("录音点评 录音点评即将开放");
  expect(await 录音.getAttribute("aria-disabled")).toBe("true");
  // 悬停给一句原因（手机长按看第二行那句，一直写着）
  expect(await page.getByTestId("coach-review-voice").getAttribute("title")).toBe("录音点评即将开放");
  await 录音.dispatchEvent("click");
  await page.waitForTimeout(150);
  expect(await page.locator(".ant-modal").count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __发?: unknown }).__发 ?? null)).toBeNull();
  expect(errors).toEqual([]);
  await page.close();
});

it("写点评框（原「发起主题」）：项目、节点、填写人锁定，会通知负责人；交上去只带主题和内容", async () => {
  const { page, errors } = await open("form");
  await 开写点评(page);
  const 框 = page.locator(".ant-modal");
  expect(await 框.locator(".ant-modal-title").innerText()).toBe("写点评");
  const 文 = await 框.textContent();
  expect(文).toContain("（当前项目）");
  expect(文).toContain("线索验证（当前节点）");
  expect(文).toMatch(/填写人销售教练X+（销售教练）/);
  expect(文).toMatch(/会通知项目负责人 · 负责人W+/);
  // 锁定的三格不是输入框：框里只有主题、内容两个输入
  expect(await 框.locator("input, textarea").count()).toBe(2);
  expect(await page.getByTestId("coach-topic-send").isDisabled()).toBe(true);
  await 框.getByLabel("主题").fill("先问清预算");
  await 框.getByLabel("内容").fill("下次沟通先确认预算范围");
  await page.getByTestId("coach-topic-send").click();
  await page.waitForFunction(() => !!(window as unknown as { __发?: unknown }).__发);
  expect(await page.evaluate(() => (window as unknown as { __发: unknown }).__发)).toEqual({ id: "p1", x: { title: "先问清预算", body: "下次沟通先确认预算范围" } });
  expect(errors).toEqual([]);
  await page.close();
});

for (const w of [1024, 1280, 1366]) {
  it(`Windows ${w}：超长名字、主题、内容不撑宽；回复、关闭、发出点得中`, async () => {
    const { page } = await open("list", w);
    await page.getByTestId("coach-topics-closed").click();
    await page.getByTestId("coach-topic").first().getByTestId("coach-topic-close").click();
    expect(await 没撑出(page)).toEqual([]);
    const 第一条 = page.getByTestId("coach-topic").first();
    await 第一条.getByLabel("回复这个主题").fill("x");
    expect(await 点得中(page, "[data-testid=coach-topic-reply]")).toBe(true);
    expect(await 点得中(page, ".pd-del-band button.ant-btn-primary")).toBe(true);
    await page.close();

    const f = await open("form", w);
    await 开写点评(f.page);
    expect(await 没撑出(f.page)).toEqual([]);
    // 长项目名一行省略，不折成好几行
    const 项目格 = await f.page.locator(".cth-ellipsis").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, h: el.getBoundingClientRect().height }));
    expect(项目格.h).toBeLessThan(40);
    await f.page.locator(".ant-modal").getByLabel("主题").fill("x");
    await f.page.locator(".ant-modal").getByLabel("内容").fill("y");
    expect(await 点得中(f.page, "[data-testid=coach-topic-send]")).toBe(true);
    await f.page.close();
  });
}
