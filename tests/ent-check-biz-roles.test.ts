/**
 * 企业版部署前核对（scripts/check-biz-roles.mjs，只读）：权限只认业务角色之后，
 * 在职账号都设好业务角色了没有、有没有总管理。不过 → 退出码 1，先补好再部署。
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { 业务角色 } from "@/lib/sync/dept-policy";
import { 核对, 报告, 认的角色 } from "../scripts/check-biz-roles.mjs";

const 账号 = (id: string, active = 1) => ({ id, name: `${id}名`, email: `${id}@t`, role: "SALES", active });

describe("纯算 核对", () => {
  it("脚本认的角色和 业务角色 是同一份", () => {
    expect(认的角色).toEqual([...业务角色]);
  });

  it("全设好、有一位能管设置的总管理 → 过", () => {
    const r = 核对([账号("d"), 账号("s")], [{ userId: "d", bizRole: "director" }, { userId: "s", bizRole: "sales" }]);
    expect(r.过).toBe(true);
    expect(r.问题).toEqual([]);
    expect(报告(r, null)).toMatch(/结论：过/);
    expect(报告(r, null)).toMatch(/没拨过（= 关）/);
  });

  it("没组织行、角色串空着、全是不认识的：都算没设；停用的不算", () => {
    const r = 核对(
      [账号("d"), 账号("无行"), 账号("空"), 账号("怪"), 账号("停", 0)],
      [{ userId: "d", bizRole: "director" }, { userId: "空", bizRole: "" }, { userId: "怪", bizRole: "boss,root" }],
    );
    expect(r.没角色.map((u) => u.id)).toEqual(["无行", "空", "怪"]);
    expect(r.在职数).toBe(4);
    expect(r.过).toBe(false);
    expect(报告(r, true)).toMatch(/无行名（无行@t，账号角色 SALES）/);
  });

  it("兼角色里有 director 也算总管理", () => {
    expect(核对([账号("x")], [{ userId: "x", bizRole: "sales, director" }]).总管理.map((u) => u.id)).toEqual(["x"]);
  });

  it("一位总管理都没有 → 不过；停用的总管理不算", () => {
    const r = 核对([账号("s"), 账号("老", 0)], [{ userId: "s", bizRole: "sales" }, { userId: "老", bizRole: "director" }]);
    expect(r.过).toBe(false);
    expect(r.问题.join()).toMatch(/一位总管理/);
  });

  it("总管理都勾了「不管设置」→ 不过；还有一位没勾 → 过，勾了的照样列出来", () => {
    const 都勾 = 核对([账号("a")], [{ userId: "a", bizRole: "director", noSettings: 1 }]);
    expect(都勾.过).toBe(false);
    expect(都勾.问题.join()).toMatch(/不管设置/);
    const 一位没勾 = 核对([账号("a"), 账号("b")], [{ userId: "a", bizRole: "director", noSettings: 1 }, { userId: "b", bizRole: "director", noSettings: 0 }]);
    expect(一位没勾.过).toBe(true);
    expect(一位没勾.不管设置的总管理.map((u) => u.id)).toEqual(["a"]);
  });
});

describe("命令行（只读打开真库）", () => {
  const 脚本 = path.join(__dirname, "../scripts/check-biz-roles.mjs");
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  const 建库 = (有列: boolean) => {
    dir = mkdtempSync(path.join(os.tmpdir(), "biz-roles-"));
    const 库 = path.join(dir, "t.db");
    const db = new DatabaseSync(库);
    db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT, active INTEGER)`);
    db.exec(`CREATE TABLE "EntMember" (userId TEXT PRIMARY KEY, bizRole TEXT${有列 ? ", noSettings INTEGER DEFAULT 0" : ""})`);
    db.exec(`CREATE TABLE "Setting" (key TEXT PRIMARY KEY, value TEXT)`);
    db.close();
    return 库;
  };
  const 跑 = (库: string) => {
    try {
      return { 码: 0, 出: execFileSync(process.execPath, ["--no-warnings", 脚本, 库], { encoding: "utf8" }) };
    } catch (e) {
      const x = e as { status: number; stdout: string; stderr: string };
      return { 码: x.status, 出: x.stdout + x.stderr };
    }
  };

  it("全设好 → 退出码 0；规则开着照实打印；库文件没被改", () => {
    const 库 = 建库(true);
    const db = new DatabaseSync(库);
    db.exec(`INSERT INTO "User" VALUES ('d','甲','d@t','ADMIN',1), ('s','乙','s@t','SALES',1)`);
    db.exec(`INSERT INTO "EntMember" VALUES ('d','director',0), ('s','sales',0)`);
    db.exec(`INSERT INTO "Setting" VALUES ('enterprise.rule.org_scope','true')`);
    db.close();
    const 前 = statSync(库).mtimeMs;
    const r = 跑(库);
    expect(r.码).toBe(0);
    expect(r.出).toMatch(/规则「按组织看客户」：开/);
    expect(statSync(库).mtimeMs).toBe(前);
  });

  it("有人没设业务角色 → 退出码 1、列出这个人；迁移 108 之前没有 noSettings 列也能跑", () => {
    const 库 = 建库(false);
    const db = new DatabaseSync(库);
    db.exec(`INSERT INTO "User" VALUES ('d','甲','d@t','ADMIN',1), ('n','丙','n@t','ADMIN',1)`);
    db.exec(`INSERT INTO "EntMember" VALUES ('d','director')`);
    db.close();
    const r = 跑(库);
    expect(r.码).toBe(1);
    expect(r.出).toMatch(/丙（n@t，账号角色 ADMIN）/);
    expect(r.出).toMatch(/结论：不过/);
  });

  it("不给库 → 退出码 2", () => {
    const r = 跑("");
    expect(r.码).toBe(2);
  });
});
