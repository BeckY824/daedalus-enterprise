/**
 * 设计语言 E6 · D25：行高 28 种、字重没 token、循环动画时长 15 种写死（现在-设计语言 1.2 / 1.4）。
 *
 * 并档会改外观（E6 不改外观），先管住不再长：
 *   1. css 里的 line-height、font-weight、循环动画（infinite）的时长，只许用名单里现有的值
 *   2. 某个值全站不再用了，测试红，提醒从名单里划掉（名单只减不增）
 * 新写样式要行高 / 字重 / 转圈时长，先挑名单里有的；行高优先用 1.5 / 22px 这类已经最常用的档。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 源, 去注释 } from "./css-read";

function 所有css(dir: string): string[] {
  const out: string[] = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) out.push(...所有css(p));
    else if (n.endsWith(".css")) out.push(p);
  }
  return out;
}
const 全部 = 所有css(源).map((f) => ({ rel: path.relative(源, f), s: 去注释(fs.readFileSync(f, "utf8")) }));

/** 11-22 盘点的现有值（含研究页样式）；11-23 跟 main：换皮删了以后 1.1 没人用、划掉，main 新用的 var(--ctl-h-sm)、var(--hit-touch) 补上 */
const 行高 = ["0", "1", "1.15", "1.2", "1.25", "1.3", "1.35", "1.4", "1.5", "1.6", "1.7", "1.75", "1.8", "1.85", "1.9", "14px", "16px", "18px", "2", "20px", "22px", "24px", "28px", "32px", "inherit", "max(28px, 1.25em)", "normal", "var(--ctl-h)", "var(--ctl-h-sm)", "var(--hit-touch)"];
const 字重 = ["100 450", "400", "451 900", "500", "600", "700", "inherit", "var(--fw-display)"];
const 转圈时长 = ["0.8s", "0.9s", "1s", "1.1s", "1.2s", "1.4s", "1.6s", "2.2s", "2.6s", "3.2s", "8s"];

function 收(re: RegExp): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const { rel, s } of 全部) for (const x of s.matchAll(re)) {
    const v = x[1].replace(/\s*!important\s*$/, "").replace(/\s+/g, " ").trim();
    m.set(v, [...(m.get(v) ?? []), rel]);
  }
  return m;
}
const 用到 = {
  行高: 收(/line-height\s*:\s*([^;}]+)/g),
  字重: 收(/font-weight\s*:\s*([^;}]+)/g),
  转圈时长: 收(/animation\s*:[^;}]*?(\d*\.?\d+m?s)\b[^;}]*\binfinite\b/g),
};

describe("行高 / 字重 / 循环动画时长不再长新值（只减不增）", () => {
  for (const [名, 许] of [["行高", 行高], ["字重", 字重], ["转圈时长", 转圈时长]] as const) {
    it(`${名}：只用名单里的值`, () => {
      const 新 = [...用到[名]].filter(([v]) => !许.includes(v)).map(([v, fs]) => `${v}（${[...new Set(fs)].join("、")}）`);
      expect(新, `先挑名单里已有的${名}`).toEqual([]);
    });
    it(`${名}：名单里没人用的划掉`, () => {
      expect(许.filter((v) => !用到[名].has(v))).toEqual([]);
    });
  }
  it("读得到（防解析坏了全放行）", () => {
    expect(用到.行高.size).toBeGreaterThan(20);
    expect(用到.转圈时长.size).toBeGreaterThan(5);
  });
});
