-- 疑似重复清单「不是同一个人」撤销留痕（2026-11-26，12-15 第三批 C，P-合并-06）：撤销不删行，打上谁、何时撤的；再标一次清空这两列、userId / at 换成新标的人和时刻
-- （每次标、撤都另记操作日志 not-dupe / not-dupe-undo）。说明见 prisma/schema.prisma 的 CustomerNotDupe、lib/enterprise/dupe-groups.ts。
-- 老行两列都空 = 标着；旧版本代码不读这两列照常能跑；只加不改。只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "CustomerNotDupe" ADD COLUMN "undoneAt" DATETIME;
ALTER TABLE "CustomerNotDupe" ADD COLUMN "undoneById" TEXT;
