-- 客户编号计数表（2026-11-17，客户抬头 PR-1）：只有一行 id = 1，n = 最近发出去的号；取号一句 UPDATE … RETURNING（src/lib/customer-no.ts）。
-- 建表语句和 Prisma 生成的一字不差（全新安装先按 schema.sql 建，这句空转）。这里只建表、不放那一行（迁移不许 INSERT）：存量库由回填脚本补完存量后建这一行；全新的库（一位客户都没有）第一次取号时自己建
CREATE TABLE IF NOT EXISTS "CustomerNoSeq" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "n" INTEGER NOT NULL
);
