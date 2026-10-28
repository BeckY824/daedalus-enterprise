-- 企业版联系人附件（2026-10-28）：名片、联系人相关图片挂在联系人上。说明见 prisma/schema.prisma 的 Attachment。
-- 线索转客户 / 并入客户时，线索上的附件补上这一列（leadId 留着），所以线索后来删了图片也跟着联系人留下来。
-- 项目模式下名片建档直接建客户 + 联系人，图片只挂这一列。不建外键，理由同 062。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Attachment" ADD COLUMN "contactId" TEXT;
CREATE INDEX IF NOT EXISTS "Attachment_contactId_idx" ON "Attachment"("contactId");
