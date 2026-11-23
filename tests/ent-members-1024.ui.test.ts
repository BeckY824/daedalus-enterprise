/**
 * 设置 → 团队成员表 窄屏不横滚（11-23）：Windows 1024 宽设置正文约 460–494，原来按宽屏列宽排整表 594、出横滚。
 *   768–1199 这一档：列收窄、格子左右内边距 8 → 4、行尾动作只留字（现状主题）/ 照旧只有图标（换皮主题），整表不横滚，
 *   列宽合计给 CI Linux 字体留 ≥ 8px；长名字、角色标签照旧一行省略号
 *   1280 / 1440 / 390：列宽、内边距、「图标 + 字」照旧
 * 正文宽照 ent-design-e4-settings：1024 / 1280 按 494（偏严），1440 按 784，手机 390 按 358
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { 打包, 开页 } from "./settings-ui-kit";

let browser: Browser, bundle: string;
const 长 = "某某超长名字的智能制造装备与工业自动化系统集成有限公司";
beforeAll(async () => {
  bundle = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import MembersTab from '@/app/(app)/settings/MembersTab';
    const 长=${JSON.stringify(长)};
    const 人=(id,name,角色,active=true)=>({id,name,email:id,title:'',role:'SALES',active,customerCount:12,oppCount:0,项目阶段:{线索:2,商机:1},业务角色:角色,系统管理员:角色.includes('director')?{on:true,有线:false}:{on:false,有线:true},不管设置:false,followCount:30});
    const 们=[人('boss','老板'+长,['director','sales']),人('u1','销售甲',['sales']),人('u2','管理员乙',['admin']),人('u3','走了的丙',['sales'],false)];
    window.__render=({宽,isAdmin})=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN} button={{autoInsertSpace:false}}><App><div className="set-body" style={{width:宽,boxSizing:'border-box'}}>
      <MembersTab users={们} me={{id:'boss',name:'老板',email:'boss',role:'SALES',title:'',avatar:null}} isAdmin={isAdmin!==false} 用邮箱登录={false} 企业版 下属可停用={isAdmin===false?['u1']:[]}/>
    </div></App></ConfigProvider>);`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 正文宽 = (w: number) => (w >= 1366 ? 784 : w >= 1024 ? 494 : w - 32);
async function 开(w: number, 主题?: string, isAdmin = true) {
  const r = await 开页(browser, bundle, { 宽: 正文宽(w), isAdmin }, w);
  if (主题) await r.page.evaluate((t) => document.documentElement.setAttribute("data-skin", t), 主题);
  await r.page.locator(".member-table tr.ant-table-row").first().waitFor();
  return r;
}
const 量 = (page: Page) => page.evaluate(() => {
  const 滚 = document.querySelector(".member-table .ant-table-content, .member-table .ant-table-body") as HTMLElement;
  const 列 = [...document.querySelectorAll(".member-table colgroup col")].map((c) => parseFloat((c as HTMLElement).style.width) || 0);
  const 选 = document.querySelector(".member-table thead th.ant-table-selection-column")?.getBoundingClientRect().width ?? 0;
  return {
    sw: 滚.scrollWidth, cw: 滚.clientWidth, 列, 合计: 列.reduce((a, b) => a + b, 0) + (列[0] === 0 ? 选 : 0),
    边: [...document.querySelectorAll(".member-table tbody tr:first-child td:not(.ant-table-selection-column)")].map((t) => getComputedStyle(t).paddingLeft),
    正文伸出: Math.max(0, document.querySelector(".set-body")!.scrollWidth - document.querySelector(".set-body")!.clientWidth),
  };
});
const 点得中 = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }));
const 键 = '[aria-label="编辑 销售甲"], [aria-label="停用成员 销售甲"], [aria-label="恢复成员 走了的丙"]';

for (const w of [1024, 1199]) for (const 主题 of [undefined, "ledger"]) {
  it(`${w} 宽${主题 ? "（换皮）" : ""}：成员表不横滚、列宽合计留 ≥8px，动作键在格子里点得中，长名字省略号`, async () => {
    const { page, errors } = await 开(w, 主题);
    try {
      const a = await 量(page);
      expect(a.sw, JSON.stringify(a)).toBeLessThanOrEqual(a.cw);
      expect(a.合计, JSON.stringify(a)).toBeLessThanOrEqual(a.cw - 8);
      expect(a.正文伸出).toBe(0);
      expect(a.边.every((p) => p === "4px")).toBe(true);
      expect(await 点得中(page, 键)).toEqual([true, true, true]);
      for (const sel of ['[aria-label="编辑 销售甲"]', '[aria-label="停用成员 销售甲"]']) {
        const 格 = await page.locator(".member-table tr.ant-table-row").nth(1).locator("td").last().evaluate((el) => el.getBoundingClientRect().toJSON()) as DOMRect;
        const r = await page.locator(sel).evaluate((el) => el.getBoundingClientRect().toJSON()) as DOMRect;
        expect(r.right, sel).toBeLessThanOrEqual(格.right + 0.5);
        expect(r.left, sel).toBeGreaterThanOrEqual(格.left - 0.5);
      }
      const b = page.getByRole("button", { name: "编辑 销售甲", exact: true });
      // 现状主题窄屏只留字；换皮照旧只有图标
      if (主题) { expect((await b.innerText()).trim()).toBe(""); expect(await b.locator(".anticon").count()).toBe(1); }
      else { expect((await b.innerText()).trim()).toBe("编辑"); expect(await b.locator(".anticon").count()).toBe(0); }
      // 长名字一行省略号、悬停有全名；角色标签放不下自己出「…」、title 是全部角色
      const 名 = page.locator(".member-table tr.ant-table-row").first().locator("td:not(.ant-table-selection-column)").first();
      expect(await 名.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(60);
      expect(await page.locator(`[title="老板${长}"]`).count()).toBeGreaterThan(0);
      expect(await page.locator(".member-role-tag").first().getAttribute("title")).toBe("总管理、销售成员");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("1024 宽直属上级（不是系统管理员）：「办离职」只留字、在格子里", async () => {
  const { page, errors } = await 开(1024, undefined, false);
  try {
    const a = await 量(page);
    expect(a.sw).toBeLessThanOrEqual(a.cw);
    const b = page.getByRole("button", { name: "给 销售甲 办离职", exact: true });
    expect((await b.innerText()).trim()).toBe("办离职");
    expect(await 点得中(page, '[aria-label="给 销售甲 办离职"]')).toEqual([true]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// 宽屏、手机照旧：列宽、格子内边距、「图标 + 字」都是改前的值
for (const [w, 列, 边] of [[1280, [146, 120, 80, 72, 70, 84, 140], "8px"], [1440, [146, 120, 80, 72, 70, 84, 140], "8px"], [390, [146, 120, 72, 84, 136], "8px"]] as const) {
  it(`${w} 宽：成员表列宽、内边距、动作「图标 + 字」照旧`, async () => {
    const { page, errors } = await 开(w);
    try {
      const a = await 量(page);
      expect(a.列.filter((x) => x > 0)).toEqual(列);
      expect(a.边.every((p) => p === 边)).toBe(true);
      const b = page.getByRole("button", { name: "编辑 销售甲", exact: true });
      expect((await b.innerText()).trim()).toBe("编辑");
      expect(await b.locator(".anticon").count()).toBe(1);
      if (w === 1440) expect(a.sw).toBeLessThanOrEqual(a.cw + 1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

for (const 主题 of [undefined, "ledger"]) {
  it(`1024 触屏${主题 ? "（换皮）" : ""}：动作键各撑到 44 照样在格子里、整表不横滚`, async () => {
    const { page, errors } = await 开(1024, 主题);
    try {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
      const 格 = await page.locator(".member-table tr.ant-table-row").nth(1).locator("td").last().evaluate((el) => el.getBoundingClientRect().toJSON()) as DOMRect;
      const 框们 = await page.locator('[aria-label="编辑 销售甲"], [aria-label="停用成员 销售甲"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON())) as DOMRect[];
      expect(框们.every((r) => r.width >= 44 && r.height >= 44)).toBe(true);
      expect(框们[1].right).toBeLessThanOrEqual(格.right + 0.5);
      expect(框们[0].left).toBeGreaterThanOrEqual(格.left - 0.5);
      const a = await 量(page);
      expect(a.sw).toBeLessThanOrEqual(a.cw);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}
