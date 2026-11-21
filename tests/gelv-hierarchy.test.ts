/**
 * 「格律」G5 层级不变量 · ① token 层（规范 9「G5」、2.3）。样板阶段只测 src/app/gelv-preview.css 里 [data-gelv] 下的角色变量。
 *
 * 每个主题（现状 + skins/*.css）× 电脑 / 手机（≤767 那块角色覆盖），把角色变量一路解到 px，断言：
 *   1. 页面标题 ≥ 区块标题 + 2，区块标题 ≥ 正文 + 2
 *   2. 小标题和正文同号，字重 600 > 400
 *   3. 中号数字 ≠ 页面标题（不和标题同号）
 *   4. 比正文小的角色一律 400；600 只给 ≥14 的角色
 * 明暗只换颜色和阴影，不碰字号，所以不分明暗。② 组件层、③ 运行时（e2e-layout/层级.gelv.ts）见各自文件。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 源, 拆块, 变量, 根变量, 主题文件 } from "./skin-css";

const 预览 = fs.readFileSync(path.join(源, "app/gelv-preview.css"), "utf8");
const 根前缀 = ":root[data-gelv][data-skin][data-mode]";

function 预览块(主题: string, 手机: boolean): Map<string, string>[] {
  // 根前缀的块只有两块：第一块是电脑的档位 + 角色，第二块在 @media (max-width: 767px) 里，是手机的角色覆盖
  const 块们 = 拆块(预览);
  const [底, 手机块] = 块们.filter((b) => b.选择器 === 根前缀);
  const 主题块 = 块们.filter((b) => b.选择器 === `:root[data-gelv][data-skin="${主题}"][data-mode]`);
  if (!底 || !手机块) throw new Error("gelv-preview.css 找不到角色块");
  return [变量(底.体), ...主题块.map((b) => 变量(b.体)), ...(手机 ? [变量(手机块.体)] : [])];
}

function 环境(主题: string, 手机: boolean): Map<string, string> {
  const 表 = new Map(根变量());
  const 皮 = 主题文件().find((f) => f.key === 主题);
  if (皮) for (const b of 拆块(皮.文)) if (b.选择器 === `:root[data-skin="${主题}"]`) for (const [k, v] of 变量(b.体)) 表.set(k, v);
  for (const m of 预览块(主题, 手机)) for (const [k, v] of m) 表.set(k, v);
  return 表;
}

function 解(值: string, 表: Map<string, string>, 深 = 0): string {
  if (深 > 20) throw new Error("变量绕圈：" + 值);
  return 值.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_, 名: string, 备: string | undefined) => {
    const v = 表.get(名) ?? 备;
    if (v === undefined) throw new Error("没定义：" + 名);
    return 解(v, 表, 深 + 1);
  });
}

function 算(值: string, 表: Map<string, string>): number {
  let s = 解(值, 表);
  while (/var\(/.test(s)) s = 解(s, 表);
  const 式 = s.replace(/px/g, "").replace(/calc\(/g, "(").replace(/min\(/g, "Math.min(").replace(/max\(/g, "Math.max(");
  if (!/^[\d\s.+\-*/(),]*$/.test(式.replace(/Math\.(min|max)/g, ""))) throw new Error("算不了：" + s);
  return Number(new Function(`return (${式});`)());
}

const 角色们 = ["page", "section", "sub", "body", "prose", "cell", "th", "label", "note", "meta", "chip", "kpi", "kpi-m"] as const;
const 主题们 = ["now", ...主题文件().map((f) => f.key)];

describe("格律 G5 ① token 层：角色字号层级", () => {
  for (const 主题 of 主题们) {
    for (const 手机 of [false, true]) {
      it(`${主题} · ${手机 ? "手机" : "电脑"}`, () => {
        const 表 = 环境(主题, 手机);
        const fs_ = Object.fromEntries(角色们.map((r) => [r, 算(`var(--ty-${r}-fs)`, 表)])) as Record<(typeof 角色们)[number], number>;
        const fw = Object.fromEntries(角色们.map((r) => [r, 算(`var(--ty-${r}-fw)`, 表)])) as Record<(typeof 角色们)[number], number>;
        expect(fs_.page, "页面标题 ≥ 区块标题 + 2").toBeGreaterThanOrEqual(fs_.section + 2);
        expect(fs_.section, "区块标题 ≥ 正文 + 2").toBeGreaterThanOrEqual(fs_.body + 2);
        expect(fs_.sub, "小标题和正文同号").toBe(fs_.body);
        expect(fw.sub, "小标题字重高一档").toBeGreaterThan(fw.body);
        expect(fs_["kpi-m"], "中号数字不和页面标题同号").not.toBe(fs_.page);
        for (const r of 角色们) {
          if (fs_[r] < fs_.body) expect(fw[r], `${r} 比正文小，只许 400`).toBe(400);
          if (fw[r] === 600) expect(fs_[r], `${r} 是 600，字号要 ≥14`).toBeGreaterThanOrEqual(14);
          expect([400, 600], `${r} 字重只有 400 / 600`).toContain(fw[r]);
        }
      });
    }
  }
});
