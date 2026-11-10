-- 企业版挂靠审批（2026-11-10，机制表 P-挂靠-02 / P-看-13）：撞号台账那一行就是一条挂靠申请，补审批人、转上级时刻、谁处理的、几时处理的。
-- 说明见 prisma/schema.prisma 的 EntDupeHit。只在企业版写；别的版本一直是空。只放 ADD COLUMN（README 第 4 条），配套索引同文件。
ALTER TABLE "EntDupeHit" ADD COLUMN "approverId" TEXT;
ALTER TABLE "EntDupeHit" ADD COLUMN "escalatedAt" DATETIME;
ALTER TABLE "EntDupeHit" ADD COLUMN "decidedById" TEXT;
ALTER TABLE "EntDupeHit" ADD COLUMN "decidedAt" DATETIME;
CREATE INDEX IF NOT EXISTS "EntDupeHit_approverId_status_idx" ON "EntDupeHit"("approverId", "status");
