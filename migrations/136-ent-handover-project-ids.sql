-- 企业版离职交接改成接手人确认才生效（2026-11-13）：「项目 → 离职交接」单条交项目也记一行待确认交接，要转的项目 id 记在这一列（JSON 数组）。
-- 转让、单条交客户、一键全部交给、老的离职交接行为空数组。说明见 prisma/schema.prisma 的 EntHandover。
-- 规矩同 006：加列单独一个文件、只放 ADD COLUMN。
ALTER TABLE "EntHandover" ADD COLUMN "projectIds" TEXT NOT NULL DEFAULT '[]';
