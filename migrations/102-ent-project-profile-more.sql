-- 企业版项目画像再加七项（2026-10-31）。说明见 prisma/schema.prisma 的 Project。
-- 七项都单选、可空、存选项名：采购周期 / 产品匹配 / 价值认同 / 决策触达 / 竞品信息 / 部署条件 / 场地现状。
-- 选项在企业字典里（EntDictItem，kind 见 src/lib/enterprise/dict-kinds.ts），第一次读时自动建默认项，设置 → 项目模式里改。
-- 只放 ADD COLUMN（README 第 4 条）；同一批新列，第一遍全加上，第二遍第一句就抛 duplicate column 跳过。
ALTER TABLE "Project" ADD COLUMN "purchaseCycle" TEXT;
ALTER TABLE "Project" ADD COLUMN "productFit" TEXT;
ALTER TABLE "Project" ADD COLUMN "valueFit" TEXT;
ALTER TABLE "Project" ADD COLUMN "decisionReach" TEXT;
ALTER TABLE "Project" ADD COLUMN "competitor" TEXT;
ALTER TABLE "Project" ADD COLUMN "deployFit" TEXT;
ALTER TABLE "Project" ADD COLUMN "siteStatus" TEXT;
