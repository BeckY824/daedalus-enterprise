-- 企业版线索配额加额（2026-10-29，P12）：线索最终判成无效（市场复核或总管理终判），给这条线索的负责人本月自动分配配额 +1。
-- 每人每月一行（month = 业务月 YYYY-MM，北京时间，同 EntLeadAssign），下个月没有行就是 0，等于按月清零。
-- 没设配额（EntLeadQuota 没行）的人不加：他本来就不参与自动分配、手动分也不限数。说明见 prisma/schema.prisma。
-- 规矩同 045：只加表、IF NOT EXISTS；指向人的列不建外键。
CREATE TABLE IF NOT EXISTS "EntLeadQuotaBonus" (
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("userId", "month")
);
