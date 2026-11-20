-- 导入记录按目标查（2026-11-20）：超时未跟进自动转每分钟认「导入 / 同步建的项目」（reply-overdue.ts 导入建的of），
-- 按 entity + targetId 查 EntImportRow；原来只有 [batchId, entity] 索引，查一次扫整张表。同 EntExternalRef 那条索引（043）
CREATE INDEX IF NOT EXISTS "EntImportRow_entity_targetId_idx" ON "EntImportRow"("entity", "targetId");
