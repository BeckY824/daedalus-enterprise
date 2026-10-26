-- 企业版「新线索」= 项目的线索阶段（2026-10-26）：分配记录记分的是哪个项目。说明见 prisma/schema.prisma 的 EntLeadAssign。
-- 分项目时 leadId 写空串（这列在存量库是 NOT NULL，按 README 第 3 条不改约束）。
-- 只放 ADD COLUMN 和配套索引（README 第 4 条）。
ALTER TABLE "EntLeadAssign" ADD COLUMN "projectId" TEXT;
CREATE INDEX IF NOT EXISTS "EntLeadAssign_projectId_idx" ON "EntLeadAssign"("projectId");
