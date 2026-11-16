-- 4 核慢路径提速 C（2026-11-16）：只加不改的索引。规矩同 137 / 138：只加索引、IF NOT EXISTS、每次启动整个重跑。
-- 记录页窄名单（@pane/panes.tsx 学员名单）不限定的人「最近跟进的 50 位」：Prisma 那句 LEFT JOIN 公海 + deletedAt IS NULL，
--    SQLite 挑 deletedAt 索引把 1.9 万位不在公海的客户取出来临时排一遍（8.5 万客户 18–24 ms）。
--    改成裸 SQL（lib/scope-sql.ts 不限定时最近跟进的客户：+deletedAt、NOT EXISTS 公海）顺这条倒着走，凑够 50 位就停（0.03 ms）。
-- 故意不带 deletedAt 打头：(deletedAt, lastFollowAt, createdAt) 会被 deletedAt IS NULL 的句子当等值列抢走，
--    把搜索、id IN、名下没几位的人按负责人筛带去顺着扫整表（138 的注、11-16 方案 C）。没有等值列能用上这条，带 deletedAt = ? 的句子照旧走原来的。
-- 8.5 万客户建索引 < 1 秒（11-16 全量副本实测），在 15 秒等锁之内。tests/recent-follow-unscoped.test.ts 钉计划和结果
CREATE INDEX IF NOT EXISTS "Customer_lastFollowAt_createdAt_id_idx" ON "Customer"("lastFollowAt", "createdAt", "id");
