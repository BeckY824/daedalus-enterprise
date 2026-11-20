-- 待补分种类（2026-11-20，32H）：空 = 判无效记的（155）；giveup = 主动放弃（豁免）记的。判无效的线索被恢复时只作废空的那种。
-- 只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "EntLeadMakeup" ADD COLUMN "kind" TEXT;
