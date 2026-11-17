/**
 * 推送前钩子用：估「vitest related」会选中多少个用例文件，不实际跑（11-17）。
 *
 *   printf '%s\n' <改动文件和要加跑的用例…> | node hooks/count-related.mjs [--max 150]
 *   输出最后一行：<个数> <算法> <耗时ms>
 *
 * 两步，先便宜后准：
 *   1. 依赖图（约 0.2 秒，scripts/ci/related-tests.mjs 依赖图用例，CI 的 PR 相关单测同一份）：正则扫 src / tests / scripts 等的 import、export from、import()、require()、vi.mock()，
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
import { 依赖图用例 } from "../scripts/ci/related-tests.mjs";

const root = process.cwd();
const 参数 = process.argv.slice(2);
const 上限 = 参数.includes("--max") ? Number(参数[参数.indexOf("--max") + 1]) : 150;
const 只要依赖图 = 参数.includes("--graph-only");
const 只要vitest = 参数.includes("--vitest-only");
const 输入 = fs.readFileSync(0, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const 起 = Date.now();

// 依赖图和 CI 的 PR 相关单测同一份（scripts/ci/related-tests.mjs）
const 依赖图个数 = () => 依赖图用例(root, 输入).length;

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
