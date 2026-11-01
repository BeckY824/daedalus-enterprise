-- 企业版卡点（2026-10-26）：卡点、卡点流转、沟通记录编号 / 下次时间。说明见 prisma/schema.prisma 的 EntBlocker / EntBlockerLog / EntFollowUpMeta。
-- 规矩同前：只加表、IF NOT EXISTS、每次启动整个重跑；现有表一列不动。卡点默认值存 Setting，由代码第一次读时兜底（这里不许 INSERT）。
-- 指向人的列不建外键（同 Project.ownerId），改身份时按 src/lib/sync/tables.ts 的 指向人的列 一起改。
CREATE TABLE IF NOT EXISTS "EntBlocker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "contactId" TEXT,
    "phase" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "obstacle" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dueDays" INTEGER NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT '看板',
    "assigneeId" TEXT,
    "creatorId" TEXT NOT NULL,
    "resourceRequest" TEXT,
    "progress" TEXT,
    "solution" TEXT,
    "result" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntBlocker_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EntBlocker_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "EntBlocker_code_key" ON "EntBlocker"("code");
CREATE INDEX IF NOT EXISTS "EntBlocker_projectId_status_idx" ON "EntBlocker"("projectId", "status");
CREATE INDEX IF NOT EXISTS "EntBlocker_assigneeId_status_idx" ON "EntBlocker"("assigneeId", "status");
CREATE TABLE IF NOT EXISTS "EntBlockerLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "note" TEXT,
    CONSTRAINT "EntBlockerLog_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "EntBlocker" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EntBlockerLog_blockerId_at_idx" ON "EntBlockerLog"("blockerId", "at");
CREATE TABLE IF NOT EXISTS "EntFollowUpMeta" (
    "followUpId" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nextAt" DATETIME,
    CONSTRAINT "EntFollowUpMeta_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EntFollowUpMeta_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "EntFollowUpMeta_code_key" ON "EntFollowUpMeta"("code");
CREATE INDEX IF NOT EXISTS "EntFollowUpMeta_projectId_idx" ON "EntFollowUpMeta"("projectId");

-- 2026-11-01 卡点改版追加（每次启动整目录重跑，IF NOT EXISTS 幂等）：认领明细一人一行、阻碍原因字典、卡点 ↔ 原因多选。
-- 标题列在 107-ent-blocker-title.sql。老库 EntBlocker.followUpId 仍是 NOT NULL + 级联（迁移改不了约束），
-- 彻底删沟通前由代码先挡住带卡点的沟通，见 src/lib/project/blocker.ts 卡点脱离沟通。
CREATE TABLE IF NOT EXISTS "EntBlockerClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "doneAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntBlockerClaim_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "EntBlocker" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "EntBlockerClaim_blockerId_userId_key" ON "EntBlockerClaim"("blockerId", "userId");
CREATE INDEX IF NOT EXISTS "EntBlockerClaim_userId_done_idx" ON "EntBlockerClaim"("userId", "done");
CREATE TABLE IF NOT EXISTS "EntBlockerReason" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '启用',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "mergedIntoId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "EntBlockerReason_name_key" ON "EntBlockerReason"("name");
CREATE TABLE IF NOT EXISTS "EntBlockerReasonLink" (
    "blockerId" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    PRIMARY KEY ("blockerId", "reasonId"),
    CONSTRAINT "EntBlockerReasonLink_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "EntBlocker" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EntBlockerReasonLink_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "EntBlockerReason" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EntBlockerReasonLink_reasonId_idx" ON "EntBlockerReasonLink"("reasonId");
