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
});
