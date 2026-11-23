/**
 * 设置开关 N6 / N8（11-23）：项目模式原卡上一点就生效的四项补后果框，「先数再确认」抽成共用钩子后原卡照旧。
 *   - 节点推进开关（开、关）、「管哪些项目」改回全部项目、前两个进程要沟通、需求补全期、往前推权限：先弹后果框，取消不存，确认才调 改组织规则
 *   - 改成「开启之后新建的」只少管：不问，当场存（ent-node-advance-scope 也钉着）
 *   - 超时回收打开：预览 0 个不弹框直接存；有的话框里写个数
 *   - 持有上限打开：框里写现在几人到上限
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { 打包, 开页, 调用们 } from "./settings-ui-kit";

let browser: Browser, 包: string;
beforeAll(async () => {
  包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import C from '@/app/(app)/settings/ProjectSettingsTab';import {默认组织规则} from '@/lib/project/org-rules';
    window.__render=(p)=>createRoot(document.getElementById('root')).render(<App><C 成员={[{id:'u1',name:'甲'},{id:'u2',name:'乙'}]} value={{角色们:[],类别们:[],
      组织规则:{...默认组织规则,节点推进:{...默认组织规则.节点推进,开:p.推进开,范围:p.范围},公海:{...默认组织规则.公海,默认上限:3}},企业选项:null,持有:{u1:5,u2:1},提成比例:null,能改提成比例:false,
      挡:{字典:null,持有上限:null,节点时限:null,必填字段:null,阶段规则:null}}}/></App>);`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 开 = (p: { 推进开?: boolean; 范围?: "全部" | "新建"; 预览?: number } = {}) => 开页(browser, 包, { 推进开: false, 范围: "全部", ...p }).then(async (r) => {
  await r.page.evaluate((n) => { (window as unknown as { __act: (名: string) => unknown }).__act = (名: string) => (名 === "预览超时回收" ? { ok: true, 个数: n, 团队: false } : { ok: true, 收回: 0 }); }, p.预览 ?? 0);
  return r;
});
const 改了 = async (page: Page) => (await 调用们(page)).filter(([n]) => n === "改组织规则").map(([, a]) => a[0]);

it("前两个进程要沟通、需求补全期、往前推权限：先弹后果框；取消不存，确认才存", async () => {
  const { page, errors } = await 开();
  try {
    await page.getByRole("switch", { name: "前两个进程要沟通" }).click();
    const 框 = page.getByRole("dialog", { name: "打开「前两个进程各要一条沟通」？" });
    await 框.waitFor();
    expect(await 框.innerText()).toContain("影响谁");
    await 框.getByRole("button", { name: /^取\s*消$/ }).click();
    await 框.waitFor({ state: "hidden" });
    expect(await 改了(page)).toEqual([]);
    expect(await page.getByRole("switch", { name: "前两个进程要沟通" }).isChecked()).toBe(false);

    await page.getByRole("switch", { name: "需求状态补全期" }).click();
    await page.getByRole("dialog", { name: "打开「需求状态补全期」？" }).getByRole("button", { name: "确认打开" }).click();
    await expect.poll(() => 改了(page)).toEqual([{ 阶段: { 需求补全期: true } }]);

    await page.getByRole("radio", { name: /仅上级推/ }).click();
    const 框2 = page.getByRole("dialog", { name: "「谁能往前推进程」改成「仅上级推」？" });
    expect(await 框2.innerText()).toContain("有直属上级的负责人自己推不动，由直属上级和总管理推");
    await 框2.getByRole("button", { name: "确认改" }).click();
    await expect.poll(() => 改了(page)).toEqual([{ 阶段: { 需求补全期: true } }, { 阶段: { 推进权限: "仅上级推" } }]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("节点推进：开、关都先弹后果框；改回全部项目弹框，改成新建的不问", async () => {
  const a = await 开();
  try {
    await a.page.getByRole("switch", { name: "节点推进" }).click();
    const 框 = a.page.getByRole("dialog", { name: "打开「节点推进」？" });
    expect(await 框.innerText()).toContain("存量项目下次保存或点「完成节点」时按必填走");
    await 框.getByRole("button", { name: /^取\s*消$/ }).click();
    expect(await 改了(a.page)).toEqual([]);
  } finally { await a.page.close(); }

  const b = await 开({ 推进开: true, 范围: "新建" });
  try {
    await b.page.getByRole("switch", { name: "节点推进" }).click();
    await b.page.getByRole("dialog", { name: "关掉「节点推进」？" }).waitFor();
    await b.page.getByRole("button", { name: /^取\s*消$/ }).click();
    await b.page.getByText("全部项目", { exact: true }).click();
    const 框 = b.page.getByRole("dialog", { name: "节点推进改成管全部项目？" });
    await 框.getByRole("button", { name: "确认改" }).click();
    await expect.poll(() => 改了(b.page)).toEqual([{ 节点推进: { 范围: "全部" } }]);
  } finally { await b.page.close(); }
});

it("超时回收打开：先数 0 个不弹框直接存；有 3 个框里写明个数（原卡和总览共用一个钩子）", async () => {
  const a = await 开({ 预览: 0 });
  try {
    await a.page.getByRole("switch", { name: "超时回收" }).click();
    await expect.poll(() => 改了(a.page)).toEqual([{ 超时回收: { 开: true } }]);
    expect(await a.page.getByRole("dialog").count()).toBe(0);
  } finally { await a.page.close(); }

  const b = await 开({ 预览: 3 });
  try {
    await b.page.getByRole("switch", { name: "超时回收" }).click();
    const 框 = b.page.getByRole("dialog", { name: "按新设置，现在会有 3 个项目回到线索公海" });
    await 框.getByRole("button", { name: "确认打开" }).click();
    await expect.poll(() => 改了(b.page)).toEqual([{ 超时回收: { 开: true } }]);
  } finally { await b.page.close(); }
});

it("持有上限打开：先数已到上限几人（默认 3 个，甲手上 5 个）", async () => {
  const { page } = await 开();
  try {
    await page.getByRole("switch", { name: "项目持有上限" }).click();
    const 框 = page.getByRole("dialog", { name: "开持有上限？" });
    expect(await 框.innerText()).toContain("按 3 个算，现在有 1 人已经到了上限");
    await 框.getByRole("button", { name: "开持有上限" }).click();
    await expect.poll(() => 改了(page)).toEqual([{ 公海: { 持有上限开: true } }]);
  } finally { await page.close(); }
});
