-- 企业版项目关联联系人（2026-10-29，P17 第 2 条）：一个项目可以关联好几位联系人，每一行带「项目角色」（多选，企业字典 projContactRole：决策人 / 审批人……）
-- 和「项目立场」（单选，企业字典 projStance：待定 / 中立 / 对手 / 线人 / 军师 / 盟友，说的是这个人和我方销售的关系）。说明见 prisma/schema.prisma 的 ProjectContact。
-- 规矩同 090：只加表、IF NOT EXISTS、每次启动整个重跑；项目或联系人删了随之级联。
CREATE TABLE IF NOT EXISTS "ProjectContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "roles" TEXT,
    "stance" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectContact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectContact_projectId_contactId_key" ON "ProjectContact"("projectId", "contactId");
CREATE INDEX IF NOT EXISTS "ProjectContact_contactId_idx" ON "ProjectContact"("contactId");
