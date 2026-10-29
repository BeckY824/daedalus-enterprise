-- 企业版联系人附件分类（2026-10-29，定稿 P5 第 24 条）：名片 / 相册。说明见 prisma/schema.prisma 的 Attachment。
-- 空 = 没分类（老的联系人附件、商机 / 线索附件都是空，联系人那边当相册看）。只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Attachment" ADD COLUMN "tag" TEXT;
