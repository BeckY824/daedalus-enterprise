-- 企业版项目加「痛点标注」「合同状态」（2026-10-31）：项目详情 / 编辑项目里可改，也进节点必填目录。
-- painPoints：痛点标注（多行文字）；contractStatus：合同状态（起草中 / 待对方确认 / 待我方确认 / 对方修改中 / 我方修改中 / 已生效 / 已终止）。
-- 都可空。新建项目写「起草中」；老项目留空、界面按「起草中」显示，这里不回填。
-- 「项目方案」是附件（Attachment.tag = '方案'），附件表已有 tag 列，不用加列。说明见 prisma/schema.prisma 的 Project。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Project" ADD COLUMN "painPoints" TEXT;
ALTER TABLE "Project" ADD COLUMN "contractStatus" TEXT;
