/**
 * R2 · 迁移文件守卫：migrations/ 里每个文件都要经得起「每次启动按文件名顺序全部重跑一遍」（docker-entrypoint.sh）。
 *
 * 老版本桌面库被桌面入口（desktop/server-entry.js）升级上来那一整套（拉老 tag 建库、故障注入）属于桌面壳，
 * 在桌面端仓库里钉；企业库不带壳，这里只留跑之前就能拦住的文件规矩。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 许可删除的表, 许可删除的文件 } from "./migration-allowed-drops";

const ROOT = path.resolve(__dirname, "..");

describe("迁移文件守卫（README 的规矩，跑之前就拦住）", () => {
  const 迁移 = fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const 语句 = (f: string) =>
    fs
      .readFileSync(path.join(ROOT, "migrations", f), "utf8")
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

  /** 唯一许可的删除：066 删外贸订单 / 供应商整套 7 张表（2026-10-29）。名单见 migration-allowed-drops.ts */
  const 许可删除 = new RegExp(`^DROP TABLE IF EXISTS "(${许可删除的表.join("|")})"$`, "i");

  it("每一句都是 CREATE … IF NOT EXISTS 或 ALTER TABLE … ADD COLUMN（只增不改；只放过 066 那 7 张表的 DROP TABLE IF EXISTS）", () => {
    const 违规 = 迁移.flatMap((f) => 语句(f).filter((s) => !/^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS/i.test(s) && !/^ALTER TABLE \S+ ADD COLUMN/i.test(s) && !(f === 许可删除的文件 && 许可删除.test(s))).map((s) => `${f}: ${s.slice(0, 60)}`));
    expect(违规).toEqual([]);
  });

  it("066 正好删那 7 张表、先子表后父表（外键开着时父表先删会被子表挡住）", () => {
    const 删 = 语句(许可删除的文件).map((s) => s.match(许可删除)?.[1]);
    expect(删).toEqual(许可删除的表);
    expect(删.indexOf("TradeOrder")).toBeGreaterThan(Math.max(删.indexOf("FollowUpOrder"), 删.indexOf("TradeOrderNode"), 删.indexOf("TradeOrderDoc"), 删.indexOf("TradeOrderPurchase")));
    expect(删.indexOf("Supplier")).toBeGreaterThan(Math.max(删.indexOf("SupplierQuote"), 删.indexOf("TradeOrderPurchase")));
  });

  it("带 ADD COLUMN 的文件里不夹建表（第二遍那句一抛，同文件后面的全被跳过）", () => {
    const 违规 = 迁移.filter((f) => {
      const ss = 语句(f);
      return ss.some((s) => /ADD COLUMN/i.test(s)) && ss.some((s) => /^CREATE TABLE/i.test(s));
    });
    expect(违规).toEqual([]);
  });

  it("编号不重复（docker-entrypoint.sh 按文件名排序跑，同号谁先谁后靠运气）", () => {
    const 号 = 迁移.map((f) => f.slice(0, 3));
    expect(new Set(号).size).toBe(号.length);
  });
});
