-- 用飞书身份登录（2026-10-30）：User 记下第一次用飞书登录时认到的飞书 open_id，之后按它认人。
-- 第一次按姓名对上、绑定；可空、唯一（一个飞书身份只对应一个账号）。说明见 src/lib/enterprise/feishu-login.ts。
-- 只放 ADD COLUMN + 配套索引（README 第 4 条）。
ALTER TABLE "User" ADD COLUMN "feishuOpenId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_feishuOpenId_key" ON "User"("feishuOpenId");
