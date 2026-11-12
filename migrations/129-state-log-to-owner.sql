-- 企业版客户三态 · 状态留痕补一列「到谁」（2026-11-12，客户 11-12 答复 T7）：撤销转让那一行记被撤的那次转让转给了谁。别的留痕为空。
-- 说明见 prisma/schema.prisma 的 EntCustomerStateLog.toOwnerId。规矩同 006：加列单独一个文件、只放 ADD COLUMN。
ALTER TABLE "EntCustomerStateLog" ADD COLUMN "toOwnerId" TEXT;
