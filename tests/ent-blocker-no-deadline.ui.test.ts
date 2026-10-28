/**
 * 卡点去时限（10-27 会议：先不设解决时限，只记从出现到解决的实际耗时；等级照旧）。
 *
 *   卡点列表：没解决的「已开 N 天」，解决了的「用了 N 天解决」；不再有「时限 N 天」「（已超时）」和标红
 *   发布框：没有「解决时限」输入，交上去不带 dueDays（服务端按类型默认值照旧写库）
 *   设置 → 卡点默认值：没有每类的时限天数，阻碍主体、默认类型和影响还在
 *   Windows 1024 / 1280 / 1366：超长描述不横向撑出，按钮点得中
 * 卡点只有企业版有（开关关时项目详情的卡点是 null，见 ent-project-detail.ui.test.ts）。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { 耗时文字 } from "@/app/(app)/projects/BlockerPanel";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "blocker-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  const 空跑 = "async()=>({ok:true})";
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/blocker-actions$/, `const f=${空跑};export const 发布卡点Action=async(id,input,who)=>{window.__发布=input;return{ok:true}},指认卡点Action=f,认领卡点Action=f,接受卡点Action=f,转让卡点Action=f,返回卡点Action=f,改卡点进度Action=f,解决卡点Action=f,卡点可选的人Action=async()=>[],存卡点默认Action=async(p)=>{window.__存=p;return{ok:true}};`);
  stub(/\/projects\/actions$|\/ent-dict-actions$|\/commission-actions$/, `const f=${空跑};export const 加组员角色=f,改组员角色=f,加项目异常类别=f,改项目异常类别=f,改组织规则=f,预览超时回收=async()=>({ok:true,项目:[]}),改提成比例=f,改按人提成比例=f,加企业选项=f,改企业选项=f,存分配谁能用=f;`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import {BlockerList,PublishBlockerModal} from '@/app/(app)/projects/BlockerPanel';import Settings from '@/app/(app)/settings/ProjectSettingsTab';
    import {默认卡点默认} from '@/lib/project/blocker-rules';
    const root=createRoot(document.getElementById('root'));
    const 串='卡在哪'.repeat(40)+'X'.repeat(120), 天前=n=>new Date(Date.now()-n*86400000+3600000).toISOString();
    const 能={认领:true,指认:true,接受:false,转让:false,返回:false,解决:true,改进度:true};
    const 卡=(id,status,开,解)=>({id,code:'BLK000'+id,projectId:'p1',项目:'项目',followUpId:'f1',phase:'订单',type:'重要卡点',impact:'高',obstacle:'客户',description:串,
      dueDays:1,dueAt:天前(开-1),status,经手人:status==='看板'?null:'经手人'+'X'.repeat(60),发布人:'组长甲',resourceRequest:null,progress:null,solution:null,result:null,
      resolvedAt:解==null?null:天前(解),createdAt:天前(开),流转:[],能});
    window.__render=(what)=>root.render(<App>{
      what==='list'?<BlockerList 们={[卡('1','看板',5,null),卡('2','已解决',9,6)]} 人们={[]} 带项目/>:
      what==='publish'?<PublishBlockerModal followUpId='f1' 默认={默认卡点默认} 人们={[]} onClose={()=>{}}/>:
      <div style={{maxWidth:640,padding:16}}><Settings 成员={[]} value={{角色们:[],类别们:[],组织规则:null,持有:{},企业选项:null,卡点默认:默认卡点默认,提成比例:null,能改提成比例:false,挡:{字典:null,持有上限:null,节点时限:null,必填字段:null,阶段规则:null}}}/></div>
    }</App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });
async function open(what: "list" | "publish" | "settings", width = 1366) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://blk.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://blk.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.evaluate(w => (window as unknown as { __render: (x: string) => void }).__render(w), what);
  return { page, errors };
}

it("耗时：没解决按现在算「已开 N 天」，解决了按解决时间算；不满一天算 1 天", () => {
  const now = new Date("2026-10-27T12:00:00+08:00");
  expect(耗时文字({ status: "处理中", createdAt: "2026-10-24T12:00:00+08:00", resolvedAt: null }, now)).toBe("已开 3 天");
  expect(耗时文字({ status: "看板", createdAt: "2026-10-27T11:00:00+08:00", resolvedAt: null }, now)).toBe("已开 1 天");
  expect(耗时文字({ status: "已解决", createdAt: "2026-10-20T12:00:00+08:00", resolvedAt: "2026-10-22T13:00:00+08:00" }, now)).toMatch(/^用了 3 天解决（/);
});

it("卡点列表：显示开了几天 / 用了几天解决，没有时限、没有「已超时」、不标红", async () => {
  const { page, errors } = await open("list");
  try {
    const t = await page.locator("#root").innerText();
    expect(t).toContain("已开 5 天");
    expect(t).toMatch(/用了 3 天解决/);
    expect(t).not.toMatch(/时限|超时/);
    expect(await page.locator("#root [style*='danger']").count()).toBe(0);
    // 等级照旧
    expect(await page.getByText("重要卡点").count()).toBe(2);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("发布框：没有「解决时限」，交上去不带 dueDays", async () => {
  const { page, errors } = await open("publish");
  try {
    const dlg = page.getByRole("dialog"); await dlg.waitFor();
    expect(await dlg.getByLabel("解决时限").count()).toBe(0);
    expect(await dlg.innerText()).not.toMatch(/时限/);
    await dlg.getByLabel("阻碍主体").click();
    await page.locator(".ant-select-item-option").first().click();
    await dlg.getByLabel("卡点描述").fill("卡在报价");
    await dlg.getByRole("button", { name: /发\s*布/ }).click();
    await page.waitForFunction(() => Reflect.get(window, "__发布"));
    const 交 = await page.evaluate(() => Reflect.get(window, "__发布") as Record<string, unknown>);
    expect(交).not.toHaveProperty("dueDays");
    expect(交.description).toBe("卡在报价");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("设置 → 卡点默认值：没有每类的时限天数，阻碍主体和默认类型还在；保存不带时限", async () => {
  const { page, errors } = await open("settings");
  try {
    const 卡 = page.locator(".ant-card").filter({ hasText: "卡点默认值" });
    await 卡.waitFor();
    expect(await 卡.locator("input[aria-label$='解决时限']").count()).toBe(0);
    expect(await 卡.getByLabel("阻碍主体的选项").count()).toBe(1);
    expect(await 卡.getByLabel("默认卡点类型").count()).toBe(1);
    await 卡.getByLabel("默认卡点类型").click();
    await page.locator(".ant-select-item-option").filter({ hasText: "轻度卡点" }).click();
    await 卡.getByRole("button", { name: /保\s*存/ }).click();
    await page.waitForFunction(() => Reflect.get(window, "__存"));
    const 存 = await page.evaluate(() => Reflect.get(window, "__存") as Record<string, unknown>);
    expect(存).not.toHaveProperty("时限天数");
    expect(存.默认类型).toBe("轻度卡点");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([1024, 1280, 1366])("Windows %ipx：超长描述和经手人不横向撑出，按钮点得中", async (w) => {
  const { page } = await open("list", w);
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const name of [/认\s*领/, /标为已解决/]) {
      const btn = page.getByRole("button", { name }).first();
      const box = (await btn.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(w);
      const 点中 = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", [box.x + box.width / 2, box.y + box.height / 2]);
      expect(点中).toBe(await btn.textContent());
    }
  } finally { await page.close(); }
});
