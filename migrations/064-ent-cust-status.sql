-- 企业版客户状态（2026-10-28）：潜在、意向、成交……这一类可配置的状态，选项在企业版字典「客户状态」（EntDictItem kind=custStatus）。
-- 企业版藏掉跟进 / 决策状态，改看这一列；旧的两列照留不删。别的版本不读不写，一直是空。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Customer" ADD COLUMN "custStatus" TEXT;
