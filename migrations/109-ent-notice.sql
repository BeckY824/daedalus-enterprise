-- 企业版站内通知（2026-11-01）：一条通知一行，顶栏铃铛读这里；飞书推送开着时同一行再推一份到飞书，结果记在 feishu* 三列。
-- 说明见 prisma/schema.prisma 的 EntNotice。只在企业版写；桌面端、团队版也建这张空表，不读。
-- 规矩同 100（编号跳过 106–108：别的分支在用）：只加表、IF NOT EXISTS、每次启动整个重跑；userId 不建外键（同 EntHandover，账号停用不删）。
CREATE TABLE IF NOT EXISTS "EntNotice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" DATETIME,
    "feishuStatus" TEXT NOT NULL DEFAULT '待推',
    "feishuError" TEXT,
    "feishuAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "EntNotice_userId_dedupeKey_key" ON "EntNotice"("userId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "EntNotice_userId_readAt_idx" ON "EntNotice"("userId", "readAt");
CREATE INDEX IF NOT EXISTS "EntNotice_userId_createdAt_idx" ON "EntNotice"("userId", "createdAt");
