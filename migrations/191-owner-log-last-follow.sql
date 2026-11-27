-- 12-22 逐项选：转的那一刻客户的最近一次跟进时间，留在换负责人记录上（可空）
ALTER TABLE "CustomerOwnerLog" ADD COLUMN "lastFollowAt" DATETIME;
