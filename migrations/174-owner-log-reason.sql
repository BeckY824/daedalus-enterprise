-- 12-22 客户转让逐项选：直接转时必填的原因（客户原话摘要）留在换负责人记录上；加列单独一个文件（README 第 4 条）
ALTER TABLE "CustomerOwnerLog" ADD COLUMN "reason" TEXT;
