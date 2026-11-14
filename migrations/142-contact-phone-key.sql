-- 联系人电话的号键表达式索引（2026-11-14，8.6 万客户提速：客户搜索、手机号筛选里像号码的那一半）。同 021 的 Customer_phoneKey_idx：
-- 搜索按 rowid 子查询只读索引里存好的号键（src/lib/search-keyword.ts 联系人号键SQL），不在联系人表上一行行现算 20 层 replace。
-- 式子必须和 号键SQL('"phone"') 原样一致（tests/search-trigram.test.ts 钉着）。规矩同前：只加索引、IF NOT EXISTS、每次启动整个重跑。
CREATE INDEX IF NOT EXISTS "Contact_phoneKey_idx" ON "Contact"(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace("phone", '０', '0'), '１', '1'), '２', '2'), '３', '3'), '４', '4'), '５', '5'), '６', '6'), '７', '7'), '８', '8'), '９', '9'), ' ', ''), '　', ''), '-', ''), '－', ''), '—', ''), '(', ''), ')', ''), '（', ''), '）', ''), '+', ''));
