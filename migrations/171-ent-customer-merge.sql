-- 企业版合并客户的合并单（2026-11-25，客户 E-277 / E-280 第一批）：说明见 prisma/schema.prisma 的 EntCustomerMerge、lib/enterprise/customer-merge.ts。
-- 规矩同 164：只加表、IF NOT EXISTS、每次启动整个重跑；指向人、客户的列都不建外键（被并的客户 30 天后清掉，合并单照留）。
-- 编号跳过 168–170（另一分支已占）。
CREATE TABLE IF NOT EXISTS "EntCustomerMerge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT '客户',
    "fromId" TEXT NOT NULL,
    "intoId" TEXT NOT NULL,
    "parentId" TEXT,
    "status" TEXT NOT NULL DEFAULT '已合并',
    "byUserId" TEXT NOT NULL,
    "approvals" TEXT,
    "fromName" TEXT NOT NULL,
    "fromNo" INTEGER,
    "fromOwnerId" TEXT,
    "fromCreatorId" TEXT,
    "fromChannelId" TEXT,
    "fromTouchpoint" TEXT,
    "counts" TEXT NOT NULL DEFAULT '{}',
    "detail" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" DATETIME,
    "undoneById" TEXT,
    "undoLeft" TEXT
);
CREATE INDEX IF NOT EXISTS "EntCustomerMerge_fromId_status_idx" ON "EntCustomerMerge"("fromId", "status");
CREATE INDEX IF NOT EXISTS "EntCustomerMerge_intoId_status_idx" ON "EntCustomerMerge"("intoId", "status");
CREATE INDEX IF NOT EXISTS "EntCustomerMerge_status_at_idx" ON "EntCustomerMerge"("status", "at");
