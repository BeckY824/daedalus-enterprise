-- 企业版客户三态 · 客户钟补一列「项目推进底日」（2026-11-12，客户 11-12 第二轮答复 S7）：
-- 建项目、换节点拨过的钟按既成事实算、不追溯——项目后来作废、删了（软删读不到），夜扫重算也不能把钟算回去。
-- 每次夜扫把算到的最近项目推进日记在这里，只往后挪；之后算最近推进日时和它取较晚的。空 = 还没记过。
-- 说明见 prisma/schema.prisma 的 EntCustomerClock.progressDay。规矩同 006：加列单独一个文件、只放 ADD COLUMN。
ALTER TABLE "EntCustomerClock" ADD COLUMN "progressDay" TEXT;
