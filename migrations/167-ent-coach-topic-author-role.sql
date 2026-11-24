-- 教练主题存发起身份（2026-11-23）：发起那一刻按什么身份发的（销售教练 / 系统管理员 / 条线总管理 / 实线上级 / 虚线上级），
-- 沟通卡和复盘列表的署名都按这一格写；空 = 这一格上线前发的老主题，读的时候按现有规则推断、推不出退回主业务角色。
-- 只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "EntCoachTopic" ADD COLUMN "authorRole" TEXT;
