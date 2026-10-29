-- 企业版项目附件（2026-10-29）：项目详情页「附件」一节上传的文件挂在项目上。说明见 prisma/schema.prisma 的 Attachment。
-- 只有 CRM_ENTERPRISE=1 且开了项目模式时接口才认这一列；没开项目模式这一列一直是空。不建外键，理由同 062。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Attachment" ADD COLUMN "projectId" TEXT;
CREATE INDEX IF NOT EXISTS "Attachment_projectId_idx" ON "Attachment"("projectId");
