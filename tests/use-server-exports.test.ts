import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * "use server" 文件只许导出 async 函数（和类型）。
 *
 * tsc、eslint、单测都不管这条，只有 next build 管：10-31 global-search.ts 导出了一个常量，
 * 本地全绿推上去，CI 里 E2E、排版、速度三套闸门全部起不来服务。这里按源码先拦一道。
 */
const 源根 = "src";
const 全部文件 = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : 全部文件(p);
    return /\.tsx?$/.test(p) ? [p] : [];
  });
/** 文件第一条语句是 "use server"（前面只许有注释），同 permissions/matrix.test.ts */
const 是动作文件 = (src: string) => /^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/.test(src);

describe('"use server" 文件的导出', () => {
  it("只有 async 函数和类型", () => {
    const 犯规: string[] = [];
    for (const f of 全部文件(源根)) {
      const src = fs.readFileSync(f, "utf8");
      if (!是动作文件(src)) continue;
      src.split("\n").forEach((行, i) => {
        if (/^export\s+(const|let|var|class|enum|default|function\b|\{|\*)/.test(行)) 犯规.push(`${f}:${i + 1} ${行.trim()}`);
      });
    }
    expect(犯规, `next build 会报 Only async functions are allowed to be exported：\n${犯规.join("\n")}`).toEqual([]);
  });
});
