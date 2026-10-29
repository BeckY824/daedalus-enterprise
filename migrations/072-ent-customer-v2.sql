-- 企业版客户改版（2026-10-29，定稿 P5 第 23 条）：客户简称、客户地址（国家 / 省 / 市 / 区县）、分配方式。说明见 prisma/schema.prisma 的 Customer。
-- 客户全称还是 name；客户级别、官网还是 CustomerExtra 的 level / website（级别 D 改 C 在代码里做一次，lib/enterprise/customer-v2-db.ts）。
-- 只在企业版写；别的版本一直是空。只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Customer" ADD COLUMN "shortName" TEXT;
ALTER TABLE "Customer" ADD COLUMN "addrCountry" TEXT;
ALTER TABLE "Customer" ADD COLUMN "addrProvince" TEXT;
ALTER TABLE "Customer" ADD COLUMN "addrCity" TEXT;
ALTER TABLE "Customer" ADD COLUMN "addrDistrict" TEXT;
ALTER TABLE "Customer" ADD COLUMN "assignWay" TEXT;
