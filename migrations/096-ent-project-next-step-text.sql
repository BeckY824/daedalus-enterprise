-- 企业版项目「下一步」写成一句话（2026-10-29）：原来只记 nextStepAt（下一步时间），现在记沟通时先写下一步做什么，时间可空。
-- nextStepText：最近一次记沟通填的下一步（文字，可空）；老数据只有时间没文字，界面照旧只显示时间。说明见 prisma/schema.prisma 的 Project。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Project" ADD COLUMN "nextStepText" TEXT;
