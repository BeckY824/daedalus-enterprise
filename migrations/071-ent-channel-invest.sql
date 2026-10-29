-- 企业版渠道投入（2026-10-29）：一条一笔，渠道、金额、币种、日期、备注、谁录的、录入时间。
-- 说明见 prisma/schema.prisma 的 EntChannelInvest。只在企业版写；别的版本也建这张空表，不读。
-- 规矩同 057：只加表、IF NOT EXISTS、每次启动整个重跑；渠道删了随渠道级联，指向人的列不建外键（同 051）。
CREATE TABLE IF NOT EXISTS "EntChannelInvest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "date" DATETIME NOT NULL,
    "remark" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntChannelInvest_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EntChannelInvest_channelId_date_idx" ON "EntChannelInvest"("channelId", "date");
