-- 指定分配时间（2026-11-17，企业版新建线索两格时间 PR3）：Project.scheduledAssignAt = 到点分配的时刻，scheduledAssignTo = 指定分配到点分给谁（空 = 自动分配）。
-- 都可空，老数据一直是空；只加不改，不动旧数据。到点由后台定时任务执行（lib/enterprise/scheduled-assign.ts）。
-- 只放 ADD COLUMN 和索引（README 第 4 条）
ALTER TABLE "Project" ADD COLUMN "scheduledAssignAt" DATETIME;
ALTER TABLE "Project" ADD COLUMN "scheduledAssignTo" TEXT;
CREATE INDEX IF NOT EXISTS "Project_scheduledAssignAt_idx" ON "Project"("scheduledAssignAt");
