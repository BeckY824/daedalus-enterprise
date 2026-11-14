-- 8.5 万客户 30 人并发提速（2026-11-14）：七个只加不改的索引。规矩同前：只加索引、IF NOT EXISTS、每次启动整个重跑。
-- 1) 公海按入池时间倒序翻页（lib/enterprise/unified-pool-db.ts）：原来没有 at 的索引，取最新一批要整表排序（6.6 万公海 23 ms → 0.8 ms）。
--    同一刻入池的按客户 id 正序，和页面上的排序（筛排 的 比id）一致，所以带上 customerId、at 倒着建。
CREATE INDEX IF NOT EXISTS "CustomerPool_at_customerId_idx" ON "CustomerPool"("at" DESC, "customerId");
-- 2) 客户列表按建档时间倒序翻页：查询总带着 deletedAt IS NULL，SQLite 先挑区分度很低的 deletedAt 索引再整表排序（8.5 万客户第 1 页 22 ms → 0.7 ms）
--    业务员「我的客户」也靠它：限定层发出的是「负责人是我 OR 在公海」∧ 不在公海，带 OR 用不上负责人索引，原来同样整表排序（31 ms → 0.2 ms）
CREATE INDEX IF NOT EXISTS "Customer_deletedAt_createdAt_id_idx" ON "Customer"("deletedAt", "createdAt", "id");
-- 2b) 按负责人筛（salesOwnerId = ? 不带 OR）：只有 2) 时没统计信息的 SQLite 会改顺 2) 扫、边扫边挑人，
--     名下没几位非公海客户的人要扫完整表（0.1 ms → 14 ms）。负责人打头、后面同 2)，等值 + 排序都在索引里
CREATE INDEX IF NOT EXISTS "Customer_salesOwnerId_deletedAt_createdAt_id_idx" ON "Customer"("salesOwnerId", "deletedAt", "createdAt", "id");
-- 3) 跟进记录页按发生时间倒序取前 300 条：同上，原来走 deletedAt 索引再把 25 万条跟进整表排序（224 ms → 2.7 ms）
CREATE INDEX IF NOT EXISTS "FollowUp_deletedAt_occurredAt_idx" ON "FollowUp"("deletedAt", "occurredAt");
-- 3b) 跟进记录页按类型筛：只有 3) 时 SQLite 改顺 3) 扫、边扫边挑类型，少见的类型（0.1%）要扫完 25 万条（1 ms → 40 ms）。
--     类型打头、后面同 3)，等值 + 排序都在索引里；末尾带 ownerId：类型 + 成员一起筛时 SQLite 照旧挑 (ownerId, occurredAt)，
--     不带的话常见类型 + 成员会被它抢走、数跟进从 6 ms 变 20 ms
CREATE INDEX IF NOT EXISTS "FollowUp_type_deletedAt_occurredAt_ownerId_idx" ON "FollowUp"("type", "deletedAt", "occurredAt", "ownerId");
-- 4) 看得到的跟进数（lib/scope-sql.ts）公海那一路：从公海表出发逐位数跟进，跟进这头只读索引不回表（20 万条 150 ms → 35 ms）；
--    type / ownerId 是跟进记录页的两个筛选，放进来数的时候照样不回表
CREATE INDEX IF NOT EXISTS "FollowUp_customerId_deletedAt_type_ownerId_idx" ON "FollowUp"("customerId", "deletedAt", "type", "ownerId");
-- 5) 号码搜索里联系人号码子表那一路（lib/search-keyword.ts 联系人子表号SQL）：每行现算 20 层 replace（7.4 万行 137 ms），
--    建成表达式索引后直接读索引里存好的号键（5 ms）。式子必须和 号键SQL('"value"') 原样一致，查询计划才认（tests/perf-85k-indexes.test.ts 钉着）；
--    不改用 numberKey 列：它是查重的键（验号码 的 键），和号键不是同一个规则（WhatsApp 的键是小写的，导入、老键各有各的写法），换过去搜出来的会不一样
CREATE INDEX IF NOT EXISTS "ContactMethod_kind_valueKey_idx" ON "ContactMethod"("kind", replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace("value", '０', '0'), '１', '1'), '２', '2'), '３', '3'), '４', '4'), '５', '5'), '６', '6'), '７', '7'), '８', '8'), '９', '9'), ' ', ''), '　', ''), '-', ''), '－', ''), '—', ''), '(', ''), ')', ''), '（', ''), '）', ''), '+', ''), "customerId", "contactId");
