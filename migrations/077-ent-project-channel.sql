-- 企业版项目来源（2026-10-29）：每个项目各记各的渠道（存渠道 id，界面写渠道全称）；可空。
-- 客户来源（Customer.channelId）记第一次的渠道，不跟着改。渠道统计按项目来源算，老项目没填的退回去用客户来源。
-- 渠道删了项目来源变空（ON DELETE SET NULL），和 prisma/schema.prisma 的 Project.channel 一致。
-- 只放 ADD COLUMN 和它的索引（README 第 4 条）。
ALTER TABLE "Project" ADD COLUMN "channelId" TEXT REFERENCES "Channel" ("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "Project_channelId_idx" ON "Project"("channelId");
