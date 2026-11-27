/**
 * 设置 → 团队成员 →「新增成员」（企业版，11-19）：当场选业务角色，能选「销售教练」。服务端见 ent-coach-new-member.test.ts。
 *
 *   系统管理员新增：业务角色下拉里有销售教练；选了教练，销售成员等销售类角色灰掉、那行写为什么；交上去带 业务角色
 *   先选了销售成员，销售教练灰掉
 *   选了总管理：业务角色那栏下面提醒「没设业务线的总管理就是系统管理员，能管设置」；没选总管理不提醒
 *   编辑已有成员：没有业务角色这一栏，保存交上去不带 业务角色（改角色只走组织架构，服务端带了会拒）
 *   不是系统管理员（isAdmin=false）：没有「新增成员」按钮
 * 选项、灰掉的规则和组织架构那一格是同一个 BizRoleSelect（组织架构那边见 ent-multi-role.ui.test.ts）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { 打包, 开页, 调用们 } from "./settings-ui-kit";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import MembersTab from '@/app/(app)/settings/MembersTab';
    const 人={id:'boss',name:'老板',email:'boss',title:'',role:'SALES',active:true,customerCount:0,oppCount:0,项目阶段:{},业务角色:['director'],系统管理员:{on:true,有线:false},followCount:0};
    window.__render=({isAdmin,title,email})=>createRoot(document.getElementById('root')).render(<App><MembersTab users={[{...人,title:title??'',email:email??人.email}]} me={{id:'boss',name:'老板',email:'boss',role:'SALES',title:'',avatar:null}} isAdmin={isAdmin} 用邮箱登录={false} 企业版 /></App>);`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(isAdmin: boolean, title?: string, email?: string) {
  const r = await 开页(browser, bundle, { isAdmin, title, email });
  await r.page.getByText("老板").first().waitFor();
  return r;
}
const 选项 = (page: Page) => page.locator(".ant-select-dropdown:visible .ant-select-item-option");
/** 点开业务角色下拉（负载高时偶尔没开：只在关着时才点，同 ent-multi-role.ui.test.ts 的 展开） */
async function 展开(page: Page) {
  const 框 = page.getByRole("dialog").getByRole("combobox", { name: "业务角色" });
  await expect.poll(async () => {
    if ((await 框.getAttribute("aria-expanded")) !== "true") await 框.click();
    await 选项(page).first().waitFor({ timeout: 3_000 }).catch(() => {});
    return (await 选项(page).allInnerTexts()).map((t) => t.split("\n")[0]);
  }, { timeout: 30_000, interval: 300 }).toContain("销售教练");
}
const 项 = (page: Page, 名: string) => 选项(page).filter({ hasText: new RegExp(`^${名}`) });
const 灰 = async (page: Page, 名: string) => (await 项(page, 名).getAttribute("class"))?.includes("ant-select-item-option-disabled") ?? false;
const 慢 = 60_000;

it("系统管理员新增：能选销售教练；选了教练销售类灰掉并写原因；交上去带 业务角色", async () => {
  const { page, errors } = await open(true);
  try {
    await page.getByRole("button", { name: /新增成员/ }).click();
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("姓名").fill("新教练");
    await 框.getByLabel("登录用户名").fill("newcoach");
    await 框.getByLabel("初始密码").fill("pass12345");
    await 展开(page);
    expect(await 灰(page, "销售教练")).toBe(false);
    await 项(page, "销售教练").click();
    // 选了教练：销售成员、销售管理、渠运、市场管理、项目运营灰掉，那行写为什么；总管理、管理员（只读管理员）照样能选
    for (const r of ["销售成员", "销售管理", "市场管理"]) {
      expect(await 灰(page, r)).toBe(true);
      expect(await 项(page, r).innerText()).toMatch(/销售教练不能兼.*分两个账号/);
    }
    expect(await 灰(page, "总管理")).toBe(false);
    expect(await 灰(page, "管理员")).toBe(false);
    // 点灰掉的不生效
    await 项(page, "销售成员").click({ force: true });
    await page.keyboard.press("Escape");
    expect(await 框.locator(".ant-select-selection-item").allInnerTexts()).toEqual(expect.arrayContaining(["销售教练"]));
    expect(await 框.locator(".ant-select-selection-item").allInnerTexts()).not.toContain("销售成员");
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(async () => (await 调用们(page)).filter(([n]) => n === "saveUser").length).toBe(1);
    const 交 = (await 调用们(page)).find(([n]) => n === "saveUser")![1] as { name: string; email: string; 业务角色?: string[] }[];
    expect(交[0]).toMatchObject({ name: "新教练", email: "newcoach", 业务角色: ["coach"] });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 慢);

it("设计语言 E1（D03）：空着点「保存」——各格下面报红、焦点到第一处没填的「姓名」，不交", async () => {
  const { page, errors } = await open(true);
  try {
    await page.getByRole("button", { name: /新增成员/ }).click();
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("姓名").waitFor();
    await 框.getByRole("button", { name: /保\s*存/ }).focus();
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await 框.locator(".ant-form-item-explain-error").first().waitFor();
    expect(await 框.locator(".ant-form-item-explain-error").allInnerTexts()).toEqual(expect.arrayContaining(["请填写姓名"]));
    await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? "")).toMatch(/name$/);
    expect((await 调用们(page)).filter(([n]) => n === "saveUser").length).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 慢);

it("先选了销售成员：销售教练灰掉", async () => {
  const { page, errors } = await open(true);
  try {
    await page.getByRole("button", { name: /新增成员/ }).click();
    await 展开(page);
    await 项(page, "销售成员").click();
    expect(await 灰(page, "销售教练")).toBe(true);
    expect(await 项(page, "销售教练").innerText()).toMatch(/销售教练不能兼销售成员/);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 慢);

const 总管理提示 = /没设业务线的总管理就是系统管理员，能管设置/;

it("选了总管理：提醒建好就能管设置；没选总管理不提醒", async () => {
  const { page, errors } = await open(true);
  try {
    await page.getByRole("button", { name: /新增成员/ }).click();
    const 框 = page.getByRole("dialog");
    expect(await 框.getByText(总管理提示).count()).toBe(0);
    // 多选下拉点一项不收起：同一次展开里先选销售成员（不提醒），再加总管理（提醒）
    await 展开(page);
    await 项(page, "销售成员").click();
    await expect.poll(() => 框.locator(".ant-select-selection-item").allInnerTexts()).toContain("销售成员");
    expect(await 框.getByText(总管理提示).count()).toBe(0);
    await 项(page, "总管理").click();
    await 框.getByText(总管理提示).waitFor();
    await page.keyboard.press("Escape");
    // 去掉总管理：提示跟着没了
    await 框.locator(".ant-select-selection-item").filter({ hasText: "总管理" }).locator(".ant-select-selection-item-remove").click();
    await expect.poll(() => 框.getByText(总管理提示).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 慢);

it("编辑已有成员：没有业务角色这一栏，保存不带 业务角色", async () => {
  const { page, errors } = await open(true);
  try {
    await page.getByRole("button", { name: "编辑 老板" }).click();
    const 框 = page.getByRole("dialog");
    await 框.getByLabel("姓名").waitFor();
    expect(await 框.getByLabel("姓名").inputValue()).toBe("老板");
    expect(await 框.getByRole("combobox", { name: "业务角色" }).count()).toBe(0);
    expect(await 框.getByText("业务角色", { exact: true }).count()).toBe(0);
    expect(await 框.getByText(总管理提示).count()).toBe(0);
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(async () => (await 调用们(page)).filter(([n]) => n === "saveUser").length).toBe(1);
    const 交 = (await 调用们(page)).find(([n]) => n === "saveUser")![1] as Record<string, unknown>[];
    expect(交[0]).toMatchObject({ id: "boss", name: "老板" });
    expect(交[0]).not.toHaveProperty("业务角色");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 慢);

it("不是系统管理员：没有「新增成员」", async () => {
  const { page, errors } = await open(false);
  try {
    expect(await page.getByRole("button", { name: /新增成员/ }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("E-384 职位：编辑成员（含系统管理员编辑自己）能看到「职位」输入框，改了随 saveUser 交上去；超 20 字报红不交", async () => {
  const { page, errors } = await open(true);
  try {
    await page.getByRole("button", { name: "编辑 老板" }).click();
    const 框 = page.getByRole("dialog");
    const 职位 = 框.getByLabel("职位");
    await 职位.waitFor();
    await 职位.fill("财务");
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(async () => (await 调用们(page)).filter(([n]) => n === "saveUser").length).toBe(1);
    const 交 = (await 调用们(page)).find(([n]) => n === "saveUser")![1] as { title?: string }[];
    expect(交[0].title).toBe("财务");
  } finally { await page.close(); }
  const b = await open(true);
  try {
    await b.page.getByRole("button", { name: "编辑 老板" }).click();
    const 框 = b.page.getByRole("dialog");
    await 框.getByLabel("职位").fill("长".repeat(21));
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await 框.getByText("最多 20 个字").first().waitFor();
    expect((await 调用们(b.page)).filter(([n]) => n === "saveUser").length).toBe(0);
    expect(errors).toEqual([]);
  } finally { await b.page.close(); }
}, 慢);

it("E-384 职位：编辑原职位就超 20 字的成员（飞书 / 钉钉同步来的）不报红，可保存；改成另一个超长职位仍报红", async () => {
  const 长 = "长".repeat(25);
  const a = await open(true, 长);
  try {
    await a.page.getByRole("button", { name: "编辑 老板" }).click();
    const 框 = a.page.getByRole("dialog");
    await 框.getByLabel("职位").waitFor();
    await 框.getByLabel("姓名").fill("老板改名");
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(async () => (await 调用们(a.page)).filter(([n]) => n === "saveUser").length).toBe(1);
    const 交 = (await 调用们(a.page)).find(([n]) => n === "saveUser")![1] as { title?: string; name?: string }[];
    expect([交[0].name, 交[0].title]).toEqual(["老板改名", 长]);
    expect(await 框.getByText("最多 20 个字").count()).toBe(0);
    expect(a.errors).toEqual([]);
  } finally { await a.page.close(); }
  const b = await open(true, 长);
  try {
    await b.page.getByRole("button", { name: "编辑 老板" }).click();
    const 框 = b.page.getByRole("dialog");
    await 框.getByLabel("职位").fill("宽".repeat(21));
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await 框.getByText("最多 20 个字").first().waitFor();
    expect((await 调用们(b.page)).filter(([n]) => n === "saveUser").length).toBe(0);
    expect(b.errors).toEqual([]);
  } finally { await b.page.close(); }
}, 慢);

it("导入来的登录名（xx@import.invalid）：编辑只改职位能保存、不报红；改成另一个不合法的报红不交", async () => {
  const 名 = "xx@import.invalid";
  const a = await open(true, undefined, 名);
  try {
    await a.page.getByRole("button", { name: "编辑 老板" }).click();
    const 框 = a.page.getByRole("dialog");
    await 框.getByLabel("职位").fill("销售总监");
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(async () => (await 调用们(a.page)).filter(([n]) => n === "saveUser").length).toBe(1);
    const 交 = (await 调用们(a.page)).find(([n]) => n === "saveUser")![1] as { email?: string; title?: string }[];
    expect([交[0].email, 交[0].title]).toEqual([名, "销售总监"]);
    expect(await 框.getByText(/2–32/).count()).toBe(0);
    expect(a.errors).toEqual([]);
  } finally { await a.page.close(); }
  const b = await open(true, undefined, 名);
  try {
    await b.page.getByRole("button", { name: "编辑 老板" }).click();
    const 框 = b.page.getByRole("dialog");
    await 框.getByLabel("登录用户名").fill("yy@import.invalid");
    await 框.getByRole("button", { name: /保\s*存/ }).click();
    await 框.getByText(/2–32/).first().waitFor();
    expect((await 调用们(b.page)).filter(([n]) => n === "saveUser").length).toBe(0);
  } finally { await b.page.close(); }
}, 慢);
