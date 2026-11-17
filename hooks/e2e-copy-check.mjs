#!/usr/bin/env node
/**
 * 推送前提示：这次改动删掉或改掉的中文文案，e2e 里还在用（11-17 复盘第 10 类：CI 红在「E2E 期待旧文案」，本机不跑 E2E）。
 *
 * 用法（pre-push 调）：node hooks/e2e-copy-check.mjs <base> <sha> [<base> <sha> …]
 * 只提示、不拦（复盘建议「搜到就提示」）：文案改对了、e2e 也该跟着改，是不是真要改由人看。
 *
 * 怎么认：
 *   1. 取 e2e / e2e-ent / e2e-layout 里（推送的那个提交）非注释行上的中文片段（连续 2 个以上汉字，可夹中文标点）；
 *   2. 片段出现在 src/ 这次删掉的行里（git diff -U0 的「-」行），
 *   3. 而推送的那个提交的 src/ 里已经搜不到它了 —— 只是挪了位置、别处还在用的不报。
 * 一律只读 git 对象，不看工作区（推的不一定是当前检出的）。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 目录 = ["e2e", "e2e-ent", "e2e-layout"];
// git 钩子里会带 GIT_DIR 等：去掉，按 cwd 找仓库（钩子开头也清过，这里单独跑也稳）
const env = { ...process.env };
for (const k of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX)$/.test(k)) delete env[k];
const git = (args, 允许没结果 = false) => {
  try {
    return execFileSync("git", ["-c", "core.quotePath=false", ...args], { env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    // git grep 没搜到时退出码 1
    if (允许没结果 && e.status === 1) return "";
    throw e;
  }
};

const 汉字 = /[㐀-鿿]/g;
// 中文片段：汉字开头结尾，中间可夹中文标点和全角符号
const 片段式 = /[㐀-鿿](?:[㐀-鿿　-〿！-～]*[㐀-鿿])?/g;

/** 一行里的中文片段（至少 2 个汉字）。注释行、行尾 // 注释不算 */
export function 中文片段(行) {
  const t = 行.trim();
  if (/^(\/\/|\/\*|\*|#)/.test(t)) return [];
  const 去注释 = t.replace(/\s\/\/\s.*$/, "");
  return (去注释.match(片段式) ?? []).filter((s) => (s.match(汉字) ?? []).length >= 2);
}

/** 这几段改动在 src/ 里删掉的行 */
function 删掉的行(段) {
  const 行 = [];
  for (const [base, sha] of 段) {
    for (const l of git(["diff", "-U0", "--no-color", "--no-ext-diff", base, sha, "--", "src"]).split("\n")) {
      if (l.startsWith("-") && !l.startsWith("---")) 行.push(l.slice(1));
    }
  }
  return 行;
}

/** e2e 里每个中文片段在哪些位置（目录:行号） */
function e2e片段(sha) {
  const 位置 = new Map();
  const 出 = git(["grep", "-n", "-I", "--full-name", "-e", "[^ -~]", sha, "--", ...目录], true);
  for (const l of 出.split("\n")) {
    // <sha>:<path>:<行号>:<内容>
    const m = l.match(/^[^:]+:([^:]+):(\d+):(.*)$/);
    if (!m) continue;
    for (const s of 中文片段(m[3])) {
      const 处 = 位置.get(s) ?? [];
      处.push(`${m[1]}:${m[2]}`);
      位置.set(s, 处);
    }
  }
  return 位置;
}

export function 查(段) {
  if (!段.length) return [];
  const sha = 段[段.length - 1][1];
  const 删 = 删掉的行(段);
  if (!删.length) return [];
  const 删文 = 删.join("\n");
  const 候选 = [...e2e片段(sha).entries()].filter(([s]) => 删文.includes(s));
  if (!候选.length) return [];
  // 推送的提交里 src/ 还有的：只是挪了，不报。一次取出 src/ 里带非 ASCII 字符的行（约 8MB、0.2 秒）再逐个找，
  // 比 git grep -o 多个 -F 快得多，也不会因为「市场管」被更长的「市场管理」先匹配掉而误报
  const src文 = git(["grep", "-h", "-I", "-e", "[^ -~]", sha, "--", "src"], true);
  return 候选.filter(([s]) => !src文.includes(s)).map(([s, 处]) => ({ 文案: s, 位置: [...new Set(处)] }));
}

// 直接跑才执行（被测试 import 时不跑）；路径带中文、空格时 import.meta.url 是转义过的，所以比文件路径
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = process.argv.slice(2);
  const 段 = [];
  for (let i = 0; i + 1 < a.length; i += 2) 段.push([a[i], a[i + 1]]);
  let 结果 = [];
  try {
    结果 = 查(段);
  } catch (e) {
    // 只是提示：出错不挡推送
    console.log(`  - e2e 旧文案提示没跑成：${String(e?.message ?? e).split("\n")[0]}`);
    process.exit(0);
  }
  if (结果.length) {
    console.log(`  ⚠ 这次删掉/改掉的中文文案，e2e 里还在用（本机不跑 E2E，CI 才会红），记得同步改 e2e：`);
    for (const { 文案, 位置 } of 结果.slice(0, 20)) {
      console.log(`      「${文案}」 ${位置.slice(0, 3).join("、")}${位置.length > 3 ? ` 等 ${位置.length} 处` : ""}`);
    }
    if (结果.length > 20) console.log(`      …另有 ${结果.length - 20} 条`);
  }
}
