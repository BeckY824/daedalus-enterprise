-- ④ 扫库检测的查询记录与触发名单（2026-11-27，E-383 第 1 阶段）：说明见 prisma/schema.prisma 的 EntScanQuery / EntScanTrigger、lib/enterprise/scan-query.ts。
-- 规矩同 171：只加表、IF NOT EXISTS、每次启动整个重跑；userId / notifiedTo 不建外键。号码、客户名原文不进库，只存指纹
CREATE TABLE IF NOT EXISTS "EntScanQuery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "hit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "EntScanQuery_userId_day_keyType_keyHash_key" ON "EntScanQuery"("userId", "day", "keyType", "keyHash");
CREATE INDEX IF NOT EXISTS "EntScanQuery_day_userId_idx" ON "EntScanQuery"("day", "userId");
CREATE TABLE IF NOT EXISTS "EntScanTrigger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "day" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "queries" INTEGER NOT NULL,
    "hits" INTEGER NOT NULL,
    "notifiedTo" TEXT,
    "noticeAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "EntScanTrigger_day_userId_key" ON "EntScanTrigger"("day", "userId");
