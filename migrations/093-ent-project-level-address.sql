-- 企业版项目级别 + 项目地址（2026-10-29，P11 定稿 -2 版）。说明见 prisma/schema.prisma 的 Project。
-- level：项目级别 S / A / B / C，可空；界面按星级显示（lib/enterprise/level-stars.ts 级别星数）。
-- addrCountry / addrProvince / addrCity / addrDistrict：项目所在地，和客户地址同一套结构（国家/地区 → 省 → 市 → 区县级市），
--   都可空，规整规则同客户（lib/enterprise/customer-v2.ts 规整地址）；国外只存国家 + 城市。
-- 087 加的 location 改作「详细地址（定位）」，列不动，这里不碰它。
-- 只放 ADD COLUMN（README 第 4 条）；同一批新列，第一遍全加上，第二遍第一句就抛 duplicate column 跳过。
ALTER TABLE "Project" ADD COLUMN "level" TEXT;
ALTER TABLE "Project" ADD COLUMN "addrCountry" TEXT;
ALTER TABLE "Project" ADD COLUMN "addrProvince" TEXT;
ALTER TABLE "Project" ADD COLUMN "addrCity" TEXT;
ALTER TABLE "Project" ADD COLUMN "addrDistrict" TEXT;
