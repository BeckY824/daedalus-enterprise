-- 客户搜索补简称（2026-11-17，客户抬头 PR-0）：只加索引，规矩同 137 / 138 / 143（IF NOT EXISTS、每次启动整个重跑）。
-- 简称（Customer.shortName）不在三字索引（141）里，FTS5 表也加不了列；不另建索引表（那要再登记一条迁移例外、挂触发器、每次启动回填），
-- 改成一条部分索引，只收有简称的行。搜索按它逐个 GLOB（src/lib/search-keyword.ts 简称SQL）：只扫有简称的那几位，两个字的简称一样走它。
-- 简称几乎都空（正式库 11-17：8.6 万位里 0 位有值），索引很小。本机 8.6 万客户库量过（11-17）：只比简称那一句，简称全空 0.0 ms（不建索引整表扫 7 ms），
-- 8.6 万位全填满 3 ms；整页搜索（客户列表 / 公海）简称全空时和改前分不出差别，全填满时三个字以上的词多 5–8 ms。tests/search-trigram.test.ts 钉查询计划
CREATE INDEX IF NOT EXISTS "Customer_shortName_idx" ON "Customer"("shortName") WHERE "shortName" IS NOT NULL;
