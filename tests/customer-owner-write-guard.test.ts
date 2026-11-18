/**
 * 守门（11-18 复盘第 5 类「多个入口写同一件事，守门只装了一部分」）：客户换负责人（Customer.salesOwnerId）要留换人记录、
 * 名下的活和项目跟着走，和改写在同一个事务里。项目负责人早有守门（owner-write-guard.test.ts），客户负责人原来没有——
 * 导入改负责人不留痕、不带活；编辑页、就地改把换人记录写在另一个事务里。
 *
 * src 里凡是 Customer update / updateMany / upsert 的 data 写到 salesOwnerId（或 data 是变量、摊开变量看不出写没写）的地方，
 * 所在顶层函数里得调共用的换负责人（下面 共用）；不调的在白名单里写明理由（文件 + 函数）。
 * 另外：不许用原生 SQL 改 salesOwnerId；客户层页面不许再用事务外的 带走并记下（换人记录和改写不在一个事务）。不连库、不 import 业务代码。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { 源文件们, 找写处, type 写处 } from "./helpers/source-scan";

const 文件们 = 源文件们();
const 写处们 = 找写处(文件们, /\.customer\.(update|updateMany|upsert)\(/g);

/**
 * 共用的换负责人：都在同一个事务里记换负责人（lib/owner-log-db.ts 记换负责人）。
 * 带走并记下在事务里 / 带走一位 / 市场转一位（lib/carry-over-db.ts、enterprise/market-transfer.ts）连活一起带；
 * 客户进公海清负责人（pool-link.ts）记进公海；删被撤的换负责人记录 是撤销（按原样删掉被撤的那条）；
 * 导入换客户负责人 是 enterprise-import/apply.ts 里包的一层（回公海只记一行，别的走 带走并记下在事务里）
 */
const 共用 = /(?<![\p{L}\p{N}_$])(记换负责人|带走并记下在事务里|带走一位|市场转一位|客户进公海清负责人|删被撤的换负责人记录|导入换客户负责人)\(/u;

/** 不调共用的：逐条说明（文件 + 所在顶层函数） */
const 白名单: { 文件: string; 函数: string; 写负责人?: true; 为什么: string }[] = [
  { 文件: "app/(app)/customers/actions.ts", 函数: "patchCustomerRegion", 为什么: "就地改地区：data 只有国家 / 省 / 市 / 区四格" },
  { 文件: "app/(app)/customers/import-actions.ts", 函数: "落这些行", 为什么: "普通导入撞号补空：只补空着的资料格，负责人不动" },
  { 文件: "app/(app)/customers/import-actions.ts", 函数: "撤这一批", 为什么: "撤回普通导入的补空：只把补过的资料格还成空，负责人不动" },
  { 文件: "lib/enterprise/pool-owner-backfill.ts", 函数: "补记存量公海客户", 写负责人: true, 为什么: "存量公海客户一次性回填占位账号：同一个事务里直接写那条进公海的换人记录（pool-release），活本来就留在原负责人名下" },
  { 文件: "lib/owner-log-db.ts", 函数: "还原进公海前负责人", 写负责人: true, 为什么: "撤销放进公海：负责人按进公海那条记录还回去，那条记录同一个事务里删掉（撤销不另记一条）" },
];

/** 所在函数里调了共用的（声明那一行不算：函数自己就叫共用的名字时别把自己数进去） */
const 调了共用 = (w: 写处) => 共用.test(w.函数体.slice(w.函数体.indexOf(w.函数) + w.函数.length));
const 写负责人 = (w: 写处) => !!w.data && /\bsalesOwnerId\b/.test(w.data);
const 看不出 = (w: 写处) => !!w.data && (!w.data.startsWith("{") || /\.\.\.\s*[\p{L}_$][\p{L}\p{N}_$.]*\s*[,}]/u.test(w.data));
const 要管 = (w: 写处) => 写负责人(w) || 看不出(w);
const 白 = (w: 写处) => 白名单.find((x) => x.文件 === w.文件 && x.函数 === w.函数);

describe("客户换负责人都走共用的换负责人（复盘第 5 类）", () => {
  it("扫得到：写处够多，共用的确实在用（防扫描本身坏了白过）", () => {
    expect(写处们.length).toBeGreaterThan(30);
    expect(写处们.filter(写负责人).filter(调了共用).length).toBeGreaterThanOrEqual(8);
    expect(写处们.filter((w) => w.data === null)).toEqual([]);
  });

  it("写负责人（或看不出写没写）的地方，所在函数里调了共用的换负责人，或在白名单里", () => {
    const 坏 = 写处们.filter((w) => 要管(w) && !调了共用(w) && !白(w)).map((w) => `${w.位置}（${w.函数}）  ${w.data!.replace(/\s+/g, " ").slice(0, 80)}`);
    expect(坏).toEqual([]);
  });

  it("白名单里说不写负责人的，data 里确实没有 salesOwnerId", () => {
    const 坏 = 写处们.filter((w) => 白(w) && !白(w)!.写负责人 && 写负责人(w)).map((w) => w.位置);
    expect(坏).toEqual([]);
  });

  it("白名单每条都还用得上（代码改了就删掉）", () => {
    for (const x of 白名单) expect([x.文件, x.函数, 写处们.some((w) => w.文件 === x.文件 && w.函数 === x.函数 && 要管(w))]).toEqual([x.文件, x.函数, true]);
  });

  it("客户层改负责人不再用事务外的 带走并记下（换人记录和改写要在同一个事务里）", () => {
    const 坏 = 文件们.filter((f) => f.includes("/app/")).filter((f) => /(?<![\p{L}\p{N}_$])带走并记下\(/u.test(fs.readFileSync(f, "utf8")));
    expect(坏).toEqual([]);
  });

  it("不用原生 SQL 改客户负责人", () => {
    const 坏 = 文件们.filter((f) => /UPDATE\s+["`]?Customer["`]?\s+SET[^;'`]*salesOwnerId/i.test(fs.readFileSync(f, "utf8")));
    expect(坏).toEqual([]);
  });
});
