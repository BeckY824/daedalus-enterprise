/**
 * X-147 962 条一次性咨询补建脚本（scripts/ent-x147-record-only-backfill.ts）：
 *   - 命令行守门：不认识的参数 / 缺 --csv / 缺 --basis / 写不带 CONFIRM 一律退出码 2、什么都不写
 *   - 认法：CSV target = keep 的行；每位客户建 1 个仅记录用项目（线索 · 潜客培育），负责人 = 客户负责人、创建人 = --操作人、createdAt = 最早那条沟通、
 *     项目来源 = 客户来源、importBatch = 批次号；只挂没挂项目、没删、不是待办 / 提醒、在本客户名下的沟通，对不上的跳过写原因
 *   - 客户在公海：项目进线索公海（ownerId 空、pooledAt = 客户进公海时间、一行 pool-release）
 *   - 不改客户；每行一条带前缀的 AuditLog；可以重复跑（已完成）；任一断言不过整批不写、退出码 1
 *   - 撤回：写后项目上多了东西整批不撤、报出来；撤完和写前一致；已撤回过的不再撤
 * 照服务器上的跑法：esbuild 打成一个 cjs，用 node 跑（只依赖 node:sqlite）。库是临时目录里只建脚本用到的几张表的 SQLite，不碰测试库
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(__dirname, "..");
let 目录 = "", 包 = "", 库 = "", csv = "";
const 操作人 = "u-op";
const 必带 = ["--basis", "E-999", "--操作人", 操作人];
const 前缀 = (批: string) => `[批次 ${批} · 执行：Becky（服务商）· 依据 E-999]`;
const T0 = Date.UTC(2024, 0, 6, 7, 12);

beforeAll(async () => {
  目录 = mkdtempSync(path.join(tmpdir(), "ent-x147-"));
  // 路径写全（scripts/ci/related-tests.mjs 按路径引用选用例）：scripts/ent-x147-record-only-backfill.ts、scripts/ent-batch-audit-prefix.ts
  await build({
    entryPoints: [path.join(ROOT, "scripts/ent-x147-record-only-backfill.ts")], bundle: true, platform: "node", format: "cjs", target: "node22",
    outfile: path.join(目录, "x147.cjs"), alias: { "@": path.join(ROOT, "src") }, logLevel: "silent",
  });
  包 = path.join(目录, "x147.cjs");
});
afterAll(() => { if (目录) rmSync(目录, { recursive: true, force: true }); });

/**
 * 客户 c1（销售 u-s 名下，来源 ch1，主要联系人 k1）：f1（较晚）、f2（最早）可挂；f3 已删、f4 是待办、f5 已挂别的项目、f6 现在在 c2 名下、f9 库里没有 → 跳过
 * 客户 c2（在客户公海，负责人是占位账号）：f7 可挂。f8 是 target = project 的行，不认
 */
beforeEach(() => {
  库 = path.join(目录, `t-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  csv = path.join(目录, `c-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  const db = new DatabaseSync(库);
  db.exec(`
    CREATE TABLE User (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE Customer (id TEXT PRIMARY KEY, customerNo INTEGER, name TEXT, shortName TEXT, salesOwnerId TEXT NOT NULL, channelId TEXT, bizLine TEXT,
      custStatus TEXT, lastFollowAt INTEGER, updatedAt INTEGER NOT NULL, deletedAt INTEGER);
    CREATE TABLE CustomerPool (customerId TEXT PRIMARY KEY, userId TEXT, reason TEXT NOT NULL DEFAULT '手动', at INTEGER NOT NULL);
    CREATE TABLE Contact (id TEXT PRIMARY KEY, customerId TEXT, isPrimary BOOLEAN);
    CREATE TABLE FollowUp (id TEXT PRIMARY KEY, customerId TEXT NOT NULL, type TEXT NOT NULL, occurredAt INTEGER NOT NULL, deletedAt INTEGER);
    CREATE TABLE Project (id TEXT PRIMARY KEY, name TEXT NOT NULL, customerId TEXT NOT NULL, contactId TEXT, ownerId TEXT NOT NULL, creatorId TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT '线索', node TEXT NOT NULL DEFAULT '潜客培育', result TEXT, pooledAt INTEGER, amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'CNY',
      balanceSettled BOOLEAN NOT NULL DEFAULT false, acceptancePassed BOOLEAN NOT NULL DEFAULT false, contractStatus TEXT, channelId TEXT, bizLine TEXT, source TEXT, importBatch TEXT,
      createdAt INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt INTEGER NOT NULL, deletedAt INTEGER);
    CREATE TABLE ProjectNodeLog (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES Project(id), userId TEXT NOT NULL, at INTEGER NOT NULL, fromPhase TEXT, fromNode TEXT, fromResult TEXT,
      toPhase TEXT NOT NULL, toNode TEXT NOT NULL, toResult TEXT, reason TEXT, kind TEXT NOT NULL DEFAULT 'node', fromOwnerId TEXT, toOwnerId TEXT);
    CREATE TABLE FollowUpProject (followUpId TEXT PRIMARY KEY REFERENCES FollowUp(id), projectId TEXT NOT NULL REFERENCES Project(id), node TEXT NOT NULL, withProjectCreate BOOLEAN NOT NULL DEFAULT false);
    CREATE TABLE EntFollowUpMeta (followUpId TEXT PRIMARY KEY, projectId TEXT, code TEXT, nextAt INTEGER);
    CREATE TABLE EntFollowUpMark (followUpId TEXT PRIMARY KEY, projectId TEXT, phase TEXT, replied BOOLEAN);
    CREATE TABLE ProjectMember (projectId TEXT, userId TEXT);
    CREATE TABLE AuditLog (id TEXT PRIMARY KEY, at INTEGER, userId TEXT, userName TEXT, action TEXT, entity TEXT, entityId TEXT, summary TEXT, detail TEXT);
    INSERT INTO User VALUES ('${操作人}', '执行账号'), ('u-s', '销售'), ('u-ph', '占位');
    INSERT INTO Customer VALUES ('c1', 101, '甲公司', NULL, 'u-s', 'ch1', '外贸', '潜在', ${T0 + 9e7}, 1000, NULL), ('c2', 102, '', '乙', 'u-ph', NULL, NULL, NULL, NULL, 2000, NULL);
    INSERT INTO CustomerPool VALUES ('c2', NULL, '回收原因：导入时没有负责人', ${T0 + 5e9});
    INSERT INTO Contact VALUES ('k1', 'c1', 1), ('k2', 'c1', 0);
    INSERT INTO Project (id, name, customerId, ownerId, creatorId, updatedAt) VALUES ('p-old', '老项目', 'c1', 'u-s', 'u-s', 1);
    INSERT INTO FollowUp VALUES ('f1', 'c1', 'WECHAT', ${T0 + 86400e3}, NULL), ('f2', 'c1', 'PHONE', ${T0}, NULL), ('f3', 'c1', 'PHONE', ${T0 - 1e6}, ${T0}),
      ('f4', 'c1', 'TASK', ${T0 - 2e6}, NULL), ('f5', 'c1', 'PHONE', ${T0 - 3e6}, NULL), ('f6', 'c2', 'PHONE', ${T0 - 4e6}, NULL),
      ('f7', 'c2', 'VISIT', ${T0 + 2e6}, NULL), ('f8', 'c1', 'PHONE', ${T0}, NULL);
    INSERT INTO FollowUpProject VALUES ('f5', 'p-old', '潜客培育', false), ('f8', 'p-old', '潜客培育', false);
  `);
  db.close();
  const 行 = (c: string, f: string, t = "keep") => `${c},${c},0,${f},2024-01-01,${t},,,,,,0`;
  writeFileSync(csv, "﻿customerKey,customerId,inPool,followUpId,date,target,projectId,newProjectKey,newNode,newOwnerId,poolReason,lowConfidence\n" +
    [行("c1", "f1"), 行("c1", "f2"), 行("c1", "f3"), 行("c1", "f4"), 行("c1", "f5"), 行("c1", "f6"), 行("c1", "f9"), 行("c2", "f7"), 行("c1", "f8", "project")].join("\n") + "\n");
});

const 跑 = (参: string[], 写 = false) => {
  const r = spawnSync(process.execPath, ["--no-warnings", 包, ...参], { encoding: "utf8", env: { ...process.env, CONFIRM: 写 ? "yes" : "" }, timeout: 30_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const 读 = <T,>(sql: string) => { const db = new DatabaseSync(库); try { return db.prepare(sql).all() as T[]; } finally { db.close(); } };
const 执 = (sql: string) => { const db = new DatabaseSync(库); try { db.exec(sql); } finally { db.close(); } };
/** 业务表的样子（撤回后要和写前一模一样；AuditLog 另看） */
const 样子 = () => JSON.stringify(["Project", "ProjectNodeLog", "FollowUpProject", "Customer", "CustomerPool", "FollowUp"].map((t) => 读(`SELECT * FROM "${t}" ORDER BY rowid`)));
const 写一批 = () => {
  const r = 跑([库, "--csv", csv, "--write", ...必带], true);
  expect(r.code, r.out).toBe(0);
  const 批 = r.out.match(/撤回：--undo (x147-\d{14}-[0-9a-f]{6})/)?.[1];
  expect(批, r.out).toBeTruthy();
  return { 批: 批!, out: r.out };
};

describe("命令行守门：退出码 2、什么都不写", () => {
  it.each([
    ["拼错的模式", ["--csv", "CSV", "--dry-runn"]],
    ["脚本没有的开关", ["--csv", "CSV", "--write", "--force"]],
    ["多出来的路径", ["多的.db", "--csv", "CSV", "--write"]],
    ["同一个给两遍", ["--csv", "CSV", "--write", "--write"]],
    ["缺 --csv", ["--write"]],
    ["--undo 和 --csv 一起给", ["--csv", "CSV", "--undo", "x147-20261125110724-9bc4ff", "--write"]],
    ["--undo 不是批次号", ["--undo", "abc", "--write"]],
  ])("%s", (_名, 参) => {
    const 前 = 样子();
    const r = 跑([库, ...参.map((x) => (x === "CSV" ? csv : x)), ...必带], true);
    expect(r.code, r.out).toBe(2);
    expect(样子()).toBe(前);
    expect(读("SELECT * FROM AuditLog")).toEqual([]);
  });

  it("缺 --basis / --操作人、写不带 CONFIRM：退出码 2", () => {
    expect(跑([库, "--csv", csv, "--dry-run", "--操作人", 操作人]).code).toBe(2);
    expect(跑([库, "--csv", csv, "--dry-run", "--basis", "E-999"]).code).toBe(2);
    expect(跑([库, "--csv", csv, "--write", ...必带]).code).toBe(2);
    expect(读("SELECT id FROM Project")).toHaveLength(1);
  });
});

describe("空跑 / 写 / 再跑", () => {
  it("空跑只读、报数和跳过原因", () => {
    const 前 = 样子();
    const r = 跑([库, "--csv", csv, "--dry-run", ...必带]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("将建项目 2 个（其中客户在公海、项目进线索公海 1 个），将挂沟通 3 条");
    for (const 因 of ["沟通已删", "是待办 / 提醒（TASK）", "已经挂在别的项目上", "这条沟通现在不在这位客户名下", "库里没有这条沟通"]) expect(r.out).toContain(因);
    expect(r.out).toContain("跳过 5 条");
    expect(r.out).not.toContain("甲公司");
    expect(样子()).toBe(前);
  });

  it("写：每位客户一个仅记录用项目，字段照规则；公海客户的进线索公海；客户不动；每行一条带前缀的日志", () => {
    const 客户前 = JSON.stringify(读("SELECT * FROM Customer ORDER BY id"));
    const { 批, out } = 写一批();
    expect(out).toContain("已写：8 行（项目 2 个、挂沟通 3 条");
    const ps = 读<Record<string, unknown>>("SELECT * FROM Project WHERE source = 'record-only' ORDER BY customerId");
    expect(ps).toHaveLength(2);
    expect(ps[0]).toMatchObject({
      customerId: "c1", name: "甲公司", contactId: "k1", ownerId: "u-s", creatorId: 操作人, phase: "线索", node: "潜客培育", pooledAt: null,
      channelId: "ch1", bizLine: "外贸", importBatch: 批, createdAt: T0, contractStatus: "起草中", amount: 0, currency: "CNY",
    });
    expect(ps[1]).toMatchObject({ customerId: "c2", name: "乙", ownerId: "", pooledAt: T0 + 5e9, createdAt: T0 + 2e6, importBatch: 批 });
    const 挂 = Object.fromEntries(读<{ followUpId: string; projectId: string; node: string }>("SELECT * FROM FollowUpProject").map((r) => [r.followUpId, r.projectId]));
    expect(挂).toEqual({ f1: ps[0].id, f2: ps[0].id, f7: ps[1].id, f5: "p-old", f8: "p-old" });
    const 痕 = 读<{ projectId: string; kind: string; at: number; reason: string | null; fromOwnerId: string | null }>("SELECT * FROM ProjectNodeLog ORDER BY kind");
    expect(痕).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: ps[0].id, kind: "node", at: T0 }),
      expect.objectContaining({ projectId: ps[1].id, kind: "pool-release", at: T0 + 5e9, reason: "回收原因：导入时没有负责人", fromOwnerId: null }),
    ]));
    expect(痕).toHaveLength(3);
    expect(JSON.stringify(读("SELECT * FROM Customer ORDER BY id"))).toBe(客户前);
    const 日志 = 读<{ userId: string; summary: string; detail: string }>("SELECT * FROM AuditLog");
    expect(日志).toHaveLength(8);
    for (const l of 日志) {
      expect(l.userId).toBe(操作人);
      expect(l.summary.startsWith(前缀(批))).toBe(true);
      expect(JSON.parse(l.detail)).toMatchObject({ 批次: 批, 执行: "Becky（服务商）", 依据: "E-999", 操作: "insert" });
    }
  });

  it("可以重复跑：再空跑 / 再写都是 0，已挂的计已完成；新冒出来的沟通补挂到已有项目", () => {
    写一批();
    const 空 = 跑([库, "--csv", csv, "--dry-run", ...必带]);
    expect(空.out).toContain("将建项目 0 个");
    expect(空.out).toContain("已完成：项目 2 个、沟通 3 条");
    // 写后 f5 被人从老项目上摘了：再跑补挂到 c1 已有的仅记录用项目，不另建
    执("DELETE FROM FollowUpProject WHERE followUpId = 'f5'");
    const 再 = 跑([库, "--csv", csv, "--write", ...必带], true);
    expect(再.code, 再.out).toBe(0);
    expect(再.out).toContain("已写：1 行（项目 0 个、挂沟通 1 条");
    expect(读("SELECT id FROM Project WHERE source = 'record-only'")).toHaveLength(2);
  });

  it("任一断言不过整批不写：库里 Project 多了非空没默认值的列，退出码 1、一行没写", () => {
    执("PRAGMA foreign_keys = OFF; DROP TABLE Project");
    执(`CREATE TABLE Project (id TEXT PRIMARY KEY, name TEXT NOT NULL, customerId TEXT NOT NULL, contactId TEXT, ownerId TEXT NOT NULL, creatorId TEXT NOT NULL,
      phase TEXT NOT NULL, node TEXT NOT NULL, result TEXT, pooledAt INTEGER, amount REAL NOT NULL, currency TEXT NOT NULL, balanceSettled BOOLEAN NOT NULL, acceptancePassed BOOLEAN NOT NULL,
      contractStatus TEXT, channelId TEXT, bizLine TEXT, source TEXT, importBatch TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER, mustHave TEXT NOT NULL);
      INSERT INTO Project VALUES ('p-old', '老项目', 'c1', NULL, 'u-s', 'u-s', '线索', '潜客培育', NULL, NULL, 0, 'CNY', 0, 0, NULL, NULL, NULL, NULL, NULL, 1, 1, NULL, 'x')`);
    const 前 = 样子();
    const r = 跑([库, "--csv", csv, "--write", ...必带], true);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("已回滚，库不变");
    expect(样子()).toBe(前);
    expect(读("SELECT * FROM AuditLog")).toEqual([]);
  });
});

describe("撤回", () => {
  it("写后项目上有人记了别的沟通：整批不撤、报出来、退出码 1；摘掉后撤回，和写前一模一样；再撤不撤", () => {
    const 写前 = 样子();
    const { 批 } = 写一批();
    const pid = String(读<{ id: string }>("SELECT id FROM Project WHERE customerId = 'c1' AND source = 'record-only'")[0].id);
    执(`INSERT INTO FollowUp VALUES ('f-new', 'c1', 'PHONE', ${T0 + 1e10}, NULL); INSERT INTO FollowUpProject VALUES ('f-new', '${pid}', '潜客培育', false)`);
    const 拦 = 跑([库, "--undo", 批, "--write", ...必带], true);
    expect(拦.code, 拦.out).toBe(1);
    expect(拦.out).toContain("多了本批以外的 FollowUpProject 1 行");
    expect(读("SELECT id FROM Project WHERE source = 'record-only'")).toHaveLength(2);
    执("DELETE FROM FollowUpProject WHERE followUpId = 'f-new'; DELETE FROM FollowUp WHERE id = 'f-new'");
    // 项目写后被改过（推进出潜客培育）同样整批不撤
    执(`UPDATE Project SET node = '线索验证' WHERE id = '${pid}'`);
    expect(跑([库, "--undo", 批, "--dry-run", ...必带]).out).toContain("的 node 写后被改过");
    执(`UPDATE Project SET node = '潜客培育' WHERE id = '${pid}'`);
    const 空 = 跑([库, "--undo", 批, "--dry-run", ...必带]);
    expect(空.out).toContain("空跑：将撤：删项目 2 个、节点变更 3 行，沟通还原成没挂项目 3 条");
    const r = 跑([库, "--undo", 批, "--write", ...必带], true);
    expect(r.code, r.out).toBe(0);
    expect(样子()).toBe(写前);
    const 撤日志 = 读<{ summary: string; detail: string }>("SELECT * FROM AuditLog WHERE action = 'delete'");
    expect(撤日志).toHaveLength(8);
    const 撤号 = String(JSON.parse(撤日志[0].detail).批次);
    expect(撤号.startsWith(`${批}-undo-`)).toBe(true);
    for (const l of 撤日志) expect(l.summary.startsWith(前缀(撤号))).toBe(true);
    const 再 = 跑([库, "--undo", 批, "--write", ...必带], true);
    expect(再.code).toBe(0);
    expect(再.out).toContain("已撤回过");
  });
});
