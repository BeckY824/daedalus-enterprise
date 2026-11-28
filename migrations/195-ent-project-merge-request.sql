-- 跨负责人项目直接合并申请（2026-11-28，E-380；终审 review/plan-xmerge-final.md）：说明见 prisma/schema.prisma 的 EntProjectMergeRequest、lib/enterprise/project-merge-request.ts。
-- 规矩同 174：只加表、IF NOT EXISTS、每次启动整个重跑；指向项目、人、客户的列都不建外键（项目软删、人停用，申请照留）。
CREATE TABLE IF NOT EXISTS "EntProjectMergeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromProjectId" TEXT NOT NULL,
    "fromOwnerId" TEXT NOT NULL,
    "intoProjectId" TEXT NOT NULL,
    "intoOwnerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "confirmerIds" TEXT NOT NULL DEFAULT '[]',
    "confirmerRole" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '待确认',
    "reason" TEXT,
    "snapshot" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "endedById" TEXT,
    "mergeId" TEXT
);
CREATE INDEX IF NOT EXISTS "EntProjectMergeRequest_fromProjectId_status_idx" ON "EntProjectMergeRequest"("fromProjectId", "status");
CREATE INDEX IF NOT EXISTS "EntProjectMergeRequest_intoProjectId_status_idx" ON "EntProjectMergeRequest"("intoProjectId", "status");
CREATE INDEX IF NOT EXISTS "EntProjectMergeRequest_customerId_status_idx" ON "EntProjectMergeRequest"("customerId", "status");
CREATE INDEX IF NOT EXISTS "EntProjectMergeRequest_byUserId_status_idx" ON "EntProjectMergeRequest"("byUserId", "status");
CREATE INDEX IF NOT EXISTS "EntProjectMergeRequest_status_expiresAt_idx" ON "EntProjectMergeRequest"("status", "expiresAt");
