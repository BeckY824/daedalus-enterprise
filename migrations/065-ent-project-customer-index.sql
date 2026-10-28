-- 企业版项目 / 客户的三条索引（2026-10-28）。只建索引，不动表。
-- 项目页、企业版新线索页按最近更新倒序取前 500（lib/project/list.ts 读项目列表）：
-- Project 上原来只有 customerId / ownerId / sourceLeadId / pooledAt 的索引，每次打开都要把整张表排一遍。
-- 新线索页按阶段筛（phase = "线索"）走 (phase, updatedAt)；项目页不筛阶段走 updatedAt。
CREATE INDEX IF NOT EXISTS "Project_phase_updatedAt_idx" ON "Project"("phase", "updatedAt");
CREATE INDEX IF NOT EXISTS "Project_updatedAt_idx" ON "Project"("updatedAt");
-- 企业版首页「意向客户」按客户状态数（dashboard/page.tsx，custStatus = "意向"），原来要扫整张客户表。
CREATE INDEX IF NOT EXISTS "Customer_custStatus_idx" ON "Customer"("custStatus");
