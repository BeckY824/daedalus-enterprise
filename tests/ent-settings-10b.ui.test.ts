/**
 * PR10b 设置页三处毛病（先复现再修）：
 *   ③ 线索配额：销售管理按「后台设置谁能改」能给下属设配额，可入口只在系统管理员的「组织架构」里——补一栏「线索配额」，搜「配额」能搜到
 *   ⑤ 旧「超时回收」卡关开关：原来一点就关；按 P-界面-40「组织规则开关」先弹后果框，不确认不生效
 * ④（只读恒为 false）是服务端判断，见 tests/ent-settings-by-identity.test.ts
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { 打包, 开页, 调用们 } from "./settings-ui-kit";

let browser: Browser, 卡包: string, 页包: string;
beforeAll(async () => {
  卡包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import C from '@/app/(app)/settings/ProjectSettingsTab';import {默认组织规则} from '@/lib/project/org-rules';
    window.__render=(开)=>createRoot(document.getElementById('root')).render(<App><C 成员={[]} value={{角色们:[],类别们:[],组织规则:{...默认组织规则,超时回收:{...默认组织规则.超时回收,开}},企业选项:null,持有:{},提成比例:null,能改提成比例:false,挡:{字典:null,持有上限:null,节点时限:null,必填字段:null,阶段规则:null}}}/></App>);`);
  页包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import V from '@/app/(app)/settings/SettingsView';
    window.__render=(p)=>createRoot(document.getElementById('root')).render(<App><V {...p}/></App>);`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 关的调用 = (cs: [string, unknown[]][]) => cs.filter(([n, a]) => n === "改组织规则" && JSON.stringify(a).includes('"开":false'));

it("⑤ 超时回收关开关：先弹后果框；取消不存、开关还开；确认了才关", async () => {
  const { page, errors } = await 开页(browser, 卡包, true);
  try {
    const 开关 = page.getByRole("switch", { name: "超时回收", exact: true });
    await 开关.click();
    const 框 = page.getByRole("dialog", { name: "关掉超时回收？" });
    await 框.waitFor();
    expect(await 框.innerText()).toContain("不再按进程时长自动回线索公海");
    await 框.getByRole("button", { name: /取\s?消/ }).click();
    await 框.waitFor({ state: "detached" });
    expect(关的调用(await 调用们(page))).toEqual([]);
    expect(await 开关.isChecked()).toBe(true);

    await 开关.click();
    await page.getByRole("dialog").getByRole("button", { name: "确认关掉" }).click();
    await page.waitForFunction(() => (window as unknown as { __refresh?: number }).__refresh === 1);
    expect(关的调用(await 调用们(page))).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

const 基本props = (extra: Record<string, unknown> = {}) => ({
  users: [], me: { id: "u1", name: "张敏", email: "zm", role: "SALES", title: "销售管理" }, isAdmin: false, logs: [],
  llm: { source: null, baseUrl: "", model: "", keyMasked: null, options: [] }, business: { customer: "客户" }, aiUsage: [], 机器: null, 企业版: true, 只个人: true, 身份: "成员", ...extra,
});
const 配额行 = [{ userId: "u2", name: "李想", line: "内贸", 已分: 3, 配额: 30, 设的配额: 30, 加额: 0, 持有: 2, 参与: true, 参与状态: "允许", 能设配额: true, 能改参与: false, 参与可选: [] }];

it("③ 销售管理（只个人）手下有能设配额的人：有「线索配额」一栏，搜「配额」搜得到，进去能改", async () => {
  const { page, errors } = await 开页(browser, 页包, 基本props({ 线索配额: { 行: 配额行, 不限额: false } }));
  try {
    await page.getByRole("searchbox", { name: "搜索设置" }).fill("配额");
    await page.getByRole("tab", { name: /线索配额/ }).click();
    await page.getByTestId("org-lead-assign").waitFor();
    expect(await page.getByText("李想").count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  // 没有能设的人：不摆这一栏
  const b = await 开页(browser, 页包, 基本props());
  try {
    await b.page.getByRole("tab", { name: /个人资料/ }).waitFor();
    expect(await b.page.getByRole("tab", { name: /线索配额/ }).count()).toBe(0);
  } finally { await b.page.close(); }
});
