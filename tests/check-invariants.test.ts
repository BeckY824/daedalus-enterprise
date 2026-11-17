/**
 * 数据不变量核对（scripts/check-invariants.mjs，只读）：11-17 复盘「不变量查询套件」。
 * 用 build-template.mjs 现建一份和正式库同结构的空库（每条 SQL 的表、列名跟着 schema 走，改了 schema 这里先红），
 * 造一条违反，断言查得出来、退出码 1、库文件没被改。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { 不变量们, 不过, 跑不变量 } from "../scripts/check-invariants.mjs";

const ROOT = path.resolve(__dirname, "..");
const 脚本 = path.join(ROOT, "scripts/check-invariants.mjs");
let dir = "";
let 空库 = "";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "invariants-"));
  空库 = path.join(dir, "empty.db");
  execFileSync(process.execPath, ["--experimental-sqlite", "--no-warnings", path.join(ROOT, "scripts/build-template.mjs"), 空库], { cwd: ROOT, stdio: "pipe" });
}, 60_000);
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

const 复制 = (名: string) => {
  const 库 = path.join(dir, `${名}.db`);
  const src = new DatabaseSync(空库);
  src.exec(`VACUUM INTO '${库.replaceAll("'", "''")}'`);
  src.close();
  return 库;
};
const 跑 = (库: string, ...参数: string[]) => {
  try {
    return { 码: 0, 出: execFileSync(process.execPath, ["--no-warnings", 脚本, 库, ...参数], { encoding: "utf8" }) };
  } catch (e) {
    const x = e as { status: number; stdout: string; stderr: string };
    return { 码: x.status, 出: x.stdout + x.stderr };
  }
};
const 哈希 = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const 毫秒 = (d: string) => new Date(d).getTime();

/** 两位客户 A、B，同一位在职销售负责；B 名下一个项目 pB */
function 造基础(db: DatabaseSync) {
  const t = 毫秒("2026-11-01T00:00:00Z");
  db.prepare(`INSERT INTO "User" (id, email, password, name, updatedAt) VALUES ('u1', 'u1@t', 'x', '销售一', ?)`).run(t);
  for (const id of ["cA", "cB"]) db.prepare(`INSERT INTO "Customer" (id, name, phone, salesOwnerId, createdAt, updatedAt) VALUES (?, ?, '', 'u1', ?, ?)`).run(id, id, t, t);
  db.prepare(`INSERT INTO "Project" (id, name, customerId, ownerId, creatorId, createdAt, updatedAt) VALUES ('pB', 'pB', 'cB', 'u1', 'u1', ?, ?)`).run(t, t);
}

describe("空库全过", () => {
  it("每条 SQL 在当前 schema 上都能跑（没有一条「跳过」），全 0，退出码 0", () => {
    const db = new DatabaseSync(空库);
    const 结果 = 跑不变量(db);
    db.close();
    expect(结果.filter((r) => r.跳过).map((r) => `${r.键}：${r.跳过}`)).toEqual([]);
    expect(结果.every((r) => r.违反数 === 0)).toBe(true);
    expect(结果).toHaveLength(不变量们.length);
    expect(不过(结果, true)).toBe(false);
    expect(跑(空库).码).toBe(0);
  });

  it("每条都写了依据", () => {
    for (const x of 不变量们) expect(x.依据.trim(), x.键).not.toBe("");
  });
});

describe("造违反，查得出", () => {
  it("沟通挂在别家客户的项目上 → 违反数 1、列出这条沟通、退出码 1、库文件没被改", () => {
    const 库 = 复制("follow");
    const db = new DatabaseSync(库);
    造基础(db);
    const t = 毫秒("2026-11-02T00:00:00Z");
    // 沟通记在客户 A 上，却挂到客户 B 的项目 pB
    db.prepare(`INSERT INTO "FollowUp" (id, type, title, content, customerId, ownerId, createdAt, updatedAt) VALUES ('f-bad', 'PHONE', '', '', 'cA', 'u1', ?, ?)`).run(t, t);
    db.prepare(`INSERT INTO "FollowUpProject" (followUpId, projectId, node) VALUES ('f-bad', 'pB', '潜客培育')`).run();
    // 对照：挂自己客户的项目，不算
    db.prepare(`INSERT INTO "FollowUp" (id, type, title, content, customerId, ownerId, createdAt, updatedAt) VALUES ('f-ok', 'PHONE', '', '', 'cB', 'u1', ?, ?)`).run(t, t);
    db.prepare(`INSERT INTO "FollowUpProject" (followUpId, projectId, node) VALUES ('f-ok', 'pB', '潜客培育')`).run();
    db.close();

    const 前 = 哈希(库);
    const r = 跑(库);
    expect(r.码).toBe(1);
    expect(r.出).toMatch(/✗ \[违规\] 沟通记录挂的项目属于同一位客户 \| 1 \| f-bad/);
    expect(r.出).toMatch(/结论：不过/);
    expect(哈希(库)).toBe(前);

    const ro = new DatabaseSync(库);
    const 这条 = 跑不变量(ro).find((x) => x.键 === "沟通挂别家客户的项目")!;
    ro.close();
    expect(这条).toMatchObject({ 违反数: 1, 前几: ["f-bad"] });
  });

  it("补建项目晚于首条节点日志：时间列一边整数毫秒、一边 ISO 文本也比得对", () => {
    const 库 = 复制("system");
    const db = new DatabaseSync(库);
    造基础(db);
    const 插项目 = db.prepare(`INSERT INTO "Project" (id, name, customerId, ownerId, creatorId, createdAt, updatedAt) VALUES (?, ?, 'cA', 'u1', 'system', ?, ?)`);
    const 插日志 = db.prepare(`INSERT INTO "ProjectNodeLog" (id, projectId, userId, at, toPhase, toNode) VALUES (?, ?, 'system', ?, '线索', '潜客培育')`);
    插项目.run("p-late", "晚", 毫秒("2026-11-10T00:00:00Z"), 毫秒("2026-11-10T00:00:00Z"));
    插日志.run("l1", "p-late", "2026-11-01T00:00:00.000Z");
    插项目.run("p-ok", "准", 毫秒("2026-11-01T00:00:00Z"), 毫秒("2026-11-01T00:00:00Z"));
    插日志.run("l2", "p-ok", "2026-11-05T00:00:00.000Z");
    插项目.run("p-nolog", "没日志", 毫秒("2026-11-01T00:00:00Z"), 毫秒("2026-11-01T00:00:00Z"));
    db.close();

    const ro = new DatabaseSync(库);
    const 这条 = 跑不变量(ro).find((x) => x.键 === "补建项目晚于首条节点日志")!;
    ro.close();
    expect(这条).toMatchObject({ 违反数: 2, 前几: ["p-late", "p-nolog"] });
  });

  it("只有「待核」非 0 时默认退出码 0，--strict 时 1", () => {
    const 库 = 复制("pending");
    const db = new DatabaseSync(库);
    造基础(db);
    db.prepare(`UPDATE "User" SET active = 0 WHERE id = 'u1'`).run();
    db.close();
    const r = 跑(库);
    expect(r.出).toMatch(/\? \[待核\] 不在公海的客户，负责人在职/);
    expect(r.码).toBe(0);
    expect(跑(库, "--strict").码).toBe(1);
  });

  it("不给库 → 退出码 2", () => {
    expect(跑("").码).toBe(2);
  });
});
