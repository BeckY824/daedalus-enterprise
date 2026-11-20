-- 客户的流转线（2026-11-20，32G）：= 客户名下线索的线（最近一次写线的那条），客户公海按它分内贸 / 外贸给人看。
-- 写项目流转线时同一笔事务里带上客户（lib/enterprise/flow-line.ts）；空 = 判不出，两条线都看得到。
-- 只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "Customer" ADD COLUMN "flowLine" TEXT;
