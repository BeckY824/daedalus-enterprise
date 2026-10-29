-- 企业版统一公海（2026-10-29）：这位客户被人主动退回公海的累计次数（客户放进公海、项目放回项目公海都算一次；超时回收、离职交接不算）。
-- 公海页「首次 / 二次 / 三次 / 多次退回」按它分。存量库没有历史次数，从 0 起数（界面上已在公海的主动退回至少算第 1 次）。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Customer" ADD COLUMN "poolReturns" INTEGER NOT NULL DEFAULT 0;
