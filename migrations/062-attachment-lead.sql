-- 企业版联系人附件（2026-10-28）：名片识别建线索时，把拍的名片原图挂在这条线索上。说明见 prisma/schema.prisma 的 Attachment。
-- 和 opportunityId / orderId 一样不建外键：线索删了能撤销（编号不变），父记录没了满 1 天才连文件清掉（lib/attachments.ts 清孤儿）。
-- 只放 ADD COLUMN（README 第 4 条）；联系人那一列另起 063，免得这一句第二次跑抛 duplicate 把后面的也跳过。
ALTER TABLE "Attachment" ADD COLUMN "leadId" TEXT;
CREATE INDEX IF NOT EXISTS "Attachment_leadId_idx" ON "Attachment"("leadId");
