-- 改密作废旧会话（2026-11-03）：自部署 User 记下最近一次改密时刻，比它早签发的会话（payload.ims）一律作废。
-- 可空：没改过密的老账号不受影响。说明见 src/lib/auth.ts getSessionUser。
-- 只放 ADD COLUMN（README 第 4 条）。
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" DATETIME;
