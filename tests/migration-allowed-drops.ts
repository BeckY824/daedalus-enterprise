/**
 * 迁移目录里唯一许可的删除（2026-10-29，migrations/066-drop-trade-tables.sql）：外贸订单 / 供应商整套 7 张表，
 * 只许 `DROP TABLE IF EXISTS` 这一种写法，顺序先子表后父表。tests/migrations.test.ts、tests/migration-files-guard.test.ts 共用这一份。
 * 每次启动 016 / 017 / 023 先把它们建成空表、066 再删，重跑多少遍都不抛。名单只许删、不许往里加——
 * 要删别的表，先想清楚老库上的数据怎么办（migrations/README.md 第 3 条）。
 */
export const 许可删除的表 = ["FollowUpOrder", "TradeOrderNode", "TradeOrderDoc", "TradeOrderPurchase", "SupplierQuote", "TradeOrder", "Supplier"];
export const 许可删除的文件 = "066-drop-trade-tables.sql";
