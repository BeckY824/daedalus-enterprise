-- 企业版渠道名称（2026-10-29）：「渠道名称|来源」里前面那一段（平台、机构名），name 存拼好的渠道全称、照旧唯一。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Channel" ADD COLUMN "platform" TEXT;
