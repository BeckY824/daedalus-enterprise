/**
 * P-界面-38「减弱动态只留透明度」的 JS 那一半：motion 驱动的动效（components/MotionTheme.tsx 包着的全部 motion 组件）。
 *
 * CSS 那一半是读样式表的守卫（motion-tokens.test.ts「减弱动态只留透明度（CSS）」）；JS 这边规矩落在
 * MotionConfig reducedMotion="user" 上——它管不管用、管到哪一步，只有真跑一遍 motion 才知道：
 * 开了「减弱动态」，同一个「淡入 + 从 .97 放大 + 上移 8px」的进场，缩放和位移直接到位，只剩透明度在过渡；
 * 没开时三样都在动（对照组，免得哪天 motion 换了行为、两边都「不动」也算绿）。
 * 默认过渡（不写 transition，走 ui 那档弹簧）也照样：位移、缩放一开始就到位。
 *
 * 真浏览器 + 真 motion + 真 MotionTheme，不是 mock。
 */
import { beforeAll, afterAll, it, expect } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser;
let bundle: string;

beforeAll(async () => {
  // 显式过渡拉到 2 秒、匀速：取样那一刻一定还在半路上，测的是「动不动」不是「多快」
  const r = await build({
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { motion } from "motion/react";
        import MotionTheme from "@/components/MotionTheme";
        const 进场 = { initial: { opacity: 0, scale: 0.97, y: 8 }, animate: { opacity: 1, scale: 1, y: 0 } };
        createRoot(document.getElementById("root")).render(
          <MotionTheme>
            <motion.div id="slow" {...进场} transition={{ duration: 2, ease: "linear" }} style={{ width: 40, height: 40 }} />
            <motion.div id="dflt" {...进场} style={{ width: 40, height: 40 }} />
          </MotionTheme>,
        );
      `,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    alias: { "@": path.resolve("src") },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  bundle = r.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

type 样 = { 透明: number; 变换: string };

async function 取样(reducedMotion: "reduce" | "no-preference") {
  const ctx = await browser.newContext({ reducedMotion });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  await page.route("http://motion.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://motion.test");
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector("#slow");
  const 读 = (id: string) =>
    page.evaluate((id) => {
      const cs = getComputedStyle(document.getElementById(id)!);
      return { 透明: Number(cs.opacity), 变换: cs.transform };
    }, id);
  // 默认过渡是弹簧，约 0.2 秒就到 95%：挂上后等两帧就取（motion 在第一帧才把「直接到位」写上去；
  // 挂上那一刻还是 initial，机器忙时紧接着取会取到 initial，误红）。两帧 ≈ 33ms，没开减弱动态的弹簧这时离到位还远
  await page.evaluate(() => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))));
  const 默认 = await 读("dflt");
  await page.waitForTimeout(400);
  const 慢 = await 读("slow");
  await ctx.close();
  return { 慢, 默认 } as { 慢: 样; 默认: 样 };
}

it("开了减弱动态：缩放、位移直接到位，透明度照常过渡", async () => {
  const { 慢, 默认 } = await 取样("reduce");
  expect(慢.变换, "显式过渡下缩放 / 位移该直接到位").toBe("none");
  expect(慢.透明, "透明度应该还在半路上（只留透明度，不是什么都不动）").toBeGreaterThan(0);
  expect(慢.透明).toBeLessThan(1);
  expect(默认.变换, "默认过渡（弹簧）下缩放 / 位移也该直接到位").toBe("none");
});

it("对照：没开减弱动态时缩放、位移都在动", async () => {
  const { 慢 } = await 取样("no-preference");
  expect(慢.变换).not.toBe("none");
  expect(慢.透明).toBeGreaterThan(0);
  expect(慢.透明).toBeLessThan(1);
});

it("--ease 那条 linear() 浏览器认得（写错一个字，所有 var(--ease) 的过渡整条作废）", async () => {
  const { 弹簧CSS } = await import("@/lib/motion");
  const page = await browser.newPage();
  const 认 = await page.evaluate((v) => CSS.supports("transition-timing-function", v), 弹簧CSS);
  await page.close();
  expect(认).toBe(true);
});
