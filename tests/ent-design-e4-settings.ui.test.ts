/**
 * 设计语言 E4 · 设置（11-22；落地计划-客户详情设计 E4 节）：
 *   K6  回收站 1024 宽（设置正文约 494）横向溢出 42px、长客户名推到 64px：表格按列宽排，名称列分剩下的、长名字省略号
 *   D09 成员表行内动作「图标 + 字」（编辑、停用、恢复、办离职），用 L-B 定的 .row-act 款；行上不标红；1024 / 1366 设置正文里不横滚、点得中；390 点击区 ≥44
 *   「总管理」角色标签红 → 灰（红按规则只给出问题；D1 实测）
 *   D19 设置卡片里的小节标题（Title 5）和卡头同号 15；D16 设置锁「已发给…」、首页模型备注的小字绿用 --success-text
 *   D22 浮层层级：设置浮层（.setm）在 antd 弹框（1000）之下、看板闸门（.board-gate）在下拉（1050）之下——所有主题
 *   换皮主题（账簿）外观不动：成员表照旧只有图标、角色标签照旧红、小节标题照旧 16
 * 宽度：设置正文 1024 宽时 494、1366 宽时约 784（.set 1040 − 左栏 200 − 间距 − 卡片内边距），手机 390 约 358
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { 打包, 开页 } from "./settings-ui-kit";

let browser: Browser, bundle: string;
const 长 = "某某超长名字的智能制造装备与工业自动化系统集成有限公司华东区域采购项目第二期".repeat(2);
beforeAll(async () => {
  bundle = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider,Typography,Select} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import TrashTab from '@/app/(app)/settings/TrashTab';import MembersTab from '@/app/(app)/settings/MembersTab';
    const 长=${JSON.stringify(长)};
    const 条=(i,表)=>({表,id:'t'+i,名称:长+i,客户:表==='Customer'?null:{id:'c'+i,name:长,也删了:false},deletedAt:'2026-11-20T00:00:00.000Z',剩几天:20,连带:表==='Customer'?{联系人:3,项目:2,沟通记录:12}:undefined});
    window.__act=(名)=>名==='回收站列表动作'?{ok:true,能彻底删除:true,条目:[条(1,'Customer'),条(2,'Project'),条(3,'Contact'),条(4,'FollowUp')]}:{ok:true};
    const 人=(id,name,角色,active=true)=>({id,name,email:id,title:'',role:'SALES',active,customerCount:12,oppCount:0,项目阶段:{线索:2,商机:1},业务角色:角色,系统管理员:角色.includes('director')?{on:true,有线:false}:undefined,followCount:30});
    const 们=[人('boss','老板'+长,['director']),人('u1','销售甲',['sales']),人('u2','管理员乙',['admin']),人('u3','走了的丙',['sales'],false)];
    window.__render=({页,宽,isAdmin})=>createRoot(document.getElementById('root')).render(<ConfigProvider locale={zhCN} button={{autoInsertSpace:false}}><App><div className="set-body" style={{width:宽,boxSizing:'border-box'}}>
      {页==='零件'?<><Typography.Title level={5}>状态显示名</Typography.Title><span className='set-lock-sent'>已发给总管理</span><span className='mp-note'>备注</span><div className='setm' data-k='setm'><Select open aria-label='下拉' options={[{value:'a',label:'甲'}]}/></div><div className='board-gate' data-k='gate'>没推过去</div></>:页==='回收站'?<TrashTab/>:<MembersTab users={们} me={{id:'boss',name:'老板',email:'boss',role:'SALES',title:'',avatar:null}} isAdmin={isAdmin!==false} 用邮箱登录={false} 企业版 下属可停用={isAdmin===false?['u1']:[]}/>}
    </div></App></ConfigProvider>);`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 正文宽 = (w: number) => (w >= 1366 ? 784 : w >= 1024 ? 494 : w - 32);
async function 开(页: "回收站" | "成员" | "零件", w: number, 主题?: string, isAdmin = true) {
  const r = await 开页(browser, bundle, { 页, 宽: 正文宽(w), isAdmin }, w);
  if (主题) await r.page.evaluate((t) => document.documentElement.setAttribute("data-skin", t), 主题);
  await r.page.locator(页 === "零件" ? ".set-lock-sent" : 页 === "回收站" ? "tr.ant-table-row" : ".member-table tr.ant-table-row").first().waitFor();
  return r;
}
/** 正文（.set-body）里横向伸出去多少：表格比正文宽、或表格自己出了横滚 */
const 伸出 = (page: Page) => page.evaluate(() => {
  const 体 = document.querySelector(".set-body")!;
  const 表 = 体.querySelector(".ant-table")!;
  return { 正文: Math.max(0, 体.scrollWidth - 体.clientWidth), 表: Math.max(0, 表.getBoundingClientRect().right - 体.getBoundingClientRect().right) };
});
const 点得中 = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }));

for (const w of [1024, 1280, 1366, 390]) {
  it(`K6 回收站 ${w} 宽 + 超长客户名：正文不横向溢出，名称省略号，「恢复」「彻底删除」点得中`, async () => {
    const { page, errors } = await 开("回收站", w);
    try {
      expect(await 伸出(page)).toEqual({ 正文: 0, 表: 0 });
      expect(await 点得中(page, "tr.ant-table-row .ant-btn")).toEqual(Array(8).fill(true));
      // 名称格是省略号，不是整串撑开
      const 名 = page.locator("tr.ant-table-row").first().locator(".ant-typography-ellipsis").first();
      expect(await 名.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("D09 成员表（系统管理员）：行内动作「编辑」「停用」「恢复」图标 + 字，.row-act 款（不带框、蓝字）；停用不标红", async () => {
  const { page, errors } = await 开("成员", 1366);
  try {
    const 行 = page.locator(".member-table tr.ant-table-row");
    for (const [名, 字] of [["编辑 销售甲", "编辑"], ["停用成员 销售甲", "停用"], ["恢复成员 走了的丙", "恢复"]]) {
      const b = 行.getByRole("button", { name: 名, exact: true });
      expect((await b.innerText()).trim(), 名).toBe(字);
      expect(await b.locator(".anticon").count(), 名).toBe(1);
      const s = await b.evaluate((el) => { const c = getComputedStyle(el); return { 框: c.borderTopColor, 底: c.backgroundColor, 类: el.className }; });
      expect(s.框).toBe("rgba(0, 0, 0, 0)");
      expect(s.底).toBe("rgba(0, 0, 0, 0)");
      expect(s.类).toMatch(/\brow-act\b/);
      expect(s.类).not.toMatch(/ant-btn-dangerous/);
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D09 成员表（直属上级，不是系统管理员）：「办离职」图标 + 字", async () => {
  const { page, errors } = await 开("成员", 1366, undefined, false);
  try {
    const b = page.getByRole("button", { name: "给 销售甲 办离职", exact: true });
    expect((await b.innerText()).trim()).toBe("办离职");
    expect(await b.locator(".anticon").count()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const w of [1024, 1280, 1366]) {
  it(`D09 成员表 ${w} 宽：操作列放得下两颗带字的键、不被裁，点得中；1366 正文里不横滚`, async () => {
    const { page, errors } = await 开("成员", w);
    try {
      const 行 = page.locator(".member-table tr.ant-table-row").nth(1);
      const 格 = await 行.locator("td").last().evaluate((el) => el.getBoundingClientRect().toJSON()) as DOMRect;
      for (const sel of ['[aria-label="编辑 销售甲"]', '[aria-label="停用成员 销售甲"]']) {
        const r = await page.locator(sel).evaluate((el) => el.getBoundingClientRect().toJSON()) as DOMRect;
        expect(r.right, sel).toBeLessThanOrEqual(格.right + 0.5);
        expect(r.left, sel).toBeGreaterThanOrEqual(格.left - 0.5);
        expect(Math.abs(r.top - 格.top - (格.height - r.height) / 2), `${sel} 同一行`).toBeLessThan(2);
      }
      // 表格自己可能横滚（1024 本来就滚），滚到最右再点
      await page.locator(".member-table .ant-table-content, .member-table .ant-table-body").first().evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      expect(await 点得中(page, '[aria-label="编辑 销售甲"], [aria-label="停用成员 销售甲"]')).toEqual([true, true]);
      if (w >= 1366) expect(await page.locator(".member-table .ant-table-content, .member-table .ant-table-body").first().evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect((await 伸出(page)).正文).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("D09 成员表 390 触屏：带字的键点击区 ≥44、两颗同一行、在格子里", async () => {
  const { page, errors } = await 开("成员", 390);
  try {
    const 键 = page.locator('[aria-label="编辑 销售甲"], [aria-label="停用成员 销售甲"]');
    const 框们 = await 键.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON())) as DOMRect[];
    expect(框们.every((r) => r.height >= 44 && r.width >= 44)).toBe(true);
    expect(Math.abs(框们[0].top - 框们[1].top)).toBeLessThan(1);
    const 格 = await page.locator(".member-table tr.ant-table-row").nth(1).locator("td").last().evaluate((el) => el.getBoundingClientRect().toJSON()) as DOMRect;
    expect(框们[1].right).toBeLessThanOrEqual(格.right + 0.5);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("「总管理」「管理员」角色标签灰（不再红）；销售标签照旧默认灰", async () => {
  const { page, errors } = await 开("成员", 1366);
  try {
    const 标 = page.locator(".member-role-tag");
    const 色们 = await 标.evaluateAll((els) => els.map((el) => ({ 字: el.textContent, 类: el.className })));
    for (const x of 色们) expect(x.类, x.字 ?? "").not.toMatch(/ant-tag-red|ant-tag-color-red/);
    expect(色们.map((x) => x.字)).toEqual(expect.arrayContaining(["总管理"]));
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("换皮主题（账簿）外观不动：成员表照旧只有图标、「总管理」照旧红", async () => {
  const { page, errors } = await 开("成员", 1366, "ledger");
  try {
    const b = page.getByRole("button", { name: "编辑 销售甲", exact: true });
    expect((await b.innerText()).trim()).toBe("");
    const 总 = page.locator(".member-role-tag").filter({ hasText: "总管理" });
    expect(await 总.getAttribute("class")).toMatch(/red/);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

const 色 = (page: Page, v: string) => page.evaluate((x) => { const d = document.createElement("i"); d.style.color = `var(${x})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, v);
const 算 = (page: Page, sel: string, k: string) => page.locator(sel).first().evaluate((el, kk) => getComputedStyle(el).getPropertyValue(kk), k);

it("D19 / D16：设置小节标题 15（同卡头）；「已发给…」、模型备注小字绿用 --success-text", async () => {
  const { page, errors } = await 开("零件", 1366);
  try {
    expect(await 算(page, ".set-body h5.ant-typography", "font-size")).toBe("15px");
    const 深绿 = await 色(page, "--success-text");
    expect(await 算(page, ".set-lock-sent", "color")).toBe(深绿);
    expect(await 算(page, ".mp-note", "color")).toBe(深绿);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("D22：设置浮层在 antd 弹框之下（990 < 1000），里面开的下拉在它上面；看板闸门同气泡层（1030 < 下拉 1050）——账簿主题一样", async () => {
  for (const 主题 of [undefined, "ledger"]) {
    const { page, errors } = await 开("零件", 1366, 主题);
    try {
      expect(Number(await 算(page, "[data-k=setm]", "z-index")), 主题).toBe(990);
      expect(Number(await 算(page, "[data-k=gate]", "z-index")), 主题).toBe(1030);
      const 下拉 = page.locator(".ant-select-dropdown").first();
      await 下拉.waitFor();
      expect(Number(await 下拉.evaluate((el) => getComputedStyle(el).zIndex)), 主题).toBeGreaterThan(990);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
});

it("换皮主题（账簿）：小节标题照旧 16、小字绿照旧 --success", async () => {
  const { page, errors } = await 开("零件", 1366, "ledger");
  try {
    expect(await 算(page, ".set-body h5.ant-typography", "font-size")).toBe("16px");
    expect(await 算(page, ".set-lock-sent", "color")).toBe(await 色(page, "--success"));
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("K6 换皮主题（账簿）同样修：回收站 1024 宽正文不横向溢出（bug 修复所有主题都生效）", async () => {
  const { page, errors } = await 开("回收站", 1024, "ledger");
  try {
    expect(await 伸出(page)).toEqual({ 正文: 0, 表: 0 });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
