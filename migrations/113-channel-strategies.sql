-- 企业版运营策略（2026-11-08）：一个渠道多选几项（字典 channelStrategy），存 JSON 数组的字符串；没选 = 空。只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Channel" ADD COLUMN "strategies" TEXT;
