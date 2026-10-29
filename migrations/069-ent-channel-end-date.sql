-- 企业版渠道结束日期（2026-10-29）：可空。累计运营天数 = 创建日期到结束日期，没填就算到今天。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Channel" ADD COLUMN "endDate" DATETIME;
