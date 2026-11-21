/**
 * 「格律」G5 层级不变量 · ③ 运行时（规范 9「G5」③）：挂在排版闸门的企业版服务和假数据上（e2e-layout/企业版.ts），打开 ?gelv=1，
 * 页面上每个 [data-ty="title"]，找最近的 [data-ty-box] 容器，和同一容器里（不跨进里面再套的容器）每个看得见的 [data-ty="body"] 比 getComputedStyle：
 *   标题字号 ≥ 正文字号，而且字号大 ≥2 或字重更高。
 * 只认打了标记的元素（样板页的卡片标题、字段值、沟通正文；规范件以后自动带），不会误伤。每页至少要比到一对，免得标记丢了还空过。
 *
 *   E2E_PORT=3520 npx playwright test -c playwright.gelv.config.ts e2e-layout/层级.gelv.ts
 */
import { test, expect } from "@playwright/test";
import { 企业版地址, 企业版进门, 企业版种子 } from "./企业版";

const 页们 = () => [
  { 名: "客户详情", 址: "/customers/gate-scandi" },
  { 名: "客户详情-项目区", 址: `/customers/gate-scandi?project=${企业版种子().项目}` },
  { 名: "客户列表", 址: "/customers" },
];

type 一组 = { 宽: number; skin: string; mode: "light" | "dark" };
const 组合: 一组[] = [
  ...["now", "pixel", "tech", "luxe", "ledger"].map((skin) => ({ 宽: 1366, skin, mode: "light" as const })),
  { 宽: 1366, skin: "now", mode: "dark" },
  { 宽: 390, skin: "now", mode: "light" },
];

for (const 宽 of [1366, 390]) {
  test(`格律 G5 ③ 运行时：标题不小于同一容器的正文 · ${宽}`, async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const 手机 = 宽 < 500;
    const ctx = await browser.newContext({
      baseURL: 企业版地址, locale: "zh-CN", timezoneId: "Asia/Shanghai",
      viewport: { width: 宽, height: 手机 ? 844 : 768 }, deviceScaleFactor: 手机 ? 2 : 1, isMobile: 手机, hasTouch: 手机,
    });
    const page = await ctx.newPage();
    await 企业版进门(page);
    const 问题: string[] = [];
    for (const x of 组合.filter((c) => c.宽 === 宽)) {
      for (const 页 of 页们()) {
        await page.evaluate(([skin, mode]) => localStorage.setItem("daedalus.appearance", JSON.stringify({ paper: "tone", skin, mode })), [x.skin, x.mode]);
        await page.goto(`${页.址}${页.址.includes("?") ? "&" : "?"}gelv=1`);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(400);
        const 结果 = await page.evaluate(() => {
          const 看得见 = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const 坏: string[] = [];
          let 对数 = 0;
          for (const t of document.querySelectorAll<HTMLElement>('[data-ty="title"]')) {
            if (!看得见(t)) continue;
            const 盒 = t.closest("[data-ty-box]");
            if (!盒) continue;
            const ts = getComputedStyle(t);
            const tf = parseFloat(ts.fontSize), tw = Number(ts.fontWeight);
            for (const b of 盒.querySelectorAll<HTMLElement>('[data-ty="body"]')) {
              if (!看得见(b) || b.closest("[data-ty-box]") !== 盒) continue;
              对数++;
              const bs = getComputedStyle(b);
              const bf = parseFloat(bs.fontSize), bw = Number(bs.fontWeight);
              if (!(tf >= bf && (tf - bf >= 2 || tw > bw)))
                坏.push(`「${(t.textContent || "").trim().slice(0, 12)}」${tf}/${tw} vs「${(b.textContent || "").trim().slice(0, 12)}」${bf}/${bw}`);
            }
          }
          return { 坏, 对数, 格律: document.documentElement.dataset.gelv !== undefined };
        });
        expect(结果.格律, `${页.名} 没打开格律`).toBe(true);
        if (页.名 !== "客户列表") expect(结果.对数, `${页.名} · ${x.skin} · ${x.mode}：一对标题 / 正文都没比到，data-ty 标记可能丢了`).toBeGreaterThan(0);
        for (const b of 结果.坏) 问题.push(`${页.名} · ${宽} · ${x.skin} · ${x.mode}：${b}`);
      }
    }
    await ctx.close();
    expect(问题, 问题.join("\n")).toEqual([]);
  });
}
