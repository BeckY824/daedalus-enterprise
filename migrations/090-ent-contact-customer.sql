-- 企业版客户↔联系人多对多（2026-10-29，P13 第 1 条）：一位联系人可以挂在好几位客户名下（同一个人在两家公司任职、代理商的对接人同时管几家）。说明见 prisma/schema.prisma 的 ContactCustomer。
-- 规矩同 075：只加表、IF NOT EXISTS、每次启动整个重跑；两头删了随之级联。
-- Contact.customerId 还是「主客户」（权限、列表、导出都还按它走）；这张表记联系人挂着的全部客户，主客户那一行也在里面。
CREATE TABLE IF NOT EXISTS "ContactCustomer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactCustomer_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContactCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ContactCustomer_contactId_customerId_key" ON "ContactCustomer"("contactId", "customerId");
CREATE INDEX IF NOT EXISTS "ContactCustomer_customerId_idx" ON "ContactCustomer"("customerId");
-- 老数据（每位联系人的主客户那一行）不在这里补：迁移里不许 INSERT（tests/migrations.test.ts）。启动时由 lib/enterprise/customer-v2-db.ts 的
-- 联系人挂靠回填 用 INSERT OR IGNORE … SELECT 补，每次启动都重跑、已有的跳过；新建联系人 / 换主客户由代码当场写
