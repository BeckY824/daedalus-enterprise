/**
 * F-043：客户列表整页崩（React #185 Maximum update depth exceeded）。
 *
 * 筛选行放不下时把带「挤」的项收进「更多筛选」（components/CustomFilters useSqueezeRow）。原来收的那一刻记下「可用宽」，
 * 之后可用宽比它宽了就放回来试。页面高度刚好卡在「收起时不出竖滚动条、摆开（折成两行）时出竖滚动条」之间时
 * （行少的第 2 页 + 某个窗口高度），放回来 → 折两行 → 出滚动条（可用宽少 10px）→ 收起、记下窄的可用宽 → 一行 → 滚动条没了
 * → 又比记的宽 → 放回来……在 layout effect 里同步来回，50 次后 React 报 #185，错误兜底页「这一页没能打开」，刷新也一样。
 *
 * 这里用真浏览器（Chromium + globals.css 的 10px 滚动条）摆出同样的高度，钉住：不崩、停在收起；窗口真变宽了照旧放回来。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser; let bundle: string;
beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App, Select, Space} from 'antd';
    import {useCustomFilters} from '@/components/CustomFilters';
    const 下=(名,宽,挤)=>({键:名,名,宽,默认外露:true,挤,有值:false,渲染:(style)=><Select style={style} placeholder={'全部'+名} aria-label={名} options={[{value:'a',label:'a'}]}/>});
    function 页(){
      const q=new URLSearchParams(location.search);const fw=Number(q.get('fw')||150);const off=Number(q.get('off')||0);
      const {外露,更多按钮}=useCustomFilters('f043-test',[下('甲',fw),下('乙',fw),下('丙',fw),下('丁',fw),下('戊',fw),下('己',fw),下('阶段',110,true),下('进程',130,true),下('回收',130,true)]);
      return <div>
        <div style={{width:off?'calc(100% - '+off+'px)':undefined}}><div className="list-bar"><Space wrap size={[10,10]}>{外露}{更多按钮}</Space><span className="list-bar-gap"/><button style={{width:60,height:32}}>列</button></div></div>
        <div id="filler" style={{height:Number(q.get('h'))}}/>
      </div>;
    }
    createRoot(document.getElementById('root')).render(<App><页/></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  bundle = r.outputFiles[0].text; // Playwright 无头默认 --hide-scrollbars（滚动条 0 宽），要的正是 Windows 上那条占位的滚动条
  browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
}, 120_000);
afterAll(async () => { await browser?.close(); });

/** 窗口 宽×800（1300 宽：≥1200 下拉不收窄）；filler 高 = 800 − 收起时筛选行高 − 余量：收起时一屏放得下（无竖滚动条），折成两行就放不下（有竖滚动条） */
async function 打开(宽: number, fillerH: number, 格宽 = 150, 减宽 = 0): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 宽, height: 800 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://f043.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><body style='margin:0'><div id='root'></div></body>" }));
  await page.goto(`http://f043.test/customers?h=${fillerH}&fw=${格宽}&off=${减宽}`);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addStyleTag({ content: "body{margin:0!important;padding:0!important}" });
  await page.addScriptTag({ content: bundle });
  // 等落定：崩了（报错）或筛选行出来了（摆着或收起）；再多等一小会儿，来回收放的话这期间就崩了。由用例先断言没报错
  await expect.poll(async () => errors.length > 0 || (await page.locator(".list-bar [aria-label='甲']").count()) > 0, { timeout: 5000 }).toBe(true);
  await page.waitForTimeout(300);
  return { page, errors };
}
const 摆着 = (page: Page) => page.locator(".list-bar [aria-label='阶段']").count();
const 有竖滚 = (page: Page) => page.evaluate(() => document.documentElement.clientWidth < window.innerWidth);

it("页面高度卡在「收起无竖滚动条 / 摆开有竖滚动条」之间：不来回收放、不崩，停在收起", async () => {
  // 收起时筛选行一行 32 高，摆开折两行 74 高：filler 748 → 收起 780 < 800，摆开 822 > 800
  const { page, errors } = await 打开(1300, 748);
  expect(errors).toEqual([]);
  expect(await page.locator("#root").innerHTML()).not.toBe("");
  expect(await 摆着(page)).toBe(0);
  expect(await page.getByRole("button", { name: /更多筛选/ }).count()).toBe(1);
  // 前提确实成立：收起时没有竖滚动条（就是这一点让原来的写法以为「宽了」）
  expect(await 有竖滚(page)).toBe(false);
  await page.context().close();
});

it("窗口真变宽、摆得下了照旧放回来；再变窄照旧收起", async () => {
  const { page, errors } = await 打开(1300, 748);
  expect(await 摆着(page)).toBe(0);
  await page.setViewportSize({ width: 1700, height: 800 });
  await expect.poll(() => 摆着(page)).toBe(1);
  await page.setViewportSize({ width: 1300, height: 800 });
  await expect.poll(() => 摆着(page)).toBe(0);
  expect(errors).toEqual([]);
  await page.context().close();
});

it("高度不卡在中间（一直有 / 一直没有竖滚动条）时照旧收起", async () => {
  for (const h of [200, 1200]) {
    const { page, errors } = await 打开(1300, h);
    expect(errors).toEqual([]);
    expect(await 摆着(page)).toBe(0);
    await page.context().close();
  }
});

it("行宽带小数（显示缩放 125% / 150%）也不来回收放：clientWidth 取整高估、放回又折的那一种（F-043 复审）", async () => {
  // 格宽 150.7、行宽少 0.3–0.5px：只按取整的行宽和取整的要宽比，会「量着够、放回去还折」，滚动条一来一去照样 #185
  for (const 减宽 of [0.3, 0.4, 0.5]) {
    const { page, errors } = await 打开(1550, 748, 150.7, 减宽);
    expect(errors).toEqual([]);
    expect(await page.locator("#root").innerHTML()).not.toBe("");
    await page.context().close();
  }
});
