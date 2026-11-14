-- 8.5 万客户 30 人并发提速第二轮（2026-11-14）：只加不改的索引。规矩同 137：只加索引、IF NOT EXISTS、每次启动整个重跑。
-- 每条都拿 Prisma 实际发出的句子 EXPLAIN 过、受影响表的主要查询复核过没被带歪（tests/perf-85k-indexes.test.ts 钉着）。
-- 1) 客户详情「他推荐来的人」（customers/[id]/page.tsx 的 referrals）：Prisma 发的是 deletedAt IS NULL AND referrerCustomerId IN (?) ORDER BY createdAt DESC，
--    只有 referrerCustomerId 单列索引时，没统计信息的 SQLite 挑 (deletedAt, createdAt, id) 省掉排序、顺着扫整张客户表（8.5 万客户 23–85 ms → 0.01 ms）。
--    两个等值列打头、排序列跟在后面，等值 + 排序都在索引里
CREATE INDEX IF NOT EXISTS "Customer_referrerCustomerId_deletedAt_createdAt_idx" ON "Customer"("referrerCustomerId", "deletedAt", "createdAt");
-- 没加的：记录页窄名单按 lastFollowAt 排（不限定的人 21 ms）。试过 (deletedAt, lastFollowAt, createdAt)：不限定的人 21 → 0.03 ms，
--    但「我的」、名下没几位的业务员按负责人筛的那几句被它抢走、顺着它扫整表（0.01 → 18 ms），得不偿失，没留
