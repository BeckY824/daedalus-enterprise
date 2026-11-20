-- 企业版主动放弃（豁免）（2026-11-20，32H）：销售对新分配、还没记有效沟通的线索点「放弃」，按超时转同一套挑人转给本线下一位。
-- 每人每月 1 次，一次一行；(userId, month) 唯一，并发点两次只成一次。说明见 prisma/schema.prisma 的 EntLeadGiveUp、lib/enterprise/lead-giveup.ts。
-- 规矩同 155：只加表、IF NOT EXISTS、每次启动整个重跑；指向人、项目、待补的列都不建外键。
CREATE TABLE IF NOT EXISTS "EntLeadGiveUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "toUserId" TEXT,
    "makeupId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "EntLeadGiveUp_userId_month_key" ON "EntLeadGiveUp"("userId", "month");
CREATE INDEX IF NOT EXISTS "EntLeadGiveUp_projectId_idx" ON "EntLeadGiveUp"("projectId");
