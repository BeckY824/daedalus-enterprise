-- 企业版统一公海（2026-10-29）：公海里的客户被老板 / 主管标成「无效客户」的时间。空 = 有效。
-- 标了无效的领不了、分不了（客户公海、项目公海两条领取路都拦），只有老板能恢复（恢复 = 清回空）。
-- 别的版本不读不写，一直是空。只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Customer" ADD COLUMN "poolInvalidAt" DATETIME;
