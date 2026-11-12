-- 企业版客户三态 · 客户公海补一列「号码不全」（2026-11-12，客户 11-12 答复 T10）：
-- 到期自动进公海不查号码（查了号码不全的就永远收不回去），收回时按退回公海那一套查一遍（客户电话 + 联系人号码，空的、不对的都算），
-- 不全就记 1，公海列表能按它筛（避免捞出去又打不通）。手动放回公海本来就要号码齐全才放得进来，为空。
-- 说明见 prisma/schema.prisma 的 CustomerPool.phoneIncomplete。规矩同 006：加列单独一个文件、只放 ADD COLUMN。
ALTER TABLE "CustomerPool" ADD COLUMN "phoneIncomplete" BOOLEAN;
