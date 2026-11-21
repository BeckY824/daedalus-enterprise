/**
 * 「格律」样板的假数据截图（落地计划 1.2 第 1 条，P1 最小版）：挂在排版闸门的企业版服务上（e2e-layout/企业版.ts 建库灌数据，
 * 长英文公司名、整段询盘、阿拉伯文这类编的数据），同一构建、同一份数据里切 ?gelv=0 / ?gelv=1 各截一张。
 *
 * 不进排版闸门的分片表（不是 *.spec.ts，playwright.layout.config.ts 不认它），单独一份配置跑：
 *
 *   E2E_PORT=3520 npx playwright test -c playwright.gelv.config.ts            # 本机（开发模式）
 *   E2E_PROD=1 npx playwright test -c playwright.gelv.config.ts               # 同 CI：先 next build 再 next start
 *
 * 产物（GELV_SHOT_DIR，默认 test-results/gelv-shots/<系统>/）：
 *   <宽>-<主题>-<明暗>-<现在|格律>-<页>.png
 *   computed.json：每张图里带 data-ty / .ty-* 和几处关键元素的最终字号、行高、字重、颜色；每页 scrollWidth / clientWidth；控制台报错
 *   对照.html：同一页「现在 | 格律」并排（Mac、Windows 两列由两边的产物合起来看）
 * 路由 × 宽度（1366 / 390）×「现状」浅 / 深 × 开关前后；另外 4 套主题只在 1366 浅色下打开开关各截一张，确认不崩。
 * 只截、只记，不判红（越界照样记进 computed.json 的 横滚 字段）。数据全是编的，产物可以发布
 */
import { test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { 企业版地址, 企业版进门 } from "./企业版";

const 系统 = process.env.GELV_SHOT_OS || (process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux");
const 出处 = process.env.GELV_SHOT_DIR || path.resolve(__dirname, "../test-results/gelv-shots", 系统);

const 页们 = [
  { 名: "客户详情", 址: "/customers/gate-scandi" },
  { 名: "客户详情-长英文名", 址: "/customers/gate-long-uk" },
] as const;

type 一张 = { 宽: number; skin: string; mode: "light" | "dark"; 格律: boolean };
const 组合: 一张[] = [];
for (const 宽 of [1366, 390]) for (const mode of ["light", "dark"] as const) for (const 格律 of [false, true]) 组合.push({ 宽, skin: "now", mode, 格律 });
for (const skin of ["pixel", "tech", "luxe", "ledger"]) 组合.push({ 宽: 1366, skin, mode: "light", 格律: true });

/** 要量的元素：带角色的（data-ty / .ty-*），加上客户详情几处有代表性的位置 */
const 量的选择器 = [
  "[data-ty]", "[class*='ty-']", ".rec-head-name", ".rec-head-sub", ".ant-card-head-title", ".rec-field-k", ".rec-field-v", ".rec-empty",
  ".pd-kv-k", ".pd-follow-meta", ".gelv-dot", ".ant-tag", ".ant-btn", ".cd-pj-nm", ".cd-cap", ".pane-t", ".roster-n", ".rec-ai-title", ".rec-ai-sec-k", ".rec-ai-sec-v",
].join(", ");

const 文件名 = (x: 一张, 页: string) => `${x.宽}-${x.skin}-${x.mode}-${x.格律 ? "格律" : "现在"}-${页}.png`;

test.describe.configure({ mode: "serial" });

test("格律样板：客户详情截图 + computed.json", async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  mkdirSync(出处, { recursive: true });
  const 记录: Record<string, unknown>[] = [];
  for (const 宽 of [1366, 390]) {
    const 手机 = 宽 < 500;
    const ctx = await browser.newContext({
      baseURL: 企业版地址, locale: "zh-CN", timezoneId: "Asia/Shanghai",
      viewport: { width: 宽, height: 手机 ? 844 : 768 }, deviceScaleFactor: 手机 ? 2 : 1, isMobile: 手机, hasTouch: 手机,
    });
    const page = await ctx.newPage();
    const 报错: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") 报错.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => 报错.push(String(e).slice(0, 200)));
    await 企业版进门(page);
    for (const x of 组合.filter((c) => c.宽 === 宽)) {
      for (const 页 of 页们) {
        报错.length = 0;
        // 外观和开关都在首次绘制前由外观预设脚本读出来（lib/appearance.ts），先写进本地再进页
        await page.evaluate(([skin, mode]) => localStorage.setItem("daedalus.appearance", JSON.stringify({ paper: "tone", skin, mode })), [x.skin, x.mode]);
        await page.goto(`${页.址}?gelv=${x.格律 ? 1 : 0}`);
        await page.waitForLoadState("networkidle").catch(() => {});
        // 开关本身和开发模式的角标不进图：两张图只差「格律」那层
        await page.addStyleTag({ content: ".gelv-toggle, nextjs-portal { display: none !important; }" });
        await page.waitForTimeout(600);
        const 名 = 文件名(x, 页.名);
        await page.screenshot({ path: path.join(出处, 名) });
        const 量 = await page.evaluate((sel) => {
          const 元素 = [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => e.getBoundingClientRect().width > 0).slice(0, 120);
          const 去重 = new Map<string, Record<string, string>>();
          for (const e of 元素) {
            const cs = getComputedStyle(e);
            const 类 = (typeof e.className === "string" ? e.className : "").split(/\s+/).filter((c) => c && !c.startsWith("css-")).slice(0, 3).join(".");
            const 键 = `${e.tagName.toLowerCase()}.${类}${e.dataset.ty ? `[data-ty=${e.dataset.ty}]` : ""}`;
            if (!去重.has(键)) 去重.set(键, { 字号: cs.fontSize, 行高: cs.lineHeight, 字重: cs.fontWeight, 颜色: cs.color, 圆角: cs.borderRadius, 字: (e.textContent || "").trim().slice(0, 16) });
          }
          const d = document.documentElement;
          return { 元素: Object.fromEntries(去重), scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, 格律: d.dataset.gelv !== undefined };
        }, 量的选择器);
        记录.push({ 图: 名, 页: 页.名, 址: 页.址, ...x, ...量, 横滚: 量.scrollWidth > 量.clientWidth, 控制台报错: [...报错] });
      }
    }
    await ctx.close();
  }
  writeFileSync(path.join(出处, "computed.json"), JSON.stringify({ 系统, 时间: new Date().toISOString(), 记录 }, null, 2));

  // 对照页：同一页、同一宽度、同一明暗，「现在 | 格律」并排；另外 4 套主题单列
  const 格 = (f: string) => `<figure><img src="${encodeURI(f)}" loading="lazy" alt="${f}"><figcaption>${f}</figcaption></figure>`;
  const 行们: string[] = [];
  for (const 页 of 页们)
    for (const 宽 of [1366, 390])
      for (const mode of ["light", "dark"] as const)
        行们.push(`<h2>${页.名} · ${宽} · ${mode === "light" ? "浅色" : "深色"}</h2><div class="row">${格(文件名({ 宽, skin: "now", mode, 格律: false }, 页.名))}${格(文件名({ 宽, skin: "now", mode, 格律: true }, 页.名))}</div>`);
  行们.push(`<h2>另外 4 套主题 · 打开格律（只看不崩）</h2><div class="row">${组合.filter((c) => c.skin !== "now").flatMap((c) => 页们.map((p) => 格(文件名(c, p.名)))).join("")}</div>`);
  writeFileSync(path.join(出处, "对照.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>格律样板对照（${系统}）</title>
<style>body{font-family:system-ui,sans-serif;margin:16px;background:#f5f5f7;color:#1d1d1f}h1{font-size:22px}h2{font-size:16px;margin:24px 0 8px}.row{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0;background:#fff;border:1px solid #e3e3e8;border-radius:10px;padding:8px;max-width:calc(50% - 6px)}img{max-width:100%;display:block}figcaption{font-size:12px;color:#6e6e73;margin-top:4px}</style>
<h1>「格律」样板对照 · ${系统} · 假数据</h1><p>左「现在」、右「格律」；同一构建、同一份数据，只切 ?gelv。只改样子，按钮顺序、文案、确认方式不在这一批。</p>${行们.join("\n")}</html>`);
});
