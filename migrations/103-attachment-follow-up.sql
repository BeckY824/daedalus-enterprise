-- 企业版沟通记录附件（2026-10-31）：项目上记沟通时可带截图、录音，挂在那条沟通记录上。说明见 prisma/schema.prisma 的 Attachment。
-- 只有 CRM_ENTERPRISE=1 且开了项目模式时接口才认这一列；没开项目模式这一列一直是空。不建外键，理由同 062。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Attachment" ADD COLUMN "followUpId" TEXT;
CREATE INDEX IF NOT EXISTS "Attachment_followUpId_idx" ON "Attachment"("followUpId");
