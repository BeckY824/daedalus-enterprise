/**
 * 视口断点只许三条线：768（手机 | 桌面）、1200（窄屏 | 宽屏）、1440（宽屏里筛选条还收不收）。
 * 写法固定：max-width 只写 767 / 1199 / 1439，min-width 只写 768 / 1200 / 1440。
 *
 * 2026-11-10 盘点：css 里写了 560/640/760/767/768/899/900/992/1023/1180/1199/1213/1279/1439/1799 十几种，
 * 同一类「窄了就收」的版面各收各的，窗口拖一下这里收了那里没收。收法（2026-11-10）：
 *   - 1024 以下的几档（560/640/760/899/900/992/1023）并到手机档 767：桌面最小窗口 1024，这样 1024 起的版面一点不变
 *   - 1180 → 1199；「更多筛选」只留图标那条 1279 → 1439（和公海筛选同一档，只会更早收，不会更挤）
 * 放行的是**按版面算出来的门槛**（几栏宽度相加），不是设备档，名单在下面，每条写了怎么算的；
 * 容器查询 @container 跟着组件自己的宽度走，不归这里管。高度查询（max-height）也不管。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 源, 去注释 } from "./skin-css";
import { 名单门槛 } from "@/lib/roster";

const 档 = { max: new Set([767, 1199, 1439]), min: new Set([768, 1200, 1440]) };

/** 放行：文件 + 查询 → 怎么算出来的 */
const 版面门槛: Record<string, string> = {
  "app/globals.css (max-width: 1213px)": "记录页名单放不下就收：左栏 220 + 名单 312 + 留白 52 + 两栏下限 630 = lib/roster.ts 名单门槛 1214（下面有一条测试对数）",
  "app/globals.css (max-width: 1799px)": "AI 面板常驻时 xl 栅格重映射：正文 = 窗口 - 左栏 220 - 面板 380，窗口 1800 正文才有 1200",
  "components/AppShell.tsx (max-width: 1599px)": "AI 面板能不能常驻（面板放不下），面板 380 + 左栏 220 + 正文下限",
};

function 所有源文件(dir: string, 后缀: RegExp): string[] {
  const out: string[] = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) {
      if (n !== "generated") out.push(...所有源文件(p, 后缀));
    } else if (后缀.test(n)) out.push(p);
  }
  return out;
}
const 相对 = (f: string) => path.relative(源, f).replaceAll("\\", "/");

type 断点 = { rel: string; 行: number; 查询: string; 向: "max" | "min"; 宽: number };

function 视口断点(): 断点[] {
  const out: 断点[] = [];
  for (const f of 所有源文件(源, /\.css$/)) {
    const rel = 相对(f);
    const s = 去注释(fs.readFileSync(f, "utf8"));
    for (const m of s.matchAll(/@media\b([^{]*)\{/g)) {
      for (const q of m[1].matchAll(/\((max|min)-width\s*:\s*(\d+(?:\.\d+)?)px\)/g)) {
        out.push({ rel, 行: s.slice(0, m.index!).split("\n").length, 查询: `(${q[1]}-width: ${q[2]}px)`, 向: q[1] as "max" | "min", 宽: Number(q[2]) });
      }
    }
  }
  // js 里给 matchMedia / useNarrow 的字面量查询；模板串里 ${门槛} 算出来的不在这里（数字不是写死的）
  for (const f of 所有源文件(源, /\.tsx?$/)) {
    const rel = 相对(f);
    fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      for (const q of l.matchAll(/\((max|min)-width\s*:\s*(\d+(?:\.\d+)?)px\)/g)) {
        out.push({ rel, 行: i + 1, 查询: `(${q[1]}-width: ${q[2]}px)`, 向: q[1] as "max" | "min", 宽: Number(q[2]) });
      }
    });
  }
  return out;
}

describe("视口断点只用三条线", () => {
  const 全部 = 视口断点();

  it("max-width 只写 767/1199/1439，min-width 只写 768/1200/1440（版面门槛除外）", () => {
    const 错 = 全部
      .filter((d) => !档[d.向].has(d.宽) && !版面门槛[`${d.rel} ${d.查询}`])
      .map((d) => `${d.rel}:${d.行} ${d.查询}`);
    expect(错, `这些断点不在三档上：手机 max 767 / 窄屏 min 768 max 1199 / 宽屏 min 1200 max 1439 / min 1440：\n${错.join("\n")}`).toEqual([]);
  });

  it("版面门槛名单没有过期的条目", () => {
    const 有 = new Set(全部.map((d) => `${d.rel} ${d.查询}`));
    expect(Object.keys(版面门槛).filter((k) => !有.has(k))).toEqual([]);
  });

  it("记录页名单那条 css 断点和 lib/roster.ts 的名单门槛对得上", () => {
    expect(全部.some((d) => d.rel === "app/globals.css" && d.向 === "max" && d.宽 === 名单门槛 - 1)).toBe(true);
  });
});
