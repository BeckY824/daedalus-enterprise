/**
 * 推送前钩子用：估「vitest related」会选中多少个用例文件，不实际跑（11-17）。
 *
 *   printf '%s\n' <改动文件和要加跑的用例…> | node hooks/count-related.mjs [--max 150]
 *   输出最后一行：<个数> <算法> <耗时ms>
 *
 * 两步，先便宜后准：
 *   1. 依赖图（约 0.2 秒）：正则扫 src / tests / scripts 等的 import、export from、import()、require()、vi.mock()，
 *      解析 @/ 和相对路径，从改动文件反向找到会引到它的 tests/**\/*.test.ts。跳过 `import type`。
 *      它比 vitest 的结果宽（vitest 看的是转译后的依赖：只当类型用、没写 type 的 import 会被去掉），
 *      11-17 在 5 个文件上对拍：vitest 选中的都在这里面，这里多出 20%–130%。所以 ≤ 上限 时 vitest 也一定 ≤ 上限，直接回。
 *   2. 超过上限才用 vitest 自己的算法核实（vitest/node 的 createVitest + filterTestsBySource，和 vitest related 同一套，
 *      只转译不跑，约 6 秒）：回 vitest 的准数。
 * 改到 vitest 的 forceRerunTriggers（package.json、vitest / vite 配置）时 vitest related 会跑全部，第 1 步直接当超上限交第 2 步。
 * 出错时退出码非 0，钩子照旧跑相关用例（宁可多跑）。
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const 参数 = process.argv.slice(2);
const 上限 = 参数.includes("--max") ? Number(参数[参数.indexOf("--max") + 1]) : 150;
const 只要依赖图 = 参数.includes("--graph-only");
const 只要vitest = 参数.includes("--vitest-only");
const 输入 = fs.readFileSync(0, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const 起 = Date.now();

const EXT = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".cjs"];
const 走 = (d) =>
  fs.existsSync(d)
    ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.name === "node_modules" || e.name === "generated" || e.name.startsWith(".")
          ? []
          : e.isDirectory()
            ? 走(path.join(d, e.name))
            : EXT.includes(path.extname(e.name))
              ? [path.join(d, e.name)]
              : [],
      )
    : [];

function 依赖图个数() {
  const 全部 = ["src", "tests", "scripts", "deploy", "prisma", "e2e"].flatMap((d) => 走(path.join(root, d)));
  for (const f of ["next.config.ts"]) if (fs.existsSync(path.join(root, f))) 全部.push(path.join(root, f));
  const 解析 = (from, spec) => {
    let base;
    if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
    else return null;
    const 候选 = [base, ...EXT.map((e) => base + e), ...EXT.map((e) => path.join(base, "index" + e))];
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
  const 见过 = new Set(输入.map((f) => path.resolve(root, f)));
  const 队 = [...见过];
  while (队.length) {
    for (const i of 谁引了.get(队.pop()) ?? []) {
      if (见过.has(i)) continue;
      见过.add(i);
      队.push(i);
    }
  }
  return [...见过].filter((f) => /^tests[\\/].*\.test\.ts$/.test(path.relative(root, f))).length;
}

async function vitest个数() {
  const { createVitest } = await import("vitest/node");
  const v = await createVitest("test", { watch: false, run: true, related: 输入.map((f) => path.resolve(root, f)), passWithNoTests: true }, {}, {});
  try {
    const 全部 = await v.globTestSpecifications();
    return (await v.specifications.filterTestsBySource(全部)).length;
  } finally {
    await v.close();
  }
}

const 全跑触发 = 输入.some((f) => /(^|\/)package\.json$|(^|\/)(vitest|vite)\.config\./.test(f));
if (!只要vitest) {
  const g = 全跑触发 ? Infinity : 依赖图个数();
  if (只要依赖图 || g <= 上限) {
    console.log(`${g} 依赖图 ${Date.now() - 起}`);
    process.exit(0);
  }
}
console.log(`${await vitest个数()} vitest ${Date.now() - 起}`);
