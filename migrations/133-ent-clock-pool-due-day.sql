-- 企业版客户三态 · 客户钟补一列「最早进公海日」（2026-11-12）：列表 / 看板的「N 天后进公海」和客户详情状态条对齐。
-- 待回收时写钟顺带存按完整事实算出的最早进公海日（含暂缓解除后 10 天、推后当天重起一轮），列表直接读、不逐行多查。
-- 空 = 不在待回收，或老钟还没重扫（列表退回按钟上的提醒次数排）；不回填，下一遍夜扫自然写上。
-- 说明见 prisma/schema.prisma 的 EntCustomerClock.poolDueDay。规矩同 006：加列单独一个文件、只放 ADD COLUMN。
ALTER TABLE "EntCustomerClock" ADD COLUMN "poolDueDay" TEXT;
