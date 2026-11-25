-- 老客户重复咨询的只读来源字段（2026-11-23，客户 E-218）：带「老客户重复咨询」标记（Project.source = 'repeat-inquiry'）的线索建时写，之后不改。
-- repeatOfCustomerId = 撞上的那位原始客户 id（不建外键，只是来源记号）；repeatSeq = 这位客户的第几次重复咨询（1、2、3……）。
-- 项目名「重复咨询-NO.客户编号」第 2 次起加「-2」「-3」按 repeatSeq 取；负责人改了项目名，检索、统计、详情照样读这两列。
-- 唯一索引保证同一位客户下序号不撞（两列都空的老数据不受限：SQLite 唯一索引里 NULL 互不相等）。
-- 都可空，老数据一直是空、旧版本代码不读这两列照常能跑；只加不改。只放 ADD COLUMN 和索引（README 第 4 条）
ALTER TABLE "Project" ADD COLUMN "repeatOfCustomerId" TEXT;
ALTER TABLE "Project" ADD COLUMN "repeatSeq" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "Project_repeatOfCustomerId_repeatSeq_key" ON "Project"("repeatOfCustomerId", "repeatSeq");
