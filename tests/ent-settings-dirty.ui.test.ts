/**
 * PR9 原型 st.dirty / st.open：设置浮层关之前，有没存的改动先问一句；不确认不关。改了天数就浮出「改了 N 项，还没保存」保存条，「放弃」改回原值。
 * 没改的照常关（放完退场再回上一页）。认 role 和文字，不认 antd 类名
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { 打包, 开页 } from "./settings-ui-kit";

let browser: Browser, 包: string;
beforeAll(async () => {
  包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import M from '@/components/SettingsModal';import R from '@/app/(app)/settings/RecycleTab';import {默认三态规则} from '@/lib/project/org-rules';
    window.__render=()=>createRoot(document.getElementById('root')).render(<App><M><R value={{三态:{...默认三态规则,开:false},挡:null,占位词:[]}}/></M></App>);`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
const 退了几次 = (page: Page) => page.evaluate(() => (window as unknown as { __back?: number }).__back ?? 0);

it("改了天数没存：浮出保存条；Esc 先问，取消不关；放弃改动才关", async () => {
  const { page, errors } = await 开页(browser, 包, null);
  try {
    const 格 = page.getByRole("spinbutton", { name: "内贸客户进入沉睡待定的天数" });
    await 格.fill("45");
    await 格.blur();
    await page.getByText("改了 1 项，还没保存").waitFor();
    await page.keyboard.press("Escape");
    const 框 = page.getByRole("dialog", { name: "还有 1 项没保存" });
    await 框.waitFor();
    await 框.getByRole("button", { name: /^取\s?消$/ }).click();
    await 框.waitFor({ state: "detached" });
    expect(await 退了几次(page)).toBe(0);
    await page.getByRole("button", { name: "关闭设置" }).click();
    await page.getByRole("dialog", { name: "还有 1 项没保存" }).getByRole("button", { name: "放弃改动并关闭" }).click();
    await page.waitForFunction(() => (window as unknown as { __back?: number }).__back === 1);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("「放弃」把天数改回原值，保存条收起；没改的直接关（放完退场）", async () => {
  const { page } = await 开页(browser, 包, null);
  try {
    const 格 = page.getByRole("spinbutton", { name: "内贸客户进入沉睡待定的天数" });
    const 原 = await 格.inputValue();
    await 格.fill("45");
    await 格.blur();
    await page.getByRole("button", { name: /^放\s?弃$/ }).click();
    expect(await 格.inputValue()).toBe(原);
    expect(await page.getByText("还没保存").count()).toBe(0);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => (window as unknown as { __back?: number }).__back === 1);
    expect(await page.getByRole("dialog", { name: /没保存/ }).count()).toBe(0);
  } finally { await page.close(); }
});
