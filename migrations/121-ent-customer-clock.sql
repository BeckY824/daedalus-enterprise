-- 企业版客户三态的「客户钟」（2026-11-11，机制表 M-公海-16、M-公海-19、M-公海-27、M-公海-31）：钟挂在客户身上，一位客户一行。
-- 记现在是哪个状态、哪天进的、本轮提醒了几次、继续持有用了几次 / 几天、推后到哪天、最后一次理由、是不是被同事的项目挡住。
-- 说明见 prisma/schema.prisma 的 EntCustomerClock。只在企业版、开了三态时由夜扫和按钮写；桌面端、团队版也建这张空表，不读。
-- 规矩同 088：只加表、IF NOT EXISTS、每次启动整个重跑；客户删了随客户级联。日子都存上海时间的 YYYY-MM-DD。
CREATE TABLE IF NOT EXISTS "EntCustomerClock" (
    "customerId" TEXT NOT NULL PRIMARY KEY,
    "state" TEXT NOT NULL DEFAULT '活跃',
    "enteredDay" TEXT NOT NULL,
    "noticeCount" INTEGER NOT NULL DEFAULT 0,
    "lastNoticeDay" TEXT,
    "holdCount" INTEGER NOT NULL DEFAULT 0,
    "holdDays" INTEGER NOT NULL DEFAULT 0,
    "holdUntil" TEXT,
    "holdReason" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntCustomerClock_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EntCustomerClock_state_enteredDay_idx" ON "EntCustomerClock"("state", "enteredDay");
