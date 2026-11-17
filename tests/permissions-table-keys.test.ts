/**
 * 权限表「每个接口都在表里」的静态版（11-17 复盘第 10 类）。
 *
 * tests/permissions/matrix.test.ts 里同名那条要 import 全部路由和动作、连测试库，只在 CI 全套里跑；
 * 功能分支推送只跑相关用例，加了新接口忘补 expected.json，要到 CI 才红（11-17 出过）。
 * 这里不 import 业务代码、不连库：按源码文本扫出 route.ts 导出的 HTTP 方法和 "use server" 文件导出的函数，
 * 和 expected.json 的键逐条对。推送前钩子固定跑它。
 *
 * 扫法和 matrix.test.ts 对齐：
 *   路由：src/app 下的 route.ts，网址去掉路由组 (xxx)；方法取 GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS
 *   动作：文件第一条语句是 "use server"（前面只许有注释），导出的每个函数一条，键「动作 <src 相对路径>#<导出名>」
 * 两边扫出来的东西对不上时，以 matrix.test.ts（真 import）为准，改这里的正则。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 源根 = path.resolve(__dirname, "../src");
const 表 = JSON.parse(fs.readFileSync(path.resolve(__dirname, "permissions/expected.json"), "utf8")) as { 接口: Record<string, unknown> };

const 走 = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? 走(path.join(d, e.name)) : [path.join(d, e.name)]));
const 全部文件 = 走(源根).filter((f) => !f.includes(`${path.sep}generated${path.sep}`));
const 方法们 = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** 去掉注释，免得注释里的 export 被当真 */
const 去注释 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

/** 源码里导出的名字：export [async] function X / export const|let X / export { a, b as c }；export default 记作 default。类型导出不算 */
function 导出名(源: string): string[] {
  const s = 去注释(源);
  const 名 = new Set<string>();
  for (const m of s.matchAll(/^\s*export\s+(?:async\s+)?function\s*\*?\s*([\p{L}_$][\p{L}\p{N}_$]*)/gmu)) 名.add(m[1]);
  for (const m of s.matchAll(/^\s*export\s+(?:const|let|var)\s+([\p{L}_$][\p{L}\p{N}_$]*)/gmu)) 名.add(m[1]);
  for (const m of s.matchAll(/^\s*export\s*\{([^}]*)\}(?!\s*from)/gm)) {
    for (const 项 of m[1].split(",")) {
      const t = 项.trim();
      if (!t || t.startsWith("type ")) continue;
      名.add((t.split(/\s+as\s+/)[1] ?? t).trim());
    }
  }
  if (/^\s*export\s+default\s+(?:async\s+)?function/m.test(s)) 名.add("default");
  return [...名];
}

const 是动作文件 = (f: string) => /\.tsx?$/.test(f) && /^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/.test(fs.readFileSync(f, "utf8"));
const 网址of = (f: string) => "/" + path.relative(path.join(源根, "app"), path.dirname(f)).split(path.sep).filter((s) => !/^\(.*\)$/.test(s)).join("/");

const 扫到 = new Set<string>();
for (const f of 全部文件.filter((x) => path.basename(x) === "route.ts" && x.startsWith(path.join(源根, "app")))) {
  const 名 = new Set(导出名(fs.readFileSync(f, "utf8")));
  for (const m of 方法们) if (名.has(m)) 扫到.add(`${m} ${网址of(f)}`);
}
for (const f of 全部文件.filter(是动作文件)) {
  const 相对 = path.relative(源根, f).split(path.sep).join("/");
  for (const n of 导出名(fs.readFileSync(f, "utf8"))) 扫到.add(`动作 ${相对}#${n}`);
}

describe("权限表和代码对得上（静态，不连库）", () => {
  it("扫得到东西（扫描本身没坏）", () => {
    expect([...扫到].filter((k) => !k.startsWith("动作 ")).length).toBeGreaterThan(50);
    expect([...扫到].filter((k) => k.startsWith("动作 ")).length).toBeGreaterThan(200);
  });

  it("每个扫出来的接口表里都有，表里每条代码里都还在", () => {
    const 缺 = [...扫到].filter((k) => !表.接口[k]).sort();
    const 多 = Object.keys(表.接口).filter((k) => !扫到.has(k)).sort();
    expect(缺, `新加接口要补表（tests/permissions/expected.json，可以 PERM_TABLE=write npx vitest run tests/permissions/matrix.test.ts 先录再审）：\n${缺.join("\n")}`).toEqual([]);
    expect(多, `表里有、代码里已经没有了，从 expected.json 删掉：\n${多.join("\n")}`).toEqual([]);
  });
});
