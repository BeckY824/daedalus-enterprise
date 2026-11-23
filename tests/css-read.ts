/**
 * 样式表的读法，给 antd-dark / dark-mode / design-tokens / motion-tokens 等守卫共用。
 *
 * dark.css 里只有 token 块：选择器只是 `:root[data-mode="dark"]` 或 `[data-mode-preview="x"]`（设置页明暗小样），
 * 块里只有 `--名字: 值;`（外加 color-scheme）。色值只许写在这里和 globals.css 的 :root
 */
import fs from "node:fs";
import path from "node:path";

export const 源 = path.resolve(__dirname, "../src");
export const globals = fs.readFileSync(path.join(源, "app/globals.css"), "utf8");

/** 去注释时把块注释换成同样多的换行，报出来的行号才对得上编辑器 */
export const 去注释 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));

export type 块 = { 选择器: string; 体: string; 起: number; 止: number; token块: boolean };

/* 认得的 token 选择器（裸 :root 不算——那是 globals.css 的根块）：暗黑 :root[data-mode="dark"]、设置页明暗小样 [data-mode-preview="x"] */
const TOKEN选择器 = /^(?::root\[data-mode="dark"\]|\[data-mode-preview="[\w-]+"\])$/;

/** 只认一层的块（不认嵌套的 @media） */
export function 拆块(css: string): 块[] {
  const s = 去注释(css);
  const out: 块[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const 选择器 = m[1].trim();
    const 体 = m[2];
    const 各选择器 = 选择器.split(",").map((x) => x.trim());
    const 只有变量 = 体
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean)
      .every((d) => d.startsWith("--") || d.startsWith("color-scheme"));
    out.push({ 选择器, 体, 起: m.index, 止: m.index + m[0].length, token块: 只有变量 && 各选择器.every((x) => TOKEN选择器.test(x)) });
  }
  return out;
}

/** 块里的 `--名字: 值`（值去掉首尾空白） */
export function 变量(体: string): Map<string, string> {
  const r = new Map<string, string>();
  for (const d of 体.split(";")) {
    const i = d.indexOf(":");
    const k = d.slice(0, i).trim();
    if (k.startsWith("--")) r.set(k, d.slice(i + 1).trim());
  }
  return r;
}

/** globals.css 第一块（:root 那块）里定义过的所有变量 */
export function 根变量(): Map<string, string> {
  const s = 去注释(globals);
  const i = s.indexOf(":root");
  return 变量(s.slice(s.indexOf("{", i) + 1, s.indexOf("\n}", i)));
}
