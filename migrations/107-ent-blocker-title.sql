-- 企业版卡点 11-01 改版：重建 EntBlocker 表——加标题列 + followUpId 改可空、沟通删了置空（ON DELETE SET NULL）。
-- 老库（052 建的）followUpId 是 NOT NULL + 级联：沟通彻底删除（含回收站过期）会把卡点一起删掉，
-- 「卡点脱离沟通」也写不进 NULL。SQLite 改不了列约束，只能 建新表 → 拷数据 → 删旧表 → 改名 → 补索引。
-- 这是 README 第 3 条的第二个例外（第一个是 066），测试里按文件名单独放行，见 tests/migration-allowed-drops.ts 许可重建的文件。
--
-- 怎么保证只跑一次：第一条建 followUpId 索引，故意不带 IF NOT EXISTS。
--   · 全新安装：schema.sql（prisma 生成）已经有这个索引 → 抛 already exists → 本文件其余语句跳过；
--   · 老库第一次：建成功 → 往下重建（旧表删掉时这个索引跟着没了，重建后在新表上再建一次）；
--   · 以后每次启动：索引已在 → 抛 already exists → 跳过。
-- 记号必须放在事务外面：放在 BEGIN 里抛错会留下一个没结束的事务，把后面所有迁移文件都吞进去。
-- 已知边角：重建事务中途进程被杀（记号已建、事务回滚）→ 表保持老结构、以后不再重建；
-- 代码对老结构有兜底（src/lib/project/blocker.ts 沟通列可空 / 卡点脱离沟通），需要时手工重跑本文件后半段。
-- 标题：老库没有标题列，拷过去是 ''，由启动后的一次性改版任务取描述前 20 字补上。
CREATE INDEX "EntBlocker_followUpId_idx" ON "EntBlocker"("followUpId");
PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE IF NOT EXISTS "EntBlocker_107" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "projectId" TEXT NOT NULL,
    "followUpId" TEXT,
    "customerId" TEXT NOT NULL,
    "contactId" TEXT,
    "phase" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "obstacle" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dueDays" INTEGER NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT '待接受',
    "assigneeId" TEXT,
    "creatorId" TEXT NOT NULL,
    "resourceRequest" TEXT,
    "progress" TEXT,
    "solution" TEXT,
    "result" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntBlocker_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EntBlocker_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "EntBlocker_107" ("id", "code", "projectId", "followUpId", "customerId", "contactId", "phase", "type", "impact", "obstacle", "description", "dueDays", "dueAt", "status", "assigneeId", "creatorId", "resourceRequest", "progress", "solution", "result", "resolvedAt", "createdAt", "updatedAt")
SELECT "id", "code", "projectId", "followUpId", "customerId", "contactId", "phase", "type", "impact", "obstacle", "description", "dueDays", "dueAt", "status", "assigneeId", "creatorId", "resourceRequest", "progress", "solution", "result", "resolvedAt", "createdAt", "updatedAt" FROM "EntBlocker";
DROP TABLE "EntBlocker";
ALTER TABLE "EntBlocker_107" RENAME TO "EntBlocker";
CREATE UNIQUE INDEX IF NOT EXISTS "EntBlocker_code_key" ON "EntBlocker"("code");
CREATE INDEX IF NOT EXISTS "EntBlocker_projectId_status_idx" ON "EntBlocker"("projectId", "status");
CREATE INDEX IF NOT EXISTS "EntBlocker_assigneeId_status_idx" ON "EntBlocker"("assigneeId", "status");
CREATE INDEX IF NOT EXISTS "EntBlocker_followUpId_idx" ON "EntBlocker"("followUpId");
COMMIT;
PRAGMA foreign_keys=ON;
