-- 企业版客户地址第五格「客户地址」（2026-10-29，P14 第 7 条）。说明见 prisma/schema.prisma 的 Customer。
-- addrDetail：公司详细地址（街道门牌、园区楼栋……），可空，国内国外都收；前四格（国家地区 / 省 / 市 / 区县级市）是 072 加的。
-- 只放 ADD COLUMN（README 第 4 条），第二遍抛 duplicate column 跳过。
ALTER TABLE "Customer" ADD COLUMN "addrDetail" TEXT;
