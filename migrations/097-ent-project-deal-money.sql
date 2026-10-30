-- 企业版项目加「成交需求」「合同金额」「定金金额」（2026-10-30）：客户原表这三列照原样导进来，项目详情 / 编辑里可改。
-- dealDemand：成交需求（文字）；contractAmount + contractCurrency：合同金额和币种；depositAmount + depositCurrency：定金金额和币种。
-- 都可空，币种取值同 Project.currency。和 amount（「金额」）各是各的。说明见 prisma/schema.prisma 的 Project。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Project" ADD COLUMN "dealDemand" TEXT;
ALTER TABLE "Project" ADD COLUMN "contractAmount" REAL;
ALTER TABLE "Project" ADD COLUMN "contractCurrency" TEXT;
ALTER TABLE "Project" ADD COLUMN "depositAmount" REAL;
ALTER TABLE "Project" ADD COLUMN "depositCurrency" TEXT;
