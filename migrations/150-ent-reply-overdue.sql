-- 企业版「超时未跟进自动转」（2026-11-17，指定回复时间后续）：线索阶段、填了指定回复时间的项目，负责人超时没记有效沟通 → 超时提醒 → 自动转给下一位销售。
-- 一个项目一行，记眼下这一位走到哪一步。说明见 prisma/schema.prisma 的 EntReplyOverdue。只在企业版写；桌面端、团队版也建这张空表，不读。
-- 规矩同 123：只加表、IF NOT EXISTS、每次启动整个重跑；项目删了随项目级联。
CREATE TABLE IF NOT EXISTS "EntReplyOverdue" (
    "projectId" TEXT NOT NULL PRIMARY KEY,
    "anchorAt" DATETIME NOT NULL,
    "holderId" TEXT NOT NULL,
    "since" DATETIME NOT NULL,
    "overdueAt" DATETIME,
    "tried" TEXT NOT NULL DEFAULT '[]',
    "transfers" INTEGER NOT NULL DEFAULT 0,
    "stoppedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntReplyOverdue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EntReplyOverdue_holderId_idx" ON "EntReplyOverdue"("holderId");
