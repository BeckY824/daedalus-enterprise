/**
 * 守门（P-转-21、X-68，11-10）：src 里凡是改 Project.ownerId 的 update / updateMany / upsert，data 要经
 * lib/project/owner-write.ts 的 换负责人（顺手清待分配）或 还负责人（撤销回滚）。
 * 直接写 ownerId 就报错；data 是变量、或摊开一个变量（...x）看不出有没有 ownerId 的，要在下面白名单里说清楚为什么不碰负责人。
 * 也不许用原生 SQL 改 Project。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 根 = path.join(__dirname, "..", "src");
const 文件们: string[] = [];
const 走 = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "generated") 走(f); } else if (/\.tsx?$/.test(e.name)) 文件们.push(f);
  }
};
走(根);

/** 跳过字符串字面量，返回结尾引号的位置 */
const 跳串 = (s: string, j: number) => { const q = s[j]; j++; while (j < s.length && s[j] !== q) { if (s[j] === "\\") j++; j++; } return j; };
/** s[i] 是开括号，返回配对的闭括号位置 */
const 配对 = (s: string, i: number) => {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'" || c === "`") { j = 跳串(s, j); continue; }
    if ("([{".includes(c)) d++;
    else if (")]}".includes(c) && --d === 0) return j;
  }
  return -1;
};
/** 参数对象最外层的 data 值（简写 data 回 "data"）；参数不是对象字面量回整段 */
const data值 = (参: string): string | null => {
  const t = 参.trim();
  if (!t.startsWith("{")) return t;
  let d = 0;
  for (let j = 0; j < t.length; j++) {
    const c = t[j];
    if (c === '"' || c === "'" || c === "`") { j = 跳串(t, j); continue; }
    if ("([{".includes(c)) d++;
    else if (")]}".includes(c)) d--;
    if (d !== 1 || !/[{,\s]/.test(t[j - 1] ?? "")) continue;
    const m = /^data\b\s*(:)?/.exec(t.slice(j));
    if (!m) continue;
    if (!m[1]) return "data";
    let e = j + m[0].length;
    for (let dd = 0; e < t.length; e++) {
      const ch = t[e];
      if (ch === '"' || ch === "'" || ch === "`") { e = 跳串(t, e); continue; }
      if ("([{".includes(ch)) dd++;
      else if (")]}".includes(ch)) { if (dd === 0) break; dd--; }
      else if (ch === "," && dd === 0) break;
    }
    return t.slice(j + m[0].length, e).trim();
  }
  return null;
};

type 写处 = { 位置: string; 文件: string; data: string | null };
const 写处们: 写处[] = [];
for (const f of 文件们) {
  const s = fs.readFileSync(f, "utf8");
  const re = /\.project\.(update|updateMany|upsert)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const 开 = m.index + m[0].length - 1;
    const 文件 = path.relative(根, f).split(path.sep).join("/");
    写处们.push({ 文件, 位置: `${文件}:${s.slice(0, m.index).split("\n").length}`, data: data值(s.slice(开 + 1, 配对(s, 开))) });
  }
}

/** 看不出内容的 data / 摊开的变量：逐条说明为什么不碰负责人（文件 + 片段） */
const 白名单: { 文件: string; 片段: string; 为什么: string }[] = [
  { 文件: "lib/project/profile.ts", 片段: "Object.fromEntries(变了", 为什么: "只写画像字段（画像字段表里没有 ownerId）" },
  { 文件: "lib/enterprise-import/project-target.ts", 片段: "data", 为什么: "导入改项目：ownerId 只经 Object.assign(data, 换负责人(...)) 写" },
  { 文件: "lib/project/db.ts", 片段: "...谁勾", 为什么: "勾交付：只写交付项和勾的人、时间" },
  { 文件: "lib/project/db.ts", 片段: "...清掉的下一步", 为什么: "按必填推进：只写阶段、节点、下一步" },
];
const 经助手 = (d: string) => /(换负责人|还负责人)\(/.test(d);
const 白 = (w: 写处) => 白名单.find((x) => x.文件 === w.文件 && w.data !== null && w.data.includes(x.片段));

describe("Project.ownerId 只经 换负责人 / 还负责人 写（P-转-21）", () => {
  it("扫得到：写处够多，助手确实在用（防扫描本身坏了白过）", () => {
    expect(写处们.length).toBeGreaterThan(30);
    expect(写处们.filter((w) => w.data && 经助手(w.data)).length).toBeGreaterThanOrEqual(12);
    expect(写处们.filter((w) => w.data === null)).toEqual([]);
  });

  it("直接写 ownerId 的一处都没有", () => {
    const 坏 = 写处们.filter((w) => w.data && /\bownerId\b/.test(w.data) && !经助手(w.data)).map((w) => `${w.位置}  ${w.data}`);
    expect(坏).toEqual([]);
  });

  it("看不出内容的 data（变量、摊开变量）都在白名单里", () => {
    const 看不出 = (d: string) => !d.startsWith("{") || /\.\.\.\s*[\p{L}_$][\p{L}\p{N}_$.]*\s*[,}]/u.test(d);
    const 坏 = 写处们.filter((w) => w.data && !经助手(w.data) && 看不出(w.data) && !白(w)).map((w) => `${w.位置}  ${w.data}`);
    expect(坏).toEqual([]);
  });

  it("白名单每条都还用得上（代码改了就删掉）", () => {
    for (const x of 白名单) expect([x.文件, 写处们.some((w) => w.文件 === x.文件 && w.data?.includes(x.片段))]).toEqual([x.文件, true]);
  });

  it("不用原生 SQL 改 Project", () => {
    const 坏 = 文件们.filter((f) => /UPDATE\s+["`]?Project["`]?\s/i.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(根, f));
    expect(坏).toEqual([]);
  });
});
