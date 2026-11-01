-- 企业版项目线索的「分配方式」「待分配」「业务线」（2026-11-01 会议 §1 / §3，清单 A1 / A6 / A7 / A10）：
-- Project.assignMode = 建线索时选的分配方式名字；Project.awaitAssignAt = 暂不分配 / 自动分配挑不到人时记的那一刻，分出去就清；
-- Project.bizLine、Customer.bizLine = 手动选的业务线（内贸 / 外贸 / 暂不分配），自动分配按项目的业务线挑人，超时回收按它分内外贸时长；暂不分配不进自动分配。
-- 都可空，老数据、团队版一直是空。只放 ADD COLUMN 和建索引（README 第 4 条）
ALTER TABLE "Project" ADD COLUMN "assignMode" TEXT;
ALTER TABLE "Project" ADD COLUMN "awaitAssignAt" DATETIME;
ALTER TABLE "Project" ADD COLUMN "bizLine" TEXT;
ALTER TABLE "Customer" ADD COLUMN "bizLine" TEXT;
CREATE INDEX IF NOT EXISTS "Project_awaitAssignAt_idx" ON "Project"("awaitAssignAt");
