-- 企业版客户三态的状态留痕（2026-11-11，机制表 M-公海-31、M-公海-23）：每次状态变更、每次继续持有 / 代选 / 裁决一行，
-- 谁、什么时间、从哪个状态到哪个状态、怎么改的（自动 / 本人 / 上级代选 / 总管理裁决）、理由。事后解释「为什么那天收了」查它。
-- 说明见 prisma/schema.prisma 的 EntCustomerStateLog。只在企业版写；桌面端、团队版也建这张空表，不读。
-- 规矩同 088：只加表、IF NOT EXISTS、每次启动整个重跑；userId 不建外键（自动的为空），客户删了随客户级联。
CREATE TABLE IF NOT EXISTS "EntCustomerStateLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "userId" TEXT,
    "via" TEXT NOT NULL DEFAULT '自动',
    "reason" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntCustomerStateLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EntCustomerStateLog_customerId_at_idx" ON "EntCustomerStateLog"("customerId", "at");
