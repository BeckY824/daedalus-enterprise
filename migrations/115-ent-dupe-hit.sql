-- 企业版撞号台账（2026-11-10，机制表 P-挂靠-01 / X-48）：新建客户时号码或客户名撞上已有客户，一次命中一行；三档预警按它数。
-- 说明见 prisma/schema.prisma 的 EntDupeHit。只在企业版写；桌面端、团队版也建这张空表，不读。
-- 规矩同 109：只加表、IF NOT EXISTS、每次启动整个重跑；userId / ownerId / customerId 不建外键。
CREATE TABLE IF NOT EXISTS "EntDupeHit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "keyValue" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "ownerId" TEXT,
    "sameGroup" BOOLEAN NOT NULL DEFAULT false,
    "action" TEXT,
    "actionAt" DATETIME,
    "result" TEXT NOT NULL DEFAULT '拦截',
    "status" TEXT NOT NULL DEFAULT '无需处置',
    "warnTier" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "EntDupeHit_userId_customerId_createdAt_idx" ON "EntDupeHit"("userId", "customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "EntDupeHit_customerId_createdAt_idx" ON "EntDupeHit"("customerId", "createdAt");
