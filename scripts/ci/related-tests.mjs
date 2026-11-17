#!/usr/bin/env node
/**
 * 测试影响分析（11-17，简化版）：改了哪些文件 → 该跑哪些单测文件。CI 的 PR 单测和推送前钩子共用这一份。
 *
 *   node scripts/ci/related-tests.mjs select --base <提交> [--head HEAD] [--shards 8]   # CI 用：写 GITHUB_OUTPUT（没有就打到标准输出）
 *   printf '%s\n' <文件…> | node scripts/ci/related-tests.mjs graph                      # 只出依赖图选中的用例，一行一个
 *
 * 怎么选（宁可多跑）：
 *   1. 退回全套：改到 全套触发 里的路径（prisma/、依赖、vitest / vite / tsconfig / eslint 配置、.github/、hooks/、测试库建表），
 *      删了 / 改名了代码文件，或改了 src / public / deploy 下的非代码文件（样式、json 之类，测试可能按路径拼出来读，静态算不准）
 *   2. 否则 = 依赖图 ∪ 按路径引用 ∪ 静态守门：
 *      - 依赖图：正则扫 import / export from / import() / require() / vi.mock()（含 UI 测试里给 esbuild 的模板串），解析 @/ 和相对路径，
 *        从改动文件反向找到会引到它的 tests/**\/*.test.ts。跳过 `import type`。和 vitest related 同一思路（顺着 import 反查），
 *        但不转译：只当类型用、没写 type 的 import 也算上，所以选得比 vitest 宽（11-17 在 5 个文件上对拍：vitest 选中的都在里面）；
 *        UI 测试模板串里 import 的组件 vitest 看不见，这里看得见
 *      - 按路径引用：用例里按路径读源码的（readFileSync("src/…")、补全动作桩("src/…")），用「仓库内路径」和「上一级目录/文件名」两种写法搜，
 *        同推送前钩子
 *      - 静态守门：hooks/static-guards.txt，不 import 业务代码，谁也选不中，固定跑
 *   3. 分片：选中的按文件名排序后轮流分进 N 片；分不到的那片直接通过（job 名不变）
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const 代码后缀 = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".cjs"];

/** 改到就退回全套（路径前缀或整名） */
export const 全套触发 = [
  /^prisma\//,
  /^package(-lock)?\.json$/,
  /(^|\/)(vitest|vite)\.config\./,
  /^tsconfig[^/]*\.json$/,
  /^eslint\.config\./,
  /^\.github\//,
  /^hooks\//,
  /^tests\/setup-db\.ts$/,
  /^scripts\/build-template\.mjs$/,
  /^next\.config\./,
];

const 是用例 = (rel) => /^tests\/.+\.test\.ts$/.test(rel);

const 走 = (d) =>
  fs.existsSync(d)
    ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.name === "node_modules" || e.name === "generated" || e.name.startsWith(".")
          ? []
          : e.isDirectory()
            ? 走(path.join(d, e.name))
            : 代码后缀.includes(path.extname(e.name))
              ? [path.join(d, e.name)]
              : [],
      )
    : [];

/** 依赖图：从这些文件（仓库内路径）反向找到的用例（仓库内路径，排好序） */
export function 依赖图用例(root, 文件们) {
  const 全部 = ["src", "tests", "scripts", "deploy", "prisma", "e2e"].flatMap((d) => 走(path.join(root, d)));
  for (const f of ["next.config.ts"]) if (fs.existsSync(path.join(root, f))) 全部.push(path.join(root, f));
  const 解析 = (from, spec) => {
    let base;
    if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
    else return null;
    const 候选 = [base, ...代码后缀.map((e) => base + e), ...代码后缀.map((e) => path.join(base, "index" + e))];
    if (/\.m?js$/.test(base)) 候选.push(base.replace(/\.m?js$/, ".ts"), base.replace(/\.m?js$/, ".tsx"));
    return 候选.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
  };
  const RE = /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^'"`;]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)|vi\.mock\(\s*["']([^"']+)["']/g;
  const 谁引了 = new Map();
  for (const f of 全部) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(RE)) {
      if (m[1]) continue;
      const r = 解析(f, m[2] ?? m[3] ?? m[4] ?? m[5]);
      if (!r) continue;
      if (!谁引了.has(r)) 谁引了.set(r, new Set());
      谁引了.get(r).add(f);
    }
  }
  const 见过 = new Set(文件们.map((f) => path.resolve(root, f)));
  const 队 = [...见过];
  while (队.length) {
    for (const i of 谁引了.get(队.pop()) ?? []) {
      if (见过.has(i)) continue;
      见过.add(i);
      队.push(i);
    }
  }
  return [...见过].map((f) => path.relative(root, f).split(path.sep).join("/")).filter(是用例).sort();
}

/** 按路径引用：用例文本里出现「仓库内路径」或「上一级目录/文件名」的（同 hooks/pre-push 的 grep） */
export function 按路径引用的用例(root, 文件们) {
  const 用例们 = 走(path.join(root, "tests")).map((f) => path.relative(root, f).split(path.sep).join("/")).filter(是用例);
  const 文本 = new Map(用例们.map((t) => [t, fs.readFileSync(path.join(root, t), "utf8")]));
  const 中 = new Set();
  for (const f of 文件们) {
    if (f.startsWith("tests/")) continue;
    const 短 = `${path.posix.basename(path.posix.dirname(f))}/${path.posix.basename(f)}`;
    for (const [t, s] of 文本) if (s.includes(f) || s.includes(短)) 中.add(t);
  }
  return [...中].sort();
}

export const 静态守门 = (root) =>
  fs.readFileSync(path.join(root, "hooks/static-guards.txt"), "utf8").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));

/**
 * @param {{ root: string; 改动: { 状态: string; 路径: string }[]; 分片数?: number }} p  状态同 git diff --name-status（A/M/D/R…）
 * @returns {{ 模式: "全套" | "相关"; 原因: string; 用例: string[]; 分片: string[][] }}
 */
export function 选单测({ root, 改动, 分片数 = 8 }) {
  const 全套 = (原因) => ({ 模式: "全套", 原因, 用例: [], 分片: [] });
  const 触发 = 改动.find((c) => 全套触发.some((r) => r.test(c.路径)));
  if (触发) return 全套(`改到 ${触发.路径}`);
  const 删改名 = 改动.find((c) => /^[DR]/.test(c.状态) && 代码后缀.includes(path.extname(c.路径)));
  if (删改名) return 全套(`删了或改名了 ${删改名.路径}`);
  const 非代码 = 改动.find((c) => /^(src|public|deploy)\//.test(c.路径) && !代码后缀.includes(path.extname(c.路径)) && !c.路径.endsWith(".md"));
  if (非代码) return 全套(`改到非代码文件 ${非代码.路径}（测试可能按路径读，静态算不准）`);
  const 在的 = 改动.filter((c) => !/^D/.test(c.状态)).map((c) => c.路径);
  const 用例 = [...new Set([...依赖图用例(root, 在的), ...按路径引用的用例(root, 在的), ...静态守门(root)])].filter((t) => fs.existsSync(path.join(root, t))).sort();
  const 分片 = Array.from({ length: 分片数 }, () => []);
  用例.forEach((t, i) => 分片[i % 分片数].push(t));
  return { 模式: "相关", 原因: `${改动.length} 个改动文件牵连 ${用例.length} 个用例（含静态守门）`, 用例, 分片 };
}

/** git diff --name-status -M 的输出 → 改动；改名的两头都记上 */
export function 读改动(root, base, head = "HEAD") {
  const 出 = execFileSync("git", ["-c", "core.quotePath=false", "diff", "--name-status", "-M", base, head], { cwd: root, encoding: "utf8" });
  return 出.split("\n").filter(Boolean).flatMap((l) => {
    const [状态, ...路径们] = l.split("\t");
    return 路径们.map((p) => ({ 状态, 路径: p }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = process.cwd();
  const [命令, ...参数] = process.argv.slice(2);
  const 取 = (k, d) => (参数.includes(k) ? 参数[参数.indexOf(k) + 1] : d);
  if (命令 === "graph") {
    const 文件们 = fs.readFileSync(0, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
    console.log(依赖图用例(root, 文件们).join("\n"));
  } else if (命令 === "select") {
    const base = 取("--base");
    if (!base) {
      console.error("用法：node scripts/ci/related-tests.mjs select --base <提交> [--head HEAD] [--shards 8]");
      process.exit(2);
    }
    const r = 选单测({ root, 改动: 读改动(root, base, 取("--head", "HEAD")), 分片数: Number(取("--shards", 8)) });
    const 行 = [`mode=${r.模式 === "全套" ? "full" : "related"}`, `reason=${r.原因}`, `count=${r.用例.length}`, `shards=${JSON.stringify(r.分片)}`];
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 行.join("\n") + "\n");
    console.log(`${r.模式}：${r.原因}`);
    r.分片.forEach((s, i) => console.log(`  片 ${i + 1}：${s.length} 个`));
  } else {
    console.error("用法：select --base <提交> | graph（标准输入给文件列表）");
    process.exit(2);
  }
}
