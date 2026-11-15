/**
 * 确认与反馈组件（PR5a，前端改版原型 g.confirm1/2/3、g.undo、g.save「改后」）。
 *
 * 只测组件本身，不碰页面调用处：
 *   后果框      取消 / Esc 不触发、确认才触发；原因没选好点不了；「其他」要写；没成原因写在框里、框不关；useConsequence 的 await
 *   就地确认    取消不触发、确认才触发；连点只算一下；3 秒（这里调短）不动自己收；鼠标停着不收；受控用法照旧
 *   长按确认    按不够不触发、松手退回；按满触发一次；键盘按住空格也行；SlideConfirm 旧接口照旧能用
 *   撤销条      同时只有一条（新的顶掉旧的、旧的立刻到点）；到点提交；撤销回调、连点只撤一次、撤了不再到点；
 *               撤销被挡写原因；离页立刻提交；调用方卸载条还在；鼠标停着倒计时暂停；Ctrl+Z
 *   保存按钮    保存中 → 已保存 → 回原样（成了 回调在最后）；没成写在按钮上、原因浮在上方；保存中连点只存一次
 *   宽度        Windows 1024 / 1280 / 1366：后果框、撤销条、长按键不出窗口、不横向滚
 * 认元素一律用 role 或文字（不认 ant-modal-confirm 这类 antd 内部类名）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React, { useState } from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
    import { ConfigProvider, Button } from 'antd'; import zhCN from 'antd/locale/zh_CN';
    import MotionTheme from '@/components/MotionTheme';
    import InlineConfirm from '@/components/InlineConfirm';
    import ConsequenceDialog, { useConsequence } from '@/components/ConsequenceDialog';
    import HoldConfirm from '@/components/HoldConfirm';
    import SlideConfirm from '@/components/SlideConfirm';
    import SaveButton from '@/components/SaveButton';
    import { showUndo, dismissUndo } from '@/components/UndoBar';
    const W = window;
    const 睡 = (ms) => new Promise(r => setTimeout(r, ms));
    let root = null;
    const 画 = (x) => { if (!root) root = createRoot(document.getElementById('root')); flushSync(() => root.render(<ConfigProvider locale={zhCN} button={{ autoInsertSpace: false }}><MotionTheme><div style={{ padding: 24 }}>{x}</div></MotionTheme></ConfigProvider>)); };
    W.__卸 = () => { root?.unmount(); root = null; };
    /** 做：记一笔；按 W.__慢 等一会；按 W.__坏 回失败 */
    const 记 = (k) => async (...a) => { (W[k] ||= []).push(a); if (W.__慢) await 睡(W.__慢); if (W.__坏) return { ok: false, error: W.__坏 }; };

    W.__inline = (p = {}) => { W.__做 = []; 画(<div className="row-end"><InlineConfirm 问={p.问 || '删除这条？'} 是={p.是} 毫秒={p.毫秒} 中性={p.中性} 做={记('__做')}><button type="button">删除计划</button></InlineConfirm></div>); };
    function 受控() { const [开, set开] = useState(false); return <><button type="button" onClick={() => set开(true)}>从菜单删</button><InlineConfirm 问="删了进回收站，30 天内可恢复" 开={开} set开={set开} 做={记('__做')}><span>一整排别的按钮</span></InlineConfirm></>; }
    W.__inlineCtl = () => { W.__做 = []; 画(<受控 />); };

    const 退回 = (名) => ({ 题: '把「' + 名 + '」退回公海', 后果: [{ 标: '领不回', 话: '你不能再领回，也看不到它了', 级: '危' }, { 标: '一起退', 话: '名下联系人、项目一起退回公海', 级: '警' }, { 标: '之后', 话: '同事领了客户就一起归他' }], 是: '退回公海', 原因: { 选项: ['超时未跟进', '客户无意向', '联系不上', '其他'], 叫: '退回原因' } });
    function 框({ 名, 须知 }) { const [开, set开] = useState(true); return <><button type="button" onClick={() => set开(true)}>再打开</button><ConsequenceDialog {...退回(名)} 须知={须知} open={开} onClose={(v) => { (W.__关 ||= []).push(v); set开(false); }} 做={记('__做')} /></>; }
    W.__dialog = (名 = '华东展具', 须知) => { W.__做 = []; W.__关 = []; 画(<框 名={名} 须知={须知} />); };
    function 问框() { const [问, 节点] = useConsequence(); return <><button type="button" onClick={async () => { W.__答 = await 问({ ...退回('星河乐园'), 原因: undefined, 做: 记('__做') }); }}>退回</button>{节点}</>; }
    W.__ask = () => { W.__做 = []; W.__答 = undefined; 画(<问框 />); };

    W.__hold = (p = {}) => { W.__做 = []; 画(<div style={{ width: p.宽 || 412 }}>{p.旧 ? <SlideConfirm 话="滑到右边清除" 做={记('__做')} /> : <HoldConfirm 话={p.话 || '清除演示数据'} 毫秒={p.毫秒} 做={记('__做')} />}</div>); };

    W.__save = () => { W.__做 = []; W.__成了 = 0; 画(<div className="foot" style={{ paddingTop: 80 }}><Button>取消</Button><SaveButton 做={记('__做')} 成了={() => W.__成了++} /></div>); };

    W.__undo = (话, p = {}) => { const id = 话; (W.__起 ||= []).push(id); return showUndo({ 话, 毫秒: p.毫秒 ?? 5000, 撤销: async () => { (W.__撤 ||= []).push(id); if (W.__慢撤) await 睡(W.__慢撤); if (W.__挡) return { ok: false, error: W.__挡 }; }, 到点: p.已做 ? undefined : async () => { (W.__交 ||= []).push(id); }, ...(p.另 ? { 另一个动作: { 话: p.另, 做: () => (W.__另 ||= []).push(id) } } : {}) }); };
    W.__undoReset = () => { dismissUndo(); W.__起 = []; W.__撤 = []; W.__交 = []; W.__另 = []; W.__挡 = null; W.__慢撤 = 0; };
    function 发撤销的() { return <button type="button" onClick={() => W.__undo('已取消关注「Nordic Fun AB」', { 毫秒: 800 })}>取消关注</button>; }
    W.__undoCaller = () => 画(<发撤销的 />);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width = 1280, height = 800) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://kit.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://kit.test");
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  return { page, errors };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type W = Record<string, any>;
const 调 = (page: Page, fn: string, ...a: unknown[]) => page.evaluate(([fn, a]) => (window as unknown as W)[fn as string](...(a as unknown[])), [fn, a] as const);
const 取 = <T>(page: Page, k: string) => page.evaluate((k) => (window as unknown as W)[k], k) as Promise<T>;
const 设 = (page: Page, k: string, v: unknown) => page.evaluate(([k, v]) => { (window as unknown as W)[k as string] = v as never; }, [k, v] as const);
const 不溢出 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

describe("后果框", () => {
  it("取消、Esc、点遮罩都不触发；原因选好才能确认；确认才触发，带上原因", async () => {
    const { page, errors } = await open();
    await 调(page, "__dialog");
    const 框 = page.getByRole("dialog", { name: "把「华东展具」退回公海" });
    await 框.waitFor();
    // 后果分条，每条带标签
    for (const t of ["领不回", "你不能再领回，也看不到它了", "一起退", "之后"]) await expect(框.getByText(t, { exact: true }).isVisible()).resolves.toBe(true);
    await 框.getByRole("button", { name: "取消" }).click();
    await 框.waitFor({ state: "hidden" });
    expect(await 取(page, "__做")).toEqual([]);
    expect(await 取(page, "__关")).toEqual([false]);

    await page.getByRole("button", { name: "再打开" }).click();
    await 框.waitFor();
    await page.keyboard.press("Escape");
    await 框.waitFor({ state: "hidden" });
    expect(await 取(page, "__做")).toEqual([]);

    await page.getByRole("button", { name: "再打开" }).click();
    await 框.waitFor();
    const 是 = 框.getByRole("button", { name: "退回公海" });
    expect(await 是.isDisabled()).toBe(true);
    // 选「其他」：原地变输入框，没写还是点不了
    await 框.getByRole("radio", { name: "其他" }).click();
    expect(await 框.getByRole("radio", { name: "其他" }).getAttribute("aria-checked")).toBe("true");
    const 写 = 框.getByRole("textbox", { name: "退回原因：其他的具体内容" });
    await 写.waitFor();
    expect(await 是.isDisabled()).toBe(true);
    await 写.fill("   ");
    expect(await 是.isDisabled()).toBe(true);
    await 写.fill("客户已转给集团采购");
    expect(await 是.isDisabled()).toBe(false);
    await 是.click();
    await 框.waitFor({ state: "hidden" });
    expect(await 取(page, "__做")).toEqual([["其他：客户已转给集团采购"]]);
    expect(await 取(page, "__关")).toEqual([false, false, true]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("没成：原因写在框里、框不关；确认在路上时连点只发一次", async () => {
    const { page } = await open();
    await 设(page, "__坏", "你没有退回这个客户的权限");
    await 设(page, "__慢", 300);
    await 调(page, "__dialog");
    const 框 = page.getByRole("dialog", { name: "把「华东展具」退回公海" });
    await 框.getByRole("radio", { name: "超时未跟进" }).click();
    const 是 = 框.getByRole("button", { name: "退回公海" });
    await 是.click();
    await 是.click({ force: true }).catch(() => {});
    await 是.click({ force: true }).catch(() => {});
    await 框.getByRole("alert").waitFor();
    expect(await 框.getByRole("alert").innerText()).toBe("你没有退回这个客户的权限");
    expect(await 框.isVisible()).toBe(true);
    expect(await 取(page, "__做")).toEqual([["超时未跟进"]]);
    expect(await 取(page, "__关")).toEqual([]);
    // 再点一次，这回成了
    await 设(page, "__坏", null);
    await 是.click();
    await 框.waitFor({ state: "hidden" });
    expect((await 取<unknown[]>(page, "__做")).length).toBe(2);
    await page.close();
  });

  it("须知没勾不让确认", async () => {
    const { page } = await open();
    await 调(page, "__dialog", "华东展具", "我知道签约也会删掉");
    const 框 = page.getByRole("dialog");
    await 框.getByRole("radio", { name: "联系不上" }).click();
    const 是 = 框.getByRole("button", { name: "退回公海" });
    expect(await 是.isDisabled()).toBe(true);
    await 框.getByRole("checkbox", { name: "我知道签约也会删掉" }).check();
    expect(await 是.isDisabled()).toBe(false);
    await page.close();
  });

  it("useConsequence：取消 → false、不触发；确认 → true", async () => {
    const { page } = await open();
    await 调(page, "__ask");
    await page.getByRole("button", { name: "退回", exact: true }).click();
    const 框 = page.getByRole("dialog", { name: "把「星河乐园」退回公海" });
    await 框.getByRole("button", { name: "取消" }).click();
    await page.waitForFunction(() => (window as unknown as W).__答 === false);
    expect(await 取(page, "__做")).toEqual([]);
    await page.getByRole("button", { name: "退回", exact: true }).click();
    await 框.getByRole("button", { name: "退回公海" }).click();
    await page.waitForFunction(() => (window as unknown as W).__答 === true);
    expect((await 取<unknown[]>(page, "__做")).length).toBe(1);
    await page.close();
  });
});

describe("就地确认", () => {
  it("取消不触发、确认才触发；连点只算一下", async () => {
    const { page, errors } = await open();
    await 调(page, "__inline");
    await page.getByRole("button", { name: "删除计划" }).click();
    await page.getByText("删除这条？").waitFor();
    await page.getByRole("button", { name: "取消" }).click();
    await page.getByRole("button", { name: "删除计划" }).waitFor();
    expect(await 取(page, "__做")).toEqual([]);

    await 设(page, "__慢", 300);
    await page.getByRole("button", { name: "删除计划" }).click();
    const 是 = page.getByRole("button", { name: "删除", exact: true });
    await 是.click();
    await 是.click({ force: true }).catch(() => {});
    await page.getByRole("button", { name: "删除计划" }).waitFor();
    expect((await 取<unknown[]>(page, "__做")).length).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("不动自己收回；鼠标停在上面不收；没成留着问句", async () => {
    const { page } = await open();
    await 调(page, "__inline", { 毫秒: 400 });
    await page.getByRole("button", { name: "删除计划" }).click();
    await page.getByText("删除这条？").waitFor();
    // 问句长在刚点的位置、鼠标还压在上面时不收（人还在）；走开之后才开始数
    await page.waitForTimeout(700);
    expect(await page.getByText("删除这条？").isVisible()).toBe(true);
    await page.mouse.move(600, 600);
    await page.getByText("删除这条？").waitFor({ state: "detached", timeout: 2000 });
    // 停在上面
    await page.getByRole("button", { name: "删除计划" }).click();
    await page.getByText("删除这条？").hover();
    await page.waitForTimeout(800);
    expect(await page.getByText("删除这条？").isVisible()).toBe(true);
    // 没成：留着，可以再点
    await 设(page, "__坏", "没有权限");
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await page.waitForTimeout(200);
    expect(await page.getByText("删除这条？").isVisible()).toBe(true);
    expect((await 取<unknown[]>(page, "__做")).length).toBe(1);
    // 键盘：Esc 收回
    await page.getByRole("button", { name: "取消" }).focus();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "删除计划" }).waitFor();
    await page.close();
  });

  it("后果那行：删除用危险色，中性的事用灰；确认键是实心的", async () => {
    const { page } = await open();
    await 调(page, "__inline", { 问: "把主客户改成这位？", 是: "改", 中性: true });
    await page.getByRole("button", { name: "删除计划" }).click();
    const 色 = (sel: string) => page.locator(sel).evaluate((e) => getComputedStyle(e).color);
    const 底 = (sel: string) => page.locator(sel).evaluate((e) => getComputedStyle(e).backgroundColor);
    const 灰 = await 色(".inlc-q");
    const 中性底 = await 底(".inlc-yes");
    await 调(page, "__卸");
    await 调(page, "__inline");
    await page.getByRole("button", { name: "删除计划" }).click();
    expect(await 色(".inlc-q")).not.toBe(灰);
    expect(await 底(".inlc-yes")).not.toBe(中性底);
    expect(await 底(".inlc-yes")).not.toBe("rgba(0, 0, 0, 0)");
    await page.close();
  });

  it("受控用法（从「…」菜单里点进来）照旧：点平时那颗键不展开", async () => {
    const { page } = await open();
    await 调(page, "__inlineCtl");
    await page.getByText("一整排别的按钮").click();
    expect(await page.getByText("删了进回收站，30 天内可恢复").count()).toBe(0);
    await page.getByRole("button", { name: "从菜单删" }).click();
    await page.getByText("删了进回收站，30 天内可恢复").waitFor();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await page.getByText("一整排别的按钮").waitFor();
    expect((await 取<unknown[]>(page, "__做")).length).toBe(1);
    await page.close();
  });
});

describe("长按确认", () => {
  it("按不够松手不触发、按钮摇一下；按满 1.2 秒触发一次", async () => {
    const { page, errors } = await open();
    await 调(page, "__hold");
    const 键 = page.getByRole("button", { name: "按住 清除演示数据" });
    const 盒 = (await 键.boundingBox())!;
    await page.mouse.move(盒.x + 盒.width / 2, 盒.y + 盒.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    const 灌了 = await 键.evaluate((e) => Number(getComputedStyle(e).getPropertyValue("--hold-p")));
    expect(灌了).toBeGreaterThan(0.2);
    expect(灌了).toBeLessThan(0.8);
    await page.mouse.up();
    expect(await 键.getAttribute("data-shake")).not.toBeNull();
    await page.waitForTimeout(900);
    expect(await 取(page, "__做")).toEqual([]);
    expect(await 键.evaluate((e) => Number(getComputedStyle(e).getPropertyValue("--hold-p")))).toBe(0);
    // 移出去也算松手
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.move(盒.x + 盒.width / 2, 盒.y - 80);
    await page.waitForTimeout(1100);
    await page.mouse.up();
    expect(await 取(page, "__做")).toEqual([]);
    // 按满
    await page.mouse.move(盒.x + 盒.width / 2, 盒.y + 盒.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1400);
    await page.mouse.up();
    await page.getByRole("button", { name: "已清除演示数据" }).waitFor();
    expect((await 取<unknown[]>(page, "__做")).length).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("键盘：按住空格 1.2 秒；只敲一下不算", async () => {
    const { page } = await open();
    await 调(page, "__hold");
    const 键 = page.getByRole("button", { name: "按住 清除演示数据" });
    await 键.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1400);
    expect(await 取(page, "__做")).toEqual([]);
    await page.keyboard.down(" ");
    await page.waitForTimeout(1400);
    await page.keyboard.up(" ");
    expect((await 取<unknown[]>(page, "__做")).length).toBe(1);
    await page.close();
  });

  it("SlideConfirm 旧接口照旧能用：话「滑到右边清除」读成「按住 清除」", async () => {
    const { page } = await open();
    await 调(page, "__hold", { 旧: true });
    const 键 = page.getByRole("button", { name: "按住 清除" });
    await 键.hover();
    await page.mouse.down();
    await page.waitForTimeout(1400);
    await page.mouse.up();
    expect((await 取<unknown[]>(page, "__做")).length).toBe(1);
    await page.getByRole("button", { name: "已清除" }).waitFor();
    await page.close();
  });
});

describe("撤销条", () => {
  const 条 = (page: Page) => page.locator("#undo-host").getByRole("status");

  it("同时只有一条：新的顶掉旧的，旧的立刻到点提交", async () => {
    const { page, errors } = await open();
    await 调(page, "__undoReset");
    await 调(page, "__undo", "已退回「华东展具」");
    await page.getByText("已退回「华东展具」").waitFor();
    await 调(page, "__undo", "已退回「星河乐园」");
    await page.getByText("已退回「星河乐园」").waitFor();
    expect(await page.getByText("已退回「华东展具」").count()).toBe(0);
    expect(await 条(page).count()).toBe(1);
    expect(await 取(page, "__交")).toEqual(["已退回「华东展具」"]);
    // 连着来三条也还是一条，前两条各提交一次
    await 调(page, "__undo", "第三条");
    await 调(page, "__undo", "第四条");
    expect(await 条(page).count()).toBe(1);
    expect(await 取(page, "__交")).toEqual(["已退回「华东展具」", "已退回「星河乐园」", "第三条"]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("另一个动作（排下一次）：倒计时里和撤销并排；点了 = 条按到点收掉、调它一次，不撤销", async () => {
    const { page } = await open();
    await 调(page, "__undoReset");
    await 调(page, "__undo", "已完成「发新报价」", { 毫秒: 5000, 另: "排下一次" });
    const 键 = page.getByRole("button", { name: "排下一次" });
    await 键.waitFor();
    expect(await page.getByRole("button", { name: "撤销" }).count()).toBe(1);
    await 键.click();
    await expect.poll(() => 取(page, "__另")).toEqual(["已完成「发新报价」"]);
    await expect.poll(() => 取(page, "__交")).toEqual(["已完成「发新报价」"]);
    expect(await 取(page, "__撤")).toEqual([]);
    await page.getByText("已完成「发新报价」").waitFor({ state: "detached", timeout: 3000 });
    // 不给 另一个动作 的照旧只有撤销
    await 调(page, "__undo", "已退回「华东展具」");
    await page.getByText("已退回「华东展具」").waitFor();
    expect(await page.getByRole("button", { name: "排下一次" }).count()).toBe(0);
    await page.close();
  });

  it("倒计时到点提交、条收起；撤销了就不再到点", async () => {
    const { page } = await open();
    await 调(page, "__undoReset");
    await 调(page, "__undo", "已移除这一轮", { 毫秒: 600 });
    await page.getByText("已移除这一轮").waitFor();
    await page.mouse.move(5, 5);
    await page.waitForFunction(() => ((window as unknown as W).__交 as unknown as unknown[]).length === 1, null, { timeout: 2000 });
    await page.getByText("已移除这一轮").waitFor({ state: "detached" });

    await 调(page, "__undo", "已取消关注「Nordic Fun AB」", { 毫秒: 600 });
    await page.getByRole("button", { name: "撤销" }).click();
    await page.getByText("已撤销").waitFor();
    await page.waitForTimeout(900);
    expect(await 取(page, "__撤")).toEqual(["已取消关注「Nordic Fun AB」"]);
    expect(await 取(page, "__交")).toEqual(["已移除这一轮"]);
    await page.getByText("已撤销").waitFor({ state: "detached", timeout: 3000 });
    await page.close();
  });

  it("连点撤销只撤一次；撤销被挡：写原因、不再倒计时", async () => {
    const { page } = await open();
    await 调(page, "__undoReset");
    await 设(page, "__慢撤", 300);
    await 设(page, "__挡", "已被同事领走，撤销不了");
    await 调(page, "__undo", "已退回「华东展具」", { 已做: true });
    const 撤 = page.getByRole("button", { name: "撤销" });
    await 撤.click();
    await 撤.click({ force: true }).catch(() => {});
    await page.keyboard.press("Control+z");
    const 警 = page.locator("#undo-host").getByRole("alert");
    await 警.waitFor();
    expect(await 警.innerText()).toContain("撤销不了：已被同事领走，撤销不了");
    expect(await 取(page, "__撤")).toEqual(["已退回「华东展具」"]);
    expect(await 取(page, "__交")).toEqual([]);
    expect(await page.getByRole("button", { name: "撤销" }).count()).toBe(0);
    await page.getByRole("button", { name: "关闭" }).click();
    await 警.waitFor({ state: "detached" });
    await page.close();
  });

  it("离页：到点才做的那一下立刻提交，不等倒计时", async () => {
    const { page } = await open();
    await 调(page, "__undoReset");
    await 调(page, "__undo", "已移除这一轮", { 毫秒: 60_000 });
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.waitForFunction(() => ((window as unknown as W).__交 as unknown as unknown[]).length === 1, null, { timeout: 1000 });
    expect(await 条(page).count()).toBe(0);
    // 已经做了的那种：离页什么都不多做
    await 调(page, "__undo", "已退回「华东展具」", { 已做: true, 毫秒: 60_000 });
    await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
    expect(await 取(page, "__交")).toEqual(["已移除这一轮"]);
    expect(await 取(page, "__撤")).toEqual([]);
    await page.close();
  });

  it("调用方卸载（换页）条还在、照常到点；鼠标停在条上倒计时暂停；Ctrl+Z 撤销", async () => {
    const { page } = await open();
    await 调(page, "__undoReset");
    await 调(page, "__undoCaller");
    await page.getByRole("button", { name: "取消关注" }).click();
    await 调(page, "__卸");
    await page.getByText("已取消关注「Nordic Fun AB」").hover();
    await page.waitForTimeout(1200);
    expect(await 取(page, "__交")).toEqual([]);
    await page.mouse.move(5, 5);
    await page.waitForFunction(() => ((window as unknown as W).__交 as unknown as unknown[]).length === 1, null, { timeout: 2000 });

    await 调(page, "__undo", "已标完成", { 毫秒: 5000 });
    await page.keyboard.press("Control+z");
    await page.getByText("已撤销").waitFor();
    expect(await 取(page, "__撤")).toEqual(["已标完成"]);
    await page.close();
  });
});

describe("保存按钮", () => {
  it("保存中 → 已保存 → 回原样，成了在最后调；保存中连点只存一次；不弹顶部提示", async () => {
    const { page, errors } = await open();
    await 设(page, "__慢", 400);
    await 调(page, "__save");
    const 键 = page.getByRole("button", { name: "保存", exact: true });
    const 原宽 = (await 键.boundingBox())!.width;
    await 键.click();
    const 存着 = page.getByRole("button", { name: "正在保存" });
    await 存着.waitFor();
    expect(await 存着.getAttribute("aria-busy")).toBe("true");
    await 存着.click({ force: true });
    await page.getByRole("button", { name: "已保存" }).waitFor();
    expect((await 取<unknown[]>(page, "__做")).length).toBe(1);
    expect(await 取(page, "__成了")).toBe(0);
    await page.getByRole("button", { name: "保存", exact: true }).waitFor({ timeout: 3000 });
    await page.waitForFunction(() => (window as unknown as W).__成了 === 1);
    await page.waitForTimeout(400);
    expect(Math.abs((await 键.boundingBox())!.width - 原宽)).toBeLessThan(1);
    expect(await page.locator(".ant-message").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("没成：按钮上写「没保存上」，原因浮在按钮上方；之后回原样可以再点", async () => {
    const { page } = await open();
    await 设(page, "__坏", "名额已满，先退回几个");
    await 调(page, "__save");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "没保存上" }).waitFor();
    const 提示 = page.getByRole("tooltip");
    await 提示.waitFor();
    expect(await 提示.innerText()).toBe("名额已满，先退回几个");
    expect(await page.getByRole("status").filter({ hasText: "没保存上：名额已满" }).count()).toBe(1);
    const 键盒 = (await page.getByRole("button", { name: "没保存上" }).boundingBox())!;
    const 提示盒 = (await 提示.boundingBox())!;
    expect(提示盒.y + 提示盒.height).toBeLessThanOrEqual(键盒.y + 1);
    await page.getByRole("button", { name: "保存", exact: true }).waitFor({ timeout: 6000 });
    expect(await 取(page, "__成了")).toBe(0);
    await page.close();
  });
});

describe("Windows 宽度：不出窗口、不横向滚", () => {
  for (const 宽 of [1024, 1280, 1366]) {
    it(`${宽}`, async () => {
      const { page } = await open(宽, 700);
      await 调(page, "__dialog", "上海华东国际展览展示器材集团有限公司第二分公司（浦东新区张江高科技园区）".repeat(2));
      const 框 = page.getByRole("dialog");
      await 框.waitFor();
      await 框.getByRole("radio", { name: "其他" }).click();
      const 框盒 = (await 框.boundingBox())!;
      expect(框盒.x).toBeGreaterThanOrEqual(0);
      expect(框盒.x + 框盒.width).toBeLessThanOrEqual(宽);
      for (const b of await 框.getByRole("button").all()) {
        const 盒 = (await b.boundingBox())!;
        expect(盒.x + 盒.width).toBeLessThanOrEqual(框盒.x + 框盒.width + 0.5);
      }
      expect(await 不溢出(page)).toBe(true);
      await 框.getByRole("button", { name: "取消" }).click();

      await 调(page, "__undoReset");
      await 调(page, "__undo", "已退回「" + "上海华东国际展览展示器材集团有限公司".repeat(4) + "」", { 毫秒: 60_000 });
      const 条盒 = (await page.locator("#undo-host").getByRole("status").boundingBox())!;
      expect(条盒.x).toBeGreaterThanOrEqual(16 - 0.5);
      expect(条盒.x + 条盒.width).toBeLessThanOrEqual(宽 - 16 + 0.5);
      expect(条盒.width).toBeLessThanOrEqual(520.5);
      const 撤盒 = (await page.getByRole("button", { name: "撤销" }).boundingBox())!;
      expect(撤盒.x + 撤盒.width).toBeLessThanOrEqual(条盒.x + 条盒.width);
      expect(await 不溢出(page)).toBe(true);

      // 长按键放在 460 宽的框里那么宽
      await 调(page, "__hold", { 宽: 412, 话: "清除演示数据" });
      const 按盒 = (await page.getByRole("button", { name: "按住 清除演示数据" }).boundingBox())!;
      expect(按盒.width).toBeLessThanOrEqual(412.5);
      expect(await 不溢出(page)).toBe(true);
      await page.close();
    });
  }
});
