/**
 * 设置 → 项目模式 → 节点推进卡（客户 11-19）：
 *   - 「管哪些项目」默认「全部项目」（存量、新建都按必填走），能改成「开启之后新建的」（第 25 题那版），点了当场存
 *   - 「用建议清单」：只留业务字段（客户第 31b 题，不再带沟通三项、下一步），生产备货填备货状态、物流运输填物流状态 + 物流单号
 *   - 390 / 1024 / 1280 / 1366 宽不横向溢出
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { 打包, 开页, 调用们 } from "./settings-ui-kit";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import T from '@/app/(app)/settings/ProjectSettingsTab';import {默认组织规则} from '@/lib/project/org-rules';
    let root;window.__render=(p)=>(root??=createRoot(document.getElementById('root'))).render(<ConfigProvider locale={zhCN}><App><T 成员={[]} value={{角色们:[],类别们:[],企业选项:null,持有:{},提成比例:null,能改提成比例:false,
      挡:{字典:null,持有上限:null,节点时限:null,必填字段:null,阶段规则:null},组织规则:{...默认组织规则,节点推进:{...默认组织规则.节点推进,...p}}}}/></App></ConfigProvider>);`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

for (const 宽 of [390, 1024, 1280, 1366]) {
  it(`${宽}px：管哪些项目默认全部项目，点「开启之后新建的」当场存；建议清单只留业务字段、带上备货 / 物流；不横向溢出`, async () => {
    const { page, errors } = await 开页(browser, bundle, { 开: true, 必填: {}, 生效于: "2026-11-19T02:00:00.000Z" }, 宽);
    try {
      const 卡 = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: /^节点推进$/ }) });
      await 卡.waitFor();
      const 组 = 卡.getByRole("radiogroup", { name: "节点推进管哪些项目" });
      await expect.poll(() => 组.getByRole("radio", { name: "全部项目" }).isChecked()).toBe(true);
      await 卡.getByText(/存量项目和新建的项目都按必填走/).waitFor();
      await 组.getByText("开启之后新建的").click();
      await expect.poll(async () => (await 调用们(page)).filter(([n]) => n === "改组织规则").map(([, a]) => a[0])).toEqual([{ 节点推进: { 范围: "新建" } }]);
      // 用建议清单：生产备货、物流运输的下拉里是新字段；别的节点没有沟通三项、下一步
      await 卡.getByRole("button", { name: "用建议清单" }).click();
      const 节点 = (n: string) => 卡.locator(`[aria-label="「${n}」的必填"]`).locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' ant-select ')][1]");
      await expect.poll(() => 节点("生产备货").innerText()).toContain("备货状态");
      const 物流 = await 节点("物流运输").innerText();
      expect(物流).toContain("物流状态");
      expect(物流).toContain("物流单号");
      expect(await 卡.innerText()).not.toMatch(/下一步计划|当前进程沟通（发起主体/);
      const 溢 = await 卡.evaluate((c) => {
        const r = c.getBoundingClientRect();
        return { 出: [...c.querySelectorAll(".set-advance-scope *, .set-advance-since")].filter((e) => { const x = e.getBoundingClientRect(); return x.width > 0 && x.right > r.right + 1; }).length, 横滚: document.documentElement.scrollWidth > innerWidth };
      });
      expect(溢).toEqual({ 出: 0, 横滚: false });
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);
}

it("选的是「开启之后新建的」：写生效时刻；关着不摆范围", async () => {
  const { page, errors } = await 开页(browser, bundle, { 开: true, 必填: {}, 生效于: "2026-11-19T02:00:00.000Z", 范围: "新建" }, 1366);
  try {
    const 卡 = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: /^节点推进$/ }) });
    await expect.poll(() => 卡.getByRole("radio", { name: "开启之后新建的" }).isChecked()).toBe(true);
    await 卡.getByTestId("节点推进生效时刻").getByText(/生效时刻：2026-11-19 \d{2}:00/).waitFor();
    await page.evaluate(() => (window as unknown as { __render: (x: unknown) => void }).__render({ 开: false, 必填: {}, 生效于: null }));
    await expect.poll(() => 卡.getByRole("radiogroup", { name: "节点推进管哪些项目" }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);
