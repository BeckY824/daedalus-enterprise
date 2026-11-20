#!/usr/bin/env node
/**
 * 测试影响分析（11-17，简化版）：改了哪些文件 → 该跑哪些单测文件。CI 的 PR 单测和推送前钩子共用这一份。
 *
 *   node scripts/ci/related-tests.mjs select --base <提交> [--head HEAD] [--shards 8]   # CI 用：写 GITHUB_OUTPUT（没有就打到标准输出）
 *   node scripts/ci/related-tests.mjs select --all [--shards 8]                         # 推 main / PR 全套：全部用例按耗时分片
 *   node scripts/ci/related-tests.mjs timing <vitest json 报告…>                        # 用 CI 的 vitest-timing-*.json 重写耗时表
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
 *   3. 分片（11-20 批次 32A 起按耗时）：按 scripts/ci/unit-timing.json 记的每个用例在 CI 上的秒数，最慢的先放、每次放进当前最轻的一片
 *      （LPT）。全套也这样分（原来交给 vitest --shard，它按文件个数切、不看耗时：最慢一片 ~620 秒、最快 ~220 秒，最慢那片就是整轮 CI 的关键路径）。
 *      表里没有的新用例按中位数算；表旧了只是分得不那么匀，不会漏跑。相关模式用例少时只用前几片（每片凑够 相关每片秒数），
 *      分不到的那片直接通过（job 名不变）
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const 代码后缀 = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".cjs"];

/** 耗时表（仓库内路径 → 秒），见文件头第 3 条；读不到就当空表（全按中位数 = 按个数均分） */
export function 读耗时(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "scripts/ci/unit-timing.json"), "utf8")).秒 ?? {};
  } catch {
    return {};
  }
}

/**
 * 每个用例文件另有的固定开销（秒）：耗时表记的是文件里用例跑了多久，vitest 还要转译、import（11-20 main 两轮 16 片：
 * Duration − 用例合计 ≈ 每文件 0.5–1.25 秒，取 0.8）。不加的话小文件多的那片会被低估（按表 375 秒的片里塞进 322 个文件）
 */
export const 每文件开销 = 0.8;

/** 按耗时分片（LPT）：最慢的先放，每次放进当前合计最少的那片；同秒数按名字排，同一输入同一结果。每片内按名字排 */
export function 按耗时分片(用例, 分片数, 耗时 = {}) {
  const 秒 = 估秒(耗时);
  const 排 = [...new Set(用例)].sort((a, b) => 秒(b) - 秒(a) || (a < b ? -1 : a > b ? 1 : 0));
  const 片 = Array.from({ length: 分片数 }, () => ({ 秒: 0, 用例: [] }));
  for (const t of 排) {
    let m = 0;
    for (let i = 1; i < 片.length; i++) if (片[i].秒 < 片[m].秒) m = i;
    片[m].用例.push(t);
    片[m].秒 += 秒(t);
  }
  return 片.map((s) => s.用例.sort());
}

/**
 * 相关模式每片至少凑多少秒才开下一片（11-20 批次 32A）：每片光起容器、装依赖、生成 Prisma 就要 ~1.5 分钟，
 * 牵连 28 个静态守门（~1 分钟）原来也摊进 8 台机器。300 秒 = 单测片最长 ~7 分钟，不比 E2E 慢；牵连很多时照旧用满 8 片
 */
export const 相关每片秒数 = 300;

/** 一个用例文件估多少秒：耗时表的秒数（没记的按中位数）+ 每文件开销 */
export function 估秒(耗时 = {}) {
  const 已知 = Object.values(耗时).filter((n) => typeof n === "number" && n >= 0).sort((a, b) => a - b);
  const 缺省 = 已知.length ? 已知[Math.floor(已知.length / 2)] : 1;
  return (t) => (typeof 耗时[t] === "number" ? 耗时[t] : 缺省) + 每文件开销;
}

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

/** tests/ 下全部用例（同 vitest.config.ts 的 include：tests/**\/*.test.ts），仓库内路径、排好序 */
export const 全部用例 = (root) => 走(path.join(root, "tests")).map((f) => path.relative(root, f).split(path.sep).join("/")).filter(是用例).sort();

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
  const 全套 = (原因) => {
    const 用例 = 全部用例(root);
    return { 模式: "全套", 原因, 用例, 分片: 按耗时分片(用例, 分片数, 读耗时(root)) };
  };
  const 触发 = 改动.find((c) => 全套触发.some((r) => r.test(c.路径)));
  if (触发) return 全套(`改到 ${触发.路径}`);
  const 删改名 = 改动.find((c) => /^[DR]/.test(c.状态) && 代码后缀.includes(path.extname(c.路径)));
  if (删改名) return 全套(`删了或改名了 ${删改名.路径}`);
  const 非代码 = 改动.find((c) => /^(src|public|deploy)\//.test(c.路径) && !代码后缀.includes(path.extname(c.路径)) && !c.路径.endsWith(".md"));
  if (非代码) return 全套(`改到非代码文件 ${非代码.路径}（测试可能按路径读，静态算不准）`);
  const 在的 = 改动.filter((c) => !/^D/.test(c.状态)).map((c) => c.路径);
  const 用例 = [...new Set([...依赖图用例(root, 在的), ...按路径引用的用例(root, 在的), ...静态守门(root)])].filter((t) => fs.existsSync(path.join(root, t))).sort();
  // 牵连的用例少就少用几片：每片按耗时表凑够 相关每片秒数 再开下一片，多出来的片空着、直接通过（不占 runner 装依赖）
  const 耗时 = 读耗时(root);
  const 合计 = 用例.reduce((n, t) => n + 估秒(耗时)(t), 0);
  const 用片 = Math.min(分片数, Math.max(1, Math.ceil(合计 / 相关每片秒数)));
  const 分片 = [...按耗时分片(用例, 用片, 耗时), ...Array.from({ length: 分片数 - 用片 }, () => [])];
  return { 模式: "相关", 原因: `${改动.length} 个改动文件牵连 ${用例.length} 个用例（含静态守门），约 ${Math.round(合计)} 秒、用 ${用片} 片`, 用例, 分片 };
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
  } else if (命令 === "timing") {
    // 每个文件取几轮的平均，保留 1 位小数；只收 tests/ 下的用例
    const 合 = new Map();
    for (const f of 参数) {
      for (const r of JSON.parse(fs.readFileSync(f, "utf8")).testResults ?? []) {
        const rel = String(r.name).replace(/^.*?\/tests\//, "tests/");
        if (!是用例(rel) || !(r.endTime >= r.startTime)) continue;
        const a = 合.get(rel) ?? [];
        a.push((r.endTime - r.startTime) / 1000);
        合.set(rel, a);
      }
    }
    const 秒 = Object.fromEntries([...合].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, Math.round((v.reduce((x, y) => x + y, 0) / v.length) * 10) / 10]));
    const 说明 = "CI 单测分片用的每个用例耗时（秒）。重写：从 main 上几轮全套 CI 下载 vitest-timing-* 产物，node scripts/ci/related-tests.mjs timing <json…> > scripts/ci/unit-timing.json";
    console.log(JSON.stringify({ 说明, 秒 }, null, 0).replace(/,"/g, ',\n"'));
  } else if (命令 === "select") {
    const 全 = 参数.includes("--all");
    const base = 取("--base");
    if (!全 && !base) {
      console.error("用法：node scripts/ci/related-tests.mjs select --base <提交> [--head HEAD] [--shards 8] | select --all [--shards 8]");
      process.exit(2);
    }
    const 分片数 = Number(取("--shards", 8));
    const r = 全
      ? (() => {
          const 用例 = 全部用例(root);
          return { 模式: "全套", 原因: "全套", 用例, 分片: 按耗时分片(用例, 分片数, 读耗时(root)) };
        })()
      : 选单测({ root, 改动: 读改动(root, base, 取("--head", "HEAD")), 分片数 });
    const 行 = [`mode=${r.模式 === "全套" ? "full" : "related"}`, `reason=${r.原因}`, `count=${r.用例.length}`, `shards=${JSON.stringify(r.分片)}`];
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 行.join("\n") + "\n");
    console.log(`${r.模式}：${r.原因}（${r.用例.length} 个用例）`);
    const 秒 = 估秒(读耗时(root));
    r.分片.forEach((s, i) => console.log(`  片 ${i + 1}：${s.length} 个，按耗时表约 ${Math.round(s.reduce((n, t) => n + 秒(t), 0))} 秒`));
  } else {
    console.error("用法：select --base <提交> | graph（标准输入给文件列表）");
    process.exit(2);
  }
}
