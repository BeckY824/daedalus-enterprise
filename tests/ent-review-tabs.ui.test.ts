/**
 * 企业版复盘页 11-01 版式融合：卡点 / 沟通页签、数据页签「现在」最上面那几块的界面。
 *
 *   卡点：卡点分布（按阻碍主体横条 + 按状态计数）、本页按状态分组的卡片、超期标红、点卡去项目页、空态「没有卡点」、多于 20 条分页
 *   沟通：方式下拉写 m=、时间分段写 t=、时间线卡片（发起 / 附件 / 编号有才摆）、点一条去项目页、空态、旁边「还没沟通过的项目」和它的空态
 *   数据：六格 KPI（3 天内回公海没开 = —）、卡点分布、超时预警和两种空
 *   Windows 1024：不横向溢出、长名字单行省略
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
const plugin: Plugin = { name: "ent-review-tabs", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "stub", pluginData: code }));
  stub(/^next\/link$/, "import React from 'react';export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  stub(/^next\/navigation$/, "const 记=(u)=>{(window.__去||(window.__去=[])).push(u)};export const useRouter=()=>({push:记,refresh(){},replace:记});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import BoardBlockers from '@/app/(app)/overview/BoardBlockers';
    import BoardTalks from '@/app/(app)/overview/BoardTalks';
    import {复盘概况排, 复盘提醒排} from '@/app/(app)/overview/ReviewSummary';
    const 长='某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域销售中心';
    const 前天=new Date(Date.now()-2*86400000).toISOString(), 后天=new Date(Date.now()+2*86400000).toISOString();
    const 状态们=['待接受','处理中','看板','已解决'];
    const 卡点=(n)=>Array.from({length:n},(_,i)=>({
      id:'b'+i, code:'KD'+String(i).padStart(4,'0'), projectId:'p'+i, 项目:'华东二期产线改造项目'+长, 客户:长+i, type:i===0?'重要卡点':'需求不清',
      impact:'一般', obstacle:i%3?'客户':'', description:i===1?'':'第'+i+'个卡点：'+长+'迟迟不给技术参数', status:状态们[i%4],
      dueAt:i===0?前天:后天, 负责人:'很长很长的负责人名字', 经手人:i%4===2?null:'经手人'+i, createdAt:'2026-10-20T09:00:00.000Z',
    }));
    const 沟通=(n)=>Array.from({length:n},(_,i)=>({
      id:'f'+i, 时间:'2026-10-2'+(i%9)+'T09:00:00.000Z', projectId:'p'+i, 项目:'华东二期产线改造项目'+长, 节点:'潜客培育', 客户:长+i, 方式:'线下拜访',
      标题:'第'+i+'次回访', 内容:i===0?'第0次回访':'聊了'+长+'的方案和报价', 负责人:'记录人'+i, 发起:i===1?'客户主动':null, 编号:i===1?'FUL0001':null, 附件:i===1?3:0,
    }));
    const 缺行=(n)=>Array.from({length:n},(_,i)=>({id:'q'+i,名:'没沟通的项目'+i+长,客户:长,节点:'潜客培育',负责人:'小'+i,建于:'2026-10-20T09:00:00.000Z'}));
    window.__画=(o)=>{
      let 里;
      if(o.页==='block'){
        const n=o.行数??6;
        里=<BoardBlockers 数={{总数:o.总数??n,页:1,行:卡点(n)}} 筛={o.筛??'open'} 只看自己={false} 分布={o.分布}/>;
      } else if(o.页==='talk'){
        const n=o.行数??4;
        里=<BoardTalks 数={{总数:o.总数??n,页:1,行:沟通(n)}} 段={o.段??'all'} 方式={o.方式??''} 只看自己={false} 缺={o.缺==null?undefined:{总数:o.缺,行:缺行(Math.min(5,o.缺))}}/>;
      } else {
        const 概={在跟:12,逾期任务:3,未解决卡点:0,已回款:123456,待回款:7890,外币项目:o.外币??0,将回公海:o.将回公海===undefined?2:o.将回公海};
        const 预警=Array.from({length:o.预警??2},(_,i)=>({id:'w'+i,名:'要回公海的项目'+i+长,节点:'潜客培育',负责人:'小'+i,回收日:'2026-11-0'+(i+2)}));
        里=<><复盘概况排 数={概} 本位币="CNY"/><复盘提醒排 分布={o.分布??{总数:0,按主体:[],按状态:[]}} 预警={预警} 将回公海={概.将回公海}/></>;
      }
      createRoot(document.getElementById('root')).render(<App><main style={{padding:16}}>{里}</main></App>);
    };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" });
  bundle = r.outputFiles[0].text; browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 打开(o: Record<string, unknown>, width = 1280, 地址 = "/overview"): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://ent.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto(`http://ent.test${地址}`);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((x) => (window as unknown as { __画: (o: unknown) => void }).__画(x), o);
  await page.locator("main > *").first().waitFor();
  return { page, errors };
}
const 去了 = (page: Page) => page.evaluate(() => (window as unknown as { __去?: string[] }).__去 ?? []);
const 不溢出 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** 这些元素：单行、省略号、不超出所在卡片 */
async function 单行省略(page: Page, sel: string, 卡: string) {
  const r = await page.locator(sel).first().evaluate((e, 卡) => {
    const s = getComputedStyle(e); const p = e.closest(卡)!.getBoundingClientRect(); const b = e.getBoundingClientRect();
    return { ws: s.whiteSpace, to: s.textOverflow, 出: b.right > p.right + 1 };
  }, 卡);
  expect(r, sel).toEqual({ ws: "nowrap", to: "ellipsis", 出: false });
}

const 分布 = { 总数: 9, 按主体: [{ 主体: "客户", 数: 5 }, { 主体: "某个特别长特别长特别长特别长特别长的阻碍主体", 数: 3 }, { 主体: "没填", 数: 1 }], 按状态: [{ 状态: "待接受", 数: 4 }, { 状态: "看板", 数: 5 }] };

it("卡点：分布（主体横条 + 状态计数）、按状态分组的卡片、超期标红、没描述有提示、点卡去项目页", async () => {
  const { page, errors } = await 打开({ 页: "block", 分布 });
  const 布 = page.locator('section[aria-label="卡点分布"]');
  expect(await 布.locator(".btodo-rc-k").allInnerTexts()).toEqual(["客户", "某个特别长特别长特别长特别长特别长的阻碍主体", "没填"]);
  expect(await 布.locator(".btodo-rc-v").allInnerTexts()).toEqual(["5", "3", "1"]);
  expect((await 布.locator(".rblk-dist-chip").allInnerTexts()).map((t) => t.replace(/\s+/g, " "))).toEqual(["待接受 4", "没人接 5"]);
  expect(await 布.locator(".rblk-dist-cap").innerText()).toBe("按阻碍主体 · 未解决 9 条");
  // 组：固定顺序，「看板」叫「没人接」
  expect((await page.locator(".rblk-group-h").allInnerTexts()).map((t) => t.replace(/\s+/g, ""))).toEqual(["待接受2", "处理中2", "没人接1", "已解决1"]);
  expect(await page.locator(".rblk-group").evaluateAll((els) => els.map((e) => e.querySelectorAll(".rblk-k").length))).toEqual([2, 2, 1, 1]);
  const 第一 = page.locator(".rblk-k").first();
  expect(await 第一.locator(".rblk-type").getAttribute("class")).toContain("rblk-type-hot");
  expect(await 第一.locator(".rblk-due").innerText()).toMatch(/^超 \d+ 天$/);
  expect(await 第一.locator(".rblk-due").getAttribute("class")).toContain("rblk-due-late");
  expect(await page.locator('.rblk-k[aria-label^="KD0001"] .rblk-k-t').innerText()).toBe("—");
  // 没人接的写「没人接」，阻碍主体有才摆
  expect(await page.locator('.rblk-k[aria-label^="KD0002"] .rblk-who').innerText()).toContain("没人接");
  expect(await page.locator('.rblk-k[aria-label^="KD0000"] .rblk-tag').count()).toBe(0);
  expect(await page.locator('.rblk-k[aria-label^="KD0001"] .rblk-tag').innerText()).toBe("客户");
  await 第一.click();
  await page.locator(".rblk-k").nth(1).focus();
  await page.keyboard.press("Enter");
  expect(await 去了(page)).toEqual(["/projects/p0", "/projects/p4"]);
  expect(await page.locator(".rblk-pager").count()).toBe(0);
  expect(errors).toEqual([]); await page.close();
});

it("卡点：状态分段写 bs=、回第一页；多于 20 条分页；没卡点：空态，不摆分布", async () => {
  const { page } = await 打开({ 页: "block", 行数: 20, 总数: 41 }, 1280, "/overview?tab=block&ownerId=u1&p=2");
  expect(await page.locator(".rblk-pager").innerText()).toContain("共 41 条");
  await page.locator('[aria-label="卡点状态"] .ant-segmented-item', { hasText: "全部" }).click();
  expect(await 去了(page)).toEqual(["/overview?tab=block&ownerId=u1&bs=all"]);
  expect(await page.locator(".rblk-dist").count()).toBe(0);
  await page.close();
  const 空 = await 打开({ 页: "block", 行数: 0, 分布: { 总数: 0, 按主体: [], 按状态: [] } });
  expect(await 空.page.locator("main").innerText()).toContain("没有卡点");
  expect(await 空.page.locator(".rblk-dist").count()).toBe(0);
  await 空.page.close();
});

it("卡点分布超过 8 种主体：前 7 种 + 「其他」", async () => {
  const 多 = { 总数: 10, 按主体: Array.from({ length: 10 }, (_, i) => ({ 主体: `主体${i}`, 数: 1 })), 按状态: [{ 状态: "待接受", 数: 10 }] };
  const { page } = await 打开({ 页: "block", 分布: 多 });
  const k = await page.locator(".rblk-dist .btodo-rc-k").allInnerTexts();
  expect(k).toHaveLength(8);
  expect(k.at(-1)).toBe("其他");
  expect(await page.locator(".rblk-dist .btodo-rc-v").last().innerText()).toBe("3");
  await page.close();
});

it("沟通：时间线卡片；发起 / 附件 / 编号有才摆；标题和内容一样只摆一次；点一条去项目页", async () => {
  const { page, errors } = await 打开({ 页: "talk", 缺: 7 });
  expect(await page.locator("ol.rtalk-tl > li.rtalk-i").count()).toBe(4);
  const 二 = page.locator(".rtalk-k").nth(1);
  expect(await 二.locator(".rblk-k-meta").innerText()).toMatch(/线下拜访[\s\S]*发起 客户主动[\s\S]*附件 3 个[\s\S]*FUL0001[\s\S]*记录人1/);
  expect(await page.locator(".rtalk-k").nth(2).locator(".rtalk-meta").allInnerTexts()).toEqual(["记录人2"]);
  expect(await page.locator(".rtalk-k").first().locator(".rtalk-t").innerText()).toBe("第0次回访");
  await 二.click();
  expect(await 去了(page)).toEqual(["/projects/p1"]);
  // 旁边：还没沟通过的项目，5 个 + 看全部
  const 旁 = page.locator('aside[aria-label="还没沟通过的项目"]');
  expect(await 旁.locator(".rtalk-miss li").count()).toBe(5);
  expect(await 旁.locator(".rtalk-miss a").first().getAttribute("href")).toBe("/projects/q0");
  expect(await 旁.getByRole("link", { name: "看全部 7 个 ›" }).getAttribute("href")).toBe("/projects?f=no-follow");
  expect(errors).toEqual([]); await page.close();
});

it("沟通：方式下拉写 m=、选「全部方式」去掉 m；时间分段写 t=；都回第一页、ownerId 照带", async () => {
  const { page } = await 打开({ 页: "talk", 方式: "VISIT", 段: "30" }, 1280, "/overview?tab=talk&ownerId=u1&t=30&m=VISIT&p=2");
  expect(await page.locator(".rtalk-m .ant-select-content").innerText()).toBe("线下拜访");
  await page.locator(".rtalk-m").click();
  await page.locator(".ant-select-item-option", { hasText: "微信沟通" }).click();
  await page.locator(".rtalk-m").click();
  await page.locator(".ant-select-item-option", { hasText: "全部方式" }).click();
  await page.locator('[aria-label="时间范围"] .ant-segmented-item').first().click();
  expect(await 去了(page)).toEqual([
    "/overview?tab=talk&ownerId=u1&t=30&m=WECHAT",
    "/overview?tab=talk&ownerId=u1&t=30",
    expect.stringMatching(/^\/overview\?tab=talk&ownerId=u1&t=\d+&m=VISIT$/),
  ]);
  await page.close();
});

it("沟通：没记录 → 「没有沟通记录」；筛过时提示选全部；缺沟通是 0 → 一句话、不摆看全部；不给缺不摆旁栏", async () => {
  const { page } = await 打开({ 页: "talk", 行数: 0, 方式: "VISIT", 缺: 0 });
  expect(await page.locator(".btodo-list").first().innerText()).toMatch(/没有沟通记录[\s\S]*时间、方式都选「全部」看看/);
  expect(await page.locator(".rtalk-side").innerText()).toContain("在推的项目都记过沟通了。");
  expect(await page.locator(".rtalk-side-more").count()).toBe(0);
  await page.close();
  const 无 = await 打开({ 页: "talk" });
  expect(await 无.page.locator(".rtalk-side").count()).toBe(0);
  await 无.page.close();
});

it("数据 · 现在：六格 KPI、链接、逾期有数标红；卡点分布 + 超时预警", async () => {
  const { page, errors } = await 打开({ 页: "data", 分布 });
  const 格 = page.locator('section[aria-label="复盘概况"] .rkpi-i');
  expect(await 格.locator(".rkpi-k").allInnerTexts()).toEqual(["在跟项目", "逾期任务", "未解决卡点", "已回款", "待回款", "3 天内回公海"]);
  const 值 = await 格.locator(".rkpi-v").allInnerTexts();
  expect(值[0]).toBe("12"); expect(值[1]).toBe("3"); expect(值[5]).toBe("2");
  expect(值[3]).toMatch(/123,456/);
  expect(await 格.nth(1).getAttribute("href")).toBe("/overview?tab=todo&f=overdue");
  expect(await 格.nth(5).getAttribute("href")).toBe("/projects?f=due-soon");
  expect(await 格.nth(1).locator(".rkpi-v").getAttribute("class")).toContain("rkpi-v-hot");
  expect(await 格.nth(2).locator(".rkpi-v").getAttribute("class")).not.toContain("rkpi-v-hot");
  expect(await page.locator('.rkpi-pair section[aria-label="卡点分布"] .btodo-rc-k').allInnerTexts()).toEqual(["客户", "某个特别长特别长特别长特别长特别长的阻碍主体", "没填"]);
  const 警 = page.locator(".rkpi-warn li");
  expect(await 警.count()).toBe(2);
  expect(await 警.first().innerText()).toMatch(/要回公海的项目0[\s\S]*潜客培育 · 小0[\s\S]*2026-11-02 收回/);
  expect(await page.getByRole("link", { name: "看全部 2 个 ›" }).getAttribute("href")).toBe("/projects?f=due-soon");
  expect(errors).toEqual([]); await page.close();
});

it("数据 · 现在：超时回收没开 → 那格「—」、预警写一句话；开了没项目 → 空态；没卡点 → 空态", async () => {
  const { page } = await 打开({ 页: "data", 将回公海: null, 预警: 0 });
  const 值 = await page.locator(".rkpi-v").allInnerTexts();
  expect(值[5]).toBe("—");
  expect(await page.locator('.rkpi-i').nth(5).evaluate((e) => e.tagName)).toBe("DIV");
  expect(await page.locator('section[aria-label="超时预警"]').innerText()).toContain("组织规则里没开超时回收");
  expect(await page.locator('section[aria-label="卡点分布"]').innerText()).toContain("没有未解决的卡点");
  await page.close();
  const 空 = await 打开({ 页: "data", 将回公海: 0, 预警: 0 });
  expect(await 空.page.locator('section[aria-label="超时预警"]').innerText()).toContain("3 天内没有要回公海的项目");
  expect(await 空.page.locator('section[aria-label="超时预警"] a').count()).toBe(0);
  await 空.page.close();
});

it.each([1024, 1366])("Windows %ipx + 超长名字：三个页签都不横向溢出，长名字单行省略", async (w) => {
  const 块 = await 打开({ 页: "block", 分布 }, w);
  await 块.page.waitForTimeout(150);
  expect(await 不溢出(块.page)).toBe(true);
  await 单行省略(块.page, ".rblk-k-t", ".rblk-k");
  await 单行省略(块.page, ".rblk-k-sub", ".rblk-k");
  await 单行省略(块.page, ".rblk-dist .btodo-rc-k", ".btodo-rc-row");
  await 块.page.close();
  const 谈 = await 打开({ 页: "talk", 缺: 3 }, w);
  await 谈.page.waitForTimeout(150);
  expect(await 不溢出(谈.page)).toBe(true);
  await 单行省略(谈.page, ".rtalk-t", ".rtalk-k");
  await 单行省略(谈.page, ".rtalk-miss-n", ".rtalk-side");
  // 方式下拉和时间分段同一行
  const ys = await 谈.page.locator(".btodo-head-r").first().evaluate((e) => [...e.children].map((c) => Math.round(c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2)));
  expect(new Set(ys).size).toBe(1);
  await 谈.page.close();
  const 数 = await 打开({ 页: "data", 分布, 外币: 2 }, w);
  await 数.page.waitForTimeout(150);
  expect(await 不溢出(数.page)).toBe(true);
  const kpi = await 数.page.locator(".rkpi-i").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(kpi).size).toBeLessThanOrEqual(2);
  await 单行省略(数.page, ".rkpi-warn-n", ".rkpi-warn-a");
  await 数.page.close();
});
