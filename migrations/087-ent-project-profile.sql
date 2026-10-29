-- 企业版项目画像五项 + 项目所在地（2026-10-29）。说明见 prisma/schema.prisma 的 Project。
-- 五项都可空：预算能力 / 价格感知 / 决策链路 / 需求状态存选项名，产品需求可多选、存 JSON 数组字符串。
-- 选项在企业字典里（EntDictItem，kind 见 src/lib/enterprise/dict-kinds.ts），设置 → 项目模式里改。
-- 所在地是自由文字：国内填城市名，国外填国家。
-- 只放 ADD COLUMN（README 第 4 条）；同一批新列，第一遍全加上，第二遍第一句就抛 duplicate column 跳过。
ALTER TABLE "Project" ADD COLUMN "budgetLevel" TEXT;
ALTER TABLE "Project" ADD COLUMN "priceSense" TEXT;
ALTER TABLE "Project" ADD COLUMN "decisionChain" TEXT;
ALTER TABLE "Project" ADD COLUMN "demandStatus" TEXT;
ALTER TABLE "Project" ADD COLUMN "productNeeds" TEXT;
ALTER TABLE "Project" ADD COLUMN "location" TEXT;
