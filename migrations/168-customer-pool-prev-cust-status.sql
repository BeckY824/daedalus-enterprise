-- 撤销放进公海时客户状态按原样回滚（2026-11-25 复审，P-撤销-01、B37）：手动放进公海那一刻把客户原来存的 custStatus 记在客户公海这一行，
-- 撤销放进时从这里读、原样写回，不再由浏览器带回来（带回来的能被改）。NULL = 没记（别的入池、老行，撤销照旧重算），"" = 原来是空。
-- 说明见 prisma/schema.prisma 的 CustomerPool.prevCustStatus。旧版本代码不读这一列照常能跑；只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "CustomerPool" ADD COLUMN "prevCustStatus" TEXT;
