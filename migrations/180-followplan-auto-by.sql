-- 自动建的计划的来源标记（2026-11-27，客户 E-396）："mql-nurture" = 判 MQL 不合格系统建的培育计划；人手加的为空。
-- 说明见 prisma/schema.prisma 的 FollowPlan.autoBy。一个文件只放一句 ADD COLUMN（README 第 4 条）
ALTER TABLE "FollowPlan" ADD COLUMN "autoBy" TEXT;
