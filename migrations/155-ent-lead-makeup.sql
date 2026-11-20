-- 企业版判无效补位（2026-11-20）：线索验证最终判无效、给负责人退了名额时记一行「待补」，下一条自动分配先给有待补的人。
-- 一次判无效一行；用掉时记用在哪条分配上，判无效的线索被恢复时没用掉的作废。说明见 prisma/schema.prisma 的 EntLeadMakeup。
-- 规矩同 089：只加表、IF NOT EXISTS、每次启动整个重跑；指向人、项目、分配记录的列都不建外键。
CREATE TABLE IF NOT EXISTS "EntLeadMakeup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "line" TEXT,
    "usedAt" DATETIME,
    "usedAssignId" TEXT,
    "usedProjectId" TEXT,
    "voidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "EntLeadMakeup_userId_usedAt_idx" ON "EntLeadMakeup"("userId", "usedAt");
CREATE INDEX IF NOT EXISTS "EntLeadMakeup_projectId_idx" ON "EntLeadMakeup"("projectId");
CREATE INDEX IF NOT EXISTS "EntLeadMakeup_usedAssignId_idx" ON "EntLeadMakeup"("usedAssignId");
