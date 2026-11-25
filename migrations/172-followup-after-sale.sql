-- 企业版售后回访标记（2026-11-25）：交付结清的项目上记的沟通打上 1（记的时候系统写、之后不改），别的一直是 0。
-- 说明见 prisma/schema.prisma 的 FollowUp.afterSale、lib/project/follow-needs-project.ts。老数据一直是 0（行为同改前）；
-- 旧版本代码不读这一列照常能跑；只加不改。只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "FollowUp" ADD COLUMN "afterSale" BOOLEAN NOT NULL DEFAULT false;
