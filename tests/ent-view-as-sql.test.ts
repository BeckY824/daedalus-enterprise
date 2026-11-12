/**
 * 切换视图 / 管理员只读拦裸 SQL 时的判写（view-as.ts 会写库的SQL）：
 *   按号搜客户用的 replace(...) 是读，不能当写拦（11-03 全方位测试 D3-4：管理员按号搜整页报错）
 */
import { describe, it, expect } from "vitest";
import { 会写库的SQL } from "@/lib/enterprise/view-as";
import { 按号键找SQL } from "@/lib/phone-dedupe";

describe("会写库的SQL", () => {
  it("按号搜的 SELECT（满是 replace(...)）不算写", () => {
    expect(会写库的SQL(按号键找SQL(1))).toBe(false);
    expect(会写库的SQL(按号键找SQL(3))).toBe(false);
  });
  it("REPLACE INTO / INSERT OR REPLACE 照样算写", () => {
    expect(会写库的SQL('REPLACE INTO "Customer" (id) VALUES (?)')).toBe(true);
    expect(会写库的SQL('replace\n  into x values (1)')).toBe(true);
    expect(会写库的SQL('INSERT OR REPLACE INTO x VALUES (1)')).toBe(true);
  });
  it("其余写法和认不出原文照旧", () => {
    expect(会写库的SQL('UPDATE "Customer" SET name = ?')).toBe(true);
    expect(会写库的SQL("PRAGMA foreign_keys = OFF")).toBe(true);
    expect(会写库的SQL(null)).toBe(true);
    expect(会写库的SQL('SELECT count(*) FROM "Customer"')).toBe(false);
  });
  it("PRAGMA 按白名单：查表结构 / 检查类带不带括号都是读；读设置值只认光秃秃的写法；带 = 、设置类带括号、不在白名单的都当写", () => {
    // 现有代码里实际用到的读
    for (const 读 of ['PRAGMA table_info("Customer")', "PRAGMA table_info(Customer)", "pragma main.table_info('x')", "PRAGMA foreign_key_list(\"Project\")", "PRAGMA foreign_key_list", "PRAGMA foreign_key_check", "PRAGMA quick_check", "PRAGMA integrity_check(10)", "PRAGMA table_list", "PRAGMA index_list(x)", "PRAGMA index_info(i)", "PRAGMA journal_mode", "PRAGMA user_version", "PRAGMA secure_delete", "PRAGMA busy_timeout", "SELECT name FROM pragma_table_info('Customer')"]) {
      expect(会写库的SQL(读), 读).toBe(false);
    }
    for (const 写 of ["PRAGMA user_version = 5", "PRAGMA user_version(5)", "PRAGMA journal_mode(WAL)", "PRAGMA journal_mode = WAL", "PRAGMA busy_timeout = 5000", "PRAGMA secure_delete = ON", "PRAGMA defer_foreign_keys = ON", "PRAGMA writable_schema", "PRAGMA case_sensitive_like = 1", "PRAGMA 不认得的", "PRAGMA table_info(x); PRAGMA optimize"]) {
      expect(会写库的SQL(写), 写).toBe(true);
    }
  });
  it("不带 = 也会动库的 PRAGMA 算写（落检查点、优化、回收空页），只读的 PRAGMA 不算", () => {
    expect(会写库的SQL("PRAGMA wal_checkpoint(TRUNCATE)")).toBe(true);
    expect(会写库的SQL("pragma  wal_checkpoint")).toBe(true);
    expect(会写库的SQL("PRAGMA main.wal_checkpoint(FULL)")).toBe(true);
    expect(会写库的SQL("PRAGMA optimize")).toBe(true);
    expect(会写库的SQL("PRAGMA incremental_vacuum(10)")).toBe(true);
    expect(会写库的SQL("PRAGMA table_info(\"Customer\")")).toBe(false);
    expect(会写库的SQL("PRAGMA journal_mode")).toBe(false);
  });
});
