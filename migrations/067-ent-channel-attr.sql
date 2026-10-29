-- 企业版渠道属性（2026-10-29）：一个渠道 = 一个来源，属性取字典 channelAttr（公域引流、客户介绍……），见 lib/enterprise/dict-kinds.ts。
-- 存字典项的名字，不存 id：字典项只停用不删，改名后旧渠道照旧显示原名，同 064 的 custStatus。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "Channel" ADD COLUMN "attr" TEXT;
