/**
 * E-218 / E-220 两个一次性数据脚本（scripts/ent-e218-two-status-write.ts、ent-e220-status-backfill.ts）的命令行守门 + e218 撤回：
 *   - 不认识的参数（拼错的、脚本没有的模式、多出来的路径、缺值、给两遍）一律退出码 2、库都不打开、什么都不写
 *    （3704 实操 r64 第 6 条：e218 带 --undo 不报错、被当成空跑）
 *   - e218 --undo <批次>：按该批 AuditLog 的改前值逐行恢复；写前核每行现在的值仍是该批写入的新值，不等整批不写、报出哪一行；
 *     撤回另起批次「原批次-undo-xxxx」，日志带「[批次 … · 执行：Becky（服务商）· 依据 E-218]」前缀和 批次 / 执行 / 依据 / 对应行 四个键
 * 照服务器上的跑法：esbuild 打成一个 cjs，用 node 跑（只依赖 node:sqlite）。库是临时目录里只建脚本用到的几张表的 SQLite（脚本只走裸 SQL），不碰测试库
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(__dirname, "..");
let 目录 = "";
let e218 = "", e220 = "", 库 = "";
const 操作人 = "u-op";
const 前缀式 = (批次: string) => `[批次 ${批次} · 执行：Becky（服务商）· 依据 E-218]`;

beforeAll(async () => {
  目录 = mkdtempSync(path.join(tmpdir(), "ent-e218-"));
  // 路径写全（scripts/ci/related-tests.mjs 按路径引用选用例：改了这几个脚本 / 共用前缀就带上这份）；共用前缀 scripts/ent-batch-audit-prefix.ts 打进两份里
  for (const [源, 出] of [["scripts/ent-e218-two-status-write.ts", "e218.cjs"], ["scripts/ent-e220-status-backfill.ts", "e220.cjs"]] as const) {
    await build({
      entryPoints: [path.join(ROOT, 源)], bundle: true, platform: "node", format: "cjs", target: "node22",
      outfile: path.join(目录, 出), alias: { "@": path.join(ROOT, "src") }, logLevel: "silent",
    });
  }
  e218 = path.join(目录, "e218.cjs");
  e220 = path.join(目录, "e220.cjs");
});
afterAll(() => { if (目录) rmSync(目录, { recursive: true, force: true }); });

/** 两家：83028（流失线索 + 在推订单 → 成交）、17535（流失线索 + 进了线索公海的线索 → 流失，E-275 选 a），改前一个「流失」一个空 */
beforeEach(() => {
  库 = path.join(目录, `t-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseSync(库);
  db.exec(`
    CREATE TABLE User (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE EntDictItem (id TEXT PRIMARY KEY, kind TEXT, name TEXT);
    CREATE TABLE Customer (id TEXT PRIMARY KEY, customerNo INTEGER, custStatus TEXT, updatedAt INTEGER, deletedAt INTEGER);
    CREATE TABLE Project (id TEXT PRIMARY KEY, customerId TEXT, phase TEXT, node TEXT, result TEXT, pooledAt INTEGER, deletedAt INTEGER);
    CREATE TABLE EntLeadVerify (projectId TEXT, finalResult TEXT, invalidReason TEXT);
    CREATE TABLE AuditLog (id TEXT PRIMARY KEY, at INTEGER, userId TEXT, userName TEXT, action TEXT, entity TEXT, entityId TEXT, summary TEXT, detail TEXT);
    INSERT INTO User VALUES ('${操作人}', '管理员');
    INSERT INTO Customer VALUES ('c83028', 83028, '流失', 1000, NULL), ('c17535', 17535, NULL, 2000, NULL);
    INSERT INTO Project VALUES
      ('p1', 'c83028', '线索', '线索验证', '线索流失', NULL, NULL), ('p2', 'c83028', '订单', '生产备货', NULL, NULL, NULL),
      ('p3', 'c17535', '线索', '潜客培育', '线索流失', NULL, NULL), ('p4', 'c17535', '线索', '潜客培育', NULL, 3000, NULL);
  `);
  db.close();
});

const 跑 = (脚本: string, 参: string[], 写 = false) => {
  const r = spawnSync(process.execPath, ["--no-warnings", 脚本, ...参], {
    encoding: "utf8", env: { ...process.env, CONFIRM: 写 ? "yes" : "" }, timeout: 30_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const 必带 = ["--basis", "E-218", "--操作人", 操作人];
const 读库 = <T,>(sql: string) => { const db = new DatabaseSync(库); try { return db.prepare(sql).all() as T[]; } finally { db.close(); } };
const 状态 = () => Object.fromEntries(读库<{ customerNo: number; custStatus: string | null }>("SELECT customerNo, custStatus FROM Customer").map((r) => [r.customerNo, r.custStatus]));
const 日志 = () => 读库<{ userId: string; userName: string; entityId: string; summary: string; detail: string }>("SELECT * FROM AuditLog ORDER BY at, id")
  .map((r) => ({ ...r, d: JSON.parse(r.detail) as Record<string, unknown> }));
/** 写一批，回批次号 */
function 写一批(): string {
  const r = 跑(e218, [库, "--write", ...必带], true);
  expect(r.code, r.out).toBe(0);
  const 批 = r.out.match(/撤回：--undo (e218-\d{14}-[0-9a-f]{6})/)?.[1];
  expect(批, r.out).toBeTruthy();
  return 批!;
}

describe("不认识的参数：退出码 2、什么都不写", () => {
  it.each([
    ["拼错的模式", ["--undoo", "e218-20261123100047-9d092c", "--dry-run"]],
    ["脚本没有的开关", ["--dry-run", "--force"]],
    ["多出来的路径", ["多的.db", "--dry-run"]],
    ["同一个给两遍", ["--dry-run", "--dry-run"]],
    ["带值的缺值", ["--dry-run", "--log"]],
    ["单横线", ["--dry-run", "-y"]],
  ])("e218 %s", (_名, 参) => {
    const r = 跑(e218, [库, ...参, ...必带], true);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("不跑（什么都没写）");
    expect(状态()).toEqual({ 83028: "流失", 17535: null });
    expect(日志()).toEqual([]);
  });

  it("e218 写入带了不认识的参数也不写", () => {
    const r = 跑(e218, [库, "--write", "--yes", ...必带], true);
    expect(r.code, r.out).toBe(2);
    expect(状态()).toEqual({ 83028: "流失", 17535: null });
  });

  it("e218 --undo 后面不是批次号：退出码 2", () => {
    const r = 跑(e218, [库, "--undo", "abc", "--dry-run", ...必带]);
    expect(r.code, r.out).toBe(2);
  });

  it.each([
    ["拼错的模式", ["--batchh", "0", "--dry-run"]],
    ["脚本没有的开关", ["--plan", "--all"]],
    ["多出来的路径", ["多的.db", "--plan"]],
    ["同一个给两遍", ["--batch", "0", "--batch", "1", "--dry-run"]],
  ])("e220 %s", (_名, 参) => {
    const r = 跑(e220, [库, ...参, "--basis", "E-220", "--操作人", 操作人], true);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("不跑（什么都没写）");
    expect(日志()).toEqual([]);
  });

  it("认识的参数照常：e218 空跑退出码 0、一行不写", () => {
    const r = 跑(e218, [库, "--dry-run", ...必带]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("空跑结束，一行没写");
    expect(状态()).toEqual({ 83028: "流失", 17535: null });
  });
});

describe("e218 --undo：按该批日志的改前值整批改回", () => {
  it("空跑只报、不写；写入改回改前值（空写回 NULL），另起 -undo- 批次、每行一条带前缀和四个键的日志；再撤一次不再撤", () => {
    const 批 = 写一批();
    expect(状态()).toEqual({ 83028: "成交", 17535: "流失" });
    expect(日志()).toHaveLength(2);

    const 空 = 跑(e218, [库, "--undo", 批, "--dry-run", ...必带]);
    expect(空.code, 空.out).toBe(0);
    expect(空.out).toContain("空跑：将撤 2 行，一行没写");
    expect(状态()).toEqual({ 83028: "成交", 17535: "流失" });
    expect(日志()).toHaveLength(2);

    const 写 = 跑(e218, [库, "--undo", 批, "--write", ...必带], true);
    expect(写.code, 写.out).toBe(0);
    expect(状态()).toEqual({ 83028: "流失", 17535: null });
    const 撤 = 日志().filter((x) => x.d.类 === "撤回");
    expect(撤).toHaveLength(2);
    const 撤号 = String(撤[0].d.批次);
    expect(撤号).toMatch(new RegExp(`^${批}-undo-[0-9a-f]{4}$`));
    expect(写.out).toContain(`撤回批次号 ${撤号}`);
    for (const x of 撤) {
      expect(x.summary.startsWith(`${前缀式(撤号)} `)).toBe(true);
      expect(x.d).toMatchObject({ 批次: 撤号, 执行: "Becky（服务商）", 依据: "E-218", 对应行: { Customer: x.entityId }, 撤的批次: 批, 脚本: "ent-e218-two-status-write.ts" });
      expect([x.userId, x.userName]).toEqual([操作人, "管理员"]);
    }
    expect(Object.fromEntries(撤.map((x) => [x.entityId, [(x.d.旧 as { custStatus: unknown }).custStatus, (x.d.新 as { custStatus: unknown }).custStatus]])))
      .toEqual({ c83028: ["成交", "流失"], c17535: ["流失", null] });

    // 再撤一次：已撤回过，不写、退出码 0
    const 再 = 跑(e218, [库, "--undo", 批, "--write", ...必带], true);
    expect(再.code, 再.out).toBe(0);
    expect(再.out).toContain("已撤回过");
    expect(日志()).toHaveLength(4);
    // 撤完照常能重写（重写是新批次）
    写一批();
    expect(状态()).toEqual({ 83028: "成交", 17535: "流失" });
  });

  it("核值不对：有一行写后被改过 → 空跑、写入都整批不撤、报出哪一行、退出码 1，库和日志都不动", () => {
    const 批 = 写一批();
    const db = new DatabaseSync(库);
    db.exec("UPDATE Customer SET custStatus = '意向' WHERE customerNo = 17535");
    db.close();
    for (const 写 of [false, true]) {
      const r = 跑(e218, [库, "--undo", 批, 写 ? "--write" : "--dry-run", ...必带], 写);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toContain("NO.17535");
      expect(r.out).toContain("整批不撤");
      expect(r.out).not.toMatch(/NO\.83028\t[^\n]*不对/);
    }
    expect(状态()).toEqual({ 83028: "成交", 17535: "意向" });
    expect(日志()).toHaveLength(2);
  });

  it("没有这个批次的写入：退出码 1；撤回批次本身不能再撤（格式不认，退出码 2）", () => {
    const r = 跑(e218, [库, "--undo", "e218-20261123000000-abcdef", "--dry-run", ...必带]);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("没有批次");
    const 批 = 写一批();
    跑(e218, [库, "--undo", 批, "--write", ...必带], true);
    const 撤号 = String(日志().find((x) => x.d.类 === "撤回")!.d.批次);
    expect(跑(e218, [库, "--undo", 撤号, "--write", ...必带], true).code).toBe(2);
  });

  it("撤回写入也要 CONFIRM=yes、--basis、--操作人", () => {
    const 批 = 写一批();
    expect(跑(e218, [库, "--undo", 批, "--write", ...必带]).code).toBe(2);
    expect(跑(e218, [库, "--undo", 批, "--write", "--操作人", 操作人], true).code).toBe(2);
    expect(跑(e218, [库, "--undo", 批, "--write", "--basis", "E-218"], true).code).toBe(2);
    expect(状态()).toEqual({ 83028: "成交", 17535: "流失" });
  });
});

describe("E-275 选 a：17535 只在在推线索进了公海时才写「流失」", () => {
  const 改库 = (sql: string) => { const db = new DatabaseSync(库); try { db.exec(sql); } finally { db.close(); } };

  it("在推线索不在公海（新规则算出潜在）：空跑、写入都退出码 1，一行不写、不留日志", () => {
    改库("UPDATE Project SET pooledAt = NULL WHERE id = 'p4'");
    for (const 写 of [false, true]) {
      const r = 跑(e218, [库, 写 ? "--write" : "--dry-run", ...必带], 写);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toContain("按新规则算出「潜在」，预期「流失」");
    }
    expect(状态()).toEqual({ 83028: "流失", 17535: null });
    expect(日志()).toEqual([]);
  });

  it("照正式库摆（83028 已是成交、名下项目都在推）：只写 17535 一行，83028 计已完成；再空跑 0 行", () => {
    改库("UPDATE Customer SET custStatus = '成交' WHERE id = 'c83028'; UPDATE Project SET phase = '线索', node = '线索验证', result = NULL WHERE id = 'p1'");
    写一批();
    expect(状态()).toEqual({ 83028: "成交", 17535: "流失" });
    expect(日志()).toHaveLength(1);
    const 再 = 跑(e218, [库, "--dry-run", ...必带]);
    expect(再.code, 再.out).toBe(0);
    expect(再.out).toContain("空跑结束，一行没写");
  });
});
