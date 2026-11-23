/**
 * 暗黑（P10）的守卫：app/dark.css 怎么盖、盖没盖全、对比度够不够。
 *
 * 漏一个颜色变量不会报错，只会在暗底上留一块浅色。这里叠一遍 token 层：根块 → dark.css 里的暗块（:root[data-mode="dark"]）。
 * 凡是最后落在亮色层、且值里写着色值（hex / rgb）的变量，或阴影/底纹变量，都算漏了。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { 拆块, 变量, 根变量, 源 } from "./css-read";

const 暗文 = fs.readFileSync(path.join(源, "app/dark.css"), "utf8");
const 暗块 = 拆块(暗文);
const 根 = 根变量();

const 选择器们 = (s: string) => s.split(",").map((x) => x.trim());
/** 只数属性选择器和 :root（:not 本身不算、括号里的算），够这几种选择器用 */
const 权重 = (s: string) => (s.match(/\[/g) ?? []).length + (s.match(/:root/g) ?? []).length;

function 层(选择器: (x: string) => boolean, 块们: ReturnType<typeof 拆块>): Map<string, string> {
  const r = new Map<string, string>();
  for (const b of 块们) if (b.token块 && 选择器们(b.选择器).some(选择器)) for (const [k, v] of 变量(b.体)) r.set(k, v);
  return r;
}

const 暗层 = 层((x) => x === ':root[data-mode="dark"]', 暗块);
const 亮小样 = 层((x) => x === '[data-mode-preview="light"]', 暗块);

type 层 = { 名: string; 暗: boolean; 值: Map<string, string> };
function 叠(暗: boolean): 层[] {
  const 层们: 层[] = [{ 名: "根块", 暗: false, 值: 根 }];
  if (暗) 层们.push({ 名: "暗块", 暗: true, 值: 暗层 });
  return 层们;
}

function 解(层们: 层[]): Map<string, { 值: string; 层: 层 }> {
  const r = new Map<string, { 值: string; 层: 层 }>();
  for (const l of 层们) for (const [k, v] of l.值) r.set(k, { 值: v, 层: l });
  return r;
}

function 取色(表: Map<string, { 值: string }>, 名: string, 深 = 0): string {
  const v = 表.get(名)?.值;
  if (v === undefined) throw new Error(`${名} 没定义`);
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  if (m) {
    if (深 > 10) throw new Error(`${名} 的 var() 链太深`);
    return 取色(表, m[1], 深 + 1);
  }
  return v;
}

function 亮度(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`不是 6 位 hex：${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const 对比 = (a: string, b: string) => {
  const [x, y] = [亮度(a), 亮度(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const 有色值 = (v: string) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(v);
const 必盖 = new Set(["--shadow-card", "--shadow-pop", "--page-pattern"]);

describe("暗黑：选择器与优先级", () => {
  it("layout 在 globals.css、antd-dark.css 之后才引入 dark.css", () => {
    const l = fs.readFileSync(path.join(源, "app/layout.tsx"), "utf8");
    const 暗 = l.indexOf('import "./dark.css"');
    expect(暗).toBeGreaterThan(0);
    for (const s of ["globals", "antd-dark"]) {
      const i = l.indexOf(`import "./${s}.css"`);
      expect(i, s).toBeGreaterThan(0);
      expect(i, s).toBeLessThan(暗);
    }
    // dark.css 之后不许再引别的样式表
    expect(l.slice(暗 + 1)).not.toMatch(/import "\.\/[^"]+\.css"/);
  });

  it("dark.css 只有 token 块，:root 选择器都是 :root[data-mode=\"dark\"]（压过 globals.css 的 :root）", () => {
    expect(暗块.length).toBeGreaterThan(0);
    for (const b of 暗块) {
      expect(b.token块, b.选择器).toBe(true);
      for (const s of 选择器们(b.选择器)) {
        if (s.startsWith("[data-mode-preview=")) continue;
        expect(s, s).toBe(':root[data-mode="dark"]');
        expect(权重(s), s).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("dark.css 里的变量名根块里都有", () => {
    const 多 = 暗块.flatMap((b) => [...变量(b.体).keys()]).filter((k) => !根.has(k));
    expect(多).toEqual([]);
  });

  it("「浅色」小样的值和根块一致", () => {
    expect(亮小样.size).toBeGreaterThan(0);
    for (const [k, v] of 亮小样) expect(v, k).toBe(根.get(k));
  });
});

describe("暗黑：盖全、对比度够", () => {
  const 表 = 解(叠(true));
  it("带色值的变量最后都落在暗层", () => {
    const 漏 = [...表]
      .filter(([k, x]) => !x.层.暗 && (有色值(x.值) || 必盖.has(k)))
      .map(([k, x]) => `${k}（${x.层.名}：${x.值}）`);
    expect(漏).toEqual([]);
  });
  it("WCAG 对比度", () => {
    const 对 = (a: string, b: string, 线 = 4.5) => {
      const r = 对比(取色(表, a), 取色(表, b));
      expect(r, `${a} / ${b} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(线);
    };
    对("--ink", "--panel");
    对("--ink-soft", "--panel");
    对("--text-muted", "--panel");
    对("--brand-deep", "--brand-bg");
    for (const s of ["success", "warning", "danger"]) 对(`--${s}-text`, `--${s}-bg`);
    对("--on-ink", "--brand");
    expect(取色(表, "--panel")).not.toBe(取色(表, "--ink"));
  });
});

describe("亮色：根块对比度", () => {
  const 表 = 解(叠(false));
  it("ink / panel、text-muted / panel ≥ 4.5", () => {
    for (const a of ["--ink", "--text-muted"]) {
      const r = 对比(取色(表, a), 取色(表, "--panel"));
      expect(r, `${a} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
