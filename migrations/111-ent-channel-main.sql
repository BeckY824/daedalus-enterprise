-- 企业版主渠道（2026-11-08）：渠道分两层，主渠道一张表（名字、可设子渠道、支持自拓、分类、启用、排序），
-- 原来的 Channel 每一行算「子渠道」（单一入口的子渠道名留空，全称就是主渠道名），挂在主渠道下（112 的 Channel.mainId）。
-- 说明见 prisma/schema.prisma 的 EntChannelMain。只在企业版写；不走团队同步（lib/sync/tables.ts）。
-- 规矩同 109：只加表、IF NOT EXISTS、每次启动整个重跑。
CREATE TABLE IF NOT EXISTS "EntChannelMain" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "allowSub" BOOLEAN NOT NULL DEFAULT true,
    "selfDev" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "EntChannelMain_name_key" ON "EntChannelMain"("name");
