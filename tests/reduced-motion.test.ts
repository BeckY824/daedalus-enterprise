/**
 * 减弱动态块的守卫（P10 顺手修的 bug）。
 *
 * lightningcss 压缩时会把同一块里的 transform / scale / translate / rotate 合并成一条 transform，
 * 例如 `transform:none; scale:none; translate:none` 被压成 `transform:scale(1)translate(0,0)`——
 * 「去掉位移」变成了「设一个位移」，盖不掉别处的 transform。
 * 所以减弱动态块里，一个声明块不许同时写 transform 和 scale/translate/rotate；要两样都清，就拆成两条选择器不同的规则（加 `:root ` 前缀）。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { 去注释, 源, 主题目录 } from "./skin-css";

const 文件 = [
  path.join(源, "app/globals.css"),
  ...fs.readdirSync(主题目录).filter((n) => n.endsWith(".css")).map((n) => path.join(主题目录, n)),
];

/** 找出所有 @media (prefers-reduced-motion: reduce) { … } 的内层（按花括号配对） */
function 减弱块(css: string): { 起行: number; 内: string }[] {
  const s = 去注释(css);
  const out: { 起行: number; 内: string }[] = [];
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const 开 = m.index + m[0].length;
    let d = 1;
    let j = 开;
    for (; j < s.length && d > 0; j++) {
      if (s[j] === "{") d++;
      else if (s[j] === "}") d--;
    }
    out.push({ 起行: s.slice(0, m.index).split("\n").length, 内: s.slice(开, j - 1) });
  }
  return out;
}

/** 声明块里的属性名（只认声明开头的名字，值里的 transform 不算） */
const 属性名 = (体: string) =>
  体
    .split(";")
    .map((d) => d.slice(0, d.indexOf(":")).trim().toLowerCase())
    .filter(Boolean);

describe("减弱动态：transform 不和 scale/translate/rotate 同块", () => {
  it("globals.css 里找得到减弱动态块（防止正则失效后空跑）", () => {
    const 块 = 减弱块(fs.readFileSync(文件[0], "utf8"));
    expect(块.length).toBeGreaterThanOrEqual(3);
    expect(块.some((b) => b.内.includes(":root .press:active"))).toBe(true);
  });

  for (const f of 文件) {
    it(path.relative(源, f), () => {
      const 违规: string[] = [];
      for (const b of 减弱块(fs.readFileSync(f, "utf8"))) {
        const re = /([^{}]+)\{([^{}]*)\}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(b.内))) {
          const 名 = 属性名(m[2]);
          if (名.includes("transform") && 名.some((n) => n === "scale" || n === "translate" || n === "rotate"))
            违规.push(`第 ${b.起行} 行起的减弱动态块：${m[1].trim().slice(0, 80)}`);
        }
      }
      expect(违规).toEqual([]);
    });
  }
});
