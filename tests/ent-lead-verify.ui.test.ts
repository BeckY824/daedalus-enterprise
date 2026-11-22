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
  const 动作 = `const r=${记};export const 线索初判Action=r('初判'),市场复核Action=r('市场复核'),销售终验Action=r('销售终验'),总管理终判Action=r('总管理终判'),销售认领Action=r('销售认领'),撤回验证Action=r('撤回验证');`;
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
    window.__render=(我能,没有效沟通,配)=>root.render(<ConfigProvider locale={zhCN}><App><div style={{display:'flex',flexDirection:'column',gap:16}}>
      <LeadVerifyPanel projectId='p1' 项目名='样例项目' v={{判定:我能==='初判'?'暂未判定':'初验无效',待:我能==='初判'?null:我能,无效原因:我能==='初判'?null:'其他：'+词,复核结果:null,最终结果:null,终验:null,初判即终判:false,叫法:我能==='初判'?'暂未验证':'初验无效',我能,能撤回:我能!=='初判',痕:我能==='初判'?[]:痕}}
        无效原因选项={['需求不存在','联系方式无效','其他']} 跑={跑} 忙={false} 缺有效沟通话={没有效沟通?"还差有效沟通：需求状态":null} 不给推={null} 线索验证必填={配||[]}/>
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
async function open(我能: string, width = 1366, 没有效沟通 = false, 配: string[] = []) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const 主栏 = width - 220 - 320 - 48;
  await page.route("http://verify.test/**", r => r.fulfill({ contentType: "text/html", body: `<meta charset='utf-8'><div id='root' style='width:${主栏}px;padding:0 16px'></div>` }));
  await page.goto("http://verify.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(([a, b, c]) => (window as unknown as { __render: (x: string, y: boolean, z: string[]) => void }).__render(a as string, b as boolean, c as string[]), [我能, 没有效沟通, 配] as const);
  await page.getByTestId("lead-verify").waitFor();
  return { page, errors, 主栏 };
}
const 调用 = (page: Page) => page.evaluate(() => (window as unknown as { __calls?: unknown[][] }).__calls ?? []);
async function 点得中(page: Page, name: string, 右界: number) {
  const box = (await page.getByRole("button", { name, exact: true }).first().boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(右界);
  return page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box.x + box.width / 2, box.y + box.height / 2]);
}

/** 线索验证节点配了一长串必填：判定依据那一行最长的情况 */
const 长配 = ["主联系人", "国家", "需求", "需求描述", "分配方式", "项目级别", "沟通三项", "下一步计划", "下一步时间", "有效沟通", "线索验证结果"];

it.each([1024, 1280, 1366])("Windows %ipx：长无效原因、长说明、长名字不横向溢出，按钮点得中", async (w) => {
  const { page, errors, 主栏 } = await open("市场复核", w, false, 长配);
  try {
    const 溢出 = await page.evaluate(() => [...document.querySelectorAll("[data-testid=lead-verify], [data-testid=verify-inbox]")].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.getAttribute("data-testid")));
    expect(溢出).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const 右界 = 主栏 + 16;
    // 顶上「判定依据」（员工反馈 #7）：长必填清单照常换行，不撑宽、不被盖住
    const 依据 = page.getByTestId("lead-verify-basis");
    const 框 = (await 依据.boundingBox())!;
    expect(框.x + 框.width).toBeLessThanOrEqual(右界);
    expect(await 依据.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[data-testid=lead-verify-basis]"), [框.x + 框.width / 2, 框.y + 框.height / 2])).toBe(true);
    expect(await page.getByTestId("lead-verify-basis-valid").innerText()).toContain("所属联系人、国家、需求（需求状态）、需求描述");
    expect(await page.getByTestId("lead-verify-basis-invalid").innerText()).toContain("交管理员复核");
    expect((await 点得中(page, "判有效", 右界)).replace(/\s/g, "")).toBe("判有效");
    expect((await 点得中(page, "判无效", 右界)).replace(/\s/g, "")).toBe("判无效");
    // 提交验证的人 / 系统管理员：撤回验证按钮也点得中（X-77）
    expect((await 点得中(page, "撤回验证", 右界)).replace(/\s/g, "")).toBe("撤回验证");
    expect(await page.getByTestId("lead-verify-trail").innerText()).toContain("管理员复核 · 有效");
    expect(await page.getByTestId("lead-verify-pending").innerText()).toBe("等管理员复核");
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
    // 没配线索验证必填：判定依据写「需求状态要先选上」，和灰着的「有效」同一个判法
    expect(await page.getByTestId("lead-verify-basis-valid").innerText()).toContain("「需求状态」要先选上");
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

// 11-09 口径（11-20 改补法）：现负责人有占额度的分配行（或补发来的）才补，自动、指定都算，不限哪个月；补 = 记 1 个判无效待补
it("判无效的补额度说法：详情页和待复核列表写判无效待补，不再写「本月自动分配」「本月补回」", async () => {
  const { page, errors } = await open("市场复核");
  const 说法 = "现负责人占过名额的（自动、指定都算，不限月；补发来的也算）记 1 个判无效待补，下一条自动分配优先补发给他；随客户分到的、转来的、没分配记录的不补。";
  try {
    for (const 第几个 of [0, 1]) {
      await page.getByRole("button", { name: "判无效", exact: true }).nth(第几个).click();
      const 框 = page.locator(".ant-modal-confirm, .ant-modal").filter({ hasText: "记为线索流失" }).last();
      await 框.waitFor();
      const 字 = await 框.innerText();
      expect(字).toContain(说法);
      expect(字).not.toContain("本月自动分配");
      expect(字).not.toContain("本月补回");
      await 框.locator(".ant-btn:not(.ant-btn-primary)").first().click();
      await 框.waitFor({ state: "hidden" });
    }
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

/*
  D04（设计语言 E2）：销售认领那一步的「放回公海」照 P-界面-40 走后果框（原来是气泡确认「退回线索公海？」）：
  标题写这条线索、后果分条、确认键写「退回公海」；取消不交，确认才交
*/
it("D04：「放回公海」是后果框——标题带项目名、后果分条、取消不交、「退回公海」才交", async () => {
  const { page, errors } = await open("销售认领", 1366);
  try {
    await page.getByTestId("lead-verify-return").click();
    const 框 = page.getByRole("dialog").filter({ hasText: "退回线索公海" });
    await 框.waitFor();
    const 字 = await 框.innerText();
    expect(字).toContain("把「样例项目」退回线索公海");
    expect(字).toContain("领不回");
    expect(字).toContain("你自己不能再领回来");
    expect(字).toContain("客户不动");
    expect(字).toContain("算你主动退回");
    expect(await page.locator(".ant-popover").filter({ hasText: "退回线索公海？" }).count()).toBe(0);
    await 框.getByRole("button", { name: /^取\s*消$/ }).click();
    await 框.waitFor({ state: "hidden" });
    expect(await 调用(page)).toEqual([]);
    await page.getByTestId("lead-verify-return").click();
    await 框.waitFor();
    await 框.getByRole("button", { name: "退回公海", exact: true }).click();
    await page.waitForFunction(() => ((window as unknown as { __calls?: unknown[] }).__calls ?? []).length > 0);
    expect(await 调用(page)).toEqual([["销售认领", "p1", false]]);
    await 框.waitFor({ state: "hidden" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
