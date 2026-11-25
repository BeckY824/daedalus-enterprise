-- 售后回访排的下次回访（2026-11-25）：跟进计划记一下是给哪个交付结清项目排的，完成计划时默认挂回那个项目、带售后回访标记。
-- 可空、不建外键（项目删了计划照留，完成时核不过就当普通计划）。说明见 prisma/schema.prisma 的 FollowPlan.afterSaleProjectId。
-- 和 172 分开放：一个文件只放一句 ADD COLUMN（README 第 4 条，一句抛了同文件后面的全跳过）
ALTER TABLE "FollowPlan" ADD COLUMN "afterSaleProjectId" TEXT;
