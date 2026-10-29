-- 企业版关联客户（2026-10-29，定稿 P5 待定 15）：手动选一个客户、填一句关系说明，两边客户页都看得到。说明见 prisma/schema.prisma 的 EntCustomerLink。
-- 规矩同 057：只加表、IF NOT EXISTS、每次启动整个重跑；两头客户删了随客户级联，指向人的列不建外键（同 051）。
-- 一对客户只记一行：存的时候 customerId 放小的、otherId 放大的（lib/enterprise/customer-v2.ts 的 关联对），唯一索引兜底。
CREATE TABLE IF NOT EXISTS "EntCustomerLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "otherId" TEXT NOT NULL,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntCustomerLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EntCustomerLink_otherId_fkey" FOREIGN KEY ("otherId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "EntCustomerLink_customerId_otherId_key" ON "EntCustomerLink"("customerId", "otherId");
CREATE INDEX IF NOT EXISTS "EntCustomerLink_otherId_idx" ON "EntCustomerLink"("otherId");
