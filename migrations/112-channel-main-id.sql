-- 企业版渠道两层（2026-11-08）：渠道（子渠道）挂哪个主渠道；老渠道空着，渠道页打开时按渠道名称（platform）补上（lib/enterprise/channel-main.ts 补主渠道）。
-- 主渠道删了变空（ON DELETE SET NULL），和 prisma/schema.prisma 的 Channel.main 一致。只放 ADD COLUMN 和它的索引（README 第 4 条）。
ALTER TABLE "Channel" ADD COLUMN "mainId" TEXT REFERENCES "EntChannelMain" ("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "Channel_mainId_idx" ON "Channel"("mainId");
