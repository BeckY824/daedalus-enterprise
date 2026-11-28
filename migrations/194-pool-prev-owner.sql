-- 回避名单根因（E-417 包 1）：把「最近一次放进公海时的原负责人」存成列，不再每次从 pool-release 留痕现算。
-- 只在在公海里时有意义；出公海不清，读的条件永远和「在公海里」一起判，下次再进公海会被覆盖。
-- 写列在每处写 pool-release 留痕的同一笔事务里（守卫 tests/pool-prev-owner-write-guard.test.ts）；
-- 老数据的值迁移里不许 UPDATE，由 scripts/pool-prev-owner-backfill.ts 回填。
ALTER TABLE "Project" ADD COLUMN "poolPrevOwnerId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "poolPrevOwnerId" TEXT;
CREATE INDEX IF NOT EXISTS "Project_poolPrevOwnerId_idx" ON "Project"("poolPrevOwnerId");
CREATE INDEX IF NOT EXISTS "Customer_poolPrevOwnerId_idx" ON "Customer"("poolPrevOwnerId");
