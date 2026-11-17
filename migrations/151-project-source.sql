-- 项目来源 + 回填批次号（2026-11-18，企业版「历史沟通分析」一次性回填前置）：
-- Project.source 空 = 系统里正常建的，"history-analysis" = 历史沟通分析回填的项目；Project.importBatch = 回填批次号。
-- 都可空，老数据一直是空、旧版本代码不读这两列照常能跑；只加不改，不动旧数据。
-- 统计怎么排除它们见 src/lib/project/system-created.ts。只放 ADD COLUMN 和索引（README 第 4 条）
ALTER TABLE "Project" ADD COLUMN "source" TEXT;
ALTER TABLE "Project" ADD COLUMN "importBatch" TEXT;
CREATE INDEX IF NOT EXISTS "Project_source_pooledAt_idx" ON "Project"("source", "pooledAt");
