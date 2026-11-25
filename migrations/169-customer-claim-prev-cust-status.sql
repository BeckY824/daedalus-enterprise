-- 撤销领取 / 分配客户公海时客户状态按原样回滚（2026-11-25 复审，P-撤销-01、B37）：出客户公海那一刻把客户原来存的 custStatus 记在领取这一行，
-- 撤销时从这里读、原样写回，不再由浏览器带回来。NULL = 没记（老行，撤销照旧重算），"" = 原来是空。
-- 说明见 prisma/schema.prisma 的 CustomerClaim.prevCustStatus。旧版本代码不读这一列照常能跑；只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "CustomerClaim" ADD COLUMN "prevCustStatus" TEXT;
