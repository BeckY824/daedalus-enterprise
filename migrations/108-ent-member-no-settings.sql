-- 企业版「不管设置」（2026-11-01 权限只认业务角色）：总管理勾上以后进不了设置页，其余总管理权限照旧。
-- 默认 0 = 没勾；别的角色勾了也没用（进设置本来就只给总管理）。只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "EntMember" ADD COLUMN "noSettings" BOOLEAN NOT NULL DEFAULT false;
