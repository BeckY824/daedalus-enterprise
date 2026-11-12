-- 企业版客户三态 · 状态留痕补一列「这次顺延了几天」（2026-11-12，机制表 M-公海-19，三态落地计划 P4 / P6）：
-- 继续持有（本人点、上级代选）每次顺延的天数是点的那一刻组织规则里的每次天数，规则后改不回改历史，所以跟着那一行存下来；
-- 计时按这几行把三个节点一起往后挪、额度按它数已用几次 / 几天。别的留痕（自动换状态、暂缓回收）为空。
-- 说明见 prisma/schema.prisma 的 EntCustomerStateLog.holdDays。规矩同 006：加列单独一个文件、只放 ADD COLUMN。
ALTER TABLE "EntCustomerStateLog" ADD COLUMN "holdDays" INTEGER;
