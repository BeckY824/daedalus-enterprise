-- 12-22 第 2 阶段 · 转让异议（2026-11-27，判定页 #7 #8 #18）：说明见 prisma/schema.prisma 的 EntTransferObjection、lib/enterprise/objection.ts。
-- ownerLogId 可空、mergeId 为项目合并类异议留口（kind 加「项目合并」，只建结构）。
-- 规矩同 164：只加表、IF NOT EXISTS、每次启动整个重跑；指向人、客户、项目、换负责人记录的列都不建外键（停用的人、软删的客户照留）。
CREATE TABLE IF NOT EXISTS "EntTransferObjection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerLogId" TEXT,
    "mergeId" TEXT,
    "customerId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "objectorUserId" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "toOwnerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '可提',
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "submittedAt" DATETIME,
    "judgeIds" TEXT,
    "judgeRole" TEXT,
    "judgeNote" TEXT,
    "judgedAt" DATETIME,
    "judgedById" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "EntTransferObjection_ownerLogId_objectorUserId_targetKey_key" ON "EntTransferObjection"("ownerLogId", "objectorUserId", "targetKey");
CREATE UNIQUE INDEX IF NOT EXISTS "EntTransferObjection_mergeId_objectorUserId_targetKey_key" ON "EntTransferObjection"("mergeId", "objectorUserId", "targetKey");
CREATE INDEX IF NOT EXISTS "EntTransferObjection_objectorUserId_status_idx" ON "EntTransferObjection"("objectorUserId", "status");
CREATE INDEX IF NOT EXISTS "EntTransferObjection_status_submittedAt_idx" ON "EntTransferObjection"("status", "submittedAt");
