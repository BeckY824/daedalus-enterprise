-- 企业版客户「归档档位」（M-导入-23）：A1 / A2 / B / C / D / E，归档导入时从表里「归档档位」那一列写进来。
-- 空 = 不是归档导入来的客户（老数据、手建的、别的版本一直是空）。只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "Customer" ADD COLUMN "archiveTier" TEXT;
