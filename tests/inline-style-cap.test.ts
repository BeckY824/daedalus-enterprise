/**
 * 行内样式 style={{ ... }} 只减不增。
 *
 * 2026-11-10 盘点：src 下 136 个 tsx 里有 1250 处 style={{ }}（合入 #223/#224 后重数）。行内样式不跟主题走、也逃过字号/圆角/颜色的守卫，
 * 一处处搬进 class 是长期活，这里先把口子收住：
 *   1. 每个文件的个数不许超过 inline-style-baseline.json 里记的数；名单里没有的新文件 = 0 处
 *   2. 减少了就把基线一起改小（棘轮），不然下次又能悄悄加回去
 * 真要加（比如运行时算出来的宽度、颜色），先在同一个文件里搬走一处别的，或者用 style={变量} 写在组件外，
 * 并在 PR 里说明为什么不能用 class。
 *
 * 改完基线：node 脚本或手改 tests/inline-style-baseline.json，文件名按字母排序，减到 0 的那一行删掉。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 源 } from "./skin-css";
import 基线 from "./inline-style-baseline.json";

function 所有tsx(dir: string): string[] {
  const out: string[] = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) {
      if (n !== "generated") out.push(...所有tsx(p));
    } else if (/\.tsx$/.test(n)) out.push(p);
  }
  return out;
}

/** 数一个文件里的 style={{（中间有空格也算）：块注释和整行 // 注释里的不算 */
function 数(s: string): number {
  const 净 = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return (净.match(/\bstyle=\{\s*\{/g) ?? []).length;
}

describe("行内样式只减不增", () => {
  const 现在 = new Map<string, number>();
  for (const f of 所有tsx(源)) {
    const n = 数(fs.readFileSync(f, "utf8"));
    if (n) 现在.set(path.relative(源, f).replaceAll("\\", "/"), n);
  }
  const 记 = 基线 as Record<string, number>;

  it("没有哪个文件比基线多（新文件基线是 0）", () => {
    const 多: string[] = [];
    for (const [f, n] of 现在) if (n > (记[f] ?? 0)) 多.push(`${f}: ${n}（基线 ${记[f] ?? 0}）`);
    expect(多, `这些文件新加了 style={{ }}，改用 class（globals.css 或模块 css），或在同一文件搬走等量的旧行内样式：\n${多.join("\n")}`).toEqual([]);
  });

  it("减少了就把基线改小（棘轮收紧）", () => {
    const 少: string[] = [];
    for (const [f, n] of Object.entries(记)) {
      const 实 = 现在.get(f) ?? 0;
      if (实 < n) 少.push(`${f}: ${n} → ${实}`);
    }
    expect(少, `这些文件的行内样式少了，把 tests/inline-style-baseline.json 对应的数改小（0 就删掉那一行）：\n${少.join("\n")}`).toEqual([]);
  });

  it("基线按文件名排序，方便合并", () => {
    const k = Object.keys(记);
    expect(k).toEqual([...k].sort());
  });

  it("总数不超过 2026-11-10 的 1250", () => {
    const 总 = [...现在.values()].reduce((a, b) => a + b, 0);
    expect(总).toBeLessThanOrEqual(1250);
  });
});
