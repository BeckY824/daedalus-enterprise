-- 企业版客户三态 · 客户钟补一列「额度上次重置日」（2026-11-12，机制表 M-公海-38，三态落地计划 P2 补列）：
-- 记了一条有内容的沟通，继续持有的次数和合计顺延天数回满；同一天多条只算一次，靠这一列认「这天已经回满过」。
-- 上海日 YYYY-MM-DD；空 = 从没回满过。夜扫和继续持有按钮读的时候判、写。说明见 prisma/schema.prisma 的 EntCustomerClock.quotaResetDay。
-- 规矩同 006：加列单独一个文件、只放 ADD COLUMN。
ALTER TABLE "EntCustomerClock" ADD COLUMN "quotaResetDay" TEXT;
