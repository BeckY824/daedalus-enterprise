-- 企业版主渠道自己记负责人和渠道属性（获客方式）（2026-11-10，P-渠道-10 / P-渠道-11）：原来这两样只记在子渠道（Channel）上，
-- 一个子渠道都没有的主渠道没地方记。ownerId = 负责人的 User.id（不建外键，同 Channel.createdById）；attr = 字典 channelAttr 的名字。
-- 老库升级后两格都是空，由页面或数据脚本填；已有子渠道、客户、项目身上的负责人不动。只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "EntChannelMain" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "EntChannelMain" ADD COLUMN "attr" TEXT;
