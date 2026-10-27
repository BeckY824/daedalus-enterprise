-- 企业版预计成交日期从客户挪到项目（2026-10-27）。说明见 prisma/schema.prisma 的 Project.expectedDealAt；老数据回填在代码里（lib/project/expected-deal.ts），只做一次。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Project" ADD COLUMN "expectedDealAt" DATETIME;
