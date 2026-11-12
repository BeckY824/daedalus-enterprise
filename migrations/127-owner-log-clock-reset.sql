-- 企业版客户三态 · 换负责人留痕补一列「这次归不归零」（2026-11-12，机制表 M-公海-20 / M-公海-37）：
-- 转让 / 离职交接 12 个月内满 2 次后不再归零；次数和窗口后台可改，但「改动只对之后的转让生效、不回改历史」，
-- 所以每次转让第一次被三态算到时（夜扫、按钮）就把归不归零存在这一行上，之后只读不再重算。空 = 还没算过，或不是转让 / 离职交接。
-- 撤销转让会把那一行删掉（owner-log-db.ts 删被撤的换负责人记录），它的归零跟着没了（推断）。说明见 prisma/schema.prisma 的 CustomerOwnerLog.clockReset。
-- 规矩同 006：加列单独一个文件、只放 ADD COLUMN。
ALTER TABLE "CustomerOwnerLog" ADD COLUMN "clockReset" BOOLEAN;
