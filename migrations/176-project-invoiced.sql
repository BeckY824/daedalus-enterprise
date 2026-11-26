-- 企业版项目「已开票」勾选（2026-11-26，12-15 第三批 A 件，客户 E-335 行 22–26、E-337 行 10–11、E-363 四①②）。
-- invoiced：勾了没有；invoicedById / invoicedAt：谁勾的、何时（取消时清空，留痕在 AuditLog）。勾了这个项目不能做项目合并。
-- 说明见 prisma/schema.prisma 的 Project.invoiced、lib/project/invoiced.ts。老项目一律 false，不批量补勾（E-363 四①）；
-- 旧版本代码不读这三列照常能跑；只加不改。只放 ADD COLUMN（README 第 4 条）。编号跳过 175（留给并行分支）
ALTER TABLE "Project" ADD COLUMN "invoiced" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "invoicedById" TEXT;
ALTER TABLE "Project" ADD COLUMN "invoicedAt" DATETIME;
