-- 企业版分配记录记分配方式（2026-10-27）：指定分配 / 自动分配，名字按「分配方式」字典。说明见 prisma/schema.prisma 的 EntLeadAssign。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "EntLeadAssign" ADD COLUMN "way" TEXT;
