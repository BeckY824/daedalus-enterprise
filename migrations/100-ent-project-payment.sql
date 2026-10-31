-- 企业版项目回款（2026-10-31）：一笔一行（回款时间、币种、金额），项目上的「当前回款」按币种加起来。
-- 说明见 prisma/schema.prisma 的 EntProjectPayment。只在企业版写；桌面端、团队版也建这张空表，不读。
-- 规矩同 051：只加表、IF NOT EXISTS、每次启动整个重跑；userId 不建外键，项目删了随项目级联。
CREATE TABLE IF NOT EXISTS "EntProjectPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "paidAt" DATETIME NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntProjectPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EntProjectPayment_projectId_idx" ON "EntProjectPayment"("projectId");
