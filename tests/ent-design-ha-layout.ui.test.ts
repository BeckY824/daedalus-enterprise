/**
 * 设计语言 H-A（11-21，首页骨架、顶部提示、输入框、指标卡；依据 现在-首页-20261121.md H0 / H4 / H6 / H7）：
 *   H-新4 还没问时整块上下居中照留；命令表从输入框上沿浮出、不撑高；多行输入、展开指标卡时顶边不动（usePinCenter）
 *   H-新3 命令表键盘选中 / 鼠标悬停只亮一行；H-新5 发送钮品牌蓝；D38 手机不写键盘提示
 *   H-新7 / 12 / 13 / 14 顶部提示同一种行、量词「N 条」、smartTime、时间不掉行不截；H-新8 自动分配不整句加粗
 *   H-新1 / 2 / 15 指标卡悬停只换底色、橙数不变蓝、右上 ›；390 展开「看这 N 个项目 ›」不截、「收起」不竖折
 * 排版门槛：Windows 1024 / 1280 / 1366 + 手机 390，超长数据；scrollWidth ≤ innerWidth、关键按钮 elementFromPoint 命中自己。
 * 换皮主题（账簿、科技）结构和文案照旧（用户 11-21「主题不动」，lib/use-skin.ts）。
 *
 * 外面的结构照 HomeChat 驾驶舱那一支摆（HomeChat / Composer 连着对话流、路由、背调，单拎出来画不了；同 ent-home-frame.ui.test.ts），
 * 钉住居中用 HomeChat 同一个 usePinCenter
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "ent-design-ha", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L({href,prefetch,...p}){return <a href={href} {...p}/>}");
  // 待复核（VerifyInbox）的判有效 / 判无效：服务端那串进不了浏览器包
  const 动作 = "const r=async()=>({ok:true});export const 线索初判Action=r,市场复核Action=r,销售终验Action=r,总管理终判Action=r,销售认领Action=r,撤回验证Action=r;";
  stub(/^\.\/actions$/, 动作);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  const r = await build({ stdin: { contents: `
    import React, { useEffect, useRef, useState } from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import Welcome from '@/app/(app)/dashboard/Welcome';
    import { ComposerFoot, ComposerTop, SendKey } from '@/app/(app)/dashboard/ComposerParts';
    import HomeCards from '@/app/(app)/dashboard/HomeCards';
    import AwaitAssignTodo from '@/app/(app)/leads/AwaitAssignTodo';
    import CoachTopicTodo from '@/app/(app)/dashboard/CoachTopicTodo';
    import ReplyDueTodo from '@/app/(app)/dashboard/ReplyDueTodo';
    import AssignEtaLine from '@/app/(app)/dashboard/AssignEtaLine';
    import VerifyInbox from '@/app/(app)/projects/VerifyInbox';
    import { usePinCenter } from '@/app/(app)/dashboard/use-pin-center';
    import { useIsNowSkin } from '@/lib/use-skin';
    import { configureBrowserBusinessTimeZone } from '@/lib/business-clock';
    // 企业版浏览器端业务钟 = 北京（app/(app)/layout.tsx 的 BusinessProvider 传 timeZone）；页面本身开在伦敦时区，时间仍按北京写
    configureBrowserBusinessTimeZone('Asia/Shanghai');
    const 长 = '某某超长贸易进出口有限公司'.repeat(5);
    const 示例们 = [
      { label: "今天该跟谁", question: "今天该跟谁", kind: "fill" },
      { label: "帮我记一条：…", question: "帮我记一条：", kind: "fill" },
      { label: "哪些项目 3 天内回公海", question: "我手上哪些项目 3 天内回公海", kind: "fill" },
    ];
    const 命令们 = [
      { cmd: "/prep", hint: "准备下次跟进：找我最该联系的那位，读完记录给建议" },
      { cmd: "/recap", hint: "回顾上次沟通：上次跟的那位聊到哪了" },
      { cmd: "/watch", hint: "盯盘：正在被遗忘的人，各自该从哪接上" },
      { cmd: "/board", hint: "打开复盘" },
      { cmd: "/clear", hint: "清空这一屏" },
    ];
    const 今 = new Date();
    const 两位 = (n) => String(n).padStart(2, '0');
    const 北京 = new Date(今.getTime() + 8 * 3600_000);
    const 今天串 = 两位(北京.getUTCMonth() + 1) + '-' + 两位(北京.getUTCDate());
    const 今天日 = 北京.getUTCFullYear() + '-' + 今天串;
    const 京 = (hm) => new Date(今天日 + 'T' + hm + ':00+08:00').toISOString();
    function 首页({ 待办: 给的待办, 卡数, 短名, 晚到 }) {
      /* 晚到：顶部待办进页后才出现（数据晚一步到、或别的提示行后挂上），先 0 行、200ms 后才是给的那几行 */
      const [到了, set到了] = useState(!晚到);
      useEffect(() => { if (!晚到) return; const t = setTimeout(() => set到了(true), 200); return () => clearTimeout(t); }, [晚到]);
      const 待办 = 到了 ? 给的待办 : false;
      const [槽, set槽] = useState(null);
      const [q, setQ] = useState("");
      const [idx, setIdx] = useState(0);
      const 现状 = useIsNowSkin();
      const 网格 = useRef(null);
      usePinCenter(网格, 现状);
      const 开命令 = q.startsWith('/');
      return (
        <><div className="cli cli-empty"><div className="cli-ck"><div className="cli-ck-g" ref={网格}>
          <div className="cli-col cli-frame">
            {待办 && <>
              <AwaitAssignTodo 数据={{ 条数: 128, 最早: 今天串 + ' 09:30', 最早At: 京('09:30') }} />
              {待办 === true && <CoachTopicTodo 数据={{ 条数: 12, 最早: { at: new Date(今.getTime() - 3600_000).toISOString(), projectId: 'p1', title: '主题' + 长 } }} />}
              {待办 !== 1 && <ReplyDueTodo 数据={{ 条数: 8, 超时: 3, 最早: { projectId: 'p2', name: 长, 时: 今天串 + ' 21:00 – 22:00', 始: 京('21:00'), 终: 京('22:00'), 超时: true } }} />}
              {待办 === true && <VerifyInbox 首页 们={[
                { projectId: 'p3', 项目: '超长项目名' + 长, 负责人: '负责人' + 长, 步: '市场复核', 无效原因: '其他：' + 长, 初判说明: '说明' + 长, 复核说明: null, 异议说明: null, 更新于: new Date(今.getTime() - 2 * 86400_000).toISOString() },
                { projectId: 'p4', 项目: '二号', 负责人: '乙', 步: '销售终验', 无效原因: null, 初判说明: null, 复核说明: null, 异议说明: null, 更新于: 今.toISOString() },
              ]} />}
              {待办 === true && <AssignEtaLine 轮到={{ 数: 128, 待补: 2, 放弃待补: 1 }} />}
            </>}
            <Welcome userName={短名 ? "测试员" : "测试员" + 长} context="" 欢迎={"欢迎使用 测试产品"} 示例槽={set槽} />
            <div className="cli-composer">
              <ComposerTop 客户="客户" 背调模式={false} 邮件={null} on去掉邮件={() => {}} 提示粘贴={null} on切={() => {}} on不切={() => {}}
                没这个命令={false} q={q} cmdMatches={开命令 ? 命令们 : []} cmdIdx={idx} on选命令={() => {}}
                浮={现状} on指命令={现状 ? setIdx : undefined} />
              <div className="cli-input cli-input-rich">
                <textarea rows={1} value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} onKeyDown={(e) => { if (开命令 && e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => (i + 1) % 命令们.length); } }} />
                <div className="cli-bar2"><div className="cli-bar2-l" /><div className="cli-bar2-r"><SendKey 在跑={false} onStop={() => {}} canSend={!!q.trim()} on发={() => {}} /></div></div>
              </div>
              <ComposerFoot 摆建议 示例槽={槽} suggestions={示例们} suggIdx={-1} 空 在跑={false} 背调模式={false} 背调价={null} AI已用完={false} on问={(x) => setQ(x.question)} />
            </div>
          </div>
          <HomeCards 数={卡数} />
        </div></div></div>
        {/* 别的页右侧 AI 面板那颗发送钮（不在 .cli-frame 里）：H-新5 只改首页，这颗照旧墨色 */}
        <div data-testid="dock-like"><button type="button" className="cli-send" aria-label="发送">↑</button></div>
        </>
      );
    }
    const root = createRoot(document.getElementById('root'));
    window.__画 = (待办, 卡数, 短名, 晚到) => root.render(<ConfigProvider locale={zhCN}><App><首页 待办={待办} 卡数={卡数} 短名={短名} 晚到={晚到} /></App></ConfigProvider>);
    window.__输 = (v) => { const ta = document.querySelector('.cli-frame textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, v); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, plugins: [plugin], logLevel: "silent" });
  bundle = "window.process = { env: {} };\n" + r.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 皮 = "now" | "ledger" | "tech";
const 卡数 = { "month-new": 591, key: 123, "no-follow": 4802, "due-soon": 0 };
async function 开(o: { 宽: number; 高?: number; 待办?: boolean | 1 | 2; skin?: 皮; 壳?: boolean; 短名?: boolean; 晚到?: boolean; 进场?: boolean }): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: o.宽, height: o.高 ?? 900 }, reducedMotion: "reduce", timezoneId: "Europe/London" });
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const skin = o.skin ?? "now";
  await page.route("http://ha.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html${skin === "now" ? "" : ` data-skin="${skin}" data-paper="tone" data-mode="light"`}><meta charset='utf-8'><body style='margin:0'>${o.壳 ? "<div class='shell'><nav style='width:220px;flex:none'></nav><main class='main app-content' style='padding:22px 26px'><div id='above'></div><div id='wrap' style='max-width:1720px;margin:0 auto" + (o.进场 ? ";transform:translateY(4px)" : "") + "'><div id='root'></div></div></main></div>" : "<main style='padding:24px'><div id='root'></div></main>"}</body></html>` }));
  await page.goto("http://ha.test/dashboard");
  for (const f of ["globals.css", ...(skin === "now" ? [] : ["skins/shared.css", `skins/${skin}.css`])]) await page.addStyleTag({ path: path.resolve("src/app", f) });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([待办, 数, 短名, 晚到]) => (window as unknown as { __画: (a: unknown, b: unknown, c: unknown, d: unknown) => void }).__画(待办, 数, 短名, 晚到), [o.待办 ?? true, 卡数, !!o.短名, !!o.晚到] as const);
  await page.locator(".cli-frame .cli-input").waitFor();
  await page.locator(".cli-frame-q .cli-q").first().waitFor();
  if (errors.length) throw new Error(errors.join("\n"));
  return { page, errors };
}
const 不横滚 = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** 元素中心点上最上面那一个就是它自己（或它里面的） */
const 点得中 = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((el) => {
  const r = el.getBoundingClientRect(); const y = r.top + r.height / 2;
  if (y < 0 || y > innerHeight) { el.scrollIntoView({ block: "center" }); }
  const r2 = el.getBoundingClientRect(); const hit = document.elementFromPoint(r2.left + r2.width / 2, r2.top + r2.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}));
const 顶 = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => e.getBoundingClientRect().top + scrollY);

for (const 宽 of [1024, 1280, 1366, 390]) {
  it(`${宽}：超长数据不横滚；顶部提示同一种行、时间 smartTime 不掉行不截；发送钮、判有效 / 判无效、指标卡点得中`, async () => {
    const { page, errors } = await 开({ 宽 });
    try {
      expect(await 不横滚(page)).toBe(true);
      // 顶部提示：五种都是同一种行（home-cth-todo），待复核不再是带表头的卡
      expect(await page.locator(".cli-frame .home-cth-todo").count()).toBe(6);
      expect(await page.locator(".cli-frame [data-testid=verify-inbox] .ant-card").count()).toBe(0);
      // 量词「N 条」、smartTime
      expect(await page.getByTestId("home-await-assign").textContent()).toContain("待分配新线索 128 条最早 今天 09:30");
      expect(await page.getByTestId("home-coach-topics").textContent()).toMatch(/待回复主题 12 条最早 (今天|昨天)/);
      expect(await page.getByTestId("home-reply-due").textContent()).toContain("待回复客户 8 条（超时 3 条）指定回复 今天 21:00 – 22:00 · ");
      expect(await page.getByTestId("verify-row-p3").textContent()).toContain(" · 2 天前 · 无效原因");
      // 时间不拆行、整段看得见（不被省略号吃掉，不掉到下一行一半）
      const 时们 = await page.locator(".cli-frame .home-cth-todo-time").evaluateAll((els) => els.map((el) => {
        const 行 = el.closest(".home-cth-todo")!.getBoundingClientRect(); const s = el.parentElement!; const rs = el.getClientRects();
        return { 字: el.textContent, 一行: rs.length === 1, 在行内: el.getBoundingClientRect().right <= 行.right + 1, 段没截: s.scrollWidth <= s.clientWidth + 1 || getComputedStyle(s).textOverflow !== "ellipsis" };
      }));
      expect(时们.length).toBe(5);
      for (const t of 时们) expect(t, JSON.stringify(t)).toMatchObject({ 一行: true, 在行内: true });
      // 手机：说明整句折行，不省略（H-新14）
      if (宽 === 390) for (const t of 时们) expect(t.段没截, JSON.stringify(t)).toBe(true);
      // H-新8：自动分配粗的只有「自动分配：前面约 N 条轮到你」，待补和估算说明是灰字
      expect(await page.locator(".home-eta-t").textContent()).toBe("自动分配：前面约 128 条轮到你");
      expect(await page.locator(".home-eta-note").textContent()).toBe("判无效待补 1 条、放弃记的待补 1 条，优先补给你 · 这是估算：指定分配、有人暂停或新同事加入都会让它变");
      expect(await page.locator(".home-eta-note").evaluate((e) => getComputedStyle(e).fontWeight)).toBe("400");
      // 关键按钮命中自己
      expect(await 点得中(page, ".home-verify-a .ant-btn")).toEqual([true, true]);
      expect(await 点得中(page, ".home-cth-todo-a")).not.toContain(false);
      expect(await 点得中(page, ".cli-frame .cli-send")).toEqual([true]);
      expect(await 点得中(page, ".home-kpi-head")).toEqual([true, true, true, true]);
      if (宽 === 390) {
        // 触屏点击区 44（--hit-touch）
        for (const h of await page.locator(".home-verify-a .ant-btn").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
      }
      // D38：手机不写键盘提示；电脑照写
      expect(await page.locator(".cli-hints-keys").isVisible()).toBe(宽 !== 390);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

it("H-新4 / 新3 / 新5（1366 高 900）：整块上下居中；开命令表不撑高、顶边不动；只亮一行；多行输入顶边不动；发送钮品牌蓝", async () => {
  const { page } = await 开({ 宽: 1366, 待办: false });
  try {
    const 组 = await page.locator(".cli-ck-g").evaluate((e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, h: r.height }; });
    const 页 = await page.locator(".cli").evaluate((e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom }; });
    // 居中照留（11-11 用户定）
    expect(Math.abs((组.t - 页.t) - (页.b - 组.b))).toBeLessThan(2);
    expect(组.t - 页.t).toBeGreaterThan(40);
    // 人点进输入框、打「/」
    await page.locator(".cli-frame textarea").click();
    await page.locator(".cli-frame textarea").pressSequentially("/");
    // 命令表浮在输入框上面，不占高度：整块顶边、高度都不变
    await page.locator(".cli-cmds").waitFor();
    // 发送钮：有字品牌蓝（等底色过渡走完）
    await page.waitForTimeout(300);
    expect(await page.locator(".cli-frame .cli-send").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(10, 102, 216)");
    // 右侧 AI 面板（别的页）那颗不改：照旧墨色
    expect(await page.locator("[data-testid=dock-like] .cli-send").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(29, 29, 31)");
    expect(await page.locator(".cli-cmds-float").count()).toBe(1);
    expect(await page.locator(".cli-ck-g").evaluate((e) => e.getBoundingClientRect().height)).toBeCloseTo(组.h, 0);
    expect(Math.abs(await 顶(page, ".cli-ck-g") - 组.t)).toBeLessThan(1.5);
    const 表底 = await page.locator(".cli-cmds").evaluate((e) => e.getBoundingClientRect().bottom);
    expect(表底).toBeLessThanOrEqual(await 顶(page, ".cli-frame .cli-input"));
    expect(await 点得中(page, ".cli-cmd")).toEqual([true, true, true, true, true]);
    // 键盘选中第二行，鼠标指到第四行：只亮一行（选中跟着鼠标走）
    await page.locator(".cli-frame textarea").press("ArrowDown");
    await page.locator(".cli-cmd").nth(3).hover();
    // 等离开那一行的底色褪完（--t-leave 150ms）
    await page.waitForTimeout(300);
    const 亮 = () => page.locator(".cli-cmd").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor !== "rgba(0, 0, 0, 0)"));
    expect(await 亮()).toEqual([false, false, false, true, false]);
    await page.locator(".cli-frame textarea").press("ArrowDown");
    await page.waitForTimeout(300);
    expect(await 亮()).toEqual([false, false, false, false, true]);
    // 多行输入：问答卡长高，顶边钉住、往下长
    await page.locator(".cli-frame textarea").fill("");
    await page.evaluate(() => (window as unknown as { __输: (v: string) => void }).__输(Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 行`).join("\n")));
    await page.waitForTimeout(100);
    expect(await page.locator(".cli-ck-g").evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThan(组.h + 20);
    expect(Math.abs(await 顶(page, ".cli-ck-g") - 组.t)).toBeLessThan(1.5);
    // 清空回原位
    await page.evaluate(() => (window as unknown as { __输: (v: string) => void }).__输(""));
    await page.waitForTimeout(300);
    expect(Math.abs(await 顶(page, ".cli-ck-g") - 组.t)).toBeLessThan(1.5);
    expect(await page.locator(".cli-frame .cli-send").evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgb(10, 102, 216)");
  } finally { await page.close(); }
});

it("H-新1 / 新2 / 新4（1366）：指标卡悬停只换底色、不上浮、橙数不变蓝；右上 ›；展开一张整块顶边不动", async () => {
  const { page } = await 开({ 宽: 1366, 待办: false });
  try {
    const 卡 = page.locator(".home-kpi-card").nth(2);
    expect(await 卡.locator(".home-kpi-chev").textContent()).toBe("›");
    const 前 = await 卡.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, top: e.getBoundingClientRect().top }));
    const 组顶 = await 顶(page, ".cli-ck-g");
    await 卡.locator(".home-kpi-head").hover();
    await page.waitForTimeout(300);
    const 后 = await 卡.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, top: e.getBoundingClientRect().top, 影: getComputedStyle(e).boxShadow, 数: getComputedStyle(e.querySelector(".home-card-v")!).color }));
    expect(后.bg).not.toBe(前.bg);
    expect(后.bg).toBe("rgb(245, 245, 247)");
    expect(后.top).toBeCloseTo(前.top, 0);
    expect(后.影).toBe("none");
    expect(后.数).toBe("rgb(217, 119, 6)");
    // 没着色的卡悬停数字也不变蓝
    await page.locator(".home-kpi-card").first().locator(".home-kpi-head").hover();
    await page.waitForTimeout(300);
    expect(await page.locator(".home-kpi-card").first().locator(".home-card-v").evaluate((e) => getComputedStyle(e).color)).toBe("rgb(29, 29, 31)");
    // 点开：› 转朝下；整块顶边不动（往下长）
    await 卡.locator(".home-kpi-head").click();
    await 卡.locator(".home-kpi-body").waitFor();
    await page.waitForTimeout(300);
    expect(await 卡.locator(".home-kpi-chev").evaluate((e) => getComputedStyle(e).rotate)).toBe("90deg");
    await page.waitForTimeout(100);
    expect(Math.abs(await 顶(page, ".cli-ck-g") - 组顶)).toBeLessThan(1.5);
  } finally { await page.close(); }
});

it("H-新15（390）：指标卡展开「看这 N 个项目 ›」不截、「收起」一行", async () => {
  const { page } = await 开({ 宽: 390, 待办: false });
  try {
    await page.locator(".home-kpi-card").first().locator(".home-kpi-head").click();
    const 体 = page.locator(".home-kpi-card").first().locator(".home-kpi-body");
    await 体.waitFor();
    expect(await 体.locator(".home-kpi-go").textContent()).toBe("看这 591 个项目 ›");
    expect(await 体.locator(".home-kpi-go").evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && getComputedStyle(e).textOverflow !== "ellipsis" || e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(await 体.locator(".home-kpi-go").evaluate((e) => e.getBoundingClientRect().right <= e.closest(".home-kpi-card")!.getBoundingClientRect().right)).toBe(true);
    expect(await 体.locator(".home-kpi-close").evaluate((e) => e.getClientRects().length === 1 && e.getBoundingClientRect().width > e.getBoundingClientRect().height)).toBe(true);
    expect(await 点得中(page, ".home-kpi-close")).toEqual([true]);
    expect(await 不横滚(page)).toBe(true);
  } finally { await page.close(); }
});

for (const skin of ["ledger", "tech"] as const) {
  it(`换皮主题（${skin}）结构和文案照旧：待复核是卡、自动分配原句、量词时间原样、没有 ›、命令表不浮、发送钮不改色`, async () => {
    const { page, errors } = await 开({ 宽: 1366, skin });
    try {
      expect(await page.locator("[data-testid=verify-inbox].ant-card").count()).toBe(1);
      expect(await page.locator(".home-eta-t").textContent()).toBe("自动分配：按现在的数，前面约 128 条轮到你（判无效待补 1 条、放弃记的待补 1 条，优先补给你）");
      expect(await page.getByTestId("home-reply-due").textContent()).toMatch(/^待回复客户 8（超时 3）/);
      expect(await page.getByTestId("home-await-assign").textContent()).toMatch(/最早 \d{2}-\d{2} 09:30/);
      expect(await page.locator(".home-kpi-chev").count()).toBe(0);
      await page.locator(".cli-frame textarea").fill("/");
      await page.locator(".cli-cmds").waitFor();
      expect(await page.locator(".cli-cmds-float").count()).toBe(0);
      expect(await page.locator(".cli-cmds-one").count()).toBe(0);
      expect(await page.locator(".cli-frame .cli-send").evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgb(10, 102, 216)");
      expect(await 不横滚(page)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

/*
  3704 实操（11-22）挡下的：顶部两行待办（销售、销售管理、市场管理常见）时，多行输入把问答卡撑高、外层 .cli-ck 跟着过了 min-height，
  原来按容器高当「窗口变了」重新居中，整块往上跳（1024×768 115 → 54、1366×900 149 → 138；展开指标卡挪 2px）。只认视口尺寸变了才重钉
*/
it.each([[1024, 768], [1366, 900]])("H-新4（%i×%i，顶部 2 行待办）：多行输入、展开指标卡，问答卡顶不动（≤1px）", async (宽, 高) => {
  const { page } = await 开({ 宽, 高, 待办: 2 });
  try {
    expect(await page.locator(".cli-frame .home-cth-todo").count()).toBe(2);
    const 起 = await 顶(page, ".cli-ck-g");
    await page.locator(".cli-frame textarea").click();
    await page.evaluate(() => (window as unknown as { __输: (v: string) => void }).__输(Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 行`).join("\n")));
    await page.waitForTimeout(150);
    expect(Math.abs(await 顶(page, ".cli-ck-g") - 起), `${宽} 多行`).toBeLessThanOrEqual(1);
    expect(Math.abs(await 顶(page, ".cli-frame") - 起), `${宽} 问答卡顶`).toBeLessThanOrEqual(1);
    await page.evaluate(() => (window as unknown as { __输: (v: string) => void }).__输(""));
    await page.waitForTimeout(300);
    expect(Math.abs(await 顶(page, ".cli-ck-g") - 起), `${宽} 清空`).toBeLessThanOrEqual(1);
    await page.locator(".home-kpi-card").nth(1).locator(".home-kpi-head").click();
    await page.locator(".home-kpi-body").waitFor();
    await page.waitForTimeout(300);
    expect(Math.abs(await 顶(page, ".cli-ck-g") - 起), `${宽} 展开指标卡`).toBeLessThanOrEqual(1);
    // 展开着再多行输入：还是不动
    await page.evaluate(() => (window as unknown as { __输: (v: string) => void }).__输(Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 行`).join("\n")));
    await page.waitForTimeout(150);
    expect(Math.abs(await 顶(page, ".cli-ck-g") - 起), `${宽} 展开 + 多行`).toBeLessThanOrEqual(1);
  } finally { await page.close(); }
});

/*
  3703 补点（11-22）：销售 1024、还没问、顶部只有 1 行待办，直接展开「暂未跟进」指标卡，整块上移约 19px（2 行待办时 −1.2px）。
  原因：usePinCenter 只把 pointerdown / keydown 算「有人动过」，没有按下那一下的点击（element.click()：读屏、自动化、扩展）
  到来时还按「没人动过」重新居中，卡列变高 → 整块上移半个增量。2 行待办时问答卡比卡列高，展开卡不改这一组的高，所以看不出。
  修：click、input 也算动过。真鼠标点、element.click() 各量一次；1 行待办时这一组确实变高了（钉住生效，不是白量）
*/
it.each([[1, 1024, 768], [1, 1366, 900], [2, 1024, 768], [2, 1366, 900]] as const)("H-新4（顶部 %i 行待办，%i×%i，照 AppShell 外壳）：进页直接展开指标卡（鼠标 / element.click()），卡顶不动（≤1px）", async (行, 宽, 高) => {
  for (const 点法 of ["鼠标", "click()"] as const) {
    const { page } = await 开({ 宽, 高, 待办: 行, 壳: true, 短名: true });
    try {
      expect(await page.locator(".cli-frame .home-cth-todo").count()).toBe(行);
      await page.waitForTimeout(300);
      const 起 = await 顶(page, ".cli-ck-g");
      const 框起 = await 顶(page, ".cli-frame");
      const 组高 = await page.locator(".cli-ck-g").evaluate((e) => e.getBoundingClientRect().height);
      const 头 = page.locator(".home-kpi-card").nth(2).locator(".home-kpi-head");
      const 点 = () => (点法 === "鼠标" ? 头.click() : 头.evaluate((e) => (e as HTMLElement).click()));
      await 点();
      await page.locator(".home-kpi-body").waitFor();
      await page.waitForTimeout(400);
      const 标 = `${行} 行 ${宽}×${高} ${点法}`;
      // 设计语言 D-2 方案 A（11-22）：1366 下右栏指标拉满问答区那么高，展开一张在格里摆得下、这一组不变高；1024（右栏落到下面）才量得出变高
      if (行 === 1 && 宽 === 1024) expect(await page.locator(".cli-ck-g").evaluate((e) => e.getBoundingClientRect().height), `${标} 这一组变高了`).toBeGreaterThan(组高 + 10);
      expect(Math.abs(await 顶(page, ".cli-ck-g") - 起), `${标} 展开`).toBeLessThanOrEqual(1);
      expect(Math.abs(await 顶(page, ".cli-frame") - 框起), `${标} 问答卡顶`).toBeLessThanOrEqual(1);
      await 点();
      await page.waitForTimeout(400);
      expect(Math.abs(await 顶(page, ".cli-ck-g") - 起), `${标} 收起`).toBeLessThanOrEqual(1);
    } finally { await page.close(); }
  }
});

/*
  #408 审查 + 3704 实操（11-22）：上面那条修（click 也算动过）在真实例上没生效——销售 1024、1 行待办，鼠标点和 element.click() 都上移 19px、--ck-nudge 一直 0。
  真因：「顶」记的是进页时量的位置，之后过期。进页后这一组还会挪位（换页淡入那层 transform 收掉、正文上方挂上提示条），
  它自己和外层尺寸都不变，尺寸监听不触发；第一次点开时原顶 ≥ 旧「顶」，走了「重新钉」，--ck-nudge 归 0。
  修：位置改量「这一组相对外层 .cli-ck 的上沿」（上面怎么挪都不算）；第一次动的时候（捕获阶段，早于 React 改状态）先按此刻的位置钉一次再算动过。
  三种「进页后才挪」各量一次：待办行晚到（0 → 1 行）、正文上方晚挂一条提示、换页淡入的 transform 收掉；鼠标 / element.click() 两种点法
*/
it.each([
  ["待办行晚到（0 → 1 行）", { 晚到: true }],
  ["正文上方晚挂一条提示", { 上方: true }],
  ["换页淡入的 transform 收掉", { 进场: true }],
] as const)("H-新4（1024×768，1 行待办）：%s，再展开指标卡，卡顶不动（≤1px）", async (_名, 情形) => {
  for (const 点法 of ["鼠标", "click()"] as const) {
    const { page } = await 开({ 宽: 1024, 高: 768, 待办: 1, 壳: true, 短名: true, 晚到: "晚到" in 情形, 进场: "进场" in 情形 });
    try {
      await page.waitForTimeout(400);
      expect(await page.locator(".cli-frame .home-cth-todo").count()).toBe(1);
      if ("上方" in 情形) await page.evaluate(() => { document.getElementById("above")!.style.height = "40px"; });
      if ("进场" in 情形) await page.evaluate(() => { document.getElementById("wrap")!.style.transform = "none"; });
      await page.waitForTimeout(200);
      const 起 = await 顶(page, ".cli-ck-g");
      const 组高 = await page.locator(".cli-ck-g").evaluate((e) => e.getBoundingClientRect().height);
      const 头 = page.locator(".home-kpi-card").nth(2).locator(".home-kpi-head");
      if (点法 === "鼠标") await 头.click();
      else await 头.evaluate((e) => (e as HTMLElement).click());
      await page.locator(".home-kpi-body").waitFor();
      await page.waitForTimeout(400);
      const 标 = `${_名} ${点法}`;
      expect(await page.locator(".cli-ck-g").evaluate((e) => e.getBoundingClientRect().height), `${标} 这一组变高了`).toBeGreaterThan(组高 + 10);
      expect(Math.abs(await 顶(page, ".cli-ck-g") - 起), `${标} 展开`).toBeLessThanOrEqual(1);
    } finally { await page.close(); }
  }
});
