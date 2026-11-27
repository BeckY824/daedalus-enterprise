-- 企业版跨负责人合并客户的合并申请（2026-11-26，客户 E-280 / E-331 第二批 2b）：说明见 prisma/schema.prisma 的 EntMergeRequest / EntMergeApprover、
-- lib/enterprise/merge-request.ts。规矩同 171：只加表、IF NOT EXISTS、每次启动整个重跑；指向人、客户的列都不建外键（被并的客户 30 天后清掉，申请照留）；
-- 同意人随申请删（申请不会删，外键只为 prisma 关系）
CREATE TABLE IF NOT EXISTS "EntMergeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromId" TEXT NOT NULL,
    "intoId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '待同意',
    "reason" TEXT,
    "choices" TEXT NOT NULL DEFAULT '{}',
    "snapshot" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "endedById" TEXT,
    "mergeId" TEXT
);
CREATE INDEX IF NOT EXISTS "EntMergeRequest_intoId_status_idx" ON "EntMergeRequest"("intoId", "status");
CREATE INDEX IF NOT EXISTS "EntMergeRequest_fromId_status_idx" ON "EntMergeRequest"("fromId", "status");
CREATE INDEX IF NOT EXISTS "EntMergeRequest_byUserId_status_idx" ON "EntMergeRequest"("byUserId", "status");
CREATE INDEX IF NOT EXISTS "EntMergeRequest_status_expiresAt_idx" ON "EntMergeRequest"("status", "expiresAt");
CREATE TABLE IF NOT EXISTS "EntMergeApprover" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "projects" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT '待同意',
    "note" TEXT,
    "decidedAt" DATETIME,
    "fromUserId" TEXT,
    "transferredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntMergeApprover_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EntMergeRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EntMergeApprover_requestId_idx" ON "EntMergeApprover"("requestId");
CREATE INDEX IF NOT EXISTS "EntMergeApprover_userId_status_idx" ON "EntMergeApprover"("userId", "status");
