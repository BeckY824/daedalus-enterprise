/**
 * 设计语言 E6 · D01：`--text-faint`（白底 2.21:1，:root 注释明写「不许当正文」）被当成要读的字色——空值、计数、时间、权限锁提示、分组标题……
 * 规矩（落地计划 E6 收尾）：faint 只许给 placeholder / 禁用 / 装饰（分隔符、箭头、拖手这类不用读的）。
 *
 * 各批改到哪页就把那页的 faint 字换 muted，一次换不完，所以：
 *   1. 新写 `color: var(--text-faint)` 的规则，选择器得一眼看出是 placeholder / disabled / ::before / ::after / 分隔 / 装饰
 *   2. 下面是 11-22 盘点剩下的老规则（52 条；11-23 跟 main 划掉 1 条、补 2 条，共 53 条；有的是真装饰，如 caret / grip / arrow），只减不增：换成 muted 或删了，从名单里划掉
 *   3. ts / tsx 里写死的 faint 字色不超过 1 处
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 源, 去注释 } from "./css-read";

const 许 = /placeholder|disabled|::?(before|after)|decor|-sep|divider|ghost/i;
const 老规则 = [
  ".rail-search",
  ".rail-search kbd",
  ".notice-meta",
  ".rail-num",
  ".rail-upd-v",
  ".aitask-m",
  ".fbt-x",
  ".rail-ask-k",
  ".rail-user-caret",
  ".chat-g-h",
  ".chat-row-m",
  ".roster-car",
  ".roster-cnt",
  ".roster-stage",
  ".pane-kbd",
  ".rec-star.ant-btn",
  ".rec-empty",
  ".proj-stage-tab.is-away",
  ".proj-stage-node",
  ".proj-stage-exit",
  ".rec-chip-caret",
  ".rec-page .rec-empty",
  ".ais-mark",
  ".ais-raw",
  ".ais-thought summary",
  ".ais-more",
  ".aiw-sec",
  ".aiw-slow",
  ".bill-tip",
  ".prop-f-arrow",
  ".prop-note",
  ".cli-bar-t",
  ".cli-file button",
  ".cli-deadend-n",
  ".plan-row-was-p",
  ".pick-ctx-0",
  ".cmdk-sec",
  ".set-nav-h",
  ".team-dept-branch",
  ".cd-lock",
  ".dock-float-grip",
  ".cli-file-note",
  ".rs-none",
  ".rs-stage-idle .rs-stage-label",
  ".rs-stage-sum",
  ".rs-tool-ms",
  ".rs-chev",
  ".rs-grade-unknown",
  ".rs-trust-foot",
  ".rs-srcs .rs-n",
  ".rs-must-head",
  // 11-23 跟 main 补（E6h 之后 main 上新写的，都是图标：步骤条展开箭头、已停下的任务图标）
  ":root:root .ais-chev",
  ":root:root .aitask-stopped .aitask-i",
];

function 走(dir: string, f: (p: string) => void) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) { if (n !== "generated") 走(p, f); } else f(p);
  }
}
const 用到: string[] = [];
let ts处 = 0;
走(源, (p) => {
  if (p.endsWith(".css")) {
    const s = 去注释(fs.readFileSync(p, "utf8"));
    for (const m of s.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/(?<![-\w])color\s*:\s*var\(--text-faint\)/.test(m[2])) 用到.push(m[1].trim().split(/\s+/).join(" "));
    }
  } else if (/\.tsx?$/.test(p)) ts处 += (fs.readFileSync(p, "utf8").match(/["'`]var\(--text-faint\)/g) ?? []).length;
});

describe("faint 只许给 placeholder / 禁用 / 装饰（只减不增）", () => {
  it("读得到（防解析坏了全放行）", () => {
    expect(用到.length).toBeGreaterThan(20);
  });
  it("新写的 faint 字色只给 placeholder / 禁用 / 装饰；要读的字用 --text-muted", () => {
    expect(用到.filter((s) => !许.test(s) && !老规则.includes(s))).toEqual([]);
  });
  it("老规则名单只减：已经换掉的划掉", () => {
    expect(老规则.filter((s) => !用到.includes(s))).toEqual([]);
  });
  it("ts / tsx 里写死的 faint 不超过 1 处", () => {
    expect(ts处).toBeLessThanOrEqual(1);
  });
});
