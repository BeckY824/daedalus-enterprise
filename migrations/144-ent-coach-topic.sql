-- 企业版教练主题（2026-11-17，销售教练角色 PR2）：教练 / 上级 / 系统管理员在项目沟通卡里发起的主题，负责人回复。
-- 不是沟通记录（不碰三态、冷项目、额度、下一步计划）。说明见 prisma/schema.prisma 的 EntCoachTopic / EntCoachReply。
-- 规矩同 088：只加表、IF NOT EXISTS、每次启动整个重跑。项目真删随项目级联，主题真删随主题级联。
CREATE TABLE IF NOT EXISTS "EntCoachTopic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "node" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '待回复',
    "closedById" TEXT,
    "closedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntCoachTopic_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EntCoachTopic_projectId_status_idx" ON "EntCoachTopic"("projectId", "status");
CREATE INDEX IF NOT EXISTS "EntCoachTopic_authorId_status_idx" ON "EntCoachTopic"("authorId", "status");
CREATE INDEX IF NOT EXISTS "EntCoachTopic_status_projectId_idx" ON "EntCoachTopic"("status", "projectId");
CREATE TABLE IF NOT EXISTS "EntCoachReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntCoachReply_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "EntCoachTopic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EntCoachReply_topicId_createdAt_idx" ON "EntCoachReply"("topicId", "createdAt");
