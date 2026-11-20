/**
 * 页面金额框（components/AmountInput，11-20）：真浏览器里敲「5万」「12.5万」「3w」「5万5」「-500」。
 *
 * 原来是 antd InputNumber 默认 parser：「5万」悄悄存成 5、「12.5万」存成 12.5、「3w」停在 3、「-500」失焦压成 0，都没有一句提示。
 * 现在：认得出的换算成元、敲的时候框上方浮「「12.5万」= 125,000」，失焦后框里就是换算后的数；认不出的框标红，
 * 聚焦 / 悬停说为什么、失焦后占位写「认不出「…」」，交上去的是 NaN（表单校验挡住），失焦也不会被压成 0 或上一个数。
 * 375 / 1024 / 1280 / 1366：和币种下拉拼在一起（Space.Compact）提示浮在框外，敲的字不被挤、页面不横撑。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {App,Button,ConfigProvider,Form,Select,Space} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import AmountInput, {金额框认不出提示, 金额认不出} from '@/components/AmountInput';
    function 拼框({起}){
      const [v,setV]=useState(起??null);window.__值=v;
      return <div style={{padding:16}}><Space.Compact style={{width:'100%'}}>
        <Select style={{width:140,flexShrink:0}} value='CNY' options={[{value:'CNY',label:'人民币 CNY'}]}/>
        <AmountInput aria-label='金额' style={{width:'100%'}} min={0} max={1e12} precision={2} value={v} onChange={setV}/>
      </Space.Compact><button id='别处'>别处</button></div>;
    }
    function 表单(){
      const [f]=Form.useForm();
      return <Form form={f} style={{padding:16}} onFinish={(x)=>{window.__交=x.amount}}>
        <Form.Item label='投入金额' required><Form.Item name='amount' noStyle rules={[{required:true,message:'请填写金额'},{validator:(_,v)=>金额认不出(v)?Promise.reject(new Error(金额框认不出提示)):Promise.resolve()},{type:'number',min:0.01,message:'金额要大于 0'}]}>
          <AmountInput aria-label='投入金额' min={0} precision={2} style={{width:'100%'}}/>
        </Form.Item></Form.Item>
        <Button htmlType='submit'>保存</Button>
      </Form>;
    }
    const root=createRoot(document.getElementById('root'));
    const 包=(x)=><ConfigProvider locale={zhCN}><App>{x}</App></ConfigProvider>;
    window.__拼=(起)=>root.render(包(<拼框 起={起}/>));
    window.__表单=()=>root.render(包(<表单/>));
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(画: string, 参?: unknown, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 700 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://amount.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://amount.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([f, a]) => (window as unknown as Record<string, (x: unknown) => void>)[f as string](a), [画, 参] as const);
  return { page, errors };
}
const 值 = (page: Page) => page.evaluate(() => { const v = (window as unknown as { __值: number | null }).__值; return typeof v === "number" && Number.isNaN(v) ? "NaN" : v; });
const 框 = (page: Page, 名 = "金额") => page.getByRole("spinbutton", { name: 名 });
const 根 = (page: Page) => page.locator(".ant-input-number").first();
const 浮层 = (page: Page) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");

it.each([
  ["5万", 50000, "「5万」= 50,000", "50,000"],
  ["12.5万", 125000, "「12.5万」= 125,000", "125,000"],
  ["3w", 30000, "「3w」= 30,000", "30,000"],
  ["2.5k", 2500, "「2.5k」= 2,500", "2,500"],
  ["¥18,000", 18000, null, "18,000"],
])("「%s」认成 %d：敲的时候框上方说换算成多少，失焦后框里是换算后的数", async (敲, 数, 换算, 失焦后) => {
  const { page, errors } = await open("__拼");
  try {
    await 框(page).fill(敲);
    await expect.poll(() => 值(page)).toBe(数);
    expect(await 框(page).inputValue()).toBe(敲);
    if (换算) await expect.poll(() => 浮层(page).innerText()).toBe(换算);
    else expect(await 浮层(page).count()).toBe(0);
    await page.locator("#别处").click();
    await expect.poll(() => 框(page).inputValue()).toBe(失焦后);
    expect(await 值(page)).toBe(数);
    await expect.poll(() => 浮层(page).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([["5万5", "认不出「5万5」"], ["约5万", "认不出「约5万」"], ["-500", "认不出「-500」"], ["20000亿", "超过上限"]])(
  "「%s」认不出：交 NaN、框标红，聚焦 / 悬停说为什么、失焦后占位写着；失焦不压成 0、不退回敲到一半的数",
  async (敲, 话) => {
    const { page, errors } = await open("__拼", 30000);
    try {
      // 一个字一个字敲：「5万5」敲到「5万」时是 50000，最后那个 5 不能让它停在 50000
      await 框(page).click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
      await page.keyboard.type(敲);
      await expect.poll(() => 值(page)).toBe("NaN");
      expect(await 框(page).inputValue()).toBe(敲);
      expect(await 根(page).evaluate((el) => el.className)).toMatch(/status-error/);
      await expect.poll(() => page.getByRole("tooltip").filter({ hasText: 话 }).count()).toBe(1);
      await page.locator("#别处").click();
      await expect.poll(() => page.getByRole("tooltip").filter({ hasText: 话 }).isVisible()).toBe(false);
      expect(await 值(page)).toBe("NaN");
      expect(await 框(page).inputValue()).toBe("");
      expect(await 框(page).getAttribute("placeholder")).toBe(`认不出「${敲}」`);
      expect(await 根(page).evaluate((el) => el.className)).toMatch(/status-error/);
      await 框(page).hover();
      await expect.poll(() => page.getByRole("tooltip").filter({ hasText: 话 }).isVisible()).toBe(true);
      // 重新敲对了就好；清空 = 没填
      await 框(page).fill("6万");
      await expect.poll(() => 值(page)).toBe(60000);
      expect(await 根(page).evaluate((el) => el.className)).not.toMatch(/status-error/);
      await 框(page).fill("约");
      await expect.poll(() => 值(page)).toBe("NaN");
      await 框(page).fill("");
      await expect.poll(() => 值(page)).toBe(null);
      expect(await 根(page).evaluate((el) => el.className)).not.toMatch(/status-error/);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  },
);

it("拼音输入：敲 wan 选「万」，中途不报认不出，选完认成 50000", async () => {
  const { page, errors } = await open("__拼");
  try {
    await 框(page).click();
    await page.keyboard.type("5");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "wa", selectionStart: 2, selectionEnd: 2 });
    await cdp.send("Input.imeSetComposition", { text: "wan", selectionStart: 3, selectionEnd: 3 });
    expect(await 根(page).evaluate((el) => el.className)).not.toMatch(/status-error/);
    expect(await 值(page)).toBe(5);
    await cdp.send("Input.insertText", { text: "万" });
    await expect.poll(() => 值(page)).toBe(50000);
    expect(await 框(page).inputValue()).toBe("5万");
    expect(await 根(page).evaluate((el) => el.className)).not.toMatch(/status-error/);
    await expect.poll(() => 浮层(page).innerText()).toBe("「5万」= 50,000");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("表单里（渠道投入那种 Form.Item 校验）：认不出挡住保存并说为什么；「5万」存 50000", async () => {
  const { page, errors } = await open("__表单");
  try {
    const 交 = () => page.evaluate(() => (window as unknown as { __交?: number }).__交);
    await 框(page, "投入金额").fill("5万5");
    await page.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(() => page.getByText("金额认不出：只填不小于 0 的数字").count()).toBe(1);
    expect(await 交()).toBeUndefined();
    await 框(page, "投入金额").fill("5万");
    await page.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(交).toBe(50000);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([375, 1024, 1280, 1366])("%ipx：和币种拼在一起，换算 / 认不出浮在框外，敲的字不被挤、浮层在视口里、页面不横撑", async (w) => {
  const { page, errors } = await open("__拼", null, w);
  try {
    for (const 敲 of ["1.5亿", "5万5"]) {
      await 框(page).fill(敲);
      await 浮层(page).waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // 敲的字整串放得下（提示没占框里的地方）
      expect(await 框(page).evaluate((i: HTMLInputElement) => i.scrollWidth <= i.clientWidth + 1)).toBe(true);
      // 浮层放出来有个缩放动画、对齐也晚一拍：等它站稳再量
      await expect.poll(async () => { const b = await 浮层(page).boundingBox(); return !!b && b.x >= 0 && b.x + b.width <= w + 0.5; }).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
