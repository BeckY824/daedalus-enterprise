-- 要求回复时间（2026-11-17，企业版新建线索两格时间 PR1）：Project.replyStartAt / replyEndAt = 客户要求联系的开始、结束时刻，填一个也行。
-- 都可空，老数据一直是空（界面「—」）；只加不改，不动旧数据。按北京时间录入、存 UTC 时刻，不存时区（待客户方确认：问题 3）。
-- 只放 ADD COLUMN 和它们的索引（README 第 4 条）：到点提醒按这两个时刻扫
ALTER TABLE "Project" ADD COLUMN "replyStartAt" DATETIME;
ALTER TABLE "Project" ADD COLUMN "replyEndAt" DATETIME;
CREATE INDEX IF NOT EXISTS "Project_replyStartAt_idx" ON "Project"("replyStartAt");
CREATE INDEX IF NOT EXISTS "Project_replyEndAt_idx" ON "Project"("replyEndAt");
