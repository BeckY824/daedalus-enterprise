/**
 * PR7b 第三批（前端改版 dt.*，不弹顶部提示）：
 *   dt.upload：拖进来高亮（antd 的 drag-hover 态有底色）、每个文件一圈进度到 ✓、没传上原因写在那一行；删就地问（InlineConfirm），
 *     没删掉问句留着、原因写在块里；删了那一项消失
 *   dt.team：选人能搜、能用键盘挑；邀请成了名单里马上多一行「已邀请」、不弹提示；被挡原因写在加人那排下面；
 *     移出就地问；改分配框里的分配条边输边变（组长那段跟着缩）
 *   dt.field：客户资料格存的时候先摆新值，刷新回来前不闪回旧值；没存上退回旧值、原因写在格子下面
 *   Windows 1024 + 超长名字：不撑出页面
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, 包: string;
const 桩: Plugin = { name: "pr7b-third", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷=(window.__刷??0)+1},push(){},replace(){}});export const usePathname=()=>'/x';export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({prefetch,...p}){return <a {...p}/>}");
  stub(/attachment-upload$/, `export const 归属查询=()=>'projectId=p1';
    export const 传附件=async(挂,f)=>{await new Promise(r=>setTimeout(r,window.__传慢??400));const r=(window.__传回??{})[f.name];if(r)return r;return {ok:true,附件:{id:'n-'+f.name,name:f.name,mime:'application/pdf',size:10,有文件:true}}};`);
  stub(/useTransferConfirm$/, "export const useTransferConfirm=()=>({先问转走的项目:async()=>true});");
  stub(/commission-actions$/, "export const 存项目底价=async()=>({ok:true}),更正实际提成=存项目底价,存提成分配=async(id,分)=>{window.__分=分;return window.__分回??{ok:true}};");
  stub(/(^|\/)\.\.\/actions$/, `
    export const patchCustomer=async(id,f,v)=>{(window.__改??=[]).push([f,v]);await new Promise(r=>setTimeout(r,300));return window.__改回??{ok:true}};
    export const 编辑项目=async()=>({ok:true});
    export const 加项目组员=async(p,u,r)=>{(window.__加??=[]).push([u,r]);return window.__加回??{ok:true}};
    export const 换项目组员角色=async()=>({ok:true});
    export const 移出项目组员=async(id)=>{(window.__移??=[]).push(id);return window.__移回??{ok:true}};`);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  包 = (await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import AttachmentsPanel from '@/components/AttachmentsPanel';
    import {ProjectTeamCard} from '@/app/(app)/projects/[id]/ProjectTeam';
    import {SplitModal} from '@/app/(app)/projects/[id]/ProjectCommission';
    import InlineField from '@/app/(app)/customers/[id]/InlineField';
    const root=createRoot(document.getElementById('root'));
    const 壳=(x)=><ConfigProvider locale={zhCN}><App><div style={{padding:16,maxWidth:560}}>{x}</div></App></ConfigProvider>;
    const 长='超长名字'.repeat(12);
    const 在职=[{id:'u1',name:'组长甲',email:'a'},{id:'u2',name:'王小二',email:'b'},{id:'u3',name:'李四'+长,email:'c'},{id:'u4',name:'赵六',email:'d'}];
    function 格(){const [v,setV]=useState('旧公司');window.__设值=setV;return <InlineField customerId='k1' field='school' label='公司' value={v} kind='text'/>;}
    window.__画=(what)=>root.render(壳(
      what==='att'?<AttachmentsPanel 归属={{projectId:'p1'}}/>:
      what==='team'?<ProjectTeamCard projectId='p1' 组员们={[{id:'m1',userId:'u2',name:'王小二',roleId:null,inviteStatus:'ACCEPTED'}]} 角色们={[]} 在职={在职} 能改 忙={false} 企业版 组长='组长甲'/>:
      what==='split'?<SplitModal projectId='p1' t={{币种:'CNY',成交金额:0,项目底价:null,比例:{底价比例:1,溢价比例:2},范围:'默认',预估:null,实际:null,每人:[],能改:true,能填底价:true,能更正:false,组员:[{userId:'u2',name:'王小二'},{userId:'u3',name:'李四'+长}],分配:{u2:10}}} onClose={()=>{window.__关=1}}/>:
      <格/>));
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [桩], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function 开(what: "att" | "team" | "split" | "field", width = 1280, 删回 = 200) {
  const page = await browser.newPage({ viewport: { width, height: 860 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://pr7c.test/**", async r => {
    const u = r.request().url();
    if (u.includes("/api/attachments/")) return r.fulfill({ status: 删回, contentType: "application/json", body: JSON.stringify(删回 === 200 ? { ok: true } : { error: "这个附件是别人传的，你删不了" }) });
    if (u.includes("/api/attachments")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ 附件: [{ id: "a1", name: "合同.pdf", mime: "application/pdf", size: 100, 有文件: true }] }) });
    return r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" });
  });
  await page.goto("http://pr7c.test/"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: 包 });
  await page.evaluate(w => (window as unknown as { __画: (x: string) => void }).__画(w), what);
  return { page, errors };
}
const 窗 = (page: Page, k: string) => page.evaluate((k) => Reflect.get(window, k) ?? null, k);
const 顶部提示 = (page: Page) => page.locator(".ant-message").innerText().catch(() => "");
const 不横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

it("dt.upload：拖进来高亮；每个文件一圈进度到 ✓；没传上原因写在那一行；不弹顶部提示", async () => {
  const { page, errors } = await 开("att", 1024);
  try {
    await page.getByText("合同.pdf").waitFor();
    // 拖进来：antd 给拖放区加 drag-hover，样式上底色换成品牌浅蓝
    const 区 = page.locator(".att-panel .ant-upload-drag");
    const 原底 = await 区.evaluate(el => getComputedStyle(el).backgroundColor);
    await 区.evaluate(el => el.classList.add("ant-upload-drag-hover"));
    await expect.poll(() => 区.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(原底);
    await 区.evaluate(el => el.classList.remove("ant-upload-drag-hover"));
    // 传两个：一个成、一个被挡
    await page.evaluate(() => Reflect.set(window, "__传回", { "坏.pdf": { ok: false, error: "单个文件最多 20MB" } }));
    await page.locator(".att-panel input[type=file]").setInputFiles([
      { name: "方案.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") },
      { name: "坏.pdf", mimeType: "application/pdf", buffer: Buffer.from("y") },
    ]);
    const 好 = page.locator(".att-up-row", { hasText: "方案.pdf" });
    await 好.waitFor();
    expect(await 好.getAttribute("data-state")).toBe("传");
    expect(await 好.locator(".att-ring svg").count()).toBe(1);
    await expect.poll(() => 好.getAttribute("data-state")).toBe("成");
    await 好.getByRole("status").filter({ hasText: "传好了" }).waitFor();
    const 坏 = page.locator(".att-up-row", { hasText: "坏.pdf" });
    await 坏.getByRole("alert").filter({ hasText: "最多 20MB" }).waitFor();
    // ✓ 停一会儿收掉，没传上的那行留着
    await 好.waitFor({ state: "detached", timeout: 4000 });
    expect(await 坏.count()).toBe(1);
    expect(await 顶部提示(page)).toBe("");
    expect(await 不横滚(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("dt.upload：删就地问；被挡原因写在块里、问句留着、附件还在；放行后那一项消失、不弹提示", async () => {
  const { page, errors } = await 开("att", 1280, 403);
  try {
    const 行 = page.locator(".att-files li", { hasText: "合同.pdf" });
    await 行.getByRole("button", { name: /删掉 合同.pdf/ }).click();
    await 行.getByText("删掉这个？").waitFor();
    expect(await page.locator(".ant-popover").count()).toBe(0);
    await 行.getByRole("button", { name: "删掉", exact: true }).click();
    await page.locator(".att-said[role=alert]").filter({ hasText: "你删不了" }).waitFor();
    expect(await 行.getByText("删掉这个？").count()).toBe(1);
    expect(await 顶部提示(page)).toBe("");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
  const p2 = await 开("att", 1280, 200);
  try {
    const 行 = p2.page.locator(".att-files li", { hasText: "合同.pdf" });
    await 行.getByRole("button", { name: /删掉 合同.pdf/ }).click();
    await 行.getByRole("button", { name: "删掉", exact: true }).click();
    await 行.waitFor({ state: "detached" });
    expect(await 顶部提示(p2.page)).toBe("");
    expect(p2.errors).toEqual([]);
  } finally { await p2.page.close(); }
});

it("dt.team：选人能打字搜、键盘挑；邀请成了名单马上多一行「已邀请」、不弹提示；被挡原因写在加人那排下面", async () => {
  const { page, errors } = await 开("team", 1024);
  try {
    const 选 = page.getByLabel("要加进项目组的成员");
    await 选.click();
    await page.keyboard.type("赵");
    await page.locator(".ant-select-item-option").filter({ hasText: "赵六" }).waitFor();
    expect(await page.locator(".ant-select-item-option").count()).toBe(1);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: /邀\s*请/ }).click();
    await page.locator(".pd-team-row.is-new", { hasText: "赵六" }).getByText("已邀请").waitFor();
    expect(await 窗(page, "__加")).toEqual([["u4", null]]);
    expect(await 顶部提示(page)).toBe("");
    // 被挡：原因写在加人那排下面，名单不多行
    await page.evaluate(() => Reflect.set(window, "__加回", { ok: false, error: "只有项目负责人能拉人进组" }));
    await 选.click();
    await page.keyboard.type("李四");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: /邀\s*请/ }).click();
    await page.getByRole("alert").filter({ hasText: "只有项目负责人能拉人进组" }).waitFor();
    expect(await page.locator(".pd-team-row.is-new").count()).toBe(1);
    expect(await 顶部提示(page)).toBe("");
    expect(await 不横滚(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("dt.team：移出就地问（不弹气泡框），确认才交服务端", async () => {
  const { page, errors } = await 开("team");
  try {
    await page.getByRole("button", { name: /移\s*出/ }).click();
    await page.getByText("把王小二移出项目组").waitFor();
    expect(await page.locator(".ant-popover").count()).toBe(0);
    expect(await 窗(page, "__移")).toBeNull();
    await page.locator(".inlc-yes").click();
    await expect.poll(() => 窗(page, "__移")).toEqual(["m1"]);
    expect(await 顶部提示(page)).toBe("");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("dt.team：改分配框里的分配条边输边变，组长那段跟着缩、分出去 / 组长留跟着变；被挡原因浮在保存键上方、框不关；存上了键里「已保存」放完才关", async () => {
  const { page, errors } = await 开("split", 1024);
  try {
    const 条 = page.locator(".pd-split");
    await 条.waitFor();
    const 宽 = (who: string) => page.locator(`.pd-split-seg[data-who="${who}"]`).evaluate(el => el.style.flexBasis);
    expect(await 宽("u2")).toBe("10%");
    expect(await 宽("组长")).toBe("90%");
    const 输 = page.getByLabel(/李四.*的提成比例/);
    await 输.fill("30");
    await expect.poll(() => 宽("u3")).toBe("30%");
    expect(await 宽("组长")).toBe("60%");
    expect(await 条.getAttribute("aria-label")).toContain("项目负责人 60%");
    await page.evaluate(() => Reflect.set(window, "__分回", { ok: false, error: "组员刚退出了项目组，刷新再分" }));
    await expect.poll(() => page.getByRole("dialog").innerText()).toContain("分出去 40%，项目负责人留 60%");
    const 存 = page.getByRole("dialog").getByRole("button", { name: /保\s*存|没保存上/ });
    await 存.click();
    // g.save：没存上的原因浮在保存键正上方（不是顶部提示），框不关
    await page.getByRole("tooltip").filter({ hasText: "刷新再分" }).waitFor();
    expect(await 窗(page, "__关")).toBeNull();
    expect(await 顶部提示(page)).toBe("");
    expect(await 不横滚(page)).toBe(true);
    // 放行：键里转圈 →「已保存」，放完才关框
    await page.evaluate(() => Reflect.set(window, "__分回", undefined));
    await page.getByRole("tooltip").filter({ hasText: "刷新再分" }).waitFor({ state: "hidden", timeout: 6000 });
    await 存.click();
    await page.getByRole("dialog").getByRole("button", { name: /已保存/ }).waitFor();
    expect(await 窗(page, "__关")).toBeNull();
    await expect.poll(() => 窗(page, "__关"), { timeout: 4000 }).toBe(1);
    expect(await 顶部提示(page)).toBe("");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("dt.field：Enter 存，存的时候就摆新值、刷新回来前不闪回旧值；Esc 放弃回旧值；没存上退回旧值、原因写在格子下面", async () => {
  const { page, errors } = await 开("field");
  try {
    const 格 = page.locator(".rec-field[data-field=school]");
    await 格.click();
    await 格.locator("input").fill("新公司");
    await 格.locator("input").press("Enter");
    // 服务端还在存（桩里慢 300ms），格子上已经是新值、不回旧值
    await 格.getByText("新公司").waitFor();
    expect(await 格.innerText()).not.toContain("旧公司");
    await expect.poll(() => 窗(page, "__改")).toEqual([["school", "新公司"]]);
    // 存成了不再 router.refresh（跳转优化 PR-B 11-25）：动作里 revalidatePath 了，新页跟着动作回包回来；等桩里那 300ms 过去再看
    await page.waitForTimeout(600);
    expect(await 窗(page, "__刷") ?? 0, "存成了还在 router.refresh").toBe(0);
    expect(await 格.innerText()).not.toContain("旧公司");
    // 刷新带回新值
    await page.evaluate(() => (window as unknown as { __设值: (v: string) => void }).__设值("新公司"));
    // Esc 放弃：回原值，不交
    await 格.click();
    await 格.locator("input").fill("不要的");
    await 格.locator("input").press("Escape");
    await 格.getByText("新公司").waitFor();
    expect(await 窗(page, "__改")).toHaveLength(1);
    // 没存上：退回旧值，原因写在格子下面，不弹顶部提示
    await page.evaluate(() => Reflect.set(window, "__改回", { ok: false, error: "你的角色只能看「公司」" }));
    await 格.click();
    await 格.locator("input").fill("再改");
    await 格.locator("input").blur();
    await 格.getByRole("alert").filter({ hasText: "只能看" }).waitFor();
    expect(await 格.innerText()).toContain("新公司");
    expect(await 格.innerText()).not.toContain("再改");
    expect(await 顶部提示(page)).toBe("");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
