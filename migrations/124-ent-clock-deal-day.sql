-- 企业版客户三态 · 客户钟补一列「成交成立日」（2026-11-12，机制表 M-公海-21，三态落地计划 P2 补列）：
-- 「成交过」一旦成立就永久按成交客户的活跃段算（后来项目重启、新开项目都不掉回普通天数），所以成立那天存下来、不每次现算。
-- 上海日 YYYY-MM-DD；空 = 还没成立。夜扫第一次判出成立时写，之后不再改。说明见 prisma/schema.prisma 的 EntCustomerClock.dealDay。
-- 规矩同 006：加列单独一个文件、只放 ADD COLUMN，重跑抛 duplicate column name 由 runner 当预期跳过。
ALTER TABLE "EntCustomerClock" ADD COLUMN "dealDay" TEXT;
