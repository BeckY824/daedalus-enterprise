-- 企业版客户转让交接记转让原因（2026-10-27）：下拉选项来自「转让原因」字典，不选为空。说明见 prisma/schema.prisma 的 EntHandover。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "EntHandover" ADD COLUMN "reason" TEXT;
