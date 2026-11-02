/**
 * 迁移目录里唯一许可的删除（2026-10-29，migrations/066-drop-trade-tables.sql）：外贸订单 / 供应商整套 7 张表，
 * 只许 `DROP TABLE IF EXISTS` 这一种写法，顺序先子表后父表。tests/migrations.test.ts、tests/migration-files-guard.test.ts 共用这一份。
 * 每次启动 016 / 017 / 023 先把它们建成空表、066 再删，重跑多少遍都不抛。名单只许删、不许往里加——
 * 要删别的表，先想清楚老库上的数据怎么办（migrations/README.md 第 3 条）。
 */
export const 许可删除的表 = ["FollowUpOrder", "TradeOrderNode", "TradeOrderDoc", "TradeOrderPurchase", "SupplierQuote", "TradeOrder", "Supplier"];
export const 许可删除的文件 = "066-drop-trade-tables.sql";

/**
 * 迁移目录里唯一许可的重建（2026-11-01，migrations/107-ent-blocker-title.sql）：EntBlocker 建新表 → 拷数据 → 删旧表 → 改名，
 * 把老库 followUpId 的 NOT NULL + 级联改成可空 + ON DELETE SET NULL（SQLite 改不了列约束）。
 * 只认下面这一个形状（tests/migrations.test.ts「107 重建」那几条钉死），其余文件照旧只许加。
 * 第一句是不带 IF NOT EXISTS 的记号索引：已重建过 / 全新安装都会抛 already exists，整个文件跳过。
 */
export const 许可重建的文件 = "107-ent-blocker-title.sql";
export const 许可重建的表 = "EntBlocker";
/** 去注释、按分号切开、压成单行后，107 必须一句不差是这个顺序（列名清单另验） */
export const 许可重建的语句: RegExp[] = [
  /^CREATE INDEX "EntBlocker_followUpId_idx" ON "EntBlocker"\("followUpId"\)$/,
  /^PRAGMA foreign_keys=OFF$/,
  /^BEGIN$/,
  /^CREATE TABLE IF NOT EXISTS "EntBlocker_107" \(.*"followUpId" TEXT,.*FOREIGN KEY \("followUpId"\) REFERENCES "FollowUp" \("id"\) ON DELETE SET NULL ON UPDATE CASCADE \)$/,
  /^INSERT INTO "EntBlocker_107" \([^)]*\) SELECT [^;]* FROM "EntBlocker"$/,
  /^DROP TABLE "EntBlocker"$/,
  /^ALTER TABLE "EntBlocker_107" RENAME TO "EntBlocker"$/,
  /^CREATE UNIQUE INDEX IF NOT EXISTS "EntBlocker_code_key" ON "EntBlocker"\("code"\)$/,
  /^CREATE INDEX IF NOT EXISTS "EntBlocker_projectId_status_idx" ON "EntBlocker"\("projectId", "status"\)$/,
  /^CREATE INDEX IF NOT EXISTS "EntBlocker_assigneeId_status_idx" ON "EntBlocker"\("assigneeId", "status"\)$/,
  /^CREATE INDEX IF NOT EXISTS "EntBlocker_followUpId_idx" ON "EntBlocker"\("followUpId"\)$/,
  /^COMMIT$/,
  /^PRAGMA foreign_keys=ON$/,
];
/** 去注释后按分号切句、压空白；两个守卫测试共用 */
export const 切句 = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
