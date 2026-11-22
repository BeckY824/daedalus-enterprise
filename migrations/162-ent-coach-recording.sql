-- 企业版录音点评（2026-11-22，录音点评 PR2：录音存储与上传）：一条录音一行（传录音文件、按住说话、点按录音都是一行），文件在数据目录 coach-rec/<年月>/<id>/。
-- 说明见 prisma/schema.prisma 的 EntCoachRecording、lib/enterprise/coach-rec.ts。转写（PR4）、整理和发出（PR5）要用的列这次一起建好，之后不再加列。
-- 规矩同 160：只加表、IF NOT EXISTS、每次启动整个重跑；指向项目、人、主题的列都不建外键（项目真删后留下的行由清理任务收）。
CREATE TABLE IF NOT EXISTS "EntCoachRecording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '上传中',
    "sourceKind" TEXT NOT NULL,
    "fileName" TEXT,
    "mime" TEXT,
    "format" TEXT,
    "bytes" INTEGER,
    "chunks" INTEGER NOT NULL DEFAULT 0,
    "segCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "sampleRate" INTEGER,
    "audioPath" TEXT,
    "interrupts" TEXT,
    "transcript" TEXT,
    "segments" TEXT,
    "speakers" INTEGER,
    "engine" TEXT,
    "asrTaskId" TEXT,
    "asrSubmittedAt" DATETIME,
    "draftTitle" TEXT,
    "draftBody" TEXT,
    "error" TEXT,
    "topicId" TEXT,
    "remindedAt" DATETIME,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "deletedAt" DATETIME,
    "audioPurgedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS "EntCoachRecording_authorId_status_idx" ON "EntCoachRecording"("authorId", "status");
CREATE INDEX IF NOT EXISTS "EntCoachRecording_projectId_idx" ON "EntCoachRecording"("projectId");
CREATE INDEX IF NOT EXISTS "EntCoachRecording_status_idx" ON "EntCoachRecording"("status");
CREATE INDEX IF NOT EXISTS "EntCoachRecording_topicId_idx" ON "EntCoachRecording"("topicId");
