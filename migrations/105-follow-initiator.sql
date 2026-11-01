-- 企业版沟通的「发起主体」（2026-11-01 客户答复 #2）：双方约定 / 我方发起 / 客户发起 / 内部会议，选项在企业版字典 followInitiator。
-- 记沟通时必填、默认「我方发起」；老记录、别的版本一直是空。只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "FollowUp" ADD COLUMN "initiator" TEXT;
