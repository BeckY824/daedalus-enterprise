-- 企业版联系人记「谁建的」（2026-11-12，只负责项目的人看客户）：受限客户详情里，只负责项目的人只能改自己新建的联系人。
-- 空 = 老数据或不是从受限详情建的（这些他一律改不了）。规矩同 006：加列单独一个文件、只放 ADD COLUMN（配套索引可同文件）。
ALTER TABLE "Contact" ADD COLUMN "createdById" TEXT;
CREATE INDEX IF NOT EXISTS "Contact_createdById_idx" ON "Contact"("createdById");
