/**
 * UI 测试（*.ui.test.ts）里服务端动作文件的桩，按源码自动补全导出（11-17）。
 *
 * UI 测试用 esbuild 把组件打成浏览器包，"use server" 文件（prisma、通知那一串进不了浏览器）各自手写一个桩模块。
 * main 给动作文件加了新导出、组件一用，手写的桩没跟上，打包就报「No matching export in fixture: … for import "新导出"」
 * ——11-17 一天 4 次推送挂在这上面。
 *
 * 用法：手写的桩照旧写要特别返回值的那几个，外面包一层，源文件里其余导出自动补成空跑：
 *   stub(/follow-method-actions$/, 补全动作桩("src/app/(app)/follow-method-actions.ts", "export const 沟通方式选项=async()=>window.__方式们;", "async()=>null"));
 * - 源文件按文本读导出名，不 import（动作文件 import prisma，测试进程里也不想加载）
 * - 手写桩里已经有的名字不动；没有的补 `export const 名=<默认>;`，默认 async()=>({ok:true})
 * - 路径写成仓库内路径（src/…）：推送前钩子按路径在 tests/ 里搜，动作文件一改，用它的 UI 测试就会被选中
 */
import fs from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";

const 仓库 = path.resolve(__dirname, "../..");
export const 空跑 = "async()=>({ok:true})";

/** 去掉注释，免得注释里的 export 被当真 */
const 去注释 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

/**
 * 源码文本里导出的值（不含类型）：export [async] function X / export const|let|var X / export { a, b as c }；export default 记作 default。
 * tests/permissions-table-keys.test.ts 也用这一份（权限表对键）
 */
export function 导出名(源: string): string[] {
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

/** 仓库内路径的源文件的导出名；文件不在了直接报错（动作文件改名要跟着改测试） */
export function 文件导出名(仓库内路径: string): string[] {
  const f = path.resolve(仓库, 仓库内路径);
  if (!fs.existsSync(f)) throw new Error(`补全动作桩：${仓库内路径} 不存在（改名了？）`);
  return 导出名(fs.readFileSync(f, "utf8"));
}

/** 一段桩代码已经导出了哪些名字：让 esbuild 解析（比正则可靠：`export const a=f,b=f` 这种逗号串也认得） */
function 桩已导出(代码: string): string[] {
  if (!代码.trim()) return [];
  const r = buildSync({ stdin: { contents: 代码, loader: "jsx" }, write: false, metafile: true, format: "esm", logLevel: "silent" });
  return Object.values(r.metafile.outputs).flatMap((o) => o.exports);
}

/**
 * 手写的桩 + 源文件其余导出补成 默认。返回的是一段 ESM 代码，当 fixture 模块的内容用。
 * @param 仓库内路径 动作文件，如 "src/app/(app)/follow-method-actions.ts"
 * @param 手写 要特别返回值的那几个，写法同以前（可空）
 * @param 默认 其余导出的实现，默认 async()=>({ok:true})
 */
export function 补全动作桩(仓库内路径: string, 手写 = "", 默认 = 空跑): string {
  const 已有 = new Set(桩已导出(手写));
  const 补 = 文件导出名(仓库内路径).filter((n) => !已有.has(n));
  return `${手写}${手写.trim() && !/;\s*$/.test(手写) ? ";" : ""}${补.map((n) => (n === "default" ? `export default ${默认};` : `export const ${n}=${默认};`)).join("")}`;
}
