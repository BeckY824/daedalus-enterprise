/**
 * 录音点评 PR3（11-22）录音面板（components/CoachRecorder/HoldToTalkPanel.tsx，入口 CoachTopics.tsx「发起点评 ▾ → 录音点评」、草稿条「再录一段」）：
 *   - 录音可用时「录音点评」放开（电脑下拉、手机底部选择板），打开面板；开关关着 / 不可用时照旧灰着（ent-coach-topic.ui 钉）
 *   - 按住说话：按下开麦、15 秒一片边录边传（PUT chunk/1/<片>），松手交最后一片 → finish → 待提交（已录 1 段、提交整理）
 *   - 不到 1 秒丢掉（drop，「说话时间太短」）；拖出按钮松手 = 取消（drop，「已取消」）；Esc 取消
 *   - 来电（话筒轨道 ended）= 打断：当作松手，finish 带 { 打断: { 秒, 原因: 来电或话筒被占用 } }，卡上写「被打断」
 *   - 第一次用（权限 prompt）：这一次只拿授权、不录，写「已允许使用麦克风，请重新按住说话」；拒了写怎么打开、不发请求
 *   - 点按录音：点一下开始、再点停；单独「取消」；选过的录法记住（下次打开还是点按）
 *   - 网络断了（片一直 503）：写「网络断了，还有约 N 秒的录音没传上去，联网后自动补传」
 *   - 按住说话 9:30 起「还能说 30 秒」，10:00 自动当松手
 *   - 录不了（没有 MediaRecorder）：只给「传录音文件」「复制链接」
 *   - 飞书里：按住说话走飞书原生录（签名 → config → 授权 → RecorderManager），松手读文件字节按片传，sourceKind 飞书原生录；飞书来电打断照样记
 *   - 草稿条：录的待提交卡写打断、「再录一段」→ 面板「按住 再补一段」→ resume、第 2 段的片、finish
 *   - 手机 390：选择板「录音点评」能点；面板从底部升起，按钮 ≥88 高、不横向撑出
 *   - PR3 审查：点按录音 Esc 不管用、「取消」先问再丢；「准备中」关面板不开麦；空格只在焦点在录音按钮 / 面板上时录；
 *     飞书原生录中途没给文件 → 这一页改走网页录；补段沿用第一段的录法、录法切换锁住
 * 麦克风、MediaRecorder、飞书 tt / h5sdk、网络都用页面里的假的（记下每次请求）。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const plugin: Plugin = { name: "coach-rec-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){window.__刷=(window.__刷??0)+1},push(){}});");
  stub(/coach-topic-actions$/, "export const 发主题动作=async()=>({ok:true});export const 回复主题动作=async()=>({ok:true});export const 关闭主题动作=async()=>({ok:true});export const 删主题动作=async()=>({ok:true});");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';
    import CoachTopics,{StartReviewButton} from '@/app/(app)/projects/[id]/CoachTopics';
    import {忙数} from '@/lib/swap-guard';window.__忙数=忙数;
    const root=createRoot(document.getElementById('root'));
    const 基=(录音)=>({们:[],能发:true,填写人:{id:'u1',name:'教练',身份:'销售教练'},负责人:{id:'u2',name:'负责人'},项目名:'项目一',当前节点:'线索验证',待回复数:0,冻结:false,...(录音?{录音:{可录:true,...录音}}:{})});
    window.__render=(what,录音)=>root.render(<App><div className="card-like" style={{maxWidth:'min(560px, calc(100vw - 32px))',margin:'0 auto',padding:16,border:'1px solid #ddd'}}>{
      what==='form'?<StartReviewButton 数据={基(录音)} projectId='p1'/>:<CoachTopics 数据={基(录音)} projectId='p1'/>
    }</div></App>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

type 页 = Record<string, unknown> & { __请求: string[]; __体: Record<string, unknown>; __权限: string; __片大小: number; __断网: boolean; __拒: boolean; __轨: EventTarget[]; __录: Record<string, unknown> | null; __飞书: Record<string, unknown> };
/** 页面里的假麦克风、假 MediaRecorder、假服务器 */
const 假环境 = ([不能录]: [boolean]) => {
  const w = window as unknown as 页;
  w.__请求 = [];
  w.__体 = {};
  w.__权限 = "granted";
  w.__片大小 = 3000;
  w.__断网 = false;
  w.__拒 = false;
  w.__轨 = [];
  w.__录 = null;
  class 轨 extends EventTarget { kind = "audio"; stop() { (w as Record<string, unknown>).__停轨 = ((w.__停轨 as number) ?? 0) + 1; } }
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => {
    // __权限慢：问权限卡住，等测试 __放权限()（模拟「准备中」）
    if (w.__权限慢) await new Promise<void>((ok) => { (w as Record<string, unknown>).__放权限 = ok; });
    return { state: w.__权限 };
  } } });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => {
    (w as Record<string, unknown>).__开麦 = ((w.__开麦 as number) ?? 0) + 1;
    if (w.__拒) throw new DOMException("no", "NotAllowedError");
    const t = new 轨();
    w.__轨.push(t);
    return { getTracks: () => [t], getAudioTracks: () => [t] };
  } } });
  (window as unknown as { AudioContext?: unknown }).AudioContext = undefined;
  if (不能录) (window as unknown as { MediaRecorder?: unknown }).MediaRecorder = undefined;
  else {
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = class {
      static isTypeSupported(t: string) { return t === "audio/mp4"; }
      state = "inactive"; mimeType = "audio/mp4"; ondataavailable: ((e: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null; onerror: (() => void) | null = null; 钟 = 0;
      start(ms: number) { this.state = "recording"; this.钟 = window.setInterval(() => this.ondataavailable?.({ data: new Blob([new Uint8Array(w.__片大小)]) }), ms); }
      stop() { clearInterval(this.钟); this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(500)]) }); queueMicrotask(() => this.onstop?.()); }
    };
  }
  const 回 = (状态: number, 体: unknown) => new Response(JSON.stringify(体), { status: 状态, headers: { "content-type": "application/json" } });
  const 片们: { 段: number; 片: number }[] = [];
  window.fetch = (async (url: string, init?: RequestInit) => {
    const 法 = init?.method ?? "GET";
    w.__请求.push(`${法} ${url}`);
    if (url.startsWith("/api/feishu/jsapi-sign")) return 回(200, { appId: "cli_test", timestamp: 1, nonceStr: "n", signature: "s" });
    if (url === "/api/coach-rec/start") {
      // __start慢：松手之后才让 start 失败（503），模拟「用户已松手、开始录音请求才失败」
      if (w.__start慢) { await new Promise<void>((ok) => { (w as Record<string, unknown>).__放start = ok; }); return 回(503, { error: "忙" }); }
      const b = JSON.parse(String(init!.body));
      w.__体.start = b;
      w.__录 = { id: "crec1", status: "上传中", sourceKind: b.sourceKind, 文件名: null, 总字节: null, 已收字节: 0, 已收片: [], 格式: null, 开始于: "", 更新于: "1", 能听: false, 时长毫秒: null, 段数: 0, 打断们: [], 能补: false, 错: null };
      return 回(200, { ok: true, 录音: w.__录 });
    }
    const m = /\/api\/coach-rec\/([^/]+)\/chunk\/(\d+)\/(\d+)$/.exec(url);
    if (m) {
      if (w.__断网) return 回(503, { error: "忙" });
      if (w.__拒段 === Number(m[2])) return 回(415, { error: "这一段和前面录的格式不一样" });
      片们.push({ 段: Number(m[2]), 片: Number(m[3]) });
      return 回(200, { ok: true });
    }
    const id = url.split("/")[3];
    if (url.endsWith("/resume")) { w.__录 = { ...(w.__录 ?? (w.__草稿 as Record<string, unknown>)), id, status: "上传中" }; return 回(200, { ok: true, 录音: w.__录 }); }
    if (url.endsWith("/finish")) {
      const b = JSON.parse(String(init?.body ?? "{}"));
      w.__体.finish = b;
      const 段数 = Math.max(...片们.map((x) => x.段));
      const 打断们 = [...((w.__录?.打断们 as unknown[]) ?? []), ...(b.打断 ? [{ 段: 段数, ...b.打断 }] : [])];
      w.__录 = { ...w.__录, id, status: "待提交", 段数, 打断们, 能补: true, 能听: true, 时长毫秒: 段数 * 5000 };
      return 回(200, { ok: true, 录音: w.__录 });
    }
    if (url.endsWith("/drop")) {
      const 段数 = (w.__录?.段数 as number) ?? 0;
      w.__录 = 段数 ? { ...w.__录, status: "待提交" } : null;
      return 回(200, { ok: true, 录音: w.__录 });
    }
    if (url.endsWith("/submit")) return 回(200, { ok: true, 录音: { ...w.__录, status: "转写中" } });
    if (url.endsWith("/abandon")) return 回(200, { ok: true });
    return 回(404, { error: "没有" });
  }) as typeof fetch;
};
/** 假飞书：签名 → config → 授权 → RecorderManager；松手 onStop 给临时文件，readFile 给 n 字节 */
const 假飞书 = () => {
  const w = window as unknown as 页;
  const 回调: Record<string, (x?: unknown) => void> = {};
  w.__飞书 = { 开始: 0, 停: 0 };
  (window as unknown as Record<string, unknown>).h5sdk = { config: (o: { onSuccess: () => void }) => setTimeout(() => o.onSuccess(), 0) };
  (window as unknown as Record<string, unknown>).tt = {
    authorize: (o: { success: () => void }) => o.success(),
    getRecorderManager: () => ({
      start: () => { (w.__飞书.开始 as number)++; },
      stop: () => { (w.__飞书.停 as number)++; setTimeout(() => 回调.stop?.({ tempFilePath: "ttfile://temp/a1.aac" }), 0); },
      onStop: (f: () => void) => { 回调.stop = f; },
      onError: (f: () => void) => { 回调.error = f; },
      onInterruptionBegin: (f: () => void) => { 回调.断 = f; },
      onFrameRecorded: (f: () => void) => { 回调.帧 = f; },
    }),
    getFileSystemManager: () => ({ readFile: (o: { filePath: string; success: (r: { data: ArrayBuffer }) => void; fail: (e: unknown) => void }) => {
      w.__飞书.读 = o.filePath;
      if (w.__飞书坏) o.fail(new Error("坏"));
      else o.success({ data: new ArrayBuffer(12_000) });
    } }),
  };
  (w as Record<string, unknown>).__飞书断 = () => 回调.断?.();
};

async function open(what: "list" | "form", 录音: unknown, opt: { width?: number; 不能录?: boolean; 飞书?: boolean; 假钟?: boolean; 记式?: string } = {}) {
  const page = await browser.newPage({ viewport: { width: opt.width ?? 1280, height: 800 }, ...(opt.飞书 ? { userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Lark/7.30.0 LarkLocale/zh_CN" } : {}) });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://crec.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://crec.test");
  if (opt.假钟) await page.clock.install();
  if (opt.记式) await page.evaluate((x) => localStorage.setItem("crec-rec-mode", x), opt.记式);
  await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.evaluate(假环境, [!!opt.不能录] as [boolean]);
  if (opt.飞书) await page.evaluate(假飞书);
  await page.evaluate((x) => { (window as unknown as Record<string, unknown>).__草稿 = x; }, (录音 as { 草稿们?: unknown[] } | undefined)?.草稿们?.[0] ?? null);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([w, r]) => (window as unknown as { __render: (x: string, r: unknown) => void }).__render(w as string, r), [what, 录音] as const);
  return { page, errors };
}
const 请求们 = (page: Page) => page.evaluate(() => (window as unknown as 页).__请求.filter((x) => !x.includes("jsapi-sign")));
const 体 = (page: Page) => page.evaluate(() => (window as unknown as 页).__体);
const 开面板 = async (page: Page) => {
  await page.getByTestId("coach-topic-new").click();
  await page.getByTestId("coach-review-voice").click();
  await page.getByTestId("ptt-panel").waitFor();
};
const 按住 = async (page: Page) => {
  const b = (await page.getByTestId("ptt-btn").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  return b;
};
const 等录着 = (page: Page) => page.getByTestId("ptt-float").waitFor();

it("录音可用：下拉「录音点评」能点、第二行写怎么录；打开面板默认「按住说话」，写告知", async () => {
  const { page, errors } = await open("form", { 草稿们: [] });
  await page.getByTestId("coach-topic-new").click();
  const 项 = page.locator(".rec-head-menu .ant-dropdown-menu-item").filter({ hasText: "录音点评" });
  expect(await 项.getAttribute("aria-disabled")).not.toBe("true");
  expect((await 项.innerText()).replace(/\s+/g, " ")).toBe("录音点评 按住说话；长的点一下开始录");
  await page.getByTestId("coach-review-voice").click();
  await page.getByTestId("ptt-panel").waitFor();
  expect(await page.getByTestId("ptt-panel").innerText()).toContain("请先告知在场的人正在录音");
  expect((await page.getByTestId("ptt-btn").innerText()).replace(/\s+/g, "")).toBe("按住说话");
  expect(await page.locator(".ptt-modal .ant-segmented-item-selected").innerText()).toBe("按住说话");
  expect(errors).toEqual([]);
  await page.close();
});

it("按住说话：按下开录、15 秒一片边录边传，松手交最后一片 → 传完 → 待提交（已录 1 段、提交整理）", async () => {
  const { page, errors } = await open("form", { 草稿们: [] }, { 假钟: true });
  await 开面板(page);
  await 按住(page);
  await 等录着(page);
  await page.clock.runFor(31_000);
  expect(await page.getByTestId("ptt-time").innerText()).toMatch(/^0:3[01]$/);
  expect((await page.getByTestId("ptt-btn").innerText()).replace(/\s+/g, "")).toBe("松开结束");
  await page.mouse.up();
  await page.getByTestId("ptt-pending").waitFor();
  expect(await 请求们(page)).toEqual(["POST /api/coach-rec/start", "PUT /api/coach-rec/crec1/chunk/1/0", "PUT /api/coach-rec/crec1/chunk/1/1", "PUT /api/coach-rec/crec1/chunk/1/2", "POST /api/coach-rec/crec1/finish"]);
  expect((await 体(page)).start).toEqual({ projectId: "p1", sourceKind: "网页录" });
  expect((await 体(page)).finish).toEqual({});
  expect(await page.getByTestId("ptt-pending").innerText()).toContain("已录 1 段");
  expect((await page.getByTestId("ptt-btn").innerText()).replace(/\s+/g, "")).toBe("按住再补一段");
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__停轨)).toBe(1); // 松手就关麦克风
  await page.getByTestId("ptt-submit").click();
  await page.waitForFunction(() => (window as unknown as 页).__请求.includes("POST /api/coach-rec/crec1/submit"));
  expect(errors).toEqual([]);
  await page.close();
});

it("不到 1 秒丢掉（drop、「说话时间太短」）；拖出按钮松手 = 取消；Esc 取消", async () => {
  const { page, errors } = await open("form", { 草稿们: [] });
  await 开面板(page);
  await 按住(page);
  await 等录着(page);
  await page.mouse.up();
  await page.getByTestId("ptt-tip").filter({ hasText: "说话时间太短" }).waitFor();
  await page.waitForFunction(() => (window as unknown as 页).__请求.includes("POST /api/coach-rec/crec1/drop"));
  expect(await page.getByTestId("ptt-pending").count()).toBe(0);
  // 拖出按钮：松手取消
  const b = await 按住(page);
  await 等录着(page);
  await page.waitForTimeout(1100);
  await page.mouse.move(b.x + b.width / 2, b.y - 100, { steps: 4 });
  expect((await page.getByTestId("ptt-btn").innerText()).replace(/\s+/g, "")).toBe("松手取消");
  await page.mouse.up();
  await page.getByTestId("ptt-tip").filter({ hasText: "已取消" }).waitFor();
  // Esc 取消
  await 按住(page);
  await 等录着(page);
  await page.waitForTimeout(1100);
  await page.keyboard.press("Escape");
  await page.getByTestId("ptt-tip").filter({ hasText: "已取消" }).waitFor();
  await page.mouse.up();
  expect(await page.getByTestId("ptt-panel").isVisible()).toBe(true); // Esc 不关面板
  expect((await 请求们(page)).filter((x) => x.endsWith("/finish"))).toEqual([]);
  expect((await 请求们(page)).filter((x) => x.endsWith("/drop")).length).toBe(3);
  expect(errors).toEqual([]);
  await page.close();
});

it("来电打断（话筒轨道 ended）：当作松手，传完带打断、卡上写被打断；之后能按住再补一段（resume、第 2 段）", async () => {
  const { page, errors } = await open("form", { 草稿们: [] });
  await 开面板(page);
  await 按住(page);
  await 等录着(page);
  await page.waitForTimeout(1200);
  await page.evaluate(() => (window as unknown as 页).__轨[0].dispatchEvent(new Event("ended")));
  await page.getByTestId("ptt-pending").waitFor();
  await page.mouse.up();
  const f = (await 体(page)).finish as { 打断: { 秒: number; 原因: string } };
  expect(f.打断.原因).toBe("来电或话筒被占用");
  expect(f.打断.秒).toBeGreaterThanOrEqual(1);
  expect(await page.getByTestId("ptt-tip").innerText()).toMatch(/^录音在 0:0\d 被打断（来电或话筒被占用），已录部分已保存/);
  expect(await page.getByTestId("ptt-interrupted").innerText()).toContain("被打断（来电或话筒被占用）");
  // 再按住补一段
  await 按住(page);
  await 等录着(page);
  await page.waitForTimeout(1100);
  await page.mouse.up();
  await page.waitForFunction(() => (window as unknown as 页).__请求.filter((x) => x.endsWith("/finish")).length === 2);
  const 后 = (await 请求们(page)).slice(-3);
  expect(后).toEqual(["POST /api/coach-rec/crec1/resume", "PUT /api/coach-rec/crec1/chunk/2/0", "POST /api/coach-rec/crec1/finish"]);
  await page.getByTestId("ptt-pending").filter({ hasText: "已录 2 段" }).waitFor();
  expect(errors).toEqual([]);
  await page.close();
});

it("第一次用（权限 prompt）：这一次只拿授权、不录；拒了写怎么打开、不发请求", async () => {
  const { page, errors } = await open("form", { 草稿们: [] });
  await 开面板(page);
  await page.evaluate(() => { (window as unknown as 页).__权限 = "prompt"; });
  await 按住(page);
  await page.getByTestId("ptt-tip").filter({ hasText: "已允许使用麦克风，请重新按住说话" }).waitFor();
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__开麦)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__停轨)).toBe(1);
  expect(await 请求们(page)).toEqual([]);
  await page.evaluate(() => { const w = window as unknown as 页; w.__权限 = "denied"; w.__拒 = true; });
  await 按住(page);
  await page.getByTestId("ptt-tip").filter({ hasText: "麦克风没被允许" }).waitFor();
  await page.mouse.up();
  expect(await page.getByTestId("ptt-tip").innerText()).toContain("地址栏左边的锁形图标");
  expect(await 请求们(page)).toEqual([]);
  expect(errors).toEqual([]);
  await page.close();
});

it("点按录音：点一下开始、再点停；单独「取消」；选过的录法记住", async () => {
  const { page, errors } = await open("form", { 草稿们: [] });
  await 开面板(page);
  await page.locator(".ptt-modal .ant-segmented-item").filter({ hasText: "点按录音" }).click();
  expect(await page.evaluate(() => localStorage.getItem("crec-rec-mode"))).toBe("点按");
  expect((await page.getByTestId("ptt-btn").innerText()).replace(/\s+/g, "")).toBe("点击开始录音");
  expect(await page.getByTestId("ptt-panel").innerText()).toContain("一条最长 2 小时");
  await page.getByTestId("ptt-btn").click();
  await 等录着(page);
  await page.getByTestId("ptt-cancel").waitFor();
  await page.waitForTimeout(1100);
  await page.getByTestId("ptt-btn").click();
  await page.getByTestId("ptt-pending").waitFor();
  expect((await 请求们(page)).at(-1)).toBe("POST /api/coach-rec/crec1/finish");
  // 再点一段、点「取消」：这段丢掉，前面的段留着
  await page.getByTestId("ptt-btn").click();
  await 等录着(page);
  await page.waitForTimeout(1100);
  await page.getByTestId("ptt-cancel").click();
  await page.getByTestId("ptt-cancel-ok").click();
  await page.getByTestId("ptt-tip").filter({ hasText: "已取消" }).waitFor();
  expect((await 请求们(page)).slice(-2)).toEqual(["POST /api/coach-rec/crec1/resume", "POST /api/coach-rec/crec1/drop"]);
  await page.getByTestId("ptt-pending").filter({ hasText: "已录 1 段" }).waitFor();
  await page.close();
  // 下次打开还是点按
  const 二 = await open("form", { 草稿们: [] }, { 记式: "点按" });
  await 开面板(二.page);
  expect((await 二.page.getByTestId("ptt-btn").innerText()).replace(/\s+/g, "")).toBe("点击开始录音");
  expect(errors).toEqual([]);
  expect(二.errors).toEqual([]);
  await 二.page.close();
});

it("PR3 审查：点按录音 Esc 不管用；点「取消」先问，「接着录」不丢、照常录，「丢掉」才丢", async () => {
  const { page, errors } = await open("form", { 草稿们: [] }, { 记式: "点按" });
  await 开面板(page);
  await page.getByTestId("ptt-btn").click();
  await 等录着(page);
  await page.waitForTimeout(1100);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  expect(await page.getByTestId("ptt-float").isVisible()).toBe(true); // 还在录
  expect(await page.getByTestId("ptt-panel").isVisible()).toBe(true);
  await page.getByTestId("ptt-cancel").click();
  expect(await page.getByTestId("ptt-cancel-ask").innerText()).toContain("丢掉正在录的这段？");
  await page.getByTestId("ptt-cancel-no").click();
  expect(await page.getByTestId("ptt-cancel-ask").count()).toBe(0);
  expect(await page.getByTestId("ptt-float").isVisible()).toBe(true);
  expect((await 请求们(page)).filter((x) => x.endsWith("/drop"))).toEqual([]);
  // 问着的时候点停：照常存下，问的那条收起
  await page.getByTestId("ptt-cancel").click();
  await page.getByTestId("ptt-btn").click();
  await page.getByTestId("ptt-pending").waitFor();
  expect(await page.getByTestId("ptt-cancel-ask").count()).toBe(0);
  expect((await 请求们(page)).at(-1)).toBe("POST /api/coach-rec/crec1/finish");
  // 补一段，取消 → 丢掉
  await page.getByTestId("ptt-btn").click();
  await 等录着(page);
  await page.getByTestId("ptt-cancel").click();
  await page.getByTestId("ptt-cancel-ok").click();
  await page.getByTestId("ptt-tip").filter({ hasText: "已取消" }).waitFor();
  expect((await 请求们(page)).filter((x) => x.endsWith("/drop")).length).toBe(1);
  expect(errors).toEqual([]);
  await page.close();
});

it("PR3 审查：「准备中」面板关了 → 中止，不开麦克风、不发开始请求", async () => {
  const { page, errors } = await open("form", { 草稿们: [] });
  await 开面板(page);
  await page.evaluate(() => { (window as unknown as 页).__权限慢 = true; });
  await 按住(page);
  await page.waitForFunction(() => typeof (window as unknown as Record<string, unknown>).__放权限 === "function");
  expect((await page.getByTestId("ptt-btn").innerText()).replace(/\s+/g, "")).toBe("准备中…");
  await page.locator(".ptt-modal .ant-modal-close").dispatchEvent("click"); // 准备中点 × 关面板
  await page.getByTestId("ptt-panel").waitFor({ state: "detached" });
  await page.evaluate(() => (window as unknown as { __放权限: () => void }).__放权限());
  await page.waitForTimeout(300);
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__开麦 ?? 0)).toBe(0);
  expect(await 请求们(page)).toEqual([]);
  expect(errors).toEqual([]);
  await page.close();
});

it("PR3 审查：空格只在焦点在录音按钮 / 面板上时录；焦点在别的按钮上不拦", async () => {
  const 草稿 = { id: "crec9", status: "待提交", sourceKind: "网页录", 文件名: null, 总字节: 9000, 已收字节: 9000, 已收片: [], 格式: "m4a", 开始于: "", 更新于: "1", 能听: true, 时长毫秒: 5000, 段数: 1, 打断们: [], 能补: true, 错: null };
  const { page, errors } = await open("list", { 草稿们: [草稿] });
  await page.getByTestId("crec-add-seg").click();
  await page.getByTestId("ptt-panel").waitFor();
  // 打开时焦点在面板上：按住空格就录
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "ptt-panel" || !!document.activeElement?.closest(".ptt-modal"));
  await page.keyboard.down("Space");
  await 等录着(page);
  await page.waitForTimeout(1100);
  await page.keyboard.up("Space");
  await page.waitForFunction(() => (window as unknown as 页).__请求.some((x) => x.endsWith("/finish")));
  const 前 = (await 请求们(page)).length;
  // 焦点在「删掉」按钮上：空格是点这个按钮，不录
  await page.getByTestId("ptt-delete").focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(300);
  await page.keyboard.up("Space");
  await page.getByRole("group", { name: "放弃这段录音？" }).waitFor();
  expect(await page.getByTestId("ptt-float").count()).toBe(0);
  expect((await 请求们(page)).length).toBe(前);
  // 焦点在录音按钮上：按住空格录
  await page.getByTestId("ptt-btn").focus();
  await page.keyboard.down("Space");
  await 等录着(page);
  await page.waitForTimeout(1100);
  await page.keyboard.up("Space");
  await page.waitForFunction(() => (window as unknown as 页).__请求.filter((x) => x.endsWith("/finish")).length === 2);
  expect(errors).toEqual([]);
  await page.close();
});

it("网络断了（片一直 503）：写「网络断了，还有约 N 秒的录音没传上去，联网后自动补传」；网好了补传、传完", async () => {
  const { page, errors } = await open("form", { 草稿们: [] }, { 假钟: true });
  await 开面板(page);
  await page.evaluate(() => { const w = window as unknown as 页; w.__断网 = true; w.__片大小 = 45_000; });
  await 按住(page);
  await 等录着(page);
  await page.clock.runFor(31_000);
  await page.getByTestId("ptt-slow").waitFor();
  expect(await page.getByTestId("ptt-slow").innerText()).toMatch(/^网络断了，还有约 \d+ 秒的录音没传上去，联网后自动补传，先别关页面$/);
  await page.evaluate(() => { (window as unknown as 页).__断网 = false; });
  await page.mouse.up();
  await page.clock.runFor(20_000);
  await page.getByTestId("ptt-pending").waitFor();
  expect(await page.getByTestId("ptt-slow").count()).toBe(0);
  const 片 = (await 请求们(page)).filter((x) => x.includes("/chunk/"));
  expect(new Set(片)).toEqual(new Set(["PUT /api/coach-rec/crec1/chunk/1/0", "PUT /api/coach-rec/crec1/chunk/1/1", "PUT /api/coach-rec/crec1/chunk/1/2"]));
  expect(errors).toEqual([]);
  await page.close();
});

it("按住说话 9:30 起「还能说 30 秒」，10:00 自动当松手、写已到上限", async () => {
  const { page, errors } = await open("form", { 草稿们: [] }, { 假钟: true });
  await 开面板(page);
  await 按住(page);
  await 等录着(page);
  await page.clock.runFor(571_000);
  expect(await page.getByTestId("ptt-float").innerText()).toMatch(/还能说 (29|30) 秒/);
  await page.clock.runFor(30_000);
  await page.getByTestId("ptt-pending").waitFor();
  expect(await page.getByTestId("ptt-tip").innerText()).toBe("单次最长 10 分钟，已到上限");
  await page.mouse.up();
  expect((await 请求们(page)).filter((x) => x.endsWith("/finish")).length).toBe(1);
  expect(errors).toEqual([]);
  await page.close();
});

it("录不了（没有 MediaRecorder）：只给「传录音文件」「复制链接」；点传录音文件打开传文件框", async () => {
  const { page, errors } = await open("form", { 草稿们: [] }, { 不能录: true });
  await 开面板(page);
  await page.getByTestId("ptt-fallback").waitFor();
  expect(await page.getByTestId("ptt-btn").count()).toBe(0);
  await page.getByTestId("ptt-fallback").getByRole("button", { name: "传录音文件" }).click();
  await page.getByTestId("crec-upload").waitFor();
  expect(errors).toEqual([]);
  await page.close();
});

it("飞书里：按住说话走飞书原生录（签名、config、授权），松手读文件按片传，sourceKind 飞书原生录；飞书来电打断照样记", async () => {
  const { page, errors } = await open("form", { 草稿们: [] }, { 飞书: true });
  await 开面板(page);
  await page.waitForFunction(() => (window as unknown as 页).__请求.some((x) => x.startsWith("GET /api/feishu/jsapi-sign")));
  await 按住(page);
  await 等录着(page);
  await page.waitForTimeout(1100);
  await page.mouse.up();
  await page.getByTestId("ptt-pending").waitFor();
  expect((await 体(page)).start).toEqual({ projectId: "p1", sourceKind: "飞书原生录" });
  expect(await 请求们(page)).toEqual(["POST /api/coach-rec/start", "PUT /api/coach-rec/crec1/chunk/1/0", "POST /api/coach-rec/crec1/finish"]);
  expect(await page.evaluate(() => (window as unknown as 页).__飞书)).toMatchObject({ 开始: 1, 停: 1, 读: "ttfile://temp/a1.aac" });
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__开麦 ?? 0)).toBe(0); // 没走网页麦克风
  // 飞书来电打断
  await 按住(page);
  await 等录着(page);
  await page.waitForTimeout(1100);
  await page.evaluate(() => (window as unknown as { __飞书断: () => void }).__飞书断());
  await page.waitForFunction(() => (window as unknown as 页).__请求.filter((x) => x.endsWith("/finish")).length === 2);
  await page.mouse.up();
  expect(((await 体(page)).finish as { 打断: { 原因: string } }).打断.原因).toBe("来电或话筒被占用");
  expect(errors).toEqual([]);
  await page.close();
});

it("PR3 审查：飞书原生录中途没给文件 → 这段丢掉，这一页之后改走网页录，不再走原生", async () => {
  const { page, errors } = await open("form", { 草稿们: [] }, { 飞书: true });
  await 开面板(page);
  await page.evaluate(() => { (window as unknown as 页).__飞书坏 = true; });
  await 按住(page);
  await 等录着(page);
  await page.waitForTimeout(1100);
  await page.mouse.up();
  await page.getByTestId("ptt-tip").filter({ hasText: "再按住一次会改用网页录" }).waitFor();
  expect((await 请求们(page)).at(-1)).toBe("POST /api/coach-rec/crec1/drop");
  await page.evaluate(() => { (window as unknown as 页).__飞书坏 = false; }); // 飞书好了也不再试原生（这一页记着）
  await 按住(page);
  await 等录着(page);
  await page.waitForTimeout(1100);
  await page.mouse.up();
  await page.getByTestId("ptt-pending").waitFor();
  expect((await 体(page)).start).toEqual({ projectId: "p1", sourceKind: "网页录" });
  expect(await page.evaluate(() => (window as unknown as 页).__飞书)).toMatchObject({ 开始: 1 });
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__开麦)).toBe(1);
  expect(errors).toEqual([]);
  await page.close();
});

it("PR3 审查：补段沿用第一段的录法——网页录的在飞书里补也走网页录（按住 / 点按不锁）；飞书原生录的锁按住、走飞书", async () => {
  const 草稿 = (sourceKind: string) => ({ id: "crec9", status: "待提交", sourceKind, 文件名: null, 总字节: 9000, 已收字节: 9000, 已收片: [], 格式: "m4a", 开始于: "", 更新于: "1", 能听: true, 时长毫秒: 5000, 段数: 1, 打断们: [], 能补: true, 错: null });
  const 一 = await open("list", { 草稿们: [草稿("网页录")] }, { 飞书: true });
  await 一.page.getByTestId("crec-add-seg").click();
  await 一.page.getByTestId("ptt-panel").waitFor();
  expect(await 一.page.locator(".ptt-modal .ant-segmented").getAttribute("class")).not.toContain("ant-segmented-disabled");
  await 按住(一.page);
  await 等录着(一.page);
  await 一.page.waitForTimeout(1100);
  await 一.page.mouse.up();
  await 一.page.waitForFunction(() => (window as unknown as 页).__请求.some((x) => x.endsWith("/finish")));
  expect(await 一.page.evaluate(() => (window as unknown as 页).__飞书)).toMatchObject({ 开始: 0 });
  expect(await 一.page.evaluate(() => (window as unknown as Record<string, number>).__开麦)).toBe(1);
  expect(一.errors).toEqual([]);
  await 一.page.close();

  // 飞书原生录的草稿：上次选的是点按也锁成按住、走飞书
  const 二 = await open("list", { 草稿们: [草稿("飞书原生录")] }, { 飞书: true, 记式: "点按" });
  await 二.page.getByTestId("crec-add-seg").click();
  await 二.page.getByTestId("ptt-panel").waitFor();
  expect((await 二.page.getByTestId("ptt-btn").innerText()).replace(/\s+/g, "")).toBe("按住再补一段");
  expect(await 二.page.locator(".ptt-modal .ant-segmented").getAttribute("class")).toContain("ant-segmented-disabled");
  await 按住(二.page);
  await 等录着(二.page);
  await 二.page.waitForTimeout(1100);
  await 二.page.mouse.up();
  await 二.page.waitForFunction(() => (window as unknown as 页).__请求.some((x) => x.endsWith("/finish")));
  expect(await 二.page.evaluate(() => (window as unknown as 页).__飞书)).toMatchObject({ 开始: 1 });
  expect(await 二.page.evaluate(() => (window as unknown as Record<string, number>).__开麦 ?? 0)).toBe(0);
  expect(await 请求们(二.page)).toEqual(["POST /api/coach-rec/crec9/resume", "PUT /api/coach-rec/crec9/chunk/2/0", "POST /api/coach-rec/crec9/finish"]);
  expect(二.errors).toEqual([]);
  await 二.page.close();
});

it("PR3 二审：补段传片被拒（415）→ 丢掉这段、退回待提交，前面的段留着，能接着提交", async () => {
  const 草稿 = { id: "crec9", status: "待提交", sourceKind: "网页录", 文件名: null, 总字节: 9000, 已收字节: 9000, 已收片: [], 格式: "m4a", 开始于: "", 更新于: "1", 能听: true, 时长毫秒: 5000, 段数: 1, 打断们: [], 能补: true, 错: null };
  const { page, errors } = await open("list", { 草稿们: [草稿] });
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__拒段 = 2; });
  await page.getByTestId("crec-add-seg").click();
  await page.getByTestId("ptt-panel").waitFor();
  await 按住(page);
  await 等录着(page);
  await page.waitForTimeout(1100);
  await page.mouse.up();
  await page.getByTestId("ptt-tip").filter({ hasText: "这一段录音没传上，前面录的还在" }).waitFor();
  expect(await page.getByTestId("ptt-tip").innerText()).toBe("这一段录音没传上，前面录的还在（和前面录的格式不一样）");
  expect(await 请求们(page)).toEqual(["POST /api/coach-rec/crec9/resume", "PUT /api/coach-rec/crec9/chunk/2/0", "POST /api/coach-rec/crec9/drop"]);
  await page.getByTestId("ptt-pending").filter({ hasText: "已录 1 段" }).waitFor();
  expect(await page.getByTestId("ptt-pending").getAttribute("data-status")).toBe("待提交");
  await page.getByTestId("ptt-submit").click();
  await page.waitForFunction(() => (window as unknown as 页).__请求.includes("POST /api/coach-rec/crec9/submit"));
  expect(errors).toEqual([]);
  await page.close();
});

it("PR3 二审：网页录第一段点按录了 30 分钟，补段默认按住超了 10 分钟 → 提示改用点按；切到点按能接着录", async () => {
  const 草稿 = { id: "crec9", status: "待提交", sourceKind: "网页录", 文件名: null, 总字节: 9000, 已收字节: 9000, 已收片: [], 格式: "m4a", 开始于: "", 更新于: "1", 能听: true, 时长毫秒: 30 * 60_000, 段数: 1, 打断们: [], 能补: true, 错: null };
  const { page, errors } = await open("list", { 草稿们: [草稿] });
  await page.getByTestId("crec-add-seg").click();
  await page.getByTestId("ptt-panel").waitFor();
  await 按住(page);
  await page.getByTestId("ptt-tip").filter({ hasText: "改用「点按录音」接着录" }).waitFor();
  await page.mouse.up();
  await page.locator(".ptt-modal .ant-segmented-item").filter({ hasText: "点按录音" }).click();
  await page.getByTestId("ptt-btn").click();
  await 等录着(page);
  await page.waitForTimeout(1100);
  await page.getByTestId("ptt-btn").click();
  await page.waitForFunction(() => (window as unknown as 页).__请求.some((x) => x.endsWith("/finish")));
  expect(await 请求们(page)).toEqual(["POST /api/coach-rec/crec9/resume", "PUT /api/coach-rec/crec9/chunk/2/0", "POST /api/coach-rec/crec9/finish"]);
  expect(errors).toEqual([]);
  await page.close();
});

it("草稿条：录的待提交卡写打断、「再录一段」→ 面板「按住 再补一段」→ resume、第 2 段、finish", async () => {
  const 草稿 = { id: "crec9", status: "待提交", sourceKind: "网页录", 文件名: null, 总字节: 9000, 已收字节: 9000, 已收片: [], 格式: "m4a", 开始于: "", 更新于: "1", 能听: true, 时长毫秒: 42_000, 段数: 1, 打断们: [{ 段: 1, 秒: 42, 原因: "锁屏或切到后台" }], 能补: true, 错: null };
  const { page, errors } = await open("list", { 草稿们: [草稿] });
  await page.getByTestId("crec-pending").waitFor();
  expect(await page.getByTestId("crec-interrupted").innerText()).toBe("录音在 0:42 被打断（锁屏或切到后台），已录部分已保存");
  expect(await page.locator(".crec-pending .crec-file-name").innerText()).toBe("录音");
  await page.getByTestId("crec-add-seg").click();
  await page.getByTestId("ptt-panel").waitFor();
  expect((await page.getByTestId("ptt-btn").innerText()).replace(/\s+/g, "")).toBe("按住再补一段");
  await 按住(page);
  await 等录着(page);
  expect(await page.getByTestId("ptt-time").innerText()).toBe("0:42"); // 接着前面的时长算
  await page.waitForTimeout(1100);
  await page.mouse.up();
  await page.waitForFunction(() => (window as unknown as 页).__请求.some((x) => x.endsWith("/finish")));
  expect(await 请求们(page)).toEqual(["POST /api/coach-rec/crec9/resume", "PUT /api/coach-rec/crec9/chunk/2/0", "POST /api/coach-rec/crec9/finish"]);
  expect(errors).toEqual([]);
  await page.close();
});

it("草稿条：录着页面关了留下的「上传中」录音写已传多少、给「保存已传的」（这一段有片 → finish）和删掉", async () => {
  const 半 = { id: "crec8", status: "上传中", sourceKind: "网页录", 文件名: null, 总字节: null, 已收字节: 6000, 已收片: [{ 段: 1, 片: 0, 字节: 3000 }, { 段: 1, 片: 1, 字节: 3000 }], 格式: "m4a", 开始于: "", 更新于: "1", 能听: false, 时长毫秒: null, 段数: 0, 打断们: [], 能补: false, 错: null };
  const { page, errors } = await open("list", { 草稿们: [半] });
  expect(await page.getByTestId("crec-rec-left").innerText()).toBe("上次录音没传完（页面关了或断网），已传上去 6KB");
  expect(await page.getByTestId("crec-continue").count()).toBe(0); // 不是「重新选同一个文件」
  await page.getByTestId("crec-save-left").click();
  await page.waitForFunction(() => (window as unknown as 页).__请求.includes("POST /api/coach-rec/crec8/finish"));
  expect(errors).toEqual([]);
  await page.close();
});

it("手机 390：选择板「录音点评」能点；面板从底部升起，按钮 ≥88 高、点得中、不横向撑出", async () => {
  const { page, errors } = await open("form", { 草稿们: [] }, { width: 390 });
  // 手机上一下都不该挂出电脑那种弹框（头一次渲染断点还没读到时也不行）
  await page.evaluate(() => {
    const w = window as unknown as { __见过弹框: boolean };
    w.__见过弹框 = false;
    new MutationObserver(() => { if (document.querySelector(".ptt-modal")) w.__见过弹框 = true; }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByTestId("coach-topic-new").click();
  await page.getByTestId("coach-review-sheet").waitFor();
  const 录 = page.getByTestId("coach-review-sheet").getByTestId("coach-review-voice");
  expect(await 录.isDisabled()).toBe(false);
  await 录.click();
  await page.getByTestId("ptt-panel").waitFor();
  expect(await page.locator(".ant-drawer-bottom .ptt-panel").count()).toBe(1);
  const 高 = Math.round((await page.getByTestId("ptt-btn").boundingBox())!.height);
  expect(高).toBeGreaterThanOrEqual(88);
  // 底部升起有动画：等它停稳再量
  await expect.poll(() => page.evaluate(() => { const b = document.querySelector(".ptt-btn")!.getBoundingClientRect(); return b.bottom <= window.innerHeight; }), { timeout: 3000 }).toBe(true);
  await page.waitForTimeout(400);
  // 通栏贴底、左右贴边、上边两角圆（同名单抽屉）；标题、内容左右留一样的边（11-26，3704 实操 390 宽看着不居中）
  const 形 = await page.evaluate(() => {
    const w = document.querySelector(".ptt-sheet .ant-drawer-content-wrapper")!.getBoundingClientRect();
    const p = document.querySelector(".ptt-panel")!.getBoundingClientRect();
    const t = document.querySelector(".ptt-sheet .ant-drawer-header-title")!.getBoundingClientRect();
    const 角 = getComputedStyle(document.querySelector(".ptt-sheet .ant-drawer-content-wrapper")!);
    return { 左: Math.round(w.left), 右: Math.round(window.innerWidth - w.right), 底: Math.round(window.innerHeight - w.bottom),
      内左: Math.round(p.left - w.left), 内右: Math.round(w.right - p.right), 题左: Math.round(t.left - w.left),
      上角: 角.borderTopLeftRadius, 下角: 角.borderBottomLeftRadius, 弹框: (window as unknown as { __见过弹框: boolean }).__见过弹框 };
  });
  expect(形).toEqual({ 左: 0, 右: 0, 底: 0, 内左: 16, 内右: 16, 题左: 16, 上角: "14px", 下角: "0px", 弹框: false });
  const 坏 = await page.evaluate(() => {
    const x: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) x.push("页面横向撑出");
    for (const el of document.querySelectorAll<HTMLElement>(".ptt-panel, .ptt-row, .ant-drawer-body")) if (el.scrollWidth > el.clientWidth + 1) x.push(el.className);
    const b = document.querySelector(".ptt-btn")!.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    if (!hit?.closest(".ptt-btn") || b.bottom > window.innerHeight) x.push(`按钮点不中 ${Math.round(b.top)}-${Math.round(b.bottom)} / ${window.innerHeight} ${hit?.className ?? ""}`);
    const 样 = getComputedStyle(document.querySelector(".ptt-btn")!);
    if (样.touchAction !== "none" || 样.userSelect !== "none") x.push(`手势样式 ${样.touchAction} ${样.userSelect}`);
    return x;
  });
  expect(坏).toEqual([]);
  expect(errors).toEqual([]);
  await page.close();
});

it("PR-C 三审：松手后开始录音请求才失败（编号拿不到）→ 队列停掉、「录音上传」忙数回 0", async () => {
  const { page, errors } = await open("form", { 草稿们: [] }, { 假钟: true });
  await 开面板(page);
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__start慢 = true; });
  await 按住(page);
  await 等录着(page);
  await page.clock.runFor(16_000); // 15 秒一片先进队列
  await page.mouse.up(); // 松手：结束中 = true，最后一片也进队列，卡在等编号
  await page.evaluate(() => (window as unknown as { __放start: () => void }).__放start()); // start 失败
  await page.waitForFunction(() => (window as unknown as 页).__请求.includes("POST /api/coach-rec/start"));
  await page.clock.runFor(1_000);
  expect(await page.evaluate(() => (window as unknown as { __忙数: () => number }).__忙数())).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});
