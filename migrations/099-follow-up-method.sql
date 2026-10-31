-- 跟进记录的沟通方式（2026-10-31）：企业版按企业字典 followMethod 选（19 种，存选项名）。
-- type 照旧留着（按方式对出来），首页、统计、提醒还认 type；可空：个人版、团队版不填。说明见 src/lib/follow-method.ts。
-- 只放 ADD COLUMN + 配套索引（README 第 4 条）。
ALTER TABLE "FollowUp" ADD COLUMN "method" TEXT;
