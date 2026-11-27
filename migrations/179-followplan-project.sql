-- 判 MQL 不合格自动建的培育计划（2026-11-27，客户 E-396）：记是哪个项目判的，项目离开潜客培育时按它找到要撤的计划。
-- 可空、不建外键（旧计划、人手加的计划都是空）。说明见 prisma/schema.prisma 的 FollowPlan.projectId。
-- 一个文件只放一句 ADD COLUMN（README 第 4 条）
ALTER TABLE "FollowPlan" ADD COLUMN "projectId" TEXT;
