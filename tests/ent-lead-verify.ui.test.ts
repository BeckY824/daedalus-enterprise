import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
/* 企业版线索有效性验证（P12）：详情页「线索验证」那块（LeadVerifyPanel）+ 列表顶上「待复核的线索」（VerifyInbox）。
   Windows 1024 / 1280 / 1366 宽：主栏（扣掉左导航和详情右栏）里长无效原因、长说明不横向溢出，按钮点得中；
   判无效没选原因、提交异议没写说明，确定按钮点不了；缺有效沟通时「有效」灰着 */
let browser: Browser, bundle: string;
const plugin: Plugin = { name: "lead-verify-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 记 = "(n)=>async(...a)=>{(window.__calls||(window.__calls=[])).push([n,...a]);return {ok:true}}";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  const 动作 = `const r=${记};export const 线索初判Action=r('初判'),市场复核Action=r('市场复核'),销售终验Action=r('销售终验'),总管理终判Action=r('总管理终判'),销售认领Action=r('销售认领');`;
  stub(/^\.\.\/actions$/, 动作);
  stub(/^\.\/actions$/, 动作);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import LeadVerifyPanel from '@/app/(app)/projects/[id]/LeadVerifyPanel';import VerifyInbox from '@/app/(app)/projects/VerifyInbox';
    const root=createRoot(document.getElementById('root'));
    const 串='很长的说明'.repeat(30), 词='X'.repeat(120);
    const 痕=[
      {id:'a',step:'销售初判',verdict:'无效',reason:'其他：'+词,note:串,谁:'业务员'+词,at:'2026-10-29T01:00:00.000Z'},
      {id:'b',step:'市场复核',verdict:'有效',reason:null,note:串,谁:'市场经理',at:'2026-10-29T02:00:00.000Z'},
    ];
    const 跑=async(f)=>{const r=await f();return r.ok;};
    window.__render=(我能,没有效沟通)=>root.render(<ConfigProvider locale={zhCN}><App><div style={{display:'flex',flexDirection:'column',gap:16}}>
      <LeadVerifyPanel projectId='p1' v={{判定:我能==='初判'?'暂未判定':'初验无效',待:我能==='初判'?null:我能,无效原因:我能==='初判'?null:'其他：'+词,复核结果:null,最终结果:null,我能,痕:我能==='初判'?[]:痕}}
        无效原因选项={['需求不存在','联系方式无效','其他']} 跑={跑} 忙={false} 没有效沟通={没有效沟通} 不给推={null}/>
      <VerifyInbox 们={[
        {projectId:'p1',项目:'超长项目名'+词,负责人:'业务员'+词,步:'市场复核',无效原因:'其他：'+词,初判说明:串,复核说明:null,异议说明:null,更新于:'2026-10-29T01:00:00.000Z'},
        {projectId:'p2',项目:'二号',负责人:'乙',步:'销售终验',无效原因:'联系方式无效',初判说明:null,复核说明:串,异议说明:null,更新于:'2026-10-29T01:00:00.000Z'},
      ]}/>
    </div></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

/** 主栏宽：视口扣掉左导航（约 220）和详情右栏（320 + 间距） */
async function open(我能: string, width = 1366, 没有效沟通 = false) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const 主栏 = width - 220 - 320 - 48;
  await page.route("http://verify.test/**", r => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><div id='root' style='width:${主栏}px;padding:0 16px'></div>` }));
  await page.goto("http://verify.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(([a, b]) => (window as unknown as { __render: (x: string, y: boolean) => void }).__render(a as string, b as boolean), [我能, 没有效沟通]);
  await page.getByTestId("lead-verify").waitFor();
  return { page, errors, 主栏 };
}
const 调用 = (page: Page) => page.evaluate(() => (window as unknown as { __calls?: unknown[][] }).__calls ?? []);
async function 点得中(page: Page, name: string, 右界: number) {
  const box = (await page.getByRole("button", { name, exact: true }).first().boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(右界);
  return page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box.x + box.width / 2, box.y + box.height / 2]);
}

it.each([1024, 1280, 1366])("Windows %ipx：长无效原因、长说明、长名字不横向溢出，按钮点得中", async (w) => {
  const { page, errors, 主栏 } = await open("市场复核", w);
  try {
    const 溢出 = await page.evaluate(() => [...document.querySelectorAll("[data-testid=lead-verify], [data-testid=verify-inbox]")].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.getAttribute("data-testid")));
    expect(溢出).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const 右界 = 主栏 + 16;
    expect((await 点得中(page, "判有效", 右界)).replace(/\s/g, "")).toBe("判有效");
    expect((await 点得中(page, "判无效", 右界)).replace(/\s/g, "")).toBe("判无效");
    expect(await page.getByTestId("lead-verify-trail").innerText()).toContain("市场复核 · 有效");
    expect(await page.getByTestId("lead-verify-pending").innerText()).toBe("等市场管理复核");
    // 列表里的销售终验行只给链接，不给判
    const 行 = page.getByTestId("verify-row-p2");
    expect(await 行.getByRole("button").allInnerTexts()).toEqual(["去处理"]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("初判：缺有效沟通时「有效」灰着；判无效没选原因确定点不了，选了才交", async () => {
  const { page, errors } = await open("初判", 1024, true);
  try {
    expect(await page.getByTestId("lead-verify-valid").isDisabled()).toBe(true);
    await page.getByTestId("lead-verify-invalid").click();
    const 框 = page.locator(".ant-modal");
    const 确定 = 框.locator(".ant-btn-primary");
    expect(await 确定.isDisabled()).toBe(true);
    await 框.getByLabel("无效原因").click();
    await page.locator(".ant-select-item-option", { hasText: "联系方式无效" }).click();
    expect(await 确定.isDisabled()).toBe(false);
    await 确定.click();
    await page.waitForFunction(() => ((window as unknown as { __calls?: unknown[] }).__calls ?? []).length > 0);
    expect(await 调用(page)).toEqual([["初判", "p1", "无效", { invalidReason: "联系方式无效", verifyNote: "" }]]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("销售终验：看得到复核说明；提交异议不写说明确定点不了，写了才交", async () => {
  const { page } = await open("销售终验", 1280);
  try {
    expect(await page.getByText("复核说明：").first().isVisible()).toBe(true);
    await page.getByTestId("lead-verify-dispute").click();
    const 框 = page.locator(".ant-modal");
    const 确定 = 框.locator(".ant-btn-primary");
    expect(await 确定.isDisabled()).toBe(true);
    await 框.getByLabel("异议说明").fill("客户明说不需要");
    await 确定.click();
    await page.waitForFunction(() => ((window as unknown as { __calls?: unknown[] }).__calls ?? []).length > 0);
    expect(await 调用(page)).toEqual([["销售终验", "p1", false, "客户明说不需要"]]);
  } finally { await page.close(); }
});
