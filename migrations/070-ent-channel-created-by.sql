-- 企业版渠道创建人（2026-10-29）：可空，老渠道和导入时对不上人的留空。指向人的列不建外键（同 051）。
-- 只放 ADD COLUMN（README 第 4 条），配套索引同文件。
ALTER TABLE "Channel" ADD COLUMN "createdById" TEXT;
CREATE INDEX IF NOT EXISTS "Channel_createdById_idx" ON "Channel"("createdById");
