/**
 * 企业版复盘页 11-01 版式融合：卡点 / 沟通页签、数据页签「现在」最上面那几块的界面。
 *
 *   卡点：11-01 卡点页签换成卡点 v2 三栏看板（待接受 / 处理中 / 已解决，见 BoardBlockers），这里只量三栏摆得出、筛选写地址、窄屏不溢出
 *   沟通：方式下拉写 m=、时间分段写 t=（自定义再摆日期段，写 tf= tt=）、时间线卡片（发起 / 附件 / 编号有才摆）、点一条去项目页、空态、旁边「还没沟通过的项目」和它的空态
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
  stub(/blocker-actions$/, "const f=async()=>({ok:true});export const 发布卡点Action=f,认领卡点Action=f,完成卡点Action=f,删卡点Action=f;");
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
    const 卡=(i,status)=>({id:'b'+i,code:'BLK-20261101-0'+i,title:'报价卡住'+长,projectId:'p'+i,项目:'华东二期产线改造项目'+长,followUpId:'f'+i,phase:'订单',type:'重要卡点',impact:'可能丢单',
      原因们:[{id:'r1',name:'价格'+长,status:'启用'}],description:'第'+i+'个卡点：'+长,status,发布人:'很长很长的发布人名字',resourceRequest:null,solution:null,result:null,
      resolvedAt:status==='已解决'?后天:null,createdAt:前天,流转:[],认领:status==='待接受'?[]:[{名字:'认领人'+长,done:status==='已解决',note:null,doneAt:null,是我:false}],
      进度:{完成:status==='已解决'?1:0,共:status==='待接受'?0:1},能:{认领:status==='待接受',完成:false,最后一个:false,删:false}});
    const 栏={待接受:[卡(0,'待接受'),卡(1,'待接受')],处理中:[卡(2,'处理中')],已解决:[卡(3,'已解决')]};
    const 统计={未解决:3,已解决:1,按影响:[{名:'可能丢单',数:3}],按原因:[{id:'r1',名:'价格'+长,状态:'启用',数:3},{id:'r2',名:'前台新加的',状态:'待审核',数:1}]};
    const 沟通=(n)=>Array.from({length:n},(_,i)=>({
      id:'f'+i, 时间:'2026-10-2'+(i%9)+'T09:00:00.000Z', projectId:'p'+i, 项目:'华东二期产线改造项目'+长, 节点:'潜客培育', 客户:长+i, 方式:'线下拜访',
      标题:'第'+i+'次回访', 内容:i===0?'第0次回访':'聊了'+长+'的方案和报价', 负责人:'记录人'+i, 发起:i===1?'客户主动':null, 编号:i===1?'FUL0001':null, 附件:i===1?3:0,
    }));
    const 缺行=(n)=>Array.from({length:n},(_,i)=>({id:'q'+i,名:'没沟通的项目'+i+长,客户:长,节点:'潜客培育',负责人:'小'+i,建于:'2026-10-20T09:00:00.000Z'}));
    window.__画=(o)=>{
      let 里;
      if(o.页==='block'){
        里=<BoardBlockers 开 全部={o.全部??true} 栏={栏} 已解决共={1} 统计={统计} 项目们={[{id:'p0',name:'华东二期产线改造项目'+长}]} 原因们={[{id:'r1',name:'价格',status:'启用'}]} 筛={o.筛??{}}/>;
      } else if(o.页==='talk'){
        const n=o.行数??4;
        里=<BoardTalks 数={{总数:o.总数??n,页:1,行:沟通(n)}} 段={o.段??'all'} 区间={o.区间} 方式={o.方式??''} 只看自己={false} 缺={o.缺==null?undefined:{总数:o.缺,行:缺行(Math.min(5,o.缺))}}/>;
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

const 分布 = { 总数: 9, 按主体: [{ 主体: "客户", 数: 5 }, { 主体: "某个特别长特别长特别长特别长特别长的阻碍主体", 数: 3 }, { 主体: "没填", 数: 1 }], 按状态: [{ 状态: "待接受", 数: 4 }, { 状态: "处理中", 数: 5 }] };

it("卡点：三栏看板（待接受 / 处理中 / 已解决）摆得出；统计和原因在；点原因写 br=、回第一页、ownerId 照带", async () => {
  const { page, errors } = await 打开({ 页: "block" }, 1280, "/overview?tab=block&ownerId=u1&p=2");
  expect(await page.locator(".rblk-col").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(["待接受的卡点", "处理中的卡点", "已解决的卡点"]);
  expect(await page.locator('[aria-label="卡点统计"]').innerText()).toMatch(/未解决\s*3[\s\S]*已解决\s*1/);
  expect(await page.locator(".rblk-reason").last().innerText()).toContain("（待审核）");
  await page.locator(".rblk-reason").first().click();
  expect(await 去了(page)).toEqual(["/overview?tab=block&ownerId=u1&br=r1"]);
  expect(await page.getByLabel("只看自己").count()).toBe(1);
  expect(errors).toEqual([]); await page.close();
  const 己 = await 打开({ 页: "block", 全部: false });
  expect(await 己.page.getByLabel("只看自己").count()).toBe(0);
  await 己.page.close();
});

it("数据页签卡点分布超过 8 种主体：前 7 种 + 「其他」", async () => {
  const 多 = { 总数: 10, 按主体: Array.from({ length: 10 }, (_, i) => ({ 主体: `主体${i}`, 数: 1 })), 按状态: [{ 状态: "待接受", 数: 10 }] };
  const { page } = await 打开({ 页: "data", 分布: 多 });
  const k = await page.locator('section[aria-label="卡点分布"] .btodo-rc-k').allInnerTexts();
  expect(k).toHaveLength(8);
  expect(k.at(-1)).toBe("其他");
  expect(await page.locator('section[aria-label="卡点分布"] .btodo-rc-v').last().innerText()).toBe("3");
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

it("沟通 · 自定义：日期段摆在分段后面、回显两头；挑一段写 t=custom&tf&tt、回第一页；换回别的段 tf / tt 一起去掉", async () => {
  const 区间 = { from: "2026-10-01", to: "2026-10-31" };
  const { page, errors } = await 打开({ 页: "talk", 段: "custom", 区间 }, 1280, "/overview?tab=talk&ownerId=u1&t=custom&tf=2026-10-01&tt=2026-10-31&p=2");
  expect(await page.locator('[aria-label="时间范围"] .ant-segmented-item-selected').innerText()).toBe("自定义");
  const 框 = page.locator(".btodo-head-r .custom-range input");
  expect(await 框.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(["2026-10-01", "2026-10-31"]);
  // 没有清空按钮
  expect(await page.locator(".btodo-head-r .custom-range .ant-picker-clear").count()).toBe(0);
  await 框.first().click();
  await 框.first().fill("2026-09-01");
  await 框.first().press("Enter");
  await 框.last().fill("2026-09-30");
  await 框.last().press("Enter");
  await page.waitForTimeout(100);
  await page.locator('[aria-label="时间范围"] .ant-segmented-item').first().click();
  expect(await 去了(page)).toEqual([
    "/overview?tab=talk&ownerId=u1&t=custom&tf=2026-09-01&tt=2026-09-30",
    "/overview?tab=talk&ownerId=u1&t=7",
  ]);
  expect(errors).toEqual([]); await page.close();
  // 别的段不摆日期段
  const 别 = await 打开({ 页: "talk", 段: "30" });
  expect(await 别.page.locator(".custom-range").count()).toBe(0);
  await 别.page.close();
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

it.each([1024, 1366])("Windows %ipx + 超长名字：三个页签都不横向溢出，沟通 / 数据的长名字单行省略", async (w) => {
  const 块 = await 打开({ 页: "block" }, w);
  await 块.page.waitForTimeout(150);
  expect(await 不溢出(块.page)).toBe(true);
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
  // 选了自定义：方式下拉、分段、日期段还是同一行，不溢出
  const 自 = await 打开({ 页: "talk", 缺: 3, 段: "custom", 区间: { from: "2026-10-01", to: "2026-11-04" } }, w);
  await 自.page.waitForTimeout(150);
  expect(await 不溢出(自.page)).toBe(true);
  const 自ys = await 自.page.locator(".btodo-head-r").first().evaluate((e) => [...e.children].map((c) => Math.round(c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2)));
  expect(自ys).toHaveLength(3);
  expect(new Set(自ys).size).toBe(1);
  await 自.page.close();
  const 数 = await 打开({ 页: "data", 分布, 外币: 2 }, w);
  await 数.page.waitForTimeout(150);
  expect(await 不溢出(数.page)).toBe(true);
  const kpi = await 数.page.locator(".rkpi-i").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(kpi).size).toBeLessThanOrEqual(2);
  await 单行省略(数.page, ".rkpi-warn-n", ".rkpi-warn-a");
  await 数.page.close();
});
