-- 企业版客户三态 · 状态留痕补一列「从谁」（2026-11-12，客户 11-12 答复 T7 / T12）：
-- 撤销转让那一行记被撤的那次转让是从谁转出的（同一对负责人 7 天内「转—撤—转」第二次起撤销不还原次数，按这一对认）；
-- 负责人停用、标「待交接」那一行记停用的那位。别的留痕为空。说明见 prisma/schema.prisma 的 EntCustomerStateLog.fromOwnerId。
-- 规矩同 006：加列单独一个文件、只放 ADD COLUMN。
ALTER TABLE "EntCustomerStateLog" ADD COLUMN "fromOwnerId" TEXT;
