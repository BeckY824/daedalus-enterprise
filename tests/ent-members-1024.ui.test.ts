/**
 * 设置 → 团队成员表 桌面宽度不横滚（11-23）：设置正文封顶（浮层 1040 框里 732、整页最宽 782，Windows 再让出 10 左右的滚动条），
 * 原来的宽屏列宽合计 744：1024 整页正文 460–494 放不下，1200 以上浮层里任何窗口宽也放不下（员工截图 1264 宽横滚）。
 *   窄屏 768–1199：六列（负责客户、跟进数本来就 1200 以上才出，10-27），合计 ≤ 正文 − 8，行尾动作只留字；按下停用转圈不加宽
 *   桌面 ≥ 1200：八列都在，合计 ≤ 正文 − 8，动作「图标 + 字」（D09）
 *   角色标签只截第一个角色名，「+N」始终露出
 *   手机 390：列宽、内边距、「图标 + 字」照旧
 * 正文宽：1024 / 1199 按 .set-body 494（内容区 460，1024 整页实际最窄），1200 起按整页和浮层里窄的那个再减 Windows 滚动条 10
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
    // 停用清点一直不回：停用键停在转圈
    window.__act=(名)=>名==='停用清点'?new Promise(()=>{}):{ok:true};
    const 人=(id,name,角色,active=true)=>({id,name,email:id,title:'',role:'SALES',active,customerCount:12,oppCount:0,项目阶段:{线索:2,商机:1},业务角色:角色,系统管理员:角色.includes('director')?{on:true,有线:false}:{on:false,有线:true},不管设置:false,followCount:30});
    const 们=[人('boss','老板'+长,['director','sales']),人('u1','销售甲',['sales']),人('u2','管理员乙',['admin']),人('u3','走了的丙',['sales'],false),人('u4','渠道丁',['channel_ops','sales'])];
    window.__render=({宽,isAdmin})=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN} button={{autoInsertSpace:false}}><App><div className="set-body" style={{width:宽,boxSizing:'border-box'}}>
      <MembersTab users={们} me={{id:'boss',name:'老板',email:'boss',role:'SALES',title:'',avatar:null}} isAdmin={isAdmin!==false} 用邮箱登录={false} 企业版 下属可停用={isAdmin===false?['u1']:[]}/>
    </div></App></ConfigProvider>);`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

/** .set-body 外框宽：整页 = min(1040, 窗 − 左栏 220 − 正文内边距 52) − 目录 200 − 间距 24；浮层 766；再减 Windows 滚动条 10 */
const 正文宽 = (w: number) => (w < 768 ? w - 32 : w < 1200 ? 494 : Math.min(Math.min(1040, w - 272) - 224, 766) - 10);
async function 开(w: number, isAdmin = true, 宽 = 正文宽(w)) {
  const r = await 开页(browser, bundle, { 宽, isAdmin }, w);
  await r.page.locator(".member-table tr.ant-table-row").first().waitFor();
  return r;
}
const 量 = (page: Page) => page.evaluate(() => {
  const 滚 = document.querySelector(".member-table .ant-table-content, .member-table .ant-table-body") as HTMLElement;
  const 列 = [...document.querySelectorAll(".member-table colgroup col")].map((c) => parseFloat((c as HTMLElement).style.width) || 0);
  const 选 = document.querySelector(".member-table thead th.ant-table-selection-column")?.getBoundingClientRect().width ?? 0;
  const 体 = document.querySelector(".set-body")!;
  return {
    sw: 滚.scrollWidth, cw: 滚.clientWidth, 列, 合计: 列.reduce((a, b) => a + b, 0) + (列[0] === 0 ? 选 : 0),
    表头: [...document.querySelectorAll(".member-table thead th")].map((t) => (t as HTMLElement).innerText.trim()).filter(Boolean),
    边: [...document.querySelectorAll(".member-table tbody tr:first-child td:not(.ant-table-selection-column)")].map((t) => getComputedStyle(t).paddingLeft),
    正文伸出: Math.max(0, 体.scrollWidth - 体.clientWidth),
  };
});
/** 每一格里的标签、按钮、小图标都不伸出格子的内容区（扣掉左右内边距） */
const 伸出格子 = (page: Page) => page.evaluate(() => [...document.querySelectorAll(".member-table tbody td:not(.ant-table-selection-column)")].flatMap((td) => {
  const g = td.getBoundingClientRect(), s = getComputedStyle(td);
  const 左 = g.left + parseFloat(s.paddingLeft), 右 = g.right - parseFloat(s.paddingRight);
  return [...td.querySelectorAll(".ant-tag, .ant-btn, .member-flag-btn")].filter((el) => { const r = el.getBoundingClientRect(); return r.right > 右 + 0.5 || r.left < 左 - 0.5; }).map((el) => (el as HTMLElement).innerText || el.className);
}));
const 点得中 = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }));
const 键 = '[aria-label="编辑 销售甲"], [aria-label="停用成员 销售甲"], [aria-label="恢复成员 走了的丙"]';
const 全八列 = ["姓名", "角色", "负责客户", "项目数", "跟进数", "状态"];

for (const w of [1024, 1199, 1200, 1240, 1264, 1280, 1440, 1536]) {
  it(`${w} 宽：成员表不横滚、列宽合计 ≤ 正文 − 8，格子里不伸出、动作点得中`, async () => {
    const { page, errors } = await 开(w);
    try {
      const a = await 量(page);
      if (w < 1200) expect(a.cw, "1024 整页最窄的内容区").toBe(460);
      expect(a.sw, JSON.stringify(a)).toBeLessThanOrEqual(a.cw);
      expect(a.合计, JSON.stringify(a)).toBeLessThanOrEqual(a.cw - 8);
      expect(a.正文伸出).toBe(0);
      expect(a.边.every((p) => p === "4px")).toBe(true);
      // 负责客户、跟进数 1200 以上才出（main 上本来如此，10-27）
      expect(a.表头).toEqual(w < 1200 ? ["姓名", "角色", "项目数", "状态"] : 全八列);
      expect(await 伸出格子(page)).toEqual([]);
      expect(await 点得中(page, 键)).toEqual([true, true, true]);
      const b = page.getByRole("button", { name: "编辑 销售甲", exact: true });
      expect((await b.innerText()).trim()).toBe("编辑");
      expect(await b.locator(".anticon").count()).toBe(w < 1200 ? 0 : 1);
      // 长名字一行，悬停有全名
      const 名 = page.locator(".member-table tr.ant-table-row").first().locator("td:not(.ant-table-selection-column)").first();
      expect(await 名.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(60);
      expect(await page.locator(`[title="老板${长}"]`).count()).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

for (const w of [1024, 1280]) {
  it(`${w} 宽：多角色标签只截第一个角色名，「+N」整个露出；悬停有全部角色`, async () => {
    const { page, errors } = await 开(w);
    try {
      const 标们 = await page.locator(".member-role-tag").evaluateAll((els) => els.map((el) => {
        const 名 = el.querySelector(".member-role-main") as HTMLElement, 多 = el.querySelector(".member-role-more") as HTMLElement | null;
        const t = el.getBoundingClientRect(), m = 多?.getBoundingClientRect();
        return { 名: 名.innerText, 截: 名.scrollWidth > 名.clientWidth, 名宽: 名.clientWidth, 多: 多?.innerText ?? null, 多宽: m?.width ?? 0, 多露: m ? m.right <= t.right + 0.5 && 多!.scrollWidth <= 多!.clientWidth : true, title: 名.title };
      }));
      const 总 = 标们.find((x) => x.名 === "总管理")!, 渠 = 标们.find((x) => x.名 === "渠道运营")!;
      for (const x of [总, 渠]) { expect(x.多).toBe("+1"); expect(x.多宽).toBeGreaterThan(0); expect(x.多露).toBe(true); expect(x.名宽).toBeGreaterThan(0); }
      // 总管理这行旁边还有两颗小图标：1024 下角色名是真截了（不是整行被盖住）
      if (w === 1024) expect(总.截).toBe(true);
      expect(总.title).toBe("总管理、销售成员");
      expect(渠.title).toBe("渠道运营、销售成员");
      expect(await 伸出格子(page)).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

for (const w of [1024, 1280]) {
  it(`${w} 宽：按下「停用」转圈时键不加宽、不伸出格子、表不横滚`, async () => {
    const { page, errors } = await 开(w);
    try {
      const sel = '[aria-label="停用成员 销售甲"]';
      const 前 = await page.locator(sel).evaluate((el) => el.getBoundingClientRect().width);
      await page.locator(sel).click();
      await page.locator(`${sel}.ant-btn-loading`).waitFor();
      const 测 = () => page.locator(sel).evaluate((el) => ({ 宽: el.getBoundingClientRect().width, 圈: (el.querySelector(".ant-btn-loading-icon, .anticon-loading") as HTMLElement | null)?.getBoundingClientRect().width ?? 0 }));
      // 转圈图标 antd 有展开动画：等它露出来再量
      await expect.poll(async () => (await 测()).圈).toBeGreaterThan(0);
      const 后 = await 测();
      expect(后.宽).toBeLessThanOrEqual(前 + 0.5);
      expect(await 伸出格子(page)).toEqual([]);
      const a = await 量(page);
      expect(a.sw).toBeLessThanOrEqual(a.cw);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("1024 宽直属上级（不是系统管理员）：「办离职」只留字、在格子里", async () => {
  const { page, errors } = await 开(1024, false);
  try {
    const a = await 量(page);
    expect(a.sw).toBeLessThanOrEqual(a.cw);
    const b = page.getByRole("button", { name: "给 销售甲 办离职", exact: true });
    expect((await b.innerText()).trim()).toBe("办离职");
    expect(await 点得中(page, '[aria-label="给 销售甲 办离职"]')).toEqual([true]);
    expect(await 伸出格子(page)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("1024 触屏：动作键各撑到 44 照样在格子里、整表不横滚", async () => {
  const { page, errors } = await 开(1024);
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const 框们 = await page.locator('[aria-label="编辑 销售甲"], [aria-label="停用成员 销售甲"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON())) as DOMRect[];
    expect(框们.every((r) => r.width >= 44 && r.height >= 44)).toBe(true);
    expect(await 伸出格子(page)).toEqual([]);
    const a = await 量(page);
    expect(a.sw).toBeLessThanOrEqual(a.cw);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("390 手机：成员表列宽、内边距、动作「图标 + 字」照旧", async () => {
  const { page, errors } = await 开(390);
  try {
    const a = await 量(page);
    expect(a.列.filter((x) => x > 0)).toEqual([146, 120, 72, 84, 136]);
    expect(a.边.every((p) => p === "8px")).toBe(true);
    const b = page.getByRole("button", { name: "编辑 销售甲", exact: true });
    expect((await b.innerText()).trim()).toBe("编辑");
    expect(await b.locator(".anticon").count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
