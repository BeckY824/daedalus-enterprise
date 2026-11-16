-- 客户编号（2026-11-17，客户抬头 PR-1）：加一列 + 唯一索引，只加不改（README 第 4 条：加列的文件只放 ADD COLUMN 和它的索引）。
-- 可空：SQLite 加不了没默认值的 NOT NULL 列；存量客户的号不在迁移里补（迁移不许 UPDATE，且一部署就自动跑，补号要先备份、用户开口），
-- 由 scripts/customer-no-backfill.mjs 按建档时间单独补。补之前页面显示短号。唯一索引名和 Prisma 的 @unique 一致，全新安装不会多建一份
ALTER TABLE "Customer" ADD COLUMN "customerNo" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_customerNo_key" ON "Customer"("customerNo");
