-- 企业版联系人改版（2026-10-29，定稿 P5 第 24 条）：性别、生日、爱好、地址。说明见 prisma/schema.prisma 的 Contact。
-- 联系方式（号码类型 + 号码）记在联系方式子表 ContactMethod（054）；名片、相册是联系人附件（063）加上 074 的 tag。
-- 只在企业版写；别的版本一直是空。只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Contact" ADD COLUMN "gender" TEXT;
ALTER TABLE "Contact" ADD COLUMN "birthday" TEXT;
ALTER TABLE "Contact" ADD COLUMN "hobby" TEXT;
ALTER TABLE "Contact" ADD COLUMN "address" TEXT;
