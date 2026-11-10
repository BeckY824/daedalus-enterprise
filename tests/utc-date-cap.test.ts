/**
 * 测试里按 UTC 取日（Date 转 ISO 串再截前 10 位、或按 T 切开取前半）只减不增。
 *
 * 单测钉了 TZ=Asia/Shanghai，业务按北京日历天算「今天」；用例里按 UTC 取「今天 / 明天」，
 * 北京 0:00–8:00（= GMT 16–24 点）时 UTC 今天 = 北京昨天，断言「今天 / 未来」的就红。
 * 2026-11-10 盘点 19 处 / 16 个用例文件 + 1 处老版本夹具，改掉 14 处，留下的 6 处都不是「拿现在取 UTC 的今天」：
 *   - business-value-of、plans-light（造函数）：拿固定种子 / 固定基准造一批日期串喂给被测函数，和现在几点无关
 *   - plans-groups-cache：自己先加 8 小时再截，算的就是北京日，故意不走业务钟（那个文件来回切 TZ 和企业版开关）
 *   - ent-followup-project.ui：从北京的今天串做纯日历加法（拼 Z 再加整天）
 *   - ent-import-ai-clean：固定日期 2026-12-31 的本机零点，对拍存下来的时刻
 *   - r4-compat-fixtures/…/credits.ts：冻住的老版本代码副本，同样是日历加法，不改
 *
 * 新用例要「今天 / 明天 / N 天前」：用 tests/helpers/beijing-date.ts 的 北京日期(n) / 北京日(时刻)。
 *   1. 每个文件的个数不许超过 utc-date-baseline.json 里记的数；名单里没有的文件 = 0 处
 *   2. 减少了就把基线一起改小（棘轮），减到 0 的那一行删掉；文件名按字母排序
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import 基线 from "./utc-date-baseline.json";

const 根 = __dirname;

function 所有源码(dir: string): string[] {
  const out: string[] = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) {
      if (n !== "node_modules" && n !== "generated") out.push(...所有源码(p));
    } else if (/\.(?:[cm]?[jt]s|tsx|jsx)$/.test(n)) out.push(p);
  }
  return out;
}

/** 数一个文件里的 UTC 取日写法：块注释和整行 // 注释里的不算 */
export function 数(s: string): number {
  const 净 = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return (净.match(/\.to(?:ISOString|JSON)\(\)\s*\.\s*(?:(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)|split\(\s*["'`]T["'`]\s*\)\s*\[\s*0\s*\])/g) ?? []).length;
}

describe("测试里的 UTC 取日只减不增", () => {
  const 现在 = new Map<string, number>();
  for (const f of 所有源码(根)) {
    const n = 数(fs.readFileSync(f, "utf8"));
    if (n) 现在.set(path.relative(根, f).replaceAll("\\", "/"), n);
  }
  const 记 = 基线 as Record<string, number>;

  it("数得出几种写法，注释里的不算", () => {
    const 头 = "new Date().toISO" + "String()";
    expect(数(`${头}.slice(0, 10)`)).toBe(1);
    expect(数(`${头}\n  .slice(0,10)`)).toBe(1);
    expect(数(`${头}.substring(0, 10)`)).toBe(1);
    expect(数(`${头}.split("T")[0]`)).toBe(1);
    expect(数("d.toJSON()" + ".slice(0, 10)")).toBe(1);
    expect(数(`// ${头}.slice(0, 10)\n/* ${头}.slice(0, 10) */`)).toBe(0);
    expect(数(`${头}.slice(0, 19)`)).toBe(0);
  });

  it("没有哪个文件比基线多（新文件基线是 0）", () => {
    const 多: string[] = [];
    for (const [f, n] of 现在) if (n > (记[f] ?? 0)) 多.push(`${f}: ${n}（基线 ${记[f] ?? 0}）`);
    expect(多, `这些文件新加了 UTC 取日的写法，北京 0–8 点会比业务的「今天」早一天；改用 tests/helpers/beijing-date.ts 的 北京日期(n) / 北京日(时刻)：\n${多.join("\n")}`).toEqual([]);
  });

  it("减少了就把基线改小（棘轮收紧）", () => {
    const 少: string[] = [];
    for (const [f, n] of Object.entries(记)) {
      const 实 = 现在.get(f) ?? 0;
      if (实 < n) 少.push(`${f}: ${n} → ${实}`);
    }
    expect(少, `这些文件的 UTC 取日少了，把 tests/utc-date-baseline.json 对应的数改小（0 就删掉那一行）：\n${少.join("\n")}`).toEqual([]);
  });

  it("基线按文件名排序，方便合并", () => {
    const k = Object.keys(记);
    expect(k).toEqual([...k].sort());
  });

  it("总数不超过 2026-11-10 的 6", () => {
    const 总 = [...现在.values()].reduce((a, b) => a + b, 0);
    expect(总).toBeLessThanOrEqual(6);
  });
});
