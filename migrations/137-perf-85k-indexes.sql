-- 8.5 万客户 30 人并发提速（2026-11-14）：五个只加不改的索引。规矩同前：只加索引、IF NOT EXISTS、每次启动整个重跑。
-- 1) 公海按入池时间倒序翻页（lib/enterprise/unified-pool-db.ts）：原来没有 at 的索引，取最新一批要整表排序（6.6 万公海 23 ms → 0.8 ms）。
--    同一刻入池的按客户 id 正序，和页面上的排序（筛排 的 比id）一致，所以带上 customerId、at 倒着建。
CREATE INDEX IF NOT EXISTS "CustomerPool_at_customerId_idx" ON "CustomerPool"("at" DESC, "customerId");
-- 2) 客户列表按建档时间倒序翻页：查询总带着 deletedAt IS NULL，SQLite 先挑区分度很低的 deletedAt 索引再整表排序（8.5 万客户第 1 页 22 ms → 0.7 ms）
CREATE INDEX IF NOT EXISTS "Customer_deletedAt_createdAt_id_idx" ON "Customer"("deletedAt", "createdAt", "id");
-- 3) 跟进记录页按发生时间倒序取前 300 条：同上，原来走 deletedAt 索引再把 25 万条跟进整表排序（224 ms → 2.7 ms）
CREATE INDEX IF NOT EXISTS "FollowUp_deletedAt_occurredAt_idx" ON "FollowUp"("deletedAt", "occurredAt");
-- 4) 看得到的跟进数（lib/scope-sql.ts）公海那一路：从公海表出发逐位数跟进，跟进这头只读索引不回表（20 万条 150 ms → 35 ms）；
--    type / ownerId 是跟进记录页的两个筛选，放进来数的时候照样不回表
CREATE INDEX IF NOT EXISTS "FollowUp_customerId_deletedAt_type_ownerId_idx" ON "FollowUp"("customerId", "deletedAt", "type", "ownerId");
-- 5) 号码搜索里联系人号码子表那一路（lib/search-keyword.ts 联系人子表号SQL）：每行现算 20 层 replace（7.4 万行 137 ms），
--    建成表达式索引后直接读索引里存好的号键（5 ms）。式子必须和 号键SQL('"value"') 原样一致，查询计划才认（tests/perf-85k-indexes.test.ts 钉着）；
--    不改用 numberKey 列：它是查重的键（验号码 的 键），和号键不是同一个规则（WhatsApp 的键是小写的，导入、老键各有各的写法），换过去搜出来的会不一样
CREATE INDEX IF NOT EXISTS "ContactMethod_kind_valueKey_idx" ON "ContactMethod"("kind", replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace("value", '０', '0'), '１', '1'), '２', '2'), '３', '3'), '４', '4'), '５', '5'), '６', '6'), '７', '7'), '８', '8'), '９', '9'), ' ', ''), '　', ''), '-', ''), '－', ''), '—', ''), '(', ''), ')', ''), '（', ''), '）', ''), '+', ''), "customerId", "contactId");
