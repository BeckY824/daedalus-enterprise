-- 企业版软删与回收站（2026-10-29，定稿 P9 第 28 条）：项目删了只记删除时间，进回收站，30 天后自动清掉。
-- 空 = 没删；有值 = 删于这一刻。读的时候由 lib/enterprise/soft-delete.ts 统一滤掉；别的版本一直是空。
-- 只放 ADD COLUMN 和它的索引（README 第 4 条）。
ALTER TABLE "Project" ADD COLUMN "deletedAt" DATETIME;
CREATE INDEX IF NOT EXISTS "Project_deletedAt_idx" ON "Project"("deletedAt");
