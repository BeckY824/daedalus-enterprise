/**
 * E-384 个人资料里的职位只读：不再是输入框，旁边写「如需修改请联系系统管理员」；保存只送名字（不带职位）；
 * 长职位一行 + 省略号，悬停浮层交全站 TruncTip（不挂原生 title）
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { 打包, 开页, 调用们 } from "./settings-ui-kit";

let browser: Browser, 包: string;
beforeAll(async () => {
  包 = await 打包(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import P from '@/app/(app)/settings/ProfileTab';
    window.__render=(p)=>createRoot(document.getElementById('root')).render(<App><P {...p}/></App>);`);
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

const 长职位 = "华东区域大客户销售运营与回款协调高级经理（兼任）";

it("职位是只读文本 + 提示文案；点保存只送名字", async () => {
  const { page, errors } = await 开页(browser, 包, { me: { name: "周宁", title: "销售", email: "u1" } });
  try {
    const 职位 = page.getByTestId("profile-title");
    await 职位.waitFor();
    expect(await 职位.innerText()).toBe("销售");
    expect(await page.getByText("如需修改请联系系统管理员").count()).toBe(1);
    // 名字是输入框，职位不是
    expect(await page.getByRole("textbox").count()).toBe(2); // 名字 + 登录名（禁用）
    expect(await page.locator("input#title").count()).toBe(0);
    await page.getByRole("button", { name: /保\s?存/ }).click();
    await page.waitForFunction(() => ((window as unknown as { __calls?: unknown[] }).__calls ?? []).length > 0);
    const 调 = (await 调用们(page)).filter(([n]) => n === "改我的资料");
    expect(调.length).toBe(1);
    expect(调[0][1][0]).toEqual({ name: "周宁" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("长职位一行 + 省略号、悬停看全文；没填显示「未填」", async () => {
  const a = await 开页(browser, 包, { me: { name: "周宁", title: 长职位, email: "u1" } }, 1024);
  try {
    const 职位 = a.page.getByTestId("profile-title");
    await 职位.waitFor();
    expect(await 职位.getAttribute("title")).toBeNull();
    const m = await 职位.evaluate((el) => ({ 溢出: el.scrollWidth > el.clientWidth, 行高: el.getBoundingClientRect().height, 省略: getComputedStyle(el).textOverflow, 不折: getComputedStyle(el).whiteSpace }));
    expect(m.省略).toBe("ellipsis");
    expect(m.不折).toBe("nowrap");
    expect(m.行高).toBeLessThan(40);
  } finally { await a.page.close(); }
  const b = await 开页(browser, 包, { me: { name: "周宁", title: "", email: "u1" } });
  try {
    const 空 = b.page.getByTestId("profile-title");
    expect(await 空.innerText()).toBe("未填");
    expect(await 空.getAttribute("style")).toContain("var(--text-muted)");
  } finally { await b.page.close(); }
});
