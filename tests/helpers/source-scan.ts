/**
 * 扫源码的守门用例共用（不连库、不 import 业务代码）：列出 src 下全部 .ts / .tsx，找某个 prisma 写法的调用处，
 * 取出参数对象最外层的 data，并认出它在哪个顶层函数里。写法同 tests/owner-write-guard.test.ts。
 */
import fs from "node:fs";
import path from "node:path";

export const 源根 = path.join(__dirname, "..", "..", "src");

export function 源文件们(): string[] {
  const 出: string[] = [];
  const 走 = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "generated") 走(f); } else if (/\.tsx?$/.test(e.name)) 出.push(f);
    }
  };
  走(源根);
  return 出;
}

/** 跳过字符串字面量，返回结尾引号的位置 */
const 跳串 = (s: string, j: number) => { const q = s[j]; j++; while (j < s.length && s[j] !== q) { if (s[j] === "\\") j++; j++; } return j; };

/** s[i] 是开括号，返回配对的闭括号位置 */
export const 配对 = (s: string, i: number) => {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'" || c === "`") { j = 跳串(s, j); continue; }
    if ("([{".includes(c)) d++;
    else if (")]}".includes(c) && --d === 0) return j;
  }
  return -1;
};

/** 参数对象最外层的 data 值（简写 data 回 "data"）；参数不是对象字面量回整段；没有 data 回 null */
export const data值 = (参: string): string | null => {
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

/** 顶层声明（行首 function / const / let）：名字和起点 */
const 顶层 = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+([\p{L}\p{N}_$]+)|(?:const|let)\s+([\p{L}\p{N}_$]+))/gmu;

export type 写处 = {
  /** src 下的相对路径，/ 分隔 */
  文件: string;
  /** 文件:行 */
  位置: string;
  /** 所在的顶层函数（或顶层 const）名；在顶层之外回 "" */
  函数: string;
  /** 所在顶层函数的整段源码（找它里面有没有调共用函数） */
  函数体: string;
  /** 参数对象最外层的 data（见 data值） */
  data: string | null;
  /** 整个参数 */
  参数: string;
};

/** 找全部 re 命中的调用处（re 要以开括号结尾，带 g） */
export function 找写处(文件们: string[], re: RegExp): 写处[] {
  const 出: 写处[] = [];
  for (const f of 文件们) {
    const s = fs.readFileSync(f, "utf8");
    const 声明们: { 名: string; 起: number }[] = [];
    for (const m of s.matchAll(顶层)) 声明们.push({ 名: m[1] ?? m[2] ?? "", 起: m.index ?? 0 });
    const 文件 = path.relative(源根, f).split(path.sep).join("/");
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const 开 = m.index + m[0].length - 1;
      const 参数 = s.slice(开 + 1, 配对(s, 开));
      const i = 声明们.findLastIndex((x) => x.起 <= m!.index);
      const 声明 = i >= 0 ? 声明们[i] : null;
      const 尾 = i >= 0 && i + 1 < 声明们.length ? 声明们[i + 1].起 : s.length;
      出.push({
        文件,
        位置: `${文件}:${s.slice(0, m.index).split("\n").length}`,
        函数: 声明?.名 ?? "",
        函数体: 声明 ? s.slice(声明.起, 尾) : "",
        data: data值(参数),
        参数,
      });
    }
  }
  return 出;
}
