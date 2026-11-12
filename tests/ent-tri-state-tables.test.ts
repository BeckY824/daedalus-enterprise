/**
 * 客户三态的三张旁表（迁移 121–123：客户钟 EntCustomerClock、状态留痕 EntCustomerStateLog、冷项目 EntProjectCold）。
 *   - 两条安装路径一致：全新安装（schema.prisma 推出来的测试库）和老库升级（跑迁移 SQL）建出来的列、默认值、索引一样
 *   - 老库升级：已有客户、项目的库跑 121–123，跑两遍不抛、老数据不动，客户 / 项目删了行跟着级联走
 *   - 用 prisma 读写得通：默认值对、一位客户一行、删客户带走钟和留痕、删项目带走冷标
 *   - 11-12 补的三列（迁移 124–126）：客户钟「成交成立日」「额度上次重置日」、状态留痕「这次顺延了几天」，老库加列重跑跳过、默认为空
 * 只管表；状态怎么算、谁来写在后面的 PR
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";

const DIR = path.resolve(__dirname, "../migrations");
const 三份 = readdirSync(DIR).filter((f) => /^12[123]-/.test(f)).sort();
const 三张表 = ["EntCustomerClock", "EntCustomerStateLog", "EntProjectCold"];

/** 一个只有客户、项目两张老表（各带一行）的库，跑 fn，用完删 */
function 在老库上<T>(fn: (db: DatabaseSync) => T): T {
  const 目录 = mkdtempSync(path.join(os.tmpdir(), "tri-state-tables-"));
  const db = new DatabaseSync(path.join(目录, "old.db"));
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE "Customer" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL)');
    db.exec('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "customerId" TEXT NOT NULL)');
    db.prepare('INSERT INTO "Customer" VALUES (?, ?)').run("c1", "老客户");
    db.prepare('INSERT INTO "Project" VALUES (?, ?, ?)').run("p1", "老项目", "c1");
    return fn(db);
  } finally {
    db.close();
    rmSync(目录, { recursive: true, force: true });
  }
}
/** 11-12 补列：每份只有一句 ADD COLUMN，重跑抛 duplicate column name，runner 当预期跳过（migrations/README.md 第 4 条）。127 是换负责人日志那张表，不在这三张里 */
const 补列 = readdirSync(DIR).filter((f) => /^12[45689]-/.test(f)).sort();
const 跑迁移 = (db: DatabaseSync) => {
  for (const f of 三份) db.exec(readFileSync(path.join(DIR, f), "utf8"));
  for (const f of 补列) {
    try {
      db.exec(readFileSync(path.join(DIR, f), "utf8"));
    } catch (e) {
      if (!/duplicate column name/.test(String(e))) throw e;
    }
  }
};

type 列 = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
const 归一列 = (rows: 列[]) => rows.map((r) => ({ name: r.name, type: r.type, notnull: Number(r.notnull), dflt: r.dflt_value === null ? null : String(r.dflt_value).replace(/^["']|["']$/g, ""), pk: Number(r.pk) })).sort((a, b) => a.name.localeCompare(b.name));

describe("迁移文件", () => {
  it("三份都在，编号接着 120 往后：121 客户钟、122 状态留痕、123 冷项目，各建一张表", () => {
    expect(三份).toEqual(["121-ent-customer-clock.sql", "122-ent-customer-state-log.sql", "123-ent-project-cold.sql"]);
    三份.forEach((f, i) => {
      const sql = readFileSync(path.join(DIR, f), "utf8").replace(/--.*$/gm, "");
      expect([...sql.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]), f).toEqual([三张表[i]]);
    });
  });
});

describe("11-12 补列（124–126、128–129）", () => {
  it("每份只有一句 ADD COLUMN：钟的成交成立日、额度上次重置日，留痕的顺延天数、从谁、到谁", () => {
    expect(补列).toEqual(["124-ent-clock-deal-day.sql", "125-ent-clock-quota-reset-day.sql", "126-ent-state-log-hold-days.sql", "128-state-log-from-owner.sql", "129-state-log-to-owner.sql"]);
    const 句 = 补列.map((f) => readFileSync(path.join(DIR, f), "utf8").replace(/--.*$/gm, "").trim());
    expect(句).toEqual([
      'ALTER TABLE "EntCustomerClock" ADD COLUMN "dealDay" TEXT;',
      'ALTER TABLE "EntCustomerClock" ADD COLUMN "quotaResetDay" TEXT;',
      'ALTER TABLE "EntCustomerStateLog" ADD COLUMN "holdDays" INTEGER;',
      'ALTER TABLE "EntCustomerStateLog" ADD COLUMN "fromOwnerId" TEXT;',
      'ALTER TABLE "EntCustomerStateLog" ADD COLUMN "toOwnerId" TEXT;',
    ]);
  });

  it("老库上已有的钟、留痕加列后还在，新列为空；重跑不抛", () => {
    在老库上((db) => {
      for (const f of 三份) db.exec(readFileSync(path.join(DIR, f), "utf8"));
      db.prepare('INSERT INTO "EntCustomerClock" ("customerId", "enteredDay", "updatedAt") VALUES (?, ?, ?)').run("c1", "2026-11-01", 1);
      db.prepare('INSERT INTO "EntCustomerStateLog" ("id", "customerId", "toState") VALUES (?, ?, ?)').run("l1", "c1", "活跃");
      expect(() => 跑迁移(db)).not.toThrow();
      expect(() => 跑迁移(db)).not.toThrow();
      expect(db.prepare('SELECT "dealDay", "quotaResetDay" FROM "EntCustomerClock"').all()).toEqual([{ dealDay: null, quotaResetDay: null }]);
      expect(db.prepare('SELECT "holdDays", "fromOwnerId", "toOwnerId" FROM "EntCustomerStateLog"').all()).toEqual([{ holdDays: null, fromOwnerId: null, toOwnerId: null }]);
    });
  });
});

describe("老库升级", () => {
  it("跑两遍都不抛；三张表建出来；老客户、老项目原样", () => {
    在老库上((db) => {
      expect(() => 跑迁移(db)).not.toThrow();
      expect(() => 跑迁移(db)).not.toThrow();
      const 表 = (db.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map((t) => t.name);
      for (const t of 三张表) expect(表).toContain(t);
      expect(db.prepare('SELECT * FROM "Customer"').all()).toEqual([{ id: "c1", name: "老客户" }]);
      expect(db.prepare('SELECT * FROM "Project"').all()).toEqual([{ id: "p1", name: "老项目", customerId: "c1" }]);
      for (const t of 三张表) expect((db.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n, t).toBe(0);
    });
  });

  it("第二遍不清数据：写进去的钟、留痕、冷标再跑一遍迁移还在", () => {
    在老库上((db) => {
      跑迁移(db);
      db.prepare('INSERT INTO "EntCustomerClock" ("customerId", "enteredDay", "updatedAt") VALUES (?, ?, ?)').run("c1", "2026-11-01", 1);
      db.prepare('INSERT INTO "EntCustomerStateLog" ("id", "customerId", "toState") VALUES (?, ?, ?)').run("l1", "c1", "活跃");
      db.prepare('INSERT INTO "EntProjectCold" ("projectId", "coldDay", "updatedAt") VALUES (?, ?, ?)').run("p1", "2026-11-01", 1);
      跑迁移(db);
      expect(db.prepare('SELECT "customerId", "state", "enteredDay", "noticeCount", "holdCount", "holdDays", "holdUntil", "blocked" FROM "EntCustomerClock"').all())
        .toEqual([{ customerId: "c1", state: "活跃", enteredDay: "2026-11-01", noticeCount: 0, holdCount: 0, holdDays: 0, holdUntil: null, blocked: 0 }]);
      expect(db.prepare('SELECT "id", "fromState", "toState", "userId", "via" FROM "EntCustomerStateLog"').all()).toEqual([{ id: "l1", fromState: null, toState: "活跃", userId: null, via: "自动" }]);
      expect(db.prepare('SELECT "projectId", "coldDay", "level" FROM "EntProjectCold"').all()).toEqual([{ projectId: "p1", coldDay: "2026-11-01", level: 0 }]);
    });
  });

  it("外键：没有的客户 / 项目写不进；一位客户只有一行钟、一个项目只有一行冷标；删了跟着级联", () => {
    在老库上((db) => {
      跑迁移(db);
      const 钟 = db.prepare('INSERT INTO "EntCustomerClock" ("customerId", "enteredDay", "updatedAt") VALUES (?, ?, ?)');
      const 冷 = db.prepare('INSERT INTO "EntProjectCold" ("projectId", "coldDay", "updatedAt") VALUES (?, ?, ?)');
      const 痕 = db.prepare('INSERT INTO "EntCustomerStateLog" ("id", "customerId", "toState") VALUES (?, ?, ?)');
      expect(() => 钟.run("没有", "2026-11-01", 1)).toThrow(/FOREIGN KEY/);
      expect(() => 冷.run("没有", "2026-11-01", 1)).toThrow(/FOREIGN KEY/);
      expect(() => 痕.run("l0", "没有", "活跃")).toThrow(/FOREIGN KEY/);
      钟.run("c1", "2026-11-01", 1); 冷.run("p1", "2026-11-01", 1); 痕.run("l1", "c1", "活跃"); 痕.run("l2", "c1", "沉睡");
      expect(() => 钟.run("c1", "2026-11-02", 1)).toThrow(/UNIQUE/);
      expect(() => 冷.run("p1", "2026-11-02", 1)).toThrow(/UNIQUE/);
      db.exec(`DELETE FROM "Project" WHERE id = 'p1'`);
      expect((db.prepare('SELECT count(*) AS n FROM "EntProjectCold"').get() as { n: number }).n).toBe(0);
      db.exec(`DELETE FROM "Customer" WHERE id = 'c1'`);
      expect((db.prepare('SELECT count(*) AS n FROM "EntCustomerClock"').get() as { n: number }).n).toBe(0);
      expect((db.prepare('SELECT count(*) AS n FROM "EntCustomerStateLog"').get() as { n: number }).n).toBe(0);
    });
  });
});

describe("两条安装路径一致（schema.prisma ↔ 迁移 SQL）", () => {
  it("三张表的列名、类型、非空、默认值、主键一样；索引名一样", async () => {
    const 新装 = async (t: string) => ({
      列: 归一列(await prisma.$queryRawUnsafe<列[]>(`PRAGMA table_info("${t}")`)),
      索引: (await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA index_list("${t}")`)).map((x) => x.name).filter((n) => !n.startsWith("sqlite_autoindex")).sort(),
    });
    const 升级 = 在老库上((db) => {
      跑迁移(db);
      return Object.fromEntries(三张表.map((t) => [t, {
        列: 归一列(db.prepare(`PRAGMA table_info("${t}")`).all() as 列[]),
        索引: (db.prepare(`PRAGMA index_list("${t}")`).all() as { name: string }[]).map((x) => x.name).filter((n) => !n.startsWith("sqlite_autoindex")).sort(),
      }]));
    });
    for (const t of 三张表) {
      const 新 = await 新装(t);
      expect(新.列.length, `${t} 在测试库里没建出来`).toBeGreaterThan(0);
      expect(升级[t], t).toEqual(新);
    }
  });
});

describe("用 prisma 读写", () => {
  let 客户: string, 项目: string;
  beforeEach(async () => {
    await resetDb();
    const u = await prisma.user.create({ data: { email: "s1", name: "小王", title: "", role: "SALES", password: "x" } });
    客户 = (await prisma.customer.create({ data: { name: "甲公司", phone: "", salesOwnerId: u.id } })).id;
    项目 = (await prisma.project.create({ data: { name: "甲项目", customerId: 客户, ownerId: u.id, creatorId: u.id } })).id;
  });

  it("客户钟：只给客户和进入日，别的都是默认（活跃、0 次、没推后、没被挡）；一位客户一行，再写是改", async () => {
    const 钟 = await prisma.entCustomerClock.create({ data: { customerId: 客户, enteredDay: "2026-11-01" } });
    expect(钟).toMatchObject({ customerId: 客户, state: "活跃", enteredDay: "2026-11-01", noticeCount: 0, lastNoticeDay: null, holdCount: 0, holdDays: 0, holdUntil: null, holdReason: null, blocked: false, dealDay: null, quotaResetDay: null });
    await expect(prisma.entCustomerClock.create({ data: { customerId: 客户, enteredDay: "2026-11-02" } })).rejects.toThrow();
    await prisma.entCustomerClock.upsert({
      where: { customerId: 客户 },
      create: { customerId: 客户, enteredDay: "2027-01-30" },
      update: { state: "沉睡", enteredDay: "2027-01-30", noticeCount: 1, lastNoticeDay: "2027-01-30", holdCount: 1, holdDays: 30, holdUntil: "2027-03-01", holdReason: "下月回访", blocked: true },
    });
    expect(await prisma.entCustomerClock.findMany()).toHaveLength(1);
    expect(await prisma.customer.findUnique({ where: { id: 客户 }, select: { entClock: true } })).toMatchObject({
      entClock: { state: "沉睡", enteredDay: "2027-01-30", noticeCount: 1, lastNoticeDay: "2027-01-30", holdCount: 1, holdDays: 30, holdUntil: "2027-03-01", holdReason: "下月回访", blocked: true },
    });
    expect(await prisma.entCustomerClock.count({ where: { state: "沉睡" } })).toBe(1);
  });

  it("状态留痕：自动的没有人、方式默认「自动」；人改的带人、方式、理由；按时间排得出先后", async () => {
    await prisma.entCustomerStateLog.create({ data: { customerId: 客户, toState: "活跃", at: new Date("2026-11-01T00:05:00+08:00") } });
    await prisma.entCustomerStateLog.create({ data: { customerId: 客户, fromState: "活跃", toState: "沉睡", reason: "满 90 天没动静", at: new Date("2027-01-30T00:05:00+08:00") } });
    await prisma.entCustomerStateLog.create({ data: { customerId: 客户, fromState: "沉睡", toState: "沉睡", userId: "u-上级", via: "上级代选", reason: "由上级代选：我还在跟", at: new Date("2027-03-01T10:00:00+08:00") } });
    const 痕 = await prisma.entCustomerStateLog.findMany({ where: { customerId: 客户 }, orderBy: { at: "asc" }, select: { fromState: true, toState: true, userId: true, via: true, reason: true } });
    expect(痕).toEqual([
      { fromState: null, toState: "活跃", userId: null, via: "自动", reason: null },
      { fromState: "活跃", toState: "沉睡", userId: null, via: "自动", reason: "满 90 天没动静" },
      { fromState: "沉睡", toState: "沉睡", userId: "u-上级", via: "上级代选", reason: "由上级代选：我还在跟" },
    ]);
  });

  it("冷项目：有这一行 = 冷的，默认提醒级别 0；一个项目一行", async () => {
    expect(await prisma.entProjectCold.create({ data: { projectId: 项目, coldDay: "2027-01-30" } })).toMatchObject({ projectId: 项目, coldDay: "2027-01-30", level: 0 });
    await expect(prisma.entProjectCold.create({ data: { projectId: 项目, coldDay: "2027-02-01" } })).rejects.toThrow();
    await prisma.entProjectCold.update({ where: { projectId: 项目 }, data: { level: 2 } });
    expect(await prisma.project.findUnique({ where: { id: 项目 }, select: { entCold: { select: { level: true } } } })).toEqual({ entCold: { level: 2 } });
  });

  it("删项目带走冷标；删客户带走钟和留痕（清库不被这三张表挡住）", async () => {
    await prisma.entCustomerClock.create({ data: { customerId: 客户, enteredDay: "2026-11-01" } });
    await prisma.entCustomerStateLog.create({ data: { customerId: 客户, toState: "活跃" } });
    await prisma.entProjectCold.create({ data: { projectId: 项目, coldDay: "2027-01-30" } });
    await prisma.$executeRawUnsafe(`DELETE FROM "Project" WHERE id = ?`, 项目);
    expect(await prisma.entProjectCold.count()).toBe(0);
    await prisma.$executeRawUnsafe(`DELETE FROM "Customer" WHERE id = ?`, 客户);
    expect(await prisma.entCustomerClock.count()).toBe(0);
    expect(await prisma.entCustomerStateLog.count()).toBe(0);
  });
});
