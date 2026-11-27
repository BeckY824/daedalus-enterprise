-- 撤培育计划按 (projectId, autoBy, done) 找（2026-11-27，客户 E-396），配 174 / 175 两列
CREATE INDEX IF NOT EXISTS "FollowPlan_projectId_autoBy_done_idx" ON "FollowPlan"("projectId", "autoBy", "done");
