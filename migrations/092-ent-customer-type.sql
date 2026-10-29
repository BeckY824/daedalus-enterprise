-- 企业版客户类型（2026-10-29，P13 第 4 条）：个人买家 / 贸易商 / 代理商 / 经销商……，选项在企业版字典 custType，设置里能改能停用。别的版本一直是空。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Customer" ADD COLUMN "customerType" TEXT;
