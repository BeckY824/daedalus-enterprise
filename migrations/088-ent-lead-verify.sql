-- 企业版线索有效性验证（2026-10-29，P12）：销售初判 → 市场复核 → 销售终验 → 总管理终判，四步。
-- EntLeadVerify 每个项目一份当前状态（线索判定、无效原因、验证人 / 时间、复核结果 / 说明 / 人 / 时间、接受复核 / 提交异议、最终结果），
-- EntLeadVerifyLog 每一步一行留痕（谁、何时、判了什么、说明），项目详情页的小时间线读它。说明见 prisma/schema.prisma。
-- 只在企业版、项目模式下写；桌面端、团队版也建这两张空表，不读。
-- 规矩同 051：只加表、IF NOT EXISTS、每次启动整个重跑；指向人的列不建外键，项目删了随项目级联。
CREATE TABLE IF NOT EXISTS "EntLeadVerify" (
    "projectId" TEXT NOT NULL PRIMARY KEY,
    "verdict" TEXT NOT NULL DEFAULT '暂未判定',
    "pending" TEXT,
    "invalidReason" TEXT,
    "verifyNote" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" DATETIME,
    "reviewResult" TEXT,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "salesAck" TEXT,
    "disputeNote" TEXT,
    "ackedAt" DATETIME,
    "finalResult" TEXT,
    "finalNote" TEXT,
    "finalById" TEXT,
    "finalAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntLeadVerify_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EntLeadVerify_pending_idx" ON "EntLeadVerify"("pending");
CREATE TABLE IF NOT EXISTS "EntLeadVerifyLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntLeadVerifyLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EntLeadVerifyLog_projectId_at_idx" ON "EntLeadVerifyLog"("projectId", "at");
