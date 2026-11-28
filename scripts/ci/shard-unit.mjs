#!/usr/bin/env node
/**
 * 单测全套分片（11-28 O4）：按耗时均分，替代 vitest --shard（它按文件数切，8 片实测 334–752 秒不等，最慢那片就是关键路径）。
 *
 *   node scripts/ci/shard-unit.mjs <第几片> <共几片>   # 打印这一片的用例文件，空格分隔
 *   node scripts/ci/shard-unit.mjs --check <共几片>    # 校验：每个用例恰好落一片、不丢不重
 *
 * 耗时表 scripts/ci/unit-timing.json 来自 main 上一轮全套 CI 的 vitest-timing-N 产物（文件 → 秒）。
 * 表里没有的新用例按表中位数算；表旧了只影响均衡，不影响跑没跑——用例清单永远从 tests/ 目录现扫。
 * 贪心：从大到小，每个放进当前最轻的一片（并列取编号小的，结果确定）。
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const 走 = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? 走(path.join(d, e.name)) : [path.join(d, e.name)],
  );
export const 全部用例 = () => 走(path.join(root, "tests")).map((f) => path.relative(root, f).split(path.sep).join("/")).filter((r) => /^tests\/.+\.test\.ts$/.test(r)).sort();

export function 分(用例, 耗时, n) {
  const 值 = Object.values(耗时).sort((a, b) => a - b);
  const 中位 = 值.length ? 值[Math.floor(值.length / 2)] : 1;
  const 重 = (t) => Math.max(耗时[t] ?? 中位, 1); // 下限 1 秒：每个文件有固定起收开销，别让一堆 0 秒文件全堆到一片
  const 片 = Array.from({ length: n }, () => ({ 秒: 0, 文件: [] }));
  for (const t of [...用例].sort((a, b) => 重(b) - 重(a) || (a < b ? -1 : 1))) {
    const 轻 = 片.reduce((m, p) => (p.秒 < m.秒 ? p : m));
    轻.秒 += 重(t);
    轻.文件.push(t);
  }
  return 片;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const 耗时 = JSON.parse(fs.readFileSync(path.join(root, "scripts/ci/unit-timing.json"), "utf8"));
  const 用例 = 全部用例();
  if (process.argv[2] === "--check") {
    const n = Number(process.argv[3] ?? 8);
    const 片 = 分(用例, 耗时, n);
    const 见 = 片.flatMap((p) => p.文件);
    if (见.length !== 用例.length || new Set(见).size !== 用例.length) { console.error("分片丢了或重了用例"); process.exit(1); }
    console.log(`共 ${用例.length} 个用例，${n} 片：` + 片.map((p) => `${p.文件.length}个/${Math.round(p.秒)}秒`).join(" "));
  } else {
    const i = Number(process.argv[2]), n = Number(process.argv[3]);
    if (!(i >= 1 && i <= n)) { console.error("用法：shard-unit.mjs <第几片> <共几片>"); process.exit(2); }
    const 文件 = 分(用例, 耗时, n)[i - 1].文件;
    if (!文件.length) { console.error("这片是空的"); process.exit(1); }
    console.log(文件.join(" "));
  }
}
