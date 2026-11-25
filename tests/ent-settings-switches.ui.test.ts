/**
 * 设置 →「开关总览」（设置开关 N1 / N3 / N7，11-23）：
 *   - 只系统管理员目录里有（「团队与权限」第一项）；别的身份带 ?tab=switches 落回个人资料，也不调 开关现状
 *   - 18 张卡左边对齐（用户 11-23），子开关卡头写「属于：线索分配和配额」
 *   - 父开关关着：子开关开着的能关（照样弹后果框）、关着的打不开
 *   - 拨开关先弹后果框，取消不调 action；超时回收先数个数；持有上限只读显示、不放输入框
 *   - 每卡「上次：谁 · 几点 · 动作」，组织规则比不出的只写「操作日志里比不出」；搜「卡点」给一条去项目模式；「在 X 里看」切到那一栏
 *   - 1280 / 390 宽不横向撑出；深色下照样画出来
 * 原卡「主动放弃」在线索分配关着时同一条规矩（OrgTab）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { 打包, 开页, 调用们 } from "./settings-ui-kit";

let browser: Browser, 页包: string, 组织包: string;
beforeAll(async () => {
  页包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import V from '@/app/(app)/settings/SettingsView';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    // 假动作要在第一次渲染前装好：开关总览一挂上就读
    window.__render=(p)=>{
      if(p.__mode)document.documentElement.dataset.mode=p.__mode;
      window.__act=(n)=>n==='开关现状'?p.__现:n==='读开关改动'?p.__改:n==='预览超时回收'?{ok:true,个数:p.__预览,团队:false}:{ok:true,收回:0};
      createRoot(document.getElementById('root')).render(<App><V business={DEFAULT_BUSINESS} {...p}/></App>);};`);
  组织包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import OrgTab from '@/app/(app)/settings/OrgTab';
    window.__act=(n)=>n==='通讯录概况'||n==='飞书表概况'?{ok:false,error:'不测'}:{ok:true};
    window.__render=(x)=>createRoot(document.getElementById('root')).render(<App><OrgTab value={{
      部门:[],成员:[],能改:true,是老板:true,线索不设配额:null,
      规则开着:{按组织看客户:false,线索分配:false,字段权限:false,市场复核:true,超时自动转:true,主动放弃:x.放弃},字段权限:{},字段权限挡:null,改权限:{},线索分配:null}}/></App>);`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 人 = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, email: id, title: "", role: "SALES", active: true, customerCount: 0, oppCount: 0, followCount: 0, ...extra });
const props = (身份: "系统管理员" | "只读管理员" | "成员") => ({
  users: 身份 !== "系统管理员" ? [] : [人("u1", "周宁", { 业务角色: ["director"] })],
  me: { id: "u1", name: "周宁", email: "u1", role: "SALES", title: "" },
  isAdmin: 身份 === "系统管理员", 只读: 身份 === "只读管理员", 只个人: 身份 !== "系统管理员", 身份, 企业版: true,
  我的角色: 身份 === "系统管理员" ? ["director"] : 身份 === "只读管理员" ? ["admin"] : ["sales_mgr"],
  logs: [], llm: { source: null, baseUrl: "", model: "", keyMasked: null, options: [] }, aiUsage: [], 机器: null,
  项目设置: 身份 !== "系统管理员" ? null : { 角色们: [], 类别们: [], 组织规则: null, 企业选项: null, 持有: {}, 提成比例: null, 能改提成比例: false, 挡: { 字典: null, 持有上限: null, 节点时限: null, 必填字段: null, 阶段规则: null } },
});

/** 正式服务器 11-23 的现值（线索分配这里拨成关，看子开关的规矩） */
const 现状 = (改: Record<string, unknown> = {}) => ({
  ok: true,
  值: { org_scope: true, field_perm: true, lead_assign: false, no_quota: false, reply_overdue: true, lead_giveup: true, market_review: true, block_meaningless: true,
    node_advance: true, first_two: false, fill_period: false, push_perm: "负责人可推", hold_cap: true, node_timeout: false, tri_state: false, record_only: false, record_only_recall: false,
    feishu_push: true, sync_feishu: false, coach_rec: false, ...改 },
  全员: 43,
  组织规则: { 公海: { 持有上限开: true, 默认上限: 999, 每人上限: {}, 多项目客户: "客户可转让" } },
  持有上限: { 默认上限: 999, 单设人数: 0, 到上限: 0 },
  节点推进: { 范围: "全部", 必填进程数: 13 },
  超时回收: { 内贸进程数: 9, 外贸进程数: 9, 起算日: "2026-11-01" },
  字段权限表改过: false,
  飞书: { 推送凭据齐了: true, 通讯录凭据齐了: true, 通讯录间隔分钟: 60 },
  录音: { 能打开: true, 测过: false, 密钥: "已配置" },
});
const 改动 = { ok: true, 上次: { reply_overdue: { 谁: "总管理", at: "2026-11-20T17:47:08Z", 动作: "打开" }, hold_cap: { 比不出: true } } };

async function 开(身份: Parameters<typeof props>[0], 宽 = 1280, 预览 = 0, mode?: "dark") {
  return 开页(browser, 页包, { ...props(身份), __现: 现状(), __改: 改动, __预览: 预览, __mode: mode }, 宽, "?tab=switches");
}
const 调了 = async (page: Page, 名: string) => (await 调用们(page)).filter(([n]) => n === 名).map(([, a]) => a);

it("系统管理员：目录「团队与权限」第一项是开关总览；18 张卡左边对齐，子开关写「属于」", async () => {
  const { page, errors } = await 开("系统管理员");
  try {
    await page.getByTestId("switches-tab").waitFor();
    const 页签 = (await page.getByRole("tab").allInnerTexts()).map((t) => t.split("\n")[0].trim());
    expect(页签.indexOf("开关总览")).toBe(页签.indexOf("团队成员") - 1);
    expect(await page.getByRole("tab", { name: /开关总览/ }).getAttribute("aria-selected")).toBe("true");
    const 左 = await page.locator(".sw-card").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(左).toHaveLength(20);
    expect(new Set(左).size).toBe(1);
    expect(await page.getByTestId("sw-parent-no_quota").innerText()).toBe("属于：线索分配和配额");
    expect(await page.getByTestId("sw-parent-lead_giveup").innerText()).toBe("属于：线索分配和配额");
    // 客户 11-23 定的说法
    expect(await page.getByTestId("sw-card-reply_overdue").innerText()).toContain("再过 30 分钟转给本线内本月分得最少的销售");
    expect(await page.getByTestId("sw-card-lead_giveup").innerText()).toContain("立即转给本线内另一位（本月分得最少的先给）");
    expect(await page.getByTestId("switches-tab").innerText()).not.toContain("本线下一位");
    // 称呼统一
    expect(await page.getByTestId("sw-card-org_scope").innerText()).toContain("总管理（系统管理员）");
    // 上次那行
    expect(await page.getByTestId("sw-card-reply_overdue").innerText()).toMatch(/上次：总管理 · .+ · 打开/);
    expect(await page.getByTestId("sw-card-first_two").innerText()).toContain("操作日志里没有改动");
    // 组织规则比不出：只写一句，不出现「上次： · 」空格子
    const 持有 = await page.getByTestId("sw-card-hold_cap").innerText();
    expect(持有).toContain("操作日志里比不出");
    expect(持有).not.toMatch(/上次：|· ·|undefined|Invalid Date/);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("其他身份：目录里没有开关总览，?tab=switches 落回个人资料，也不读开关", async () => {
  for (const 身份 of ["成员", "只读管理员"] as const) {
    const { page } = await 开(身份);
    try {
      await page.getByRole("tab", { name: /个人资料/ }).waitFor();
      expect(await page.getByRole("tab", { name: /开关总览/ }).count()).toBe(0);
      expect(await page.getByRole("tab", { name: /个人资料/ }).getAttribute("aria-selected")).toBe("true");
      expect(await page.getByTestId("switches-tab").count()).toBe(0);
      expect(await 调了(page, "开关现状")).toEqual([]);
    } finally { await page.close(); }
  }
});

it("父开关关着：开着的子开关能关（弹后果框、确认才调）；关着的子开关打不开", async () => {
  const { page } = await 开("系统管理员");
  try {
    const 不设 = page.getByTestId("sw-card-no_quota").getByRole("switch");
    expect(await 不设.isDisabled()).toBe(true);
    expect(await page.getByTestId("sw-lock-no_quota").innerText()).toContain("先打开「线索分配和配额」才起作用，现在打不开");
    const 放弃 = page.getByTestId("sw-card-lead_giveup").getByRole("switch");
    expect(await 放弃.isDisabled()).toBe(false);
    expect(await page.getByTestId("sw-lock-lead_giveup").innerText()).toContain("现在开着不起作用，可以关掉");
    await 放弃.click();
    const 框 = page.getByRole("dialog", { name: "关掉「销售主动放弃线索（豁免）」？" });
    await 框.getByRole("button", { name: "确认关掉" }).click();
    await expect.poll(() => 调了(page, "设规则")).toEqual([[false, "主动放弃"]]);
  } finally { await page.close(); }
});

it("拨开关先弹后果框，取消不调；超时回收先数个数；持有上限只读、不放输入框", async () => {
  const { page } = await 开("系统管理员", 1280, 4);
  try {
    await page.getByTestId("sw-card-org_scope").getByRole("switch").click();
    const 框 = page.getByRole("dialog", { name: "关掉「按组织架构看客户」？" });
    expect(await 框.innerText()).toContain("全员（43 人）看客户的范围");
    await 框.getByRole("button", { name: /^取\s*消$/ }).click();
    await 框.waitFor({ state: "hidden" });
    expect(await 调了(page, "设规则")).toEqual([]);

    await page.getByTestId("sw-card-node_timeout").getByRole("switch").click();
    const 数 = page.getByRole("dialog", { name: "按新设置，现在会有 4 个项目回到线索公海" });
    await 数.getByRole("button", { name: "确认打开" }).click();
    await expect.poll(() => 调了(page, "改组织规则")).toEqual([[{ 超时回收: { 开: true } }]]);

    const 持有 = page.getByTestId("sw-card-hold_cap");
    expect(await 持有.innerText()).toContain("默认 999 = 不限");
    expect(await 持有.locator("input").count()).toBe(0);
    expect(await page.locator(".sw-row", { hasText: "项目持有上限" }).innerText()).toContain("开 · 不限");
    expect(await page.locator(".sw-row", { hasText: "字段权限" }).innerText()).toContain("开 · 表没改过");
    // 超时回收、客户回收留红色提示
    expect(await page.locator(".sw-risk").count()).toBe(2);
  } finally { await page.close(); }
});

it("搜「卡点」给一条去项目模式；「在「项目模式」里看」切到项目模式那一栏", async () => {
  const { page } = await 开("系统管理员");
  try {
    await page.getByRole("searchbox", { name: "搜开关" }).fill("卡点");
    await page.locator(".sw-ptr").getByText("不是开关").waitFor();
    await page.getByRole("searchbox", { name: "搜开关" }).fill("进程推进");
    expect(await page.locator(".sw-card").count()).toBe(1);
    await page.getByTestId("sw-card-node_advance").getByRole("button", { name: "在「项目模式」里看" }).click();
    await expect.poll(() => page.getByRole("tab", { name: /项目模式/ }).getAttribute("aria-selected")).toBe("true");
  } finally { await page.close(); }
});

for (const [宽, mode] of [[1280, "dark"], [390, undefined], [390, "dark"]] as const) {
  it(`${宽}px${mode ? " 深色" : ""}：不横向撑出，卡内东西不伸出卡外`, async () => {
    const { page, errors } = await 开("系统管理员", 宽, 0, mode);
    try {
      await page.getByTestId("switches-tab").waitFor();
      const 量 = await page.evaluate(() => {
        const 伸出: string[] = [];
        for (const c of document.querySelectorAll(".sw-card, .sw-ov")) {
          const r = c.getBoundingClientRect();
          for (const x of c.querySelectorAll("*")) {
            const b = x.getBoundingClientRect();
            if (b.width && b.right > r.right + 1) 伸出.push(`${c.id || c.className}: ${(x.textContent ?? "").slice(0, 20)}`);
          }
        }
        // 目录 .set-nav 本来就有 -3px 的外边距（给焦点框留位置，settings.css），这里量正文：正文不横滚、卡片不出视口
        const 正文 = document.querySelector(".set-body") as HTMLElement;
        const 出屏 = [...document.querySelectorAll(".sw-card, .sw-ov, .sw-tools")].filter((x) => x.getBoundingClientRect().right > window.innerWidth + 0.5).map((x) => x.id || x.className);
        return { 横滚: 正文.scrollWidth - 正文.clientWidth, 出屏, 伸出 };
      });
      expect(量.横滚).toBeLessThanOrEqual(0);
      expect(量.出屏).toEqual([]);
      expect(量.伸出).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("原卡「主动放弃」：线索分配关着时关着的打不开、开着的能关", async () => {
  for (const 放弃 of [false, true]) {
    const { page } = await 开页(browser, 组织包, { 放弃 });
    try {
      const 开关 = page.getByTestId("org-rule-lead-giveup");
      await 开关.waitFor();
      expect(await 开关.isDisabled()).toBe(!放弃);
      expect(await page.getByTestId("org-rules").innerText()).toContain("先打开「线索分配和配额」才起作用");
    } finally { await page.close(); }
  }
});
