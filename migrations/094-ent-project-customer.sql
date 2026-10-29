-- 企业版项目关联客户（2026-10-29，P17 第 1 条）：一个项目可以关联好几位客户，每一行带「项目身份」（多选，企业字典 projCustRole：业主方 / 总包方 / 分包方……）。
-- 同一位客户在不同项目里身份可以不同，所以身份记在这张表上、不记在客户身上。说明见 prisma/schema.prisma 的 ProjectCustomer。
-- 规矩同 090：只加表、IF NOT EXISTS、每次启动整个重跑；项目或客户删了随之级联。
-- Project.customerId 还是「主客户」、意思不变；主客户不用在这里占一行，只有给主客户标了身份才写一行（不回填，见 schema 注释）。
CREATE TABLE IF NOT EXISTS "ProjectCustomer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "roles" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectCustomer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectCustomer_projectId_customerId_key" ON "ProjectCustomer"("projectId", "customerId");
-- 客户页「参与的项目」按客户取
CREATE INDEX IF NOT EXISTS "ProjectCustomer_customerId_idx" ON "ProjectCustomer"("customerId");
