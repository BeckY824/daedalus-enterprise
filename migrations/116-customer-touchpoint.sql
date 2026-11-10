-- 企业版客户「渠道触点」（P-渠道-08）：公司资源 / 客户介绍。这两类客户主渠道（channelId）留空、由触点标来源性质；
-- 主渠道和触点至少填一个。空 = 没填（老数据、别的版本一直是空）。只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "Customer" ADD COLUMN "touchpoint" TEXT;
