/**
 * PR9 设置页按登录身份（P-界面-46，原型 st.role / st.lock / st.perm / st.find）和设置各页签的确认替换（P-界面-40，PR5a 组件）：
 *   - 各身份看到的页签、分组：系统管理员全有；销售管理、市场管理只有「我自己 / 带团队 / 全公司规则」，看不到团队成员、操作日志
 *   - 只读管理员：仍只有个人页签（P-全局-02 不放宽），顶上写明只读
 *   - 全公司规则：灰着写「只有总管理能改」，「找总管理开通」原地变「已发给 xx」
 *   - 搜一项：搜说明里没有的具体项（「分配」→ 线索配额），结果写明在哪个页签，回车直达
 *   - 确认项不确认不生效：设系统管理员（后果框）、字典停用（原地确认）
 *   - Windows 1024 / 1280 / 1366 + 超长名字不溢出
 * 认元素用 role 和文字，不认 antd 内部类名
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { 打包, 开页, 调用们 } from "./settings-ui-kit";

let browser: Browser, 页包: string, 卡包: string;
beforeAll(async () => {
  页包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import V from '@/app/(app)/settings/SettingsView';import {默认三态规则} from '@/lib/project/org-rules';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    window.__render=(p)=>createRoot(document.getElementById('root')).render(<App><V business={DEFAULT_BUSINESS} {...p} 客户回收={p.客户回收===true?{三态:默认三态规则,挡:p.只读?'只有系统管理员能改':null,占位词:null}:null}/></App>);`);
  卡包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import C from '@/app/(app)/settings/ProjectSettingsTab';
    window.__render=()=>createRoot(document.getElementById('root')).render(<App><C 成员={[]} value={{角色们:[{id:'r1',name:'技术负责人',active:true,用的人:2}],类别们:[],组织规则:null,企业选项:null,持有:{},提成比例:null,能改提成比例:false,挡:{字典:null,持有上限:null,节点时限:null,必填字段:null,阶段规则:null}}}/></App>);`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 长名 = "欧阳上官慕容诸葛司马长孙宇文东方皇甫尉迟公孙轩辕令狐钟离";
const 人 = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, email: id, title: "", role: "SALES", active: true, customerCount: 0, oppCount: 0, followCount: 0, ...extra });
const props = (身份: "系统管理员" | "只读管理员" | "成员", extra: Record<string, unknown> = {}) => ({
  users: 身份 !== "系统管理员" ? [] : [人("u1", "周宁", { 业务角色: ["director"] }), 人("u2", "李想", { 业务角色: ["director"], 系统管理员: { on: false, 有线: true } })],
  me: { id: "u1", name: "周宁", email: "u1", role: "SALES", title: "" },
  isAdmin: 身份 === "系统管理员", 只读: 身份 === "只读管理员", 只个人: 身份 !== "系统管理员", 身份, 企业版: true,
  我的角色: 身份 === "系统管理员" ? ["director"] : 身份 === "只读管理员" ? ["admin"] : ["sales_mgr"],
  logs: [], llm: { source: null, baseUrl: "", model: "", keyMasked: null, options: [] }, aiUsage: [], 机器: null,
  ...extra,
});
const 页签们 = async (page: Page) => (await page.getByRole("tab").allInnerTexts()).map((t) => t.split("\n")[0].trim());

it("各身份看到的页签：系统管理员全有、按「我要做什么」分组；销售管理只有个人几项、我能做什么、全公司规则", async () => {
  const a = await 开页(browser, 页包, props("系统管理员", { 客户回收: true }));
  try {
    await a.page.getByRole("tab", { name: /团队成员/ }).waitFor();
    const 有 = await 页签们(a.page);
    expect(有).toEqual(expect.arrayContaining(["个人资料", "我能做什么", "团队成员", "客户回收", "操作日志"]));
    expect(有).not.toContain("全公司规则");
    for (const g of ["我自己", "团队与权限", "线索和公海", "数据"]) await a.page.getByText(g, { exact: true }).waitFor();
    expect(a.errors).toEqual([]);
  } finally { await a.page.close(); }

  const b = await 开页(browser, 页包, props("成员"));
  try {
    await b.page.getByRole("tab", { name: /个人资料/ }).waitFor();
    expect(await 页签们(b.page)).toEqual(["个人资料", "登录与密码", "快捷键", "外观", "我能做什么", "全公司规则"]);
    await b.page.getByText("销售管理 · 灰掉的只能看", { exact: false }).waitFor();
    // 我能做什么：按身份列，进后台设置是「不能」
    await b.page.getByRole("tab", { name: /我能做什么/ }).click();
    const 表 = b.page.getByRole("region", { name: "我能做什么" });
    await 表.getByText("给下属设线索配额").waitFor();
    expect(await 表.getByRole("listitem").filter({ hasText: "进后台设置" }).getByLabel("不能").count()).toBe(1);
    expect(b.errors).toEqual([]);
  } finally { await b.page.close(); }
});

it("市场管理的「我能做什么」：领公海、删客户是不能", async () => {
  const { page } = await 开页(browser, 页包, props("成员", { 我的角色: ["marketing_mgr"] }), 1366, "?tab=perm");
  try {
    const 表 = page.getByRole("region", { name: "我能做什么" });
    await 表.getByText("建线索、分配线索").waitFor();
    expect(await 表.getByRole("listitem").filter({ hasText: "领公海客户" }).getByLabel("不能").count()).toBe(1);
    expect(await 表.getByRole("listitem").filter({ hasText: "建线索、分配线索" }).getByLabel("能", { exact: true }).count()).toBe(1);
  } finally { await page.close(); }
});

it("全公司规则：灰着写只有总管理能改；「找总管理开通」原地变成已发给谁", async () => {
  const { page, errors } = await 开页(browser, 页包, props("成员"), 1366, "?tab=rules");
  try {
    await page.evaluate(() => { (window as unknown as { __act: unknown }).__act = (n: string) => (n === "找总管理开通" ? { ok: true, 发给: ["周宁"] } : { ok: true }); });
    const 行 = page.getByRole("listitem").filter({ hasText: "客户回收天数" });
    await 行.getByText("只有总管理能改").waitFor();
    await 行.getByRole("button", { name: "找总管理开通" }).click();
    await 行.getByRole("status").filter({ hasText: "已发给 周宁" }).waitFor();
    expect((await 调用们(page)).filter(([n]) => n === "找总管理开通").map(([, a]) => a)).toEqual([["recycle"]]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("只读管理员：仍只有个人页签（不扩大可见范围），顶上写明只读", async () => {
  const { page } = await 开页(browser, 页包, props("只读管理员"));
  try {
    await page.getByRole("note").filter({ hasText: "只读管理员" }).waitFor();
    expect(await 页签们(page)).toEqual(["个人资料", "登录与密码", "快捷键", "外观", "我能做什么", "全公司规则"]);
    await page.getByRole("tab", { name: /我能做什么/ }).click();
    expect(await page.getByRole("region", { name: "我能做什么" }).getByRole("listitem").filter({ hasText: "改任何数据" }).getByLabel("不能").count()).toBe(1);
  } finally { await page.close(); }
});

it("搜一项：「分配」搜到线索配额（写明在哪个页签），回车直达", async () => {
  const 行 = [{ userId: "u9", name: "陈默", line: "内贸", 已分: 1, 配额: 10, 设的配额: 10, 加额: 0, 持有: 1, 参与: true, 参与状态: "允许", 能设配额: true, 能改参与: false }];
  const { page } = await 开页(browser, 页包, props("成员", { 线索配额: { 行, 不限额: false } }));
  try {
    const 搜 = page.getByRole("searchbox", { name: "搜索设置" });
    await 搜.fill("分配");
    await page.getByRole("tab", { name: /线索配额/ }).waitFor();
    expect(await page.getByRole("tab", { name: /个人资料/ }).count()).toBe(0);
    // 说明里没「分配」的（全公司规则）不该出来；说明里有的照常
    await 搜.fill("持有上限");
    await page.getByRole("tab", { name: /全公司规则/ }).filter({ hasText: "全公司规则 › 持有上限" }).waitFor();
    await 搜.press("Enter");
    await page.getByRole("tab", { name: /全公司规则/, selected: true }).waitFor();
    await page.getByRole("region", { name: "全公司规则" }).waitFor();
  } finally { await page.close(); }
});

it("设系统管理员：先弹后果框；取消不提交，确认了才提交", async () => {
  const { page } = await 开页(browser, 页包, props("系统管理员"));
  try {
    await page.getByRole("switch", { name: "李想 系统管理员" }).click();
    const 框 = page.getByRole("dialog", { name: "把「李想」设为系统管理员" });
    await 框.waitFor();
    expect(await 框.innerText()).toContain("后台设置、成员管理");
    await 框.getByRole("button", { name: /^取\s?消$/ }).click();
    await 框.waitFor({ state: "detached" });
    expect((await 调用们(page)).filter(([n]) => n === "设系统管理员")).toEqual([]);
    await page.getByRole("switch", { name: "李想 系统管理员" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "设为系统管理员" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    expect((await 调用们(page)).filter(([n]) => n === "设系统管理员").map(([, a]) => a)).toEqual([["u2", true, true]]);
  } finally { await page.close(); }
});

it("字典停用：原地问一句；不点确认不停用", async () => {
  const { page } = await 开页(browser, 卡包, null);
  try {
    await page.getByRole("button", { name: /^停\s?用$/ }).first().click();
    await page.getByText("停用后不能再选；已经用着它的组员不变").waitFor();
    await page.waitForTimeout(300);
    expect((await 调用们(page)).filter(([n]) => n === "改组员角色")).toEqual([]);
    await page.getByRole("button", { name: /^停\s?用$/ }).last().click();
    await page.waitForFunction(() => ((window as unknown as { __calls?: [string][] }).__calls ?? []).some(([n]) => n === "改组员角色"));
    expect((await 调用们(page)).filter(([n]) => n === "改组员角色").map(([, a]) => a)).toEqual([["r1", { active: false }]]);
  } finally { await page.close(); }
});

it("Windows 1024 / 1280 / 1366 + 超长名字：页面不横滚，页签名、规则行、我能做什么不溢出", async () => {
  const 行 = [{ userId: "u9", name: 长名, line: "内贸", 已分: 1, 配额: 10, 设的配额: 10, 加额: 0, 持有: 1, 参与: true, 参与状态: "允许", 能设配额: true, 能改参与: false }];
  for (const w of [1024, 1280, 1366]) {
    for (const tab of ["rules", "perm", "quota"]) {
      const { page } = await 开页(browser, 页包, props("成员", { me: { id: "u1", name: 长名, email: "u1", role: "SALES", title: "" }, 我的角色: ["sales_mgr", "marketing_mgr", "channel_ops"], 线索配额: { 行, 不限额: false } }), w, `?tab=${tab}`);
      try {
        await page.getByRole("tabpanel").waitFor();
        await page.waitForTimeout(100);
        const r = await page.evaluate(() => {
          const 体 = document.querySelector('[role="tabpanel"]')!.getBoundingClientRect();
          const 超 = [...document.querySelectorAll('[role="tabpanel"] li, [role="tabpanel"] section')].filter((el) => el.getBoundingClientRect().right > 体.right + 1).length;
          const 第一项 = document.querySelector('[role="tabpanel"] li');
          let 盖住 = false;
          if (第一项) { const b = 第一项.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + 8, b.top + b.height / 2); 盖住 = !!hit && !第一项.contains(hit); }
          return { 横滚: document.documentElement.scrollWidth > window.innerWidth + 1, 超, 盖住 };
        });
        expect(r, `${w} ${tab}`).toEqual({ 横滚: false, 超: 0, 盖住: false });
      } finally { await page.close(); }
    }
  }
}, 90_000);
